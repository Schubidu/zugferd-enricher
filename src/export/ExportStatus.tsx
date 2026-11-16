import type { InvoiceDraft } from "../invoice/model";
import { assessExportPreflight } from "./preflight";

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
          <p>Für den Export fehlen außerdem die vollständige EN-16931-Datenbasis und unabhängige XML-/PDF/A-3-Prüfungen.</p>
          <p>Eine Verarbeitungskopie ersetzt keine Originalrechnung des Ausstellers.</p>
        </div>
      </details>
    </section>
  );
}
