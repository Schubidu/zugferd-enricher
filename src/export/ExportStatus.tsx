import { useEffect, useMemo, useState } from "react";
import type { InvoiceDraft } from "../invoice/model";
import { assessExportPreflight } from "./preflight";
import { buildCiiCandidate } from "./cii-candidate";
import type { CiiCandidateResult } from "./cii-candidate";
import { validateCiiXmlInBrowser } from "./local-xml-validator";
import type { LocalXmlValidation } from "./local-xml-validator";

type Props = {
  original: InvoiceDraft;
  reviewed: InvoiceDraft;
};

/**
 * A secondary, optional explanation of export limitations.
 * Invoice analysis and the still-incomplete export are separate workflows.
 */
export default function ExportStatus({original, reviewed}: Props) {
  const report = assessExportPreflight(original, reviewed);
  const candidate = useMemo<CiiCandidateResult>(() => {
    try {
      return buildCiiCandidate(original,reviewed);
    } catch {
      return {status:"blocked",reasons:["LOCAL_CII_UNAVAILABLE"]};
    }
  },[original,reviewed]);
  const [verification,setVerification] = useState<{
    xml: string; result: LocalXmlValidation;
  } | null>(null);
  useEffect(() => {
    if (candidate.status !== "unvalidated") return;
    const controller = new AbortController();
    void validateCiiXmlInBrowser(candidate.xml,controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setVerification({xml:candidate.xml,result});
      })
      .catch(() => {
        if (!controller.signal.aborted) setVerification({
          xml:candidate.xml,
          result:{status:"unavailable",reason:"LOCAL_VALIDATION_UNAVAILABLE"},
        });
      });
    return () => controller.abort();
  },[candidate]);
  const xmlCheck = candidate.status === "unvalidated" &&
    verification?.xml === candidate.xml ? verification.result : null;
  const sourceProblems = report.blockers.filter(blocker => blocker.stage === "source");
  const missingFields = report.blockers.filter(blocker =>
    blocker.code === "REQUIRED_FIELD_MISSING");
  const inconsistentTotals = report.blockers.some(blocker =>
    blocker.code === "INVALID_TOTALS");

  return (
    <section className="export-status" aria-label="ZUGFeRD-Export">
      <details className="export-status-details">
        <summary>ZUGFeRD-Export <span>· noch nicht verfügbar</span></summary>
        <div className="export-status-breakdown">
          <p>Die Rechnungsprüfung funktioniert bereits. Der validierte Export ist noch in Entwicklung.</p>
          {sourceProblems.length > 0 && (
            <div>
              <h3>Änderungen gegenüber dem Original</h3>
              <ul>{sourceProblems.map(blocker => (
                <li key={blocker.code + blocker.path}>{blocker.message}</li>
              ))}</ul>
            </div>
          )}
          {(missingFields.length > 0 || inconsistentTotals) && (
            <div>
              <h3>Offene Rechnungsangaben</h3>
              <ul>
                {missingFields.map(blocker => (
                  <li key={blocker.path}>{blocker.message}</li>
                ))}
                {inconsistentTotals && <li>Netto, Umsatzsteuer und Brutto stimmen nicht nachweisbar überein.</li>}
              </ul>
            </div>
          )}
          <p aria-live="polite">{
            xmlCheck?.status === "valid-xml-only"
              ? "Die erkannten XML-Daten bestehen die lokalen EN-16931-Regeln. Vollständiger Originalabgleich und PDF/A-3 fehlen weiterhin."
              : xmlCheck?.status === "invalid"
                ? "Die lokale EN-16931-Prüfung hat Widersprüche erkannt. Ein Export bleibt gesperrt."
                : xmlCheck?.status === "unavailable"
                  ? "Die lokale XML-Prüfung ist nicht verfügbar. Ein Export bleibt gesperrt."
                  : "Für den Export fehlen außerdem die vollständige EN-16931-Datenbasis und unabhängige XML-/PDF/A-3-Prüfungen."
          }</p>
          <p>Eine Verarbeitungskopie ersetzt keine Originalrechnung des Ausstellers.</p>
        </div>
      </details>
    </section>
  );
}
