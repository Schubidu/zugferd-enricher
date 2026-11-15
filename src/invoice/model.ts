/** A fallible invoice reading, not a replacement invoice. */
export type SourceBox = { x: number; y: number; width: number; height: number };
export type SourceLine = { id: string; page: number; text: string; box: SourceBox };

export const FIELD_KEYS = [
  "issuer", "recipient", "invoiceNumber", "invoiceDate",
  "dueDate", "netTotal", "taxTotal", "grossTotal",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
export type FieldValue = { value: string; evidenceIds: string[]; origin: "pdf" | "manual" };
export type InvoiceFields = Record<FieldKey, FieldValue | null>;
export type LineItem = {
  id: string;
  description: string;
  quantity: string | null;
  unitPrice: string | null;
  amount: string;
  taxRate: string | null;
  evidenceIds: string[];
  origin: "pdf" | "manual";
};
export type TaxGroup = { rate: string; net: string; tax: string; evidenceIds: string[] };
export type InvoiceDraft = {
  pageCount: number;
  sourceLines: SourceLine[];
  fields: InvoiceFields;
  items: LineItem[];
  taxGroups: TaxGroup[];
  warnings: string[];
};

export const FIELD_LABELS: Record<FieldKey, string> = {
  issuer: "Rechnungsaussteller",
  recipient: "Rechnungsempfänger",
  invoiceNumber: "Rechnungsnummer",
  invoiceDate: "Rechnungsdatum",
  dueDate: "Fälligkeitsdatum",
  netTotal: "Netto",
  taxTotal: "Umsatzsteuer",
  grossTotal: "Brutto",
};

export function emptyFields(): InvoiceFields {
  return Object.fromEntries(FIELD_KEYS.map(key => [key, null])) as InvoiceFields;
}
