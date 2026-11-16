import { FIELD_KEYS, FIELD_LABELS, isSourceBackedNet } from "../invoice/model";
import type { FieldKey, FieldValue, InvoiceDraft, SourceLine } from "../invoice/model";
import { checkTotals, parseCents } from "../invoice/money";
import { reconcileInvoice } from "../invoice/reconcile";
import { recognizeInvoice } from "../invoice/recognize";
import { extractCiiSourceFacts } from "./cii-evidence";

/** A local, non-exporting gate for Issue #5. There is no PDF/XML writer here. */
export type ExportBlockerCode =
  | "SOURCE_LINES_CHANGED"
  | "SOURCE_SNAPSHOT_INCONSISTENT"
  | "SOURCE_EVIDENCE_INVALID"
  | "SOURCE_FIELD_CHANGED"
  | "SOURCE_ITEM_CHANGED"
  | "SOURCE_TAX_GROUP_CHANGED"
  | "REQUIRED_FIELD_MISSING"
  | "INVALID_TOTALS"
  | "SOURCE_RECONCILIATION_FAILED"
  | "SOURCE_POSITIONS_MISSING"
  | "SOURCE_LINE_COVERAGE_UNVERIFIED"
  | "CURRENCY_UNVERIFIED"
  | "PARTY_ADDRESSES_UNVERIFIED"
  | "INVOICE_TYPE_UNVERIFIED"
  | "PAYABLE_AMOUNT_UNVERIFIED"
  | "SELLER_TAX_IDENTIFIER_UNVERIFIED"
  | "LINE_AMOUNT_BASIS_UNVERIFIED"
  | "LINE_VAT_CATEGORY_UNVERIFIED"
  | "XML_SCHEMA_VALIDATION_PENDING"
  | "XML_BUSINESS_RULE_VALIDATION_PENDING"
  | "PDFA3_VALIDATION_PENDING"
  | "PDF_XML_FIDELITY_VALIDATION_PENDING";

export type ExportBlocker = {
  stage: "source" | "semantics" | "conformance";
  code: ExportBlockerCode;
  path: string;
  message: string;
};

export type ExportPreflight = {
  /** No successful PDF/A-3 + EN 16931 pipeline exists yet. Never enable export. */
  exportAllowed: false;
  sourceAligned: boolean;
  blockers: ExportBlocker[];
};

const REQUIRED_FIELDS: readonly FieldKey[] = [
  "issuer", "recipient", "invoiceNumber", "invoiceDate",
  "netTotal", "taxTotal", "grossTotal",
];

function same<T>(left: T, right: T): boolean {
  // InvoiceDraft is intentionally JSON-compatible; no monetary BigInt is stored.
  return JSON.stringify(left) === JSON.stringify(right);
}

function validEvidence(lines: readonly SourceLine[], ids: readonly string[], value?: string): boolean {
  if (ids.length === 0) return false;
  const byId = new Map(lines.map(line => [line.id, line]));
  if (byId.size !== lines.length) return false;
  const referenced = ids.map(id => byId.get(id));
  if (referenced.some(line => !line)) return false;
  if (value === undefined) return true;
  // Evidence must literally contain the extracted value. Even that does not
  // certify the entire original PDF or that all charges were recognized.
  return referenced.some(line => line!.text.toLocaleLowerCase("de-DE")
    .includes(value.trim().toLocaleLowerCase("de-DE")));
}

function sameField(original: FieldValue | null, current: FieldValue | null): boolean {
  if (!original || !current) return original === current;
  return current.origin === "pdf" && original.origin === "pdf" &&
    current.value === original.value && same(current.evidenceIds, original.evidenceIds);
}

/**
 * Check the currently reviewed draft against a separate immutable PDF extraction.
 * This is a prerequisite, NOT a certification of completeness or a ZUGFeRD file.
 *
 * Callers must retain `original` independently of mutable review state, and
 * must never promote an edited field or an inferred expense category to a fact.
 */
