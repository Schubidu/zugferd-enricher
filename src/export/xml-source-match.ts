import type { InvoiceDraft } from "../invoice/model";
import { parseCents } from "../invoice/money";
import { extractCiiSourceFacts } from "./cii-evidence";

/**
 * Browser-local semantic cross-check for the *currently mapped* CII subset.
 * Not an XSD/Schematron validator, a completeness check, or export approval.
 *
 * In particular, this proves neither that every visible PDF charge was read
 * nor that the untouched PDF can be transformed into a valid PDF/A-3.
 */
export type XmlSourceMatch =
  | {status: "matched-subset"; checks: number}
  | {status: "mismatch"; reasons: string[]};

const NS = {
  rsm: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
  ram: "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
  udt: "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
} as const;

function direct(parent: Element | null, tagName: string): Element[] {
  if (!parent) return [];
  const [prefix, name] = tagName.split(":");
  if (!name || (prefix !== "rsm" && prefix !== "ram" && prefix !== "udt")) return [];
  return Array.from(parent.children).filter(node =>
    node.namespaceURI === NS[prefix] && node.localName === name);
}
function get(root: Element | null, ...path: string[]): Element | null {
  let result: Element | null = root;
  for (const step of path) {
    const nodes = direct(result, step);
    if (nodes.length !== 1) return null; // Duplicate or missing fields are unsafe.
    result = nodes[0]!;
  }
  return result;
}
function amount(text: string | null | undefined): string | null {
  const parsed = text == null ? null : parseCents(text);
  if (parsed === null) return null;
  const absolute = parsed < 0n ? -parsed : parsed;
  return (parsed < 0n ? "-" : "") + (absolute / 100n).toString() +
    "." + (absolute % 100n).toString().padStart(2, "0");
}
function quantity(text: string | null): string | null {
  const match = /^(\d+)(?:[.,](\d{1,3}))?$/.exec(text ?? "");
  if (!match) return null;
  const whole = BigInt(match[1]!).toString();
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return whole + (fraction ? "." + fraction : "");
}
function date(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /^(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.(\d{1,2})\.(\d{4}))$/.exec(text);
  if (!match) return null;
  const year = Number(match[1] ?? match[6]);
  const month = Number(match[2] ?? match[5]);
  const day = Number(match[3] ?? match[4]);
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 ||
    checked.getUTCDate() !== day) return null;
  return String(year).padStart(4, "0") + String(month).padStart(2, "0") +
    String(day).padStart(2, "0");
}

