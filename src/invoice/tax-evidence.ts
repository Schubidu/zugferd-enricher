import type { SourceLine } from "./model";
import { parseCents } from "./money";

/**
 * Independent, tiny local bag-of-words classifier for locating candidate tax notes.
 * It is trained from deterministic SYNTHETIC examples during module initialization.
 * This model only selects text for verification: neither scores nor classifications
 * are invoice facts, and it never assigns VAT rates or ZUGFeRD tax codes.
 *
 * Unlike the existing fastText model, this classifier does not classify line-item
 * categories. No PDF text, model input, or inference is sent to a server.
 */
const POSITIVE = [
  "Kurtaxe (im Namen der Gemeinde, ohne Umsatzsteuer): 10,50",
  "Kurtaxe im Namen der Stadt, keine Mehrwertsteuer: 10,50",
  "Ortstaxe im Namen der Gemeinde ohne MwSt: 6,00",
  "Ortstaxe im Auftrag der Stadt ohne Umsatzsteuer 6,00",
  "Kurtaxe für die Gemeinde ohne USt 10,50",
  "Kurtaxe im Namen der Kommune nicht umsatzsteuerpflichtig 3,50",
  "Beherbergungssteuer im Namen der Stadt ohne Mehrwertsteuer 12,00",
  "Tourismusabgabe im Auftrag der Gemeinde ohne MwSt 8,00",
  "Kurtaxe für Gemeinde nicht umsatzsteuerpflichtig 5,00",
  "Kurtaxe Gemeinde ohne Umsatzsteuer 10,50",
  "Ortstaxe Stadt keine Umsatzsteuer 10,50",
  "City tax collected on behalf of municipality, no VAT: 10.50",
  "Municipal tourism tax on behalf of city, without VAT: 8.00",
  "Kurtaxe (im Namen der Gemeinde ohne USt) 10,50",
  "Kurtaxe im Namen der Gemeinde, umsatzsteuerfrei weitergeleitet: 10,50",
  "Ortstaxe im Auftrag der Stadt keine Umsatzsteuer: 6,00",
  "Tourismusabgabe Stadt ohne Mehrwertsteuer: 4,00",
  "Beherbergungssteuer im Namen der Gemeinde ohne Umsatzsteuer: 5,00",
  "Kurtaxe im Namen des Kurorts ohne Umsatzsteuer: 7,00",
  "Kurtaxe im Namen der Gemeinde, ohne Umsatzsteuer, durchlaufender Posten 10,50",
] as const;
const NEGATIVE = [
  "Kurtaxe 3 x 3,50 10,50",
  "Ortstaxe 6,00",
  "Kurtaxe inkl. Umsatzsteuer 10,50",
  "Umsatzsteuer 19% Kurtaxe 2,00",
  "Kurtaxe Umsatzsteuerpflicht 10,50",
  "Für Übernachtungen gilt ohne Umsatzsteuer 10,50",
  "Kein USt Ausweis für Parken 10,50",
  "USt 7% Netto 390,00 Steuer 27,30",
  "USt 19% Netto 31,00 Steuer 5,89",
  "Nettosumme 431,50",
  "Gesamtbetrag 464,69",
  "Kurtaxe im Namen der Gemeinde mit 19% Umsatzsteuer: 10,50",
  "Kurtaxe Gemeinde inklusive Mehrwertsteuer: 10,50",
  "Rechnungsnummer HAM-2026-315",
  "Bitte Umsatzsteuer für Kurtaxe prüfen: 10,50",
  "Im Namen der Gemeinde: Übernachtung 105,00 7%",
  "Kurtaxe ohne Verpflegung 10,50",
  "Sonstige Gebühren ohne Sonderleistungen 10,50",
  "City tax including VAT: 10.50",
  "Tourism levy subject to VAT 10.50",
  "Hotel charged city tax: 10.50",
  "City tax without breakfast 10.50",
  "Stornierung Kurtaxe 10,50",
  "Kurtaxe wird ohne Nachweis abgerechnet: 10,50",
  "Kurtaxe Gemeinde 10,50",
  "Steuerfrei nach Paragraph 4: 10,50",
  "Kurtaxe im Namen der Gemeinde, nicht ohne Umsatzsteuer: 10,50",
  "Kurtaxe ohne Umsatzsteuer aber nicht im Namen der Gemeinde: 10,50",
  "Lieferung im Auftrag der Stadt ohne MwSt: 10,50",
  "Frühstück im Namen der Gemeinde ohne MwSt: 15,00",
] as const;

function tokens(text: string): Set<string> {
  const words = text.toLocaleLowerCase("de-DE").normalize("NFKD")
    .replace(/\p{M}/gu, "").match(/[\p{L}]{3,}/gu) ?? [];
  return new Set(words);
}