export function assessExportPreflight(original: InvoiceDraft, reviewed: InvoiceDraft): ExportPreflight {
  const blockers: ExportBlocker[] = [];
  const add = (stage: ExportBlocker["stage"], code: ExportBlockerCode,
    path: string, message: string) => blockers.push({stage, code, path, message});

  if (original.pageCount < 1 || original.sourceLines.length === 0 ||
    original.pageCount !== reviewed.pageCount || !same(original.sourceLines, reviewed.sourceLines)) {
    add("source", "SOURCE_LINES_CHANGED", "sourceLines",
      "Originale PDF-Fundstellen fehlen oder weichen vom Auslesestand ab.");
  }

  // Re-derive the extraction from the retained source lines instead of trusting
  // values labelled `origin: pdf` merely because their metadata says so.
  const extracted = recognizeInvoice(original.sourceLines, original.pageCount);
  if (!same(extracted.fields, original.fields) ||
    !same(extracted.items, original.items) ||
    !same(extracted.taxGroups, original.taxGroups)) {
    add("source", "SOURCE_SNAPSHOT_INCONSISTENT", "original",
      "Der angebliche Originalstand stimmt nicht mit den PDF-Fundstellen überein.");
  }

  for (const key of FIELD_KEYS) {
    const source = original.fields[key];
    const current = reviewed.fields[key];
    if (!sameField(source, current)) {
      add("source", "SOURCE_FIELD_CHANGED", `fields.${key}`,
        `${FIELD_LABELS[key]} weicht vom Originalstand ab oder wurde manuell ergänzt.`);
    }
    if (source && (source.origin !== "pdf" ||
      !validEvidence(original.sourceLines, source.evidenceIds, source.value))) {
      add("source", "SOURCE_EVIDENCE_INVALID", `fields.${key}`,
        `Die Fundstelle für ${FIELD_LABELS[key]} ist nicht nachvollziehbar.`);
    }
  }

  if (!same(original.items, reviewed.items)) {
    add("source", "SOURCE_ITEM_CHANGED", "items",
      "Positionen, Mengen, Steuersätze oder Steuerhinweise wurden gegenüber dem Original geändert.");
  }
  if (!same(original.taxGroups, reviewed.taxGroups)) {
    add("source", "SOURCE_TAX_GROUP_CHANGED", "taxGroups",
      "Steuergruppen weichen vom Originalstand ab.");
  }
  for (const [index, item] of original.items.entries()) {
    if (item.origin !== "pdf" || !validEvidence(original.sourceLines, item.evidenceIds) ||
      (item.taxTreatment && (item.taxTreatment.origin !== "pdf" ||
        !validEvidence(original.sourceLines, item.taxTreatment.evidenceIds))) ||
      (item.amountBasis && (item.amountBasis.origin !== "pdf" ||
        !validEvidence(original.sourceLines, item.amountBasis.evidenceIds)))) {
      add("source", "SOURCE_EVIDENCE_INVALID", `items.${index}`,
        "Mindestens eine Rechnungsposition oder ihre Steuerbehandlung ist nicht belegt.");
    }
  }
  for (const [index, group] of original.taxGroups.entries()) {
    if (!validEvidence(original.sourceLines, group.evidenceIds)) {
      add("source", "SOURCE_EVIDENCE_INVALID", `taxGroups.${index}`,
        "Mindestens eine Steuergruppe hat keine gültige Originalfundstelle.");
    }
  }

  for (const key of REQUIRED_FIELDS) {
    if (!original.fields[key]?.value.trim()) {
      add("semantics", "REQUIRED_FIELD_MISSING", `fields.${key}`,
        `${FIELD_LABELS[key]} ist nicht eindeutig aus der Rechnung erkennbar.`);
    }
  }
  const net = original.fields.netTotal?.value ?? null;
  const tax = original.fields.taxTotal?.value ?? null;
  const gross = original.fields.grossTotal?.value ?? null;
  if (checkTotals(net, tax, gross).status !== "match") {
    add("semantics", "INVALID_TOTALS", "fields",
      "Netto, Umsatzsteuer und Brutto sind nicht vollständig und widerspruchsfrei belegbar.");
  }
  if (original.items.length === 0 || original.items.some(item => parseCents(item.amount) === null)) {
    add("semantics", "SOURCE_POSITIONS_MISSING", "items",
      "Rechnungspositionen sind nicht vollständig auswertbar.");
  }
  for (const finding of reconcileInvoice(original)) {
    add("semantics", "SOURCE_RECONCILIATION_FAILED", `reconcile.${finding.id}`,
      "Die aus dem Original erkannten Rechnungsdaten erfordern weitere Prüfung.");
  }

  // A printed tax percentage is not an EN 16931 BT-151 VAT category.
  // The basis gate can now be satisfied by explicit PDF column evidence.
  add("semantics", "SOURCE_LINE_COVERAGE_UNVERIFIED", "items.coverage",
    "Die vollständige Erfassung aller sichtbaren Rechnungspositionen ist nicht nachgewiesen.");
  const ciiFacts = extractCiiSourceFacts(original);
  const lacking = new Set(ciiFacts.ok ? [] : ciiFacts.missing);
  if (lacking.has("currency") || lacking.has("supportedCurrency")) {
    add("semantics", "CURRENCY_UNVERIFIED", "currency",
      "Der Rechnungswährungscode ist nicht unabhängig belegt (BT-5).");
  }
  if ([...lacking].some(key => (key.startsWith("seller") && !key.startsWith("sellerVatId")) ||
    key.startsWith("buyer"))) {
    add("semantics", "PARTY_ADDRESSES_UNVERIFIED", "parties",
      "Vollständige Originalanschriften und Ländercodes von Aussteller und Empfänger fehlen.");
  }
  if (lacking.has("typeCode") || lacking.has("supportedType")) {
    add("semantics", "INVOICE_TYPE_UNVERIFIED", "invoiceType",
      "Der Rechnungstypcode ist nicht aus dem Original belegt (BT-3).");
  }
  if (lacking.has("sellerVatId") || lacking.has("sellerVatIdFormat")) {
    add("semantics", "SELLER_TAX_IDENTIFIER_UNVERIFIED", "seller.taxId",
      "Die Steuerkennung des Rechnungsausstellers ist nicht eindeutig im Original belegt.");
  }
  if (lacking.has("payable") || lacking.has("payableFormat")) {
    add("semantics", "PAYABLE_AMOUNT_UNVERIFIED", "totals.payable",
      "Der tatsächlich zu zahlende Betrag ist nicht ausdrücklich aus dem Original belegt.");
  }
  if (original.items.length === 0 || original.items.some(item => !isSourceBackedNet(item))) {
    add("semantics", "LINE_AMOUNT_BASIS_UNVERIFIED", "items.amountBasis",
      "Die Netto-/Brutto-Basis der einzelnen Positionen ist nicht belegt.");
  }
  if ([...lacking].some(key => key.startsWith("items."))) {
    add("semantics", "LINE_VAT_CATEGORY_UNVERIFIED", "items.vatCategory",
      "Steuersätze und Sonderbehandlungen sind noch keinen belegten EN-16931-Steuerkategorien zugeordnet.");
  }

  // A business-rule checker cannot be replaced by hand-written assertions.
  // No PDF may be downloaded until all independent gates pass in a later slice.
  add("conformance", "XML_SCHEMA_VALIDATION_PENDING", "validation.xmlSchema",
    "ZUGFeRD-2.5.2-Schema-Validierung ist noch nicht integriert.");
  add("conformance", "XML_BUSINESS_RULE_VALIDATION_PENDING", "validation.schematron",
    "EN-16931-/ZUGFeRD-Geschäftsregeln wurden noch nicht unabhängig geprüft.");
  add("conformance", "PDFA3_VALIDATION_PENDING", "validation.pdfa3",
    "Unabhängige PDF/A-3-Konformitätsprüfung fehlt.");
  add("conformance", "PDF_XML_FIDELITY_VALIDATION_PENDING", "validation.fidelity",
    "Der Vergleich der sichtbaren Originalrechnung mit dem später eingebetteten XML fehlt.");

  return {
    exportAllowed: false,
    sourceAligned: !blockers.some(blocker => blocker.stage === "source"),
    blockers,
  };
}
