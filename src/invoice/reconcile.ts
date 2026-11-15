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
  const totals = checkTotals(
    draft.fields.netTotal?.value ?? null,
    draft.fields.taxTotal?.value ?? null,
    draft.fields.grossTotal?.value ?? null,
  );
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

  if (draft.taxGroups.length > 0 && draft.fields.taxTotal) {
    const amounts = draft.taxGroups.map(g => parseCents(g.tax));
    const total = parseCents(draft.fields.taxTotal.value);
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
  for (const item of draft.items) {
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

  if (draft.items.some(item => !item.taxRate)) {
    findings.push({id:"missing-tax-rates",severity:"review",
      message:"Mindestens eine Position hat keinen belegten Steuersatz. Kategorien ersetzen keine Steuerangaben.",
      evidenceIds:draft.items.filter(item=>!item.taxRate).flatMap(item=>item.evidenceIds)});
  }

  return findings;
}
