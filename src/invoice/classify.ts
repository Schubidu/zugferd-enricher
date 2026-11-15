import type { LineItem } from "./model";

/** Categories suggest what a position describes, never a tax rate or money amount. */
export const CATEGORY_IDS = [
  "accommodation", "food", "beverage", "parking", "city_tax",
  "bundle", "service", "books", "hardware", "office_supplies", "other", "unknown",
] as const;
export type Category = (typeof CATEGORY_IDS)[number];
export type AssignedCategory = Exclude<Category, "unknown">;
export const CATEGORY_LABELS: Record<Category, string> = {
  accommodation: "Übernachtung",
  food: "Speisen / Frühstück",
  beverage: "Getränke",
  parking: "Parken",
  city_tax: "Kurtaxe / Beherbergungssteuer",
  bundle: "Paket / Mischleistung",
  service: "Dienstleistungen",
  books: "Bücher / Druckerzeugnisse",
  hardware: "Hardware",
  office_supplies: "Bürobedarf",
  other: "Sonstiges",
  unknown: "Unbekannt",
};
export type Classification = {
  category: Category;
  source: "rule" | "fasttext" | "manual" | "abstain";
  confidence: number | null;
};

/** Classification confidence is not invoice provenance or fiscal validation. */
export type CategoryReviewStatus = "unknown" | "suggested" | "confirmed";
export const CATEGORY_REVIEW_STATUS_LABELS: Record<CategoryReviewStatus, string> = {
  unknown: "Unbekannt",
  suggested: "Vorgeschlagen – nicht bestätigt",
  confirmed: "Manuell zugeordnet",
};

export function getCategoryReviewStatus(classification: Classification): CategoryReviewStatus {
  if (classification.category === "unknown") return "unknown";
  return classification.source === "manual" ? "confirmed" : "suggested";
}

type Prediction = { category: string; probability: number };

/** A very small high-precision fallback; conflicting keywords cause abstention. */
const RULES: readonly { category: AssignedCategory; re: RegExp }[] = [
  // Narrow non-hotel vocabulary: examples from synthetic TEST-01 and TEST-02.
  {
    category: "service",
    re: /(?<![\p{L}\p{N}])(?:beratungsleistung|beratungsdienstleistung|installation[\s-]+vor[\s-]+ort|consulting[\s-]+services?)(?![\p{L}\p{N}])/iu,
  },
  {
    category: "books",
    re: /(?<![\p{L}\p{N}])(?:designhandbuch|fachbuch|lehrbuch)(?![\p{L}\p{N}])/iu,
  },
  {
    category: "hardware",
    re: /(?<![\p{L}\p{N}])(?:monitorhalterung|usb[\s-]*c[\s-]*hub|usb[\s-]*kabel(?:[\s-]*adapter)?)(?![\p{L}\p{N}])/iu,
  },
  {
    category: "office_supplies",
    re: /(?<![\p{L}\p{N}])(?:dokumentenmappe|büromaterial|aktenordner)(?![\p{L}\p{N}])/iu,
  },
  {
    category: "accommodation",
    re: /(?<![\p{L}\p{N}])(?:übernachtung(?:en)?|übernachtungs(?:entgelt|preis)|zimmer(?:nacht|übernachtung|preis|rate)|logis|unterkunft|room[\s-]*(?:night|rate|charge)|accommodation|lodging)(?![\p{L}\p{N}])/iu,
  },
  {
    category: "food",
    re: /(?<![\p{L}\p{N}])(?:frühstück(?:sspeisen|sessen)?|breakfast[\s-]*(?:food|meal)|abendessen|mittagessen|mittagsmenü|abendmenü|tagesgericht|dinner|(?:konferenz|tagungs?|seminar|business|meeting)[\s-]*(?:lunch|mittagessen)|lunch(?:menü)?|speisen|mahlzeit|restaurant[\s-]*meal)(?![\p{L}\p{N}])/iu,
  },
  {
    category: "beverage",
    re: /(?<![\p{L}\p{N}])(?:getränke?(?:anteil)?|drinks?|wasserflasche|softdrinks?|coffee|kaffee(?:spezialität)?|espresso|cappuccino|latte[\s-]*macchiato|tea|tee|bier|wein|beverages?|mineralwasser|orangensaft|apfelsaft)(?![\p{L}\p{N}])/iu,
  },
  {
    category: "parking",
    re: /(?<![\p{L}\p{N}])(?:park(?:en|platz(?:miete)?|gebühr|haus|ticket|dauer)|parking|garage[\s-]*fee|tiefgarage|stellplatz(?:gebühr)?)(?![\p{L}\p{N}])/iu,
  },
  {
    category: "city_tax",
    re: /(?<![\p{L}\p{N}])(?:kurtaxe|city[\s-]*tax|tourism[\s-]*levy|beherbergungssteuer|bettensteuer|ortstaxe|tourismusabgabe|touristensteuer|übernachtungssteuer|kulturförderabgabe|gästebeitrag|kurbeitrag)(?![\p{L}\p{N}])/iu,
  },
  {
    category: "bundle",
    re: /(?<![\p{L}\p{N}])(?:business[\s-]*paket|arrangement|package|bundle|kombipaket|(?:frühstücks?|tagungs?|hotel|seminar)[\s-]*pauschale|pauschale|halbpension|vollpension|(?:hotel|frühstücks?)[\s-]*paket|inklusivpaket)(?![\p{L}\p{N}])/iu,
  },
];

/**
 * These exact component labels explicitly mean breakfast *drinks*, not a
 * combined meal. An unqualified "Frühstück und Getränke" stays ambiguous.
 */
const BREAKFAST_DRINKS = /^(?:frühstücks?[\s:-]*getränke(?:anteil)?|frühstück[\s-]*getränkeanteil|getränke(?:anteil)?[\s-]+(?:zum[\s-]+)?frühstück|breakfast[\s-]*(?:drinks?|beverages?))(?:\s+(?:am\s+)?\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4}))?$/iu;
// "other" is a deliberate manual assignment, never a model catch-all.
const supported = new Set<string>(CATEGORY_IDS.filter(id => id !== "unknown" && id !== "other"));
const THRESHOLD = 0.83;
const MIN_MARGIN = 0.2;

export function classifyDescription(
  description: string,
  predictions: readonly Prediction[] = [],
): Classification {
  if (BREAKFAST_DRINKS.test(description.trim())) {
    return {category: "beverage", source: "rule", confidence: null};
  }
  const matches = RULES.filter(rule => rule.re.test(description));
  if (matches.length === 1) return {category: matches[0]!.category, source: "rule", confidence: null};
  // Mixed keywords / split components must never be "solved" by a confidence score.
  if (matches.length > 1) return {category:"unknown", source:"abstain", confidence:null};

  const ranked = predictions.filter(p => supported.has(p.category) && Number.isFinite(p.probability))
    .sort((a,b) => b.probability - a.probability);
  const best = ranked[0];
  if (!best || best.probability < THRESHOLD ||
    best.probability - (ranked[1]?.probability ?? 0) < MIN_MARGIN) {
    return {category:"unknown",source:"abstain",confidence:best?.probability ?? null};
  }
  return {category:best.category as AssignedCategory,source:"fasttext",confidence:best.probability};
}

export function classifyItems(
  items: readonly LineItem[],
  predict: (description: string) => readonly Prediction[],
): Record<string, Classification> {
  return Object.fromEntries(items.map(item => {
    const fallback = classifyDescription(item.description);
    return [item.id, fallback.category === "unknown" && fallback.source === "abstain"
      ? classifyDescription(item.description, predict(item.description))
      : fallback];
  }));
}
