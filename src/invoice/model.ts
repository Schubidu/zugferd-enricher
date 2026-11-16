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
/** Invoice wording with PDF evidence, never an inferred 0% VAT rate. */
export type TaxTreatment = {
  kind: "third_party_no_vat";
  origin: "pdf";
  evidenceIds: string[];
};
/** Basis is explicit in a PDF table heading; never infer it from a tax rate. */
export type LineAmountBasis = {
  kind: "net";
  origin: "pdf";
  evidenceIds: string[];
};
export type LineItem = {
  id: string;
  description: string;
  quantity: string | null;
  unitPrice: string | null;
  amount: string;
  taxRate: string | null;
  taxTreatment?: TaxTreatment;
  amountBasis?: LineAmountBasis;
  evidenceIds: string[];
  origin: "pdf" | "manual";
};
/** Deliberately narrower than recognizing an internal invoice category. */
export function isSourceBackedNoVat(item: LineItem): boolean {
  return item.origin === "pdf" && item.taxRate === null &&
    item.taxTreatment?.kind === "third_party_no_vat" &&
    item.taxTreatment.origin === "pdf" &&
    item.taxTreatment.evidenceIds.length > 0;
}
export function isSourceBackedNet(item: LineItem): boolean {
  return item.origin === "pdf" && item.amountBasis?.kind === "net" &&
    item.amountBasis.origin === "pdf" && item.amountBasis.evidenceIds.length > 0;
}
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