function countWords(examples: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const example of examples) {
    for (const token of tokens(example)) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function trainSyntheticModel() {
  const positive = countWords(POSITIVE);
  const negative = countWords(NEGATIVE);
  const vocabulary = [...new Set([...positive.keys(), ...negative.keys()])];
  // Bernoulli Naive Bayes with Laplace smoothing and a fixed corpus.
  const absentBase = Math.log(POSITIVE.length / NEGATIVE.length);
  const features = vocabulary.map(token => {
    const yes = ((positive.get(token) ?? 0) + 1) / (POSITIVE.length + 2);
    const no = ((negative.get(token) ?? 0) + 1) / (NEGATIVE.length + 2);
    return {token, whenPresent: Math.log(yes / no), whenAbsent: Math.log((1 - yes) / (1 - no))};
  });
  return {
    probability(text: string) {
      const present = tokens(text);
      let score = absentBase;
      for (const feature of features) {
        score += present.has(feature.token) ? feature.whenPresent : feature.whenAbsent;
      }
      return 1 / (1 + Math.exp(-score));
    },
  };
}
const model = trainSyntheticModel();
const CANDIDATE_THRESHOLD = 0.7;

export function selectTaxEvidenceCandidates(lines: readonly SourceLine[]): SourceLine[] {
  return lines.filter(line => line.text.length <= 1024 &&
    model.probability(line.text) >= CANDIDATE_THRESHOLD);
}

// Only specific source wording authorizes pass-through treatment. ML cannot
// supply an amount, issuer, legal status, or factual source evidence.
const amount = /[-+]?(?:\d{1,3}(?:[., ]\d{3})+|\d+)[.,]\d{2}/.source;
const statement = new RegExp(
  "^(?<label>Kurtaxe|Ortstaxe|Beherbergungssteuer|Tourismusabgabe)\\b(?<body>.+?)\\s*[:;,]?\\s*(?<amount>" +
  amount + ")\\s*$", "i",
);
const authority = /\b(?:im\s+Namen|im\s+Auftrag)\s+(?:der|des)\s+(?:Gemeinde|Stadt|Kommune|Kurorts)\b/i;
const noVat = /\b(?:ohne\s+(?:Umsatzsteuer|Mehrwertsteuer|USt|MwSt)|keine\s+(?:Umsatzsteuer|Mehrwertsteuer|USt|MwSt)|nicht\s+umsatzsteuerpflichtig)\b/i;
const contradiction = /\b(?:nicht\s+ohne|(?:aber\s+)?nicht\s+im\s+(?:Namen|Auftrag)|aber\s+mit|doch\s+mit|(?:inkl\.?|inklusive|einschließlich)\s+(?:Umsatzsteuer|Mehrwertsteuer|MwSt|USt)|mit\s+\d{1,2}\s*%\s*(?:Umsatzsteuer|Mehrwertsteuer|MwSt|USt))\b/i;
const anotherAmount = new RegExp(amount);

export type SourceTaxEvidence = {
  label: string;
  amountCents: bigint;
  evidenceId: string;
};

function verifyPassThrough(line: SourceLine): SourceTaxEvidence | null {
  const matched = statement.exec(line.text);
  if (!matched?.groups) return null;
  const {label, body, amount: printedAmount} = matched.groups;
  if (!label || !body || !printedAmount || !authority.test(body) ||
    !noVat.test(body) || contradiction.test(body) || anotherAmount.test(body)) return null;
  const amountCents = parseCents(printedAmount);
  return amountCents === null ? null : {label: label.toLocaleLowerCase("de-DE"), amountCents, evidenceId: line.id};
}

/** Returns source-matched evidence only; classification is never a tax assertion. */
export function findSourceTaxEvidence(lines: readonly SourceLine[]): SourceTaxEvidence[] {
  return selectTaxEvidenceCandidates(lines)
    .map(verifyPassThrough)
    .filter((entry): entry is SourceTaxEvidence => entry !== null);
}

/**
 * Scan ALL source lines independently of ML scoring. A contradictory
 * statement rejected by the candidate model must still veto tax treatment.
 */
export function findTaxStatementMentions(lines: readonly SourceLine[]): SourceTaxEvidence[] {
  return lines.flatMap(line => {
    const match = statement.exec(line.text);
    if (!match?.groups) return [];
    const {label, body, amount: printedAmount} = match.groups;
    if (!label || !body || !printedAmount ||
      !/\b(?:Umsatzsteuer|Mehrwertsteuer|USt|MwSt)\b/i.test(body) ||
      /\b\d+(?:[.,]\d+)?\s*[x×]\s*[-+]?\d+[.,]\d{2}\b/i.test(body)) return [];
    const amountCents = parseCents(printedAmount);
    return amountCents === null ? [] : [{
      label: label.toLocaleLowerCase("de-DE"), amountCents, evidenceId: line.id,
    }];
  });
}

/** Only a separate and uniquely matched explanation may be deduplicated. */
export function isTaxExplanationLine(text: string): boolean {
  const match = statement.exec(text.trim());
  if (!match?.groups?.body) return false;
  const body = match.groups.body;
  return authority.test(body) && /\b(?:Umsatzsteuer|Mehrwertsteuer|USt|MwSt)\b/i.test(body) &&
    !/\b\d+(?:[.,]\d+)?\s*[x×]\s*[-+]?\d+[.,]\d{2}\b/i.test(body);
}
