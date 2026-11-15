import type { InvoiceDraft } from "./model";
import { checkTotals, formatEuroCents, parseCents } from "./money";

export type Finding = {
  id: string;
  severity: "info" | "review" | "mismatch";
  message: string;
  evidenceIds: string[];
};

/** Only validate facts stated on the source. Never infer missing VAT allocations. */
export function reconcileInvoice(draft: InvoiceDraft): Finding[] {
  const findings: Finding[] = [];
  // Source-backed checks must not be satisfied by user-entered replacements.
  const pdfAmount = (key: "netTotal" | "taxTotal" | "grossTotal") =>
    draft.fields[key]?.origin === "pdf" ? draft.fields[key].value : null;
  const totals = checkTotals(
    pdfAmount("netTotal"),
    pdfAmount("taxTotal"),
    pdfAmount("grossTotal"),
  );
  const manualTotals = (["netTotal", "taxTotal", "grossTotal"] as const)
    .filter(key => draft.fields[key]?.origin === "manual");
  if (manualTotals.length > 0) {
    findings.push({
      id: "manual-document-values", severity: "review",
      message: "Manuell geänderte Summen sind nicht durch das Original belegt. Bitte dort prüfen.",
      evidenceIds: [],
    });
  }
  if (totals.status === "mismatch") {
    findings.push({
      id:"document-total",severity:"mismatch",
      message:"Netto + Steuer weicht vom ausgewiesenen Bruttobetrag ab.",
      evidenceIds:[
        ...(draft.fields.netTotal?.evidenceIds ?? []),
        ...(draft.fields.taxTotal?.evidenceIds ?? []),
        ...(draft.fields.grossTotal?.evidenceIds ?? []),
      ],
    });
  } else if (totals.status === "unknown") {
    findings.push({id:"document-total",severity:"review",message:"Dokumentsumme nicht vollständig belegbar.",evidenceIds:[]});
  }

  for (const group of draft.taxGroups) {
    const net = parseCents(group.net), tax = parseCents(group.tax);
    const rate = /^(7|19)%$/.exec(group.rate);
    if (net === null || tax === null || !rate) {
      findings.push({id:"tax-"+group.evidenceIds.join("-"),severity:"review",
        message:"Steuergruppe enthält nicht prüfbare Werte.",evidenceIds:group.evidenceIds});
      continue;
    }
    const percentage = BigInt(rate[1]!);
    // One full cent of printed rounding difference is tolerated; >1 cent is flagged.
    const numerator = net * percentage;
    const expected = numerator >= 0n ? (numerator + 50n) / 100n : -((-numerator + 50n) / 100n);
    const delta = expected - tax;
    if (delta > 1n || delta < -1n) {
      findings.push({
        id:"tax-"+group.evidenceIds.join("-"),severity:"mismatch",
        message:group.rate + ": ausgewiesene Steuer " + formatEuroCents(tax) +
          " weicht vom rechnerischen Betrag " + formatEuroCents(expected) + " ab.",
        evidenceIds:group.evidenceIds,
      });
    }
  }

  if (draft.taxGroups.length === 0 && pdfAmount("taxTotal") !== null &&
      parseCents(pdfAmount("taxTotal")!) !== 0n) {
    findings.push({
      id:"tax-breakdown",severity:"review",
      message:"Es sind keine ausgewiesenen Steuergruppen erkennbar. Eine Aufteilung kann nicht berechnet werden.",
      evidenceIds:draft.fields.taxTotal.evidenceIds,
    });
  }

  if (draft.taxGroups.length > 0 && pdfAmount("taxTotal") !== null) {
    const amounts = draft.taxGroups.map(g => parseCents(g.tax));
    const total = parseCents(pdfAmount("taxTotal")!);
    if (total !== null && amounts.every(x => x !== null)) {
      const groupsTotal = amounts.reduce<bigint>((sum,x) => sum + x!,0n);
      if (groupsTotal !== total) {
        findings.push({
          id:"tax-summary",severity:"review",
          message:"Die erkannten Steuergruppen ergeben nicht die ausgewiesene Gesamtsteuer; weitere Gruppen könnten fehlen.",
          evidenceIds:[
            ...draft.taxGroups.flatMap(g => g.evidenceIds),
            ...draft.fields.taxTotal.evidenceIds,
          ],
        });
      }
    }
  }
  if (draft.taxGroups.length > 0 && pdfAmount("netTotal") !== null) {
    const amounts = draft.taxGroups.map(g => parseCents(g.net));
    const total = parseCents(pdfAmount("netTotal")!);
    if (total !== null && amounts.every(x => x !== null)) {
      const groupNet = amounts.reduce<bigint>((sum, amount) => sum + amount!, 0n);
      if (groupNet !== total) {
        findings.push({
          id: "net-summary", severity: "review",
          message: "Die Nettobeträge der erkannten Steuergruppen ergeben nicht den ausgewiesenen Gesamtnettobetrag; weitere Gruppen könnten fehlen.",
          evidenceIds: [
            ...draft.taxGroups.flatMap(group => group.evidenceIds),
            ...(draft.fields.netTotal?.evidenceIds ?? []),
          ],
        });
      }
    }
  }
  for (const item of draft.items) {
    if (item.origin === "manual") {
      findings.push({
        id: "manual-item-" + item.id, severity: "review",
        message: "Diese Position wurde manuell geändert. Ein rechnerischer Abgleich mit dem ursprünglichen Positionsbetrag ist nicht belegbar.",
        evidenceIds: [],
      });
      continue;
    }
    const qty = item.quantity?.trim();
    if (!qty || !item.unitPrice) continue;
    const match = /^(\d+)(?:[.,](\d{1,3}))?$/.exec(qty);
    const unit = parseCents(item.unitPrice);
    const amount = parseCents(item.amount);
    if (!match || unit === null || amount === null) {
      findings.push({id:"quantity-"+item.id,severity:"review",
        message:"Menge × Einzelpreis für Position ist nicht prüfbar.",evidenceIds:item.evidenceIds});
      continue;
    }
    const fraction = (match[2] ?? "").padEnd(3,"0");
    const quantity1000 = BigInt(match[1]!) * 1000n + BigInt(fraction || "0");
    const raw = unit * quantity1000;
    const expected = raw >= 0n ? (raw + 500n) / 1000n : -((-raw + 500n) / 1000n);
    if (expected !== amount) {
      findings.push({
        id:"quantity-"+item.id,severity:"mismatch",
        message:"Menge × Einzelpreis stimmt nicht mit dem ausgewiesenen Positionsbetrag überein.",
        evidenceIds:item.evidenceIds,
      });
    }
  }

  function dateValue(value: string): number | null {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
    const english = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value.trim());
    if (!iso && !german && !english) return null;
    const monthNames = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const year = Number(iso?.[1] ?? german?.[3] ?? english?.[3]);
    const month = english
      ? monthNames.indexOf(english[1]!.slice(0, 3).toLowerCase()) + 1
      : Number(iso?.[2] ?? german?.[2]);
    const day = Number(iso?.[3] ?? german?.[1] ?? english?.[2]);
    const timestamp = Date.UTC(year, month-1, day);
    const parsed = new Date(timestamp);
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month-1 &&
      parsed.getUTCDate() === day ? timestamp : null;
  }
  const invoiceDate = draft.fields.invoiceDate && dateValue(draft.fields.invoiceDate.value);
  const dueDate = draft.fields.dueDate && dateValue(draft.fields.dueDate.value);
  if (invoiceDate !== null && dueDate !== null && invoiceDate !== undefined &&
    dueDate !== undefined && dueDate < invoiceDate) {
    findings.push({
      id:"date-order",severity:"review",
      message:"Das Fälligkeitsdatum liegt vor dem Rechnungsdatum. Bitte Original prüfen.",
      evidenceIds:[
        ...(draft.fields.invoiceDate?.evidenceIds ?? []),
        ...(draft.fields.dueDate?.evidenceIds ?? []),
      ],
    });
  }

  if (draft.items.some(item => !item.taxRate)) {
    findings.push({id:"missing-tax-rates",severity:"review",
      message:"Mindestens eine Position hat keinen belegten Steuersatz. Kategorien ersetzen keine Steuerangaben.",
      evidenceIds:draft.items.filter(item=>!item.taxRate).flatMap(item=>item.evidenceIds)});
  }

  return findings;
}
