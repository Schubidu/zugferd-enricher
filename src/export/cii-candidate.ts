import type { InvoiceDraft } from "../invoice/model";
import { isSourceBackedNet } from "../invoice/model";
import { parseCents } from "../invoice/money";
import { assessExportPreflight } from "./preflight";
import { extractCiiSourceFacts } from "./cii-evidence";
import type { CiiAddress, CiiFact } from "./cii-evidence";

/**
 * Intermediate CII XML only. This has NOT passed official ZUGFeRD 2.5.2
 * XSD/Schematron or independent PDF/A-3 and visual-fidelity validation.
 * Deliberately no public download, Blob or release-eligibility API.
 */
export type CiiCandidateResult =
  | {status: "blocked"; reasons: string[]}
  | {status: "unvalidated"; xml: string; profile: "EN16931"};

function xmlText(value: string): string {
  // XML 1.0 legal characters only; never silently remove illegal user/PDF data.
  for (const character of value) {
    const scalar = character.codePointAt(0)!;
    if ((scalar < 32 && scalar !== 9 && scalar !== 10 && scalar !== 13) ||
      (scalar >= 0xD800 && scalar <= 0xDFFF) || scalar === 0xFFFE || scalar === 0xFFFF)
      throw new Error("Illegal XML 1.0 character in source");
  }
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function tag(name: string, value: string): string {
  return "<ram:" + name + ">" + xmlText(value) + "</ram:" + name + ">";
}
function cents(value: bigint): string {
  const abs = value < 0n ? -value : value;
  return (value < 0n ? "-" : "") + (abs / 100n).toString() +
    "." + (abs % 100n).toString().padStart(2, "0");
}
function valueCents(text: string | null | undefined): bigint | null {
  return text == null ? null : parseCents(text);
}
function sourceDate(text: string | undefined): string | null {
  if (!text) return null;
  const match = /^(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.(\d{1,2})\.(\d{4}))$/.exec(text);
  if (!match) return null;
  const year = Number(match[1] ?? match[6]);
  const month = Number(match[2] ?? match[5]);
  const day = Number(match[3] ?? match[4]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day)
    return null;
  return String(year).padStart(4, "0") + String(month).padStart(2, "0") +
    String(day).padStart(2, "0");
}
function quantity1000(text: string | null): bigint | null {
  const match = /^(\d+)(?:[.,](\d{1,3}))?$/.exec(text ?? "");
  if (!match) return null;
  return BigInt(match[1]!) * 1000n + BigInt((match[2] ?? "").padEnd(3, "0") || "0");
}
function roundPositive(amount: bigint, divisor: bigint): bigint {
  return (amount + divisor / 2n) / divisor;
}
function addressXml(address: CiiAddress): string {
  return "<ram:PostalTradeAddress>" +
    tag("PostcodeCode", address.postcode.value) +
    tag("LineOne", address.street.value) +
    tag("CityName", address.city.value) +
    tag("CountryID", address.countryCode.value) +
    "</ram:PostalTradeAddress>";
}
function partyXml(type: "Seller" | "Buyer", name: CiiFact, address: CiiAddress,
  vatId?: CiiFact): string {
  return "<ram:" + type + "TradeParty>" + tag("Name", name.value) +
    addressXml(address) +
    (vatId ? '<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">' +
      xmlText(vatId.value) + "</ram:ID></ram:SpecifiedTaxRegistration>" : "") +
    "</ram:" + type + "TradeParty>";
}
function simpleEvidenceName(draft: InvoiceDraft, key: "issuer" | "recipient"): CiiFact | null {
  const field = draft.fields[key];
  if (!field || field.origin !== "pdf" || field.evidenceIds.length !== 1 || !field.value.trim())
    return null;
  if (!draft.sourceLines.some(line => line.id === field.evidenceIds[0] &&
    line.text.includes(field.value))) return null;
  return {value: field.value, evidenceId: field.evidenceIds[0]!};
}

/**
 * Build an internally inspectable, non-releasable CII candidate, only if
 * a restricted subset of source documents is completely and explicitly
 * represented. A downstream independent validator is mandatory.
 */
export function buildCiiCandidate(original: InvoiceDraft, reviewed: InvoiceDraft): CiiCandidateResult {
  const preflight = assessExportPreflight(original, reviewed);
  const reasons = preflight.blockers
    .filter(problem => problem.stage === "source" ||
      problem.code === "REQUIRED_FIELD_MISSING" ||
      problem.code === "INVALID_TOTALS" ||
      problem.code === "SOURCE_RECONCILIATION_FAILED" ||
      problem.code === "SOURCE_POSITIONS_MISSING" ||
      problem.code === "LINE_AMOUNT_BASIS_UNVERIFIED")
    .map(problem => problem.code + ":" + problem.path);
  const extracted = extractCiiSourceFacts(original);
  if (!extracted.ok) reasons.push(...extracted.missing.map(key => "EVIDENCE:" + key));

  const invoiceNumber = original.fields.invoiceNumber?.origin === "pdf" &&
    original.fields.invoiceNumber.evidenceIds.length > 0
    ? original.fields.invoiceNumber : null;
  const sellerName = simpleEvidenceName(original, "issuer");
  const buyerName = simpleEvidenceName(original, "recipient");
  if (!sellerName) reasons.push("EVIDENCE:issuer");
  if (!buyerName) reasons.push("EVIDENCE:recipient");
  if (!invoiceNumber?.value || invoiceNumber.origin !== "pdf") reasons.push("EVIDENCE:invoiceNumber");
  const issueDate = sourceDate(original.fields.invoiceDate?.value);
  if (!issueDate) reasons.push("EVIDENCE:invoiceDate");
  const dueDate = original.fields.dueDate ? sourceDate(original.fields.dueDate.value) : null;
  if (original.fields.dueDate && !dueDate) reasons.push("EVIDENCE:dueDate");

  const net = valueCents(original.fields.netTotal?.value);
  const tax = valueCents(original.fields.taxTotal?.value);
  const gross = valueCents(original.fields.grossTotal?.value);
  if (net === null || tax === null || gross === null || net < 0n || tax < 0n ||
    gross < 0n || net + tax !== gross) reasons.push("AMOUNTS:totals");

  let lineTotal = 0n;
  const perRate = new Map<number, bigint>();
  const preparedLines: Array<{name: string; quantity: bigint; unit: bigint;
    amount: bigint; rate: number}> = [];
  for (const [index, item] of original.items.entries()) {
    const amount = valueCents(item.amount);
    const unit = valueCents(item.unitPrice);
    const qty = quantity1000(item.quantity);
    const rate = /^(7|19)%$/.exec(item.taxRate ?? "");
    const isNet = isSourceBackedNet(item);
    if (item.origin !== "pdf" || !isNet || item.taxTreatment ||
      !item.description.trim() || amount === null || amount < 0n ||
      unit === null || unit < 0n || qty === null || qty <= 0n || !rate ||
      roundPositive(unit * qty, 1000n) !== amount) {
      reasons.push("LINE:" + index);
      continue;
    }
    const percent = Number(rate[1]);
    lineTotal += amount;
    perRate.set(percent, (perRate.get(percent) ?? 0n) + amount);
    preparedLines.push({name:item.description,quantity:qty,unit,amount,rate:percent});
  }

  let groupNetSum = 0n;
  let groupTaxSum = 0n;
  const preparedGroups: Array<{rate:number;net:bigint;tax:bigint}> = [];
  const seenRates = new Set<number>();
  for (const group of original.taxGroups) {
    const rate = /^(7|19)%$/.exec(group.rate);
    const base = valueCents(group.net);
    const vat = valueCents(group.tax);
    if (!rate || base === null || vat === null || base < 0n || vat < 0n) {
      reasons.push("TAX:group");
      continue;
    }
    const percent = Number(rate[1]);
    if (seenRates.has(percent) || roundPositive(base * BigInt(percent), 100n) !== vat ||
      perRate.get(percent) !== base) {
      reasons.push("TAX:group-" + percent);
      continue;
    }
    seenRates.add(percent);
    groupNetSum += base;
    groupTaxSum += vat;
    preparedGroups.push({rate:percent,net:base,tax:vat});
  }
  if (preparedLines.length === 0 || preparedLines.length !== original.items.length ||
    seenRates.size !== perRate.size || net === null || tax === null || gross === null ||
    lineTotal !== net || groupNetSum !== net || groupTaxSum !== tax) {
    reasons.push("AMOUNTS:coverage");
  }

  if (!extracted.ok || reasons.length > 0 || !sellerName || !buyerName || !invoiceNumber ||
    !issueDate || net === null || tax === null || gross === null) {
    return {status:"blocked",reasons:[...new Set(reasons)]};
  }

  const facts = extracted.facts;
  const deliveryDate = sourceDate(facts.deliveryDate.value);
  if (!deliveryDate) return {status:"blocked",reasons:["EVIDENCE:deliveryDate"]};
  const payable = valueCents(facts.payable.value);
  // Never guess due payable from invoice gross: partial payments may exist.
  if (payable === null || payable !== gross) {
    return {status:"blocked",reasons:["AMOUNTS:payable"]};
  }

  try {
    const xmlLines = preparedLines.map((line,index) => {
      const codes = facts.lineCodes[index]!;
      const billedQty = (line.quantity / 1000n).toString() +
        (line.quantity % 1000n === 0n ? "" :
          "." + (line.quantity % 1000n).toString().padStart(3,"0").replace(/0+$/, ""));
      return "<ram:IncludedSupplyChainTradeLineItem>" +
        "<ram:AssociatedDocumentLineDocument>" + tag("LineID",String(index + 1)) +
        "</ram:AssociatedDocumentLineDocument>" +
        "<ram:SpecifiedTradeProduct>" + tag("Name",line.name) + "</ram:SpecifiedTradeProduct>" +
        "<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice>" +
        tag("ChargeAmount",cents(line.unit)) +
        "</ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>" +
        "<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode=\"" +
        xmlText(codes.unit.value) + "\">" + billedQty +
        "</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>" +
        "<ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax>" +
        tag("TypeCode","VAT") + tag("CategoryCode",codes.category.value) +
        tag("RateApplicablePercent",line.rate.toFixed(2)) +
        "</ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation>" +
        tag("LineTotalAmount",cents(line.amount)) +
        "</ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>" +
        "</ram:IncludedSupplyChainTradeLineItem>";
    }).join("");

    const xmlGroups = preparedGroups.map(group =>
      "<ram:ApplicableTradeTax>" +
      tag("CalculatedAmount",cents(group.tax)) + tag("TypeCode","VAT") +
      tag("BasisAmount",cents(group.net)) + tag("CategoryCode","S") +
      tag("RateApplicablePercent",group.rate.toFixed(2)) +
      "</ram:ApplicableTradeTax>").join("");

    const optionalDueDate = dueDate
      ? "<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime>" +
        '<udt:DateTimeString format="102">' + dueDate + "</udt:DateTimeString>" +
        "</ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>" : "";

    const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"' +
      ' xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"' +
      ' xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">' +
      "<rsm:ExchangedDocumentContext>" +
      "<ram:GuidelineSpecifiedDocumentContextParameter>" +
      tag("ID","urn:cen.eu:en16931:2017") +
      "</ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>" +
      "<rsm:ExchangedDocument>" +
      tag("ID",invoiceNumber.value) + tag("TypeCode",facts.typeCode.value) +
      '<ram:IssueDateTime><udt:DateTimeString format="102">' +
      issueDate + "</udt:DateTimeString></ram:IssueDateTime>" +
      "</rsm:ExchangedDocument>" +
      "<rsm:SupplyChainTradeTransaction>" + xmlLines +
      "<ram:ApplicableHeaderTradeAgreement>" +
      partyXml("Seller",sellerName,facts.seller,facts.seller.vatId) +
      partyXml("Buyer",buyerName,facts.buyer) +
      "</ram:ApplicableHeaderTradeAgreement>" +
      "<ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent>" +
      '<ram:OccurrenceDateTime><udt:DateTimeString format="102">' +
      deliveryDate +
      "</udt:DateTimeString></ram:OccurrenceDateTime>" +
      "</ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>" +
      "<ram:ApplicableHeaderTradeSettlement>" +
      tag("InvoiceCurrencyCode",facts.currency.value) + xmlGroups +
      optionalDueDate +
      "<ram:SpecifiedTradeSettlementHeaderMonetarySummation>" +
      tag("LineTotalAmount",cents(lineTotal)) +
      tag("TaxBasisTotalAmount",cents(net)) +
      '<ram:TaxTotalAmount currencyID="' + xmlText(facts.currency.value) + '">' +
      cents(tax) + "</ram:TaxTotalAmount>" +
      tag("GrandTotalAmount",cents(gross)) +
      tag("DuePayableAmount",cents(payable)) +
      "</ram:SpecifiedTradeSettlementHeaderMonetarySummation>" +
      "</ram:ApplicableHeaderTradeSettlement></rsm:SupplyChainTradeTransaction>" +
      "</rsm:CrossIndustryInvoice>";

    return {status:"unvalidated",profile:"EN16931",xml};
  } catch {
    return {status:"blocked",reasons:["XML:illegal-source-character"]};
  }
}