export function compareCiiXmlToSource(xml: string, source: InvoiceDraft): XmlSourceMatch {
  const reasons: string[] = [];
  if (typeof DOMParser === "undefined") return {status:"mismatch",reasons:["DOM_PARSER_UNAVAILABLE"]};
  if (xml.length === 0 || xml.length > 2_000_000 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml)) return {status:"mismatch",reasons:["UNSAFE_XML"]};

  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  const root = parsed.documentElement;
  if (root.localName !== "CrossIndustryInvoice" || root.namespaceURI !== NS.rsm ||
    parsed.getElementsByTagName("parsererror").length > 0) {
    return {status:"mismatch",reasons:["INVALID_CII_XML"]};
  }
  const facts = extractCiiSourceFacts(source);
  if (!facts.ok) return {status:"mismatch",reasons:["SOURCE_EVIDENCE_INCOMPLETE"]};
  let checks = 0;
  function expectValue(node: Element | null, expected: string | null, field: string) {
    checks++;
    if (!node || node.children.length !== 0 || expected === null ||
      node.textContent !== expected) reasons.push(field);
  }
  function expectPath(base: Element | null, field: string, expected: string | null,
    ...path: string[]) {
    expectValue(get(base,...path),expected,field);
  }
  function expectDate(base: Element | null, field: string, expected: string | null,
    ...path: string[]) {
    const node = get(base,...path);
    checks++;
    if (node?.getAttribute("format") !== "102" || node.children.length !== 0 ||
      expected === null || node.textContent !== expected) reasons.push(field);
  }

  const context = get(root, "rsm:ExchangedDocumentContext",
    "ram:GuidelineSpecifiedDocumentContextParameter");
  expectPath(context, "profile", "urn:cen.eu:en16931:2017", "ram:ID");
  const document = get(root,"rsm:ExchangedDocument");
  expectPath(document,"invoiceNumber",source.fields.invoiceNumber?.value ?? null,"ram:ID");
  expectPath(document,"invoiceType",facts.facts.typeCode.value,"ram:TypeCode");
  expectDate(document,"invoiceDate",date(source.fields.invoiceDate?.value),
    "ram:IssueDateTime","udt:DateTimeString");

  const transaction = get(root,"rsm:SupplyChainTradeTransaction");
  const agreement = get(transaction,"ram:ApplicableHeaderTradeAgreement");
  for (const [role,party,name] of [
    ["Seller",facts.facts.seller,source.fields.issuer?.value],
    ["Buyer",facts.facts.buyer,source.fields.recipient?.value],
  ] as const) {
    const partyNode = get(agreement,"ram:" + role + "TradeParty");
    expectPath(partyNode,role+".name",name ?? null,"ram:Name");
    const address = get(partyNode,"ram:PostalTradeAddress");
    expectPath(address,role+".postcode",party.postcode.value,"ram:PostcodeCode");
    expectPath(address,role+".street",party.street.value,"ram:LineOne");
    expectPath(address,role+".city",party.city.value,"ram:CityName");
    expectPath(address,role+".country",party.countryCode.value,"ram:CountryID");
  }
  const vatId = get(agreement,"ram:SellerTradeParty","ram:SpecifiedTaxRegistration","ram:ID");
  expectValue(vatId,facts.facts.seller.vatId.value,"seller.vatId");
  checks++;
  if (vatId?.getAttribute("schemeID") !== "VA") reasons.push("seller.vatId.scheme");

  const delivery = get(transaction,"ram:ApplicableHeaderTradeDelivery",
    "ram:ActualDeliverySupplyChainEvent","ram:OccurrenceDateTime");
  expectDate(delivery,"deliveryDate",date(facts.facts.deliveryDate.value),"udt:DateTimeString");

  const settlement = get(transaction,"ram:ApplicableHeaderTradeSettlement");
  expectPath(settlement,"currency",facts.facts.currency.value,"ram:InvoiceCurrencyCode");
  const terms = direct(settlement,"ram:SpecifiedTradePaymentTerms");
  if (source.fields.dueDate?.value) {
    checks++;
    if (terms.length !== 1) reasons.push("dueDate.count");
    expectDate(terms[0] ?? null,"dueDate",date(source.fields.dueDate.value),
      "ram:DueDateDateTime","udt:DateTimeString");
  } else {
    checks++;
    if (terms.length !== 0) reasons.push("dueDate.unbacked");
  }
  const summary = get(settlement,"ram:SpecifiedTradeSettlementHeaderMonetarySummation");
  expectPath(summary,"netTotal",amount(source.fields.netTotal?.value),"ram:TaxBasisTotalAmount");
  expectPath(summary,"itemTotal",amount(source.fields.netTotal?.value),"ram:LineTotalAmount");
  expectPath(summary,"taxTotal",amount(source.fields.taxTotal?.value),"ram:TaxTotalAmount");
  const taxCurrency = get(summary,"ram:TaxTotalAmount");
  checks++;
  if (taxCurrency?.getAttribute("currencyID") !== facts.facts.currency.value)
    reasons.push("taxTotal.currency");
  expectPath(summary,"grossTotal",amount(source.fields.grossTotal?.value),"ram:GrandTotalAmount");
  expectPath(summary,"payable",amount(facts.facts.payable.value),"ram:DuePayableAmount");

  const lines = direct(transaction,"ram:IncludedSupplyChainTradeLineItem");
  checks++;
  if (lines.length !== source.items.length) reasons.push("lines.count");
  for (const [index,item] of source.items.entries()) {
    const node = lines[index] ?? null;
    const code = facts.facts.lineCodes[index];
    if (!code) {reasons.push("lines." + index + ".evidence");continue;}
    const id = get(node,"ram:AssociatedDocumentLineDocument");
    expectPath(id,"lines."+index+".id",String(index+1),"ram:LineID");
    const product = get(node,"ram:SpecifiedTradeProduct");
    expectPath(product,"lines."+index+".name",item.description,"ram:Name");
    expectPath(node,"lines."+index+".unitPrice",amount(item.unitPrice),
      "ram:SpecifiedLineTradeAgreement","ram:NetPriceProductTradePrice","ram:ChargeAmount");
    const billed = get(node,"ram:SpecifiedLineTradeDelivery","ram:BilledQuantity");
    expectValue(billed,quantity(item.quantity),"lines."+index+".quantity");
    checks++;
    if (billed?.getAttribute("unitCode") !== code.unit.value) reasons.push("lines."+index+".unitCode");
    const vat = get(node,"ram:SpecifiedLineTradeSettlement","ram:ApplicableTradeTax");
    expectPath(vat,"lines."+index+".vatType","VAT","ram:TypeCode");
    expectPath(vat,"lines."+index+".vatCategory",code.category.value,"ram:CategoryCode");
    const rate = item.taxRate?.replace(/%$/,"");
    expectPath(vat,"lines."+index+".vatRate",rate ? Number(rate).toFixed(2) : null,
      "ram:RateApplicablePercent");
    expectPath(node,"lines."+index+".amount",amount(item.amount),
      "ram:SpecifiedLineTradeSettlement","ram:SpecifiedTradeSettlementLineMonetarySummation",
      "ram:LineTotalAmount");
  }

  const groups = direct(settlement,"ram:ApplicableTradeTax");
  checks++;
  if (groups.length !== source.taxGroups.length) reasons.push("taxGroups.count");
  for(const [index,group] of source.taxGroups.entries()) {
    const node = groups[index] ?? null;
    expectPath(node,"taxGroups."+index+".type","VAT","ram:TypeCode");
    expectPath(node,"taxGroups."+index+".category","S","ram:CategoryCode");
    expectPath(node,"taxGroups."+index+".rate",
      group.rate ? Number(group.rate.replace(/%$/,"")).toFixed(2) : null,
      "ram:RateApplicablePercent");
    expectPath(node,"taxGroups."+index+".net",amount(group.net),"ram:BasisAmount");
    expectPath(node,"taxGroups."+index+".tax",amount(group.tax),"ram:CalculatedAmount");
  }

  return reasons.length ? {status:"mismatch",reasons} : {status:"matched-subset",checks};
}
