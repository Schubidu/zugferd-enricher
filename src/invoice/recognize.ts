import { emptyFields } from "./model";
import type { FieldKey, InvoiceDraft, InvoiceFields, LineItem, SourceLine, TaxGroup } from "./model";
import { parseCents } from "./money";

const currencyToken = /[-+]?(?:\d{1,3}(?:[.,]\d{3})+|\d+)[.,]\d{2}/;
const currencyPattern = new RegExp("(?<![\\d.,])(" + currencyToken.source + ")(?![\\d.,])", "g");
const itemPattern = new RegExp(
  "^(.{2,}?)\\s+(?:(\\d+(?:[.,]\\d+)?)\\s*[x×]\\s*(" + currencyToken.source + ")\\s+)?(" +
  currencyToken.source + ")(?:\\s+(7|19)\\s*%)?\\s*$", "i",
);
function amounts(text: string): string[] {
  return Array.from(text.matchAll(currencyPattern), m => m[1] ?? "").filter(v => parseCents(v) !== null);
}

function validDate(value: string): boolean {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  const english = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value);
  let year: number, month: number, day: number;
  if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]); }
  else if (german) { year = Number(german[3]); month = Number(german[2]); day = Number(german[1]); }
  else if (english) {
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    year = Number(english[3]);
    month = monthNames.indexOf((english[1] ?? "").slice(0, 3).toLowerCase()) + 1;
    day = Number(english[2]);
  } else return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}
function findDate(text: string): string | null {
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}\b/,
    /\b\d{1,2}\.\d{1,2}\.\d{4}\b/,
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/i,
  ];
  for (const pattern of patterns) {
    const value = text.match(pattern)?.[0];
    if (value && validDate(value)) return value;
  }
  return null;
}
function parseText(text: string): string | null {
  const value = text.trim().replace(/^[:#=-]\s*/, "");
  return value && value.length <= 120 ? value : null;
}
function parseSingleAmount(text: string): string | null {
  const found = amounts(text);
  return found.length === 1 ? found[0] ?? null : null;
}

const labels: { key: FieldKey; regex: RegExp; kind: "text" | "date" | "money" }[] = [
  { key: "invoiceNumber", regex: /(?:Rechnungs(?:nr\.?|nummer)|Invoice\s*(?:no\.?|number|#)|Belegnummer)\s*[:#-]?\s*/i, kind: "text" },
  { key: "invoiceDate", regex: /(?:Rechnungsdatum|Invoice\s*date|Date\s*of\s*invoice)\s*[:#-]?\s*/i, kind: "date" },
  { key: "dueDate", regex: /(?:Fällig(?:keit|keitsdatum)?|Due\s*date|Payable\s*by)\s*[:#-]?\s*/i, kind: "date" },
  { key: "issuer", regex: /(?:Rechnungsaussteller|Aussteller|Supplier|Seller)\s*[:#-]?\s*/i, kind: "text" },
  { key: "recipient", regex: /(?:Rechnungsempfänger|Empfänger|Bill\s*to|Buyer|Customer)\s*[:#-]?\s*/i, kind: "text" },
  { key: "grossTotal", regex: /(?:Gesamtbetrag|Rechnungsbetrag|Bruttosumme|Total\s*due|Grand\s*total|Gross\s*total|Amount\s*due)\s*[:=-]?\s*/i, kind: "money" },
  { key: "netTotal", regex: /(?:Nettosumme|Netto(?:gesamt|betrag)?|Subtotal|Net\s*total)\s*[:=-]?\s*/i, kind: "money" },
  { key: "taxTotal", regex: /(?:Umsatzsteuer\s*gesamt|MwSt\s*gesamt|Steuerbetrag|VAT\s*total|Tax\s*total)\s*[:=-]?\s*/i, kind: "money" },
];

/** No guessing of invoice authorship, VAT allocation or whether item amounts are gross. */
export function recognizeInvoice(sourceLines: SourceLine[], pageCount: number): InvoiceDraft {
  const fields: InvoiceFields = emptyFields();
  const items: LineItem[] = [];
  const taxGroups: TaxGroup[] = [];
  const warnings: string[] = [];
  const lines = [...sourceLines].sort((a, b) => a.page - b.page || a.box.y - b.box.y || a.box.x - b.box.x);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const taxHeader = /(?:USt|MwSt|VAT|Tax)\s*(7|19)\s*%\s*(?:Netto|Net|Base)\s*/i.exec(line.text);
    if (taxHeader) {
      const found = amounts(line.text.slice(taxHeader.index + taxHeader[0].length));
      if (found.length === 2) {
        taxGroups.push({ rate: taxHeader[1]! + "%", net: found[0]!, tax: found[1]!, evidenceIds: [line.id] });
      }
      continue;
    }

    let labeled = false;
    for (const label of labels) {
      const hit = label.regex.exec(line.text);
      if (!hit) continue;
      labeled = true;
      const trailing = line.text.slice(hit.index + hit[0].length).trim();
      const next = lines[i + 1];
      const nearby = next && next.page === line.page && next.box.y >= line.box.y &&
        next.box.y - line.box.y < 0.07 && !labels.some(l => l.regex.test(next.text));
      const source = trailing || (nearby ? next!.text : "");
      const value = label.kind === "money" ? parseSingleAmount(source) :
        label.kind === "date" ? findDate(source) : parseText(source);
      if (value && !fields[label.key]) {
        fields[label.key] = {
          value,
          evidenceIds: trailing ? [line.id] : [line.id, next!.id],
          origin: "pdf",
        };
      }
      break;
    }
    if (labeled) continue;

    if (/\b(?:Summe|Total|Zwischensumme|Subtotal|Gesamt|Rechnung|Invoice)\b/i.test(line.text)) continue;
    const match = itemPattern.exec(line.text.trim());
    if (!match || parseCents(match[4] ?? "") === null ||
      (match[3] && parseCents(match[3]) === null)) continue;
    items.push({
      id: "item-" + line.id,
      description: match[1]!.trim(),
      quantity: match[2] ?? null,
      unitPrice: match[3] ?? null,
      amount: match[4]!,
      taxRate: match[5] ? match[5] + "%" : null,
      evidenceIds: [line.id],
      origin: "pdf",
    });
  }
  if (lines.length === 0) warnings.push("Kein eingebetteter Text erkannt. Gescannte PDFs benötigen die spätere lokale OCR.");
  if (!fields.grossTotal) warnings.push("Kein eindeutig ausgewiesener Gesamtbetrag gefunden.");
  if (!fields.invoiceNumber) warnings.push("Keine eindeutig bezeichnete Rechnungsnummer gefunden.");
  if (items.some(item => !item.taxRate)) warnings.push("Mindestens eine Position hat keinen eindeutig ausgewiesenen Steuersatz.");
  return { pageCount, sourceLines: lines, fields, items, taxGroups, warnings };
}
