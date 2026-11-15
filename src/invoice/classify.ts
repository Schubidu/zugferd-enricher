import type { LineItem } from "./model";

/** Categories suggest what a position describes, never a tax rate or money amount. */
export const CATEGORY_IDS = [
  "accommodation", "food", "beverage", "parking", "city_tax",
  "bundle", "other", "unknown",
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
  other: "Sonstiges",
  unknown: "Unbekannt – prüfen",
};
export type Classification = {
  category: Category;
  source: "rule" | "fasttext" | "manual" | "abstain";
  confidence: number | null;
};

type Prediction = { category: string; probability: number };

/** A very small high-precision fallback; conflicting keywords cause abstention. */
const RULES: readonly { category: AssignedCategory; re: RegExp }[] = [
  {category: "accommodation", re: /(?<![\p{L}\p{N}])(?:übernachtung(?:en)?|zimmernacht|logis|room\s*(?:night|rate)|accommodation|lodging)(?![\p{L}\p{N}])/iu},
  {category: "food", re: /(?<![\p{L}\p{N}])(?:frühstück(?:sspeisen)?|breakfast\s*(?:food|meal)|abendessen|mittagessen|dinner|lunch|speisen|mahlzeit|restaurant\s*meal)(?![\p{L}\p{N}])/iu},
  {category: "beverage", re: /(?<![\p{L}\p{N}])(?:getränke?|drinks?|wasserflasche|softdrink|coffee|kaffee|tea|bier|wein|beverage|mineralwasser)(?![\p{L}\p{N}])/iu},
  {category: "parking", re: /(?<![\p{L}\p{N}])(?:park(?:en|platz|gebühr|haus|ticket)|parking|garage\s*fee)(?![\p{L}\p{N}])/iu},
  {category: "city_tax", re: /(?<![\p{L}\p{N}])(?:kurtaxe|city\s*tax|tourism\s*levy|beherbergungssteuer|bettensteuer|ortstaxe|tourismusabgabe)(?![\p{L}\p{N}])/iu},
  {category: "bundle", re: /(?<![\p{L}\p{N}])(?:business\s*paket|arrangement|package|bundle|kombipaket|pauschale)(?![\p{L}\p{N}])/iu},
];
const supported = new Set<string>(CATEGORY_IDS.filter(id => id !== "unknown"));
const THRESHOLD = 0.83;
const MIN_MARGIN = 0.2;

export function classifyDescription(
  description: string,
  predictions: readonly Prediction[] = [],
): Classification {
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
