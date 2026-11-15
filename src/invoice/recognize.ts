import { emptyFields, FIELD_LABELS } from "./model";
import type { FieldKey, FieldValue, InvoiceDraft, LineItem, SourceLine, TaxGroup } from "./model";
import { parseCents } from "./money";

// Capture entire spaced/thousands-grouped amounts, not a plausible numeric suffix.
const money = /[-+]?(?:\d{1,3}(?:[., ]\d{3})+|\d+)[.,]\d{2}/.source;
const itemPattern = new RegExp(
  "^(.{2,}?)\\s+(?:(\\d+(?:[.,]\\d+)?)\\s*[x×]\\s*(" + money + ")\\s+)?(" +
  money + ")(?:\\s+(7|19)\\s*%)?\\s*$", "i",
);
const groupPattern = new RegExp(
  "^\\s*(?:USt|MwSt|VAT|Tax)\\s*(7|19)\\s*%\\s*(?:Netto|Net|Base)\\s*[:=]?\\s*(" +
  money + ")\\s+(?:Steuer|MwSt|VAT|Tax)\\s*[:=]?\\s*(" + money + ")\\s*$", "i",
);
const taxSummary = /^\s*(?:(?:USt|MwSt|VAT|Tax)(?:\s+\d{1,2}\s*%)?|Umsatzsteuer(?:\s+\d{1,2}\s*%)?)\s*(?:[:=]|\s|$)/i;

function validDate(value: string): boolean {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  const english = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value);
  let year: number, month: number, day: number;
  if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]); }
  else if (german) { year = Number(german[3]); month = Number(german[2]); day = Number(german[1]); }
  else if (english) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    year = Number(english[3]);
    month = months.indexOf((english[1] ?? "").slice(0, 3).toLowerCase()) + 1;
    day = Number(english[2]);
  } else return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}
function findDate(text: string): string | null {
  for (const re of [
    /\b\d{4}-\d{2}-\d{2}\b/,
    /\b\d{1,2}\.\d{1,2}\.\d{4}\b/,
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/i,
  ]) {
    const value = text.match(re)?.[0];
    if (value && validDate(value)) return value;
  }
  return null;
}
function parseText(text: string): string | null {
  const value = text.trim();
  return value.length > 0 && value.length <= 120 ? value : null;
}
function parseSingleAmount(text: string): string | null {
  const value = text.trim();
  return parseCents(value) === null ? null : value;
}

