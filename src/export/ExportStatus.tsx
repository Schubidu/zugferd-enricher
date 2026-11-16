import type { InvoiceDraft } from "../invoice/model";
import { assessExportPreflight } from "./preflight";

type Props = {
  original: InvoiceDraft;
  reviewed: InvoiceDraft;
};

/**
 * Make the export gate inspectable without pretending a derivative PDF exists.
 * The details are optional: routine invoice review stays the primary workflow.
 */
export default function ExportStatus({original, reviewed}: Props) {
  const assessment = assessExportPreflight(original, reviewed);
  const sourceProblems = assessment.blockers.filter(blocker => blocker.stage === "source");
  const invoiceProblems = assessment.blockers.filter(blocker => blocker.stage === "semantics");
  const technicalPending = assessment.blockers.some(blocker => blocker.stage === "conformance");

  return (
    <section className="export-status" aria-labelledby="export-status-heading">
      <div className="export-status-intro">
        <h2 id="export-status-heading">ZUGFeRD-Verarbeitungskopie</h2>
        <p>Export noch nicht verfügbar. Die erforderlichen Rechnungsangaben und unabhängigen Konformitätsprüfungen sind noch nicht vollständig.</p>
      </div>
      <details className="export-status-details">
        <summary>Exportvoraussetzungen anzeigen</summary>
        <div className="export-status-breakdown">
          {sourceProblems.length > 0 && (
            <div>
              <h3>Abweichungen zum Original</h3>
              <ul>
                {sourceProblems.map(blocker => (
                  <li key={blocker.code + blocker.path}>{blocker.message}</li>
                ))}
              </ul>
              <p>Manuelle Änderungen können Originalangaben nicht ersetzen. Vergleiche sie mit den Fundstellen im PDF.</p>
            </div>
          )}
          {invoiceProblems.length > 0 && (
            <div>
              <h3>Fehlende oder ungeklärte Rechnungsangaben</h3>
              <ul>
                {invoiceProblems.map(blocker => (
                  <li key={blocker.code + blocker.path}>{blocker.message}</li>
                ))}
              </ul>
            </div>
          )}
          {technicalPending && (
            <div>
              <h3>Technische Validierung</h3>
              <p>XML-Schema, EN-16931-Geschäftsregeln, PDF/A-3 und der Vergleich zwischen sichtbarer Rechnung und eingebettetem XML müssen noch unabhängig validiert werden.</p>
            </div>
          )}
          <p>Eine spätere Verarbeitungskopie ersetzt weder die Originalrechnung noch eine Korrektur durch den Rechnungsaussteller.</p>
        </div>
      </details>
    </section>
  );
}