type Label = { key: FieldKey; regex: RegExp; kind: "text" | "date" | "money" };
const labels: Label[] = [
  { key: "invoiceNumber", regex: /^\s*(?:Rechnungs(?:nr\.?|nummer)|Invoice\s*(?:no\.?|number|#)|Belegnummer)\s*[:#]?\s*/i, kind: "text" },
  { key: "invoiceDate", regex: /^\s*(?:Rechnungsdatum|Invoice\s*date|Date\s*of\s*invoice)\s*:?\s*/i, kind: "date" },
  { key: "dueDate", regex: /^\s*(?:Fällig(?:keit|keitsdatum)?|Due\s*date|Payable\s*by)\s*:?\s*/i, kind: "date" },
  // A mandatory colon distinguishes a name from Supplier/Customer number and ID.
  { key: "issuer", regex: /^\s*(?:Rechnungsaussteller|Aussteller|Supplier(?:\s+name)?|Seller(?:\s+name)?)\s*:\s*/i, kind: "text" },
  { key: "recipient", regex: /^\s*(?:Rechnungsempfänger|Empfänger|Bill\s*to|Buyer(?:\s+name)?|Customer(?:\s+name)?)\s*:\s*/i, kind: "text" },
  // Never consume a negative amount's minus sign as a label separator.
  { key: "grossTotal", regex: /^\s*(?:Gesamtbetrag|Rechnungsbetrag|Bruttosumme|Total\s*due|Grand\s*total|Gross\s*total|Amount\s*due)\s*[:=]?\s*/i, kind: "money" },
  { key: "netTotal", regex: /^\s*(?:Nettosumme|Nettogesamt|Nettobetrag|Subtotal|Net\s*total|Netto(?=\s*[:=]|\s+[+-]?\d))\s*[:=]?\s*/i, kind: "money" },
  { key: "taxTotal", regex: /^\s*(?:Umsatzsteuer\s*gesamt|MwSt\s*gesamt|Steuerbetrag|VAT\s*total|Tax\s*total)\s*[:=]?\s*/i, kind: "money" },
];

function equivalent(key: FieldKey, left: string, right: string): boolean {
  if (key === "netTotal" || key === "taxTotal" || key === "grossTotal") {
    const a = parseCents(left), b = parseCents(right);
    return a !== null && b !== null && a === b;
  }
  return left.trim().toLocaleLowerCase("de-DE") === right.trim().toLocaleLowerCase("de-DE");
}

/** No source-backed field is silently chosen from conflicting candidates. */
export function recognizeInvoice(sourceLines: SourceLine[], pageCount: number): InvoiceDraft {
  const fields = emptyFields();
  const items: LineItem[] = [];
  const taxGroups: TaxGroup[] = [];
  const warnings: string[] = [];
  const candidates = new Map<FieldKey, FieldValue[]>();
  const consumed = new Set<string>();
  const lines = [...sourceLines].sort((a, b) => a.page - b.page || a.box.y - b.box.y || a.box.x - b.box.x);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (consumed.has(line.id)) continue;
    const group = groupPattern.exec(line.text);
    if (group && parseCents(group[2]!) !== null && parseCents(group[3]!) !== null) {
      taxGroups.push({ rate: group[1]! + "%", net: group[2]!, tax: group[3]!, evidenceIds: [line.id] });
      continue;
    }
    let isLabel = false;
    for (const label of labels) {
      const match = label.regex.exec(line.text);
      if (!match) continue;
      isLabel = true;
      const trailing = line.text.slice(match[0].length).trim();
      const next = lines[i + 1];
      const nearNext = next && next.page === line.page && next.box.y >= line.box.y &&
        next.box.y - line.box.y < 0.07 && !labels.some(l => l.regex.test(next.text));
      const source = trailing || (nearNext ? next!.text : "");
      const value = label.kind === "money" ? parseSingleAmount(source) :
        label.kind === "date" ? findDate(source) : parseText(source);
      if (value) {
        const candidate: FieldValue = {
          value,
          evidenceIds: trailing ? [line.id] : [line.id, next!.id],
          origin: "pdf",
        };
        candidates.set(label.key, [...(candidates.get(label.key) ?? []), candidate]);
        if (!trailing && next) consumed.add(next.id);
      }
      break;
    }
    if (isLabel) continue;
    // Explicit invoice tax totals were handled above; exclude remaining tax summaries from positions.
    if (taxSummary.test(line.text)) continue;

    if (/\b(?:Summe|Total|Zwischensumme|Subtotal|Gesamt|Rechnung|Invoice)\b/i.test(line.text)) continue;
    const match = itemPattern.exec(line.text.trim());
    if (!match || parseCents(match[4] ?? "") === null ||
      (match[3] && parseCents(match[3]) === null)) continue;
    items.push({
      id: "item-" + line.id,
      description: match[1]!.trim(), quantity: match[2] ?? null,
      unitPrice: match[3] ?? null, amount: match[4]!,
      taxRate: match[5] ? match[5] + "%" : null,
      evidenceIds: [line.id], origin: "pdf",
    });
  }

  for (const label of labels) {
    const found = candidates.get(label.key);
    if (!found?.length) continue;
    const first = found[0]!;
    if (found.some(candidate => !equivalent(label.key, first.value, candidate.value))) {
      warnings.push("Widersprüchliche Angaben für " + FIELD_LABELS[label.key] + ": bitte Fundstellen im Original vergleichen.");
      fields[label.key] = null;
    } else fields[label.key] = first;
  }
  if (lines.length === 0) warnings.push("Kein eingebetteter Text erkannt. Gescannte PDFs benötigen die spätere lokale OCR.");
  if (!fields.grossTotal) warnings.push("Kein eindeutig ausgewiesener Gesamtbetrag gefunden.");
  if (!fields.invoiceNumber) warnings.push("Keine eindeutig bezeichnete Rechnungsnummer gefunden.");
  if (items.some(item => !item.taxRate)) warnings.push("Mindestens eine Position hat keinen eindeutig ausgewiesenen Steuersatz.");
  return { pageCount, sourceLines: lines, fields, items, taxGroups, warnings };
}
