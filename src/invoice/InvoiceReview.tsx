import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { FieldKey, InvoiceDraft, SourceLine } from "./model";
import { FIELD_KEYS, FIELD_LABELS } from "./model";
import { checkTotals, formatEuroCents, sumLineItemAmounts } from "./money";
import PdfPreview from "./PdfPreview";
import { CATEGORY_IDS, CATEGORY_LABELS, CATEGORY_REVIEW_STATUS_LABELS, classifyDescription, getCategoryReviewStatus } from "./classify";
import type { Category, Classification } from "./classify";
import { reconcileInvoice } from "./reconcile";
import { summarizeCategories } from "./category-summary";
import { modelErrorMessage } from "./model-errors";

type Props = {
  pdf: PDFDocumentProxy;
  draft: InvoiceDraft;
  onDraftChange: (next: InvoiceDraft) => void;
};
export default function InvoiceReview({pdf, draft, onDraftChange}: Props) {
  const [page, setPage] = useState(1);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [classifications, setClassifications] = useState<Record<string, Classification>>({});
  const [classifying, setClassifying] = useState(false);
  const [classificationError, setClassificationError] = useState<string | null>(null);
  const classificationController = useRef<AbortController | null>(null);
  const inspectorRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [inspectedEvidence, setInspectedEvidence] = useState<string | null>(null);
  // Every PDF object is a new classification scope, even if item IDs repeat.
  // This also runs when a parent replaces the PDF without unmounting this view.
  useEffect(() => {
    classificationController.current?.abort();
    classificationController.current = null;
    setClassifications({});
    setClassifying(false);
    setClassificationError(null);
    setPage(1);
    setActiveEvidenceId(null);
    setInspectedEvidence(null);
    return () => classificationController.current?.abort();
  }, [pdf]);
  useEffect(() => {
    if (!inspectedEvidence) return;
    const dialog = inspectorRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      returnFocusRef.current?.focus();
    };
  }, [inspectedEvidence]);
  // Manual edits remain visible but cannot make PDF-backed reconciliation pass.
  const totals = checkTotals(
    draft.fields.netTotal?.origin === "pdf" ? draft.fields.netTotal.value : null,
    draft.fields.taxTotal?.origin === "pdf" ? draft.fields.taxTotal.value : null,
    draft.fields.grossTotal?.origin === "pdf" ? draft.fields.grossTotal.value : null,
  );
  const positionSum = sumLineItemAmounts(draft.items);
  const categorySummary = summarizeCategories(draft.items, classifications);
  const unclassifiedCount = categorySummary.find(group => group.category === "unknown")?.count ?? 0;
  const findings = reconcileInvoice(draft);

  async function runClassification() {
    classificationController.current?.abort();
    const controller = new AbortController();
    classificationController.current = controller;
    setClassifying(true);
    setClassificationError(null);
    try {
      const { classifyLocally } = await import("./classify-client");
      if (controller.signal.aborted) return;
      const predicted = await classifyLocally(draft.items, controller.signal);
      if (!controller.signal.aborted) {
        setClassifications(previous => ({
          ...predicted,
          ...Object.fromEntries(Object.entries(previous).filter(([, entry]) => entry.source === "manual")),
        }));
      }
    } catch (error) {
      if (!controller.signal.aborted) setClassificationError(modelErrorMessage(error));
    } finally {
      if (!controller.signal.aborted) setClassifying(false);
    }
  }

  function setCategory(id: string, category: Category) {
    setClassifications(previous => ({
      ...previous, [id]: {category, source:"manual",confidence:null},
    }));
  }
  function focusEvidence(id: string, openInspector = false) {
    const line = draft.sourceLines.find(x => x.id === id);
    if (line) {
      setPage(line.page);
      setActiveEvidenceId(line.id);
      if (openInspector) {
        returnFocusRef.current = document.activeElement as HTMLElement | null;
        setInspectedEvidence(line.id);
      }
    }
  }
  function focusReviewSection(id: string, selector = "input, select, button") {
    const target = document.getElementById(id);
    target?.scrollIntoView?.({behavior: "smooth", block: "center"});
    const input = target?.querySelector<HTMLInputElement>(selector);
    input?.focus({preventScroll: true});
  }
  function updateField(key: FieldKey, value: string) {
    const old = draft.fields[key];
    onDraftChange({
      ...draft,
      fields: {
        ...draft.fields,
        [key]: {value, evidenceIds: old?.evidenceIds ?? [], origin: "manual"},
      },
    });
  }
  function updateItem(id: string, key: "description" | "amount" | "taxRate", value: string) {
    if (key === "description") {
      classificationController.current?.abort();
      classificationController.current = null;
      setClassifying(false);
      setClassificationError(null);
      setClassifications(previous => {
        const next = {...previous};
        delete next[id];
        return next;
      });
    }
    onDraftChange({
      ...draft,
      items: draft.items.map(item => item.id === id ? {...item, [key]: value, origin: "manual"} : item),
    });
  }
  function sourceButton(lines: SourceLine[], ids: string[]) {
    // For two-line fields the value is on the last evidence line, not the label.
    const source = lines.find(line => line.id === ids.at(-1));
    return source ? (
      <button className="evidence-link" type="button" onClick={() => focusEvidence(source.id, true)}>
        Fundstelle S. {source.page} im PDF ansehen
      </button>
    ) : null;
  }
  return (
    <section className="review-workspace" aria-label="Rechnung prüfen">
      <div className="review-intro">
        <h2>Erkannte Rechnungsdaten</h2>
        <p>Dies ist ein prüfbarer Entwurf, keine berichtigte Rechnung. Erkannte Daten sind Vorschläge; manuelle Korrekturen gelten nicht als durch das Original belegt.</p>
      </div>
      <section className="review-findings" aria-labelledby="reconciliation-heading">
        <div className="review-findings-heading">
          <h3 id="reconciliation-heading">Rechnerische Plausibilitätsprüfung</h3>
          <span>{findings.length} {findings.length === 1 ? "Hinweis" : "Hinweise"}</span>
        </div>
        <p className="quiet">
          Wähle eine Position zum Bearbeiten oder öffne die markierte Fundstelle direkt im Original.
          Fehlende Steuerangaben werden nicht automatisch geschätzt.
        </p>
        {findings.length === 0 ? (
          <p className="total-check match">Keine rechnerischen Abweichungen in den prüfbaren Angaben gefunden.</p>
        ) : (
          <ul className="reconciliation-findings">
            {findings.map(finding => (
              <li className={"reconciliation-" + finding.severity} key={finding.id}>
                <p>{finding.message}</p>
                <div className="finding-actions">
                  {finding.id === "missing-tax-rates" ? (
                    draft.items.filter(item => !item.taxRate).map(item => {
                      const index = draft.items.findIndex(entry => entry.id === item.id);
                      return (
                        <button
                          type="button" className="review-action" key={item.id}
                          onClick={() => focusReviewSection("line-item-" + item.id, 'input[aria-label$=" Steuersatz"]')}
                        >
                          Position {index + 1}: {item.description} bearbeiten
                        </button>
                      );
                    })
                  ) : finding.id.startsWith("manual-item-") || finding.id.startsWith("quantity-") ? (
                    <button className="review-action" type="button"
                      onClick={() => focusReviewSection("line-item-" + finding.id.replace(/^(?:manual-item-|quantity-)/, ""), 'input[aria-label$=" Betrag"]')}>
                      Betroffene Position bearbeiten
                    </button>
                  ) : finding.id === "net-summary" || finding.id === "tax-summary" ||
                    finding.id === "tax-breakdown" || finding.id.startsWith("tax-") ? (
                    <button className="review-action" type="button" onClick={() => focusReviewSection("tax-groups-heading")}>
                      Steuergruppen prüfen
                    </button>
                  ) : (
                    <button className="review-action" type="button" onClick={() => focusReviewSection("invoice-fields-heading")}>
                      Rechnungsangaben prüfen
                    </button>
                  )}
                  {finding.id === "net-summary" && draft.fields.netTotal && (
                    <button className="review-action" type="button"
                      onClick={() => focusEvidence(draft.fields.netTotal!.evidenceIds.at(-1) ?? "", true)}>
                      Gesamtnetto im PDF ansehen
                    </button>
                  )}
                  {finding.id === "net-summary" && draft.taxGroups.map((group, index) => (
                    <button className="review-action" type="button" key={index}
                      onClick={() => focusEvidence(group.evidenceIds.at(-1) ?? "", true)}>
                      Steuergruppe {group.rate} im PDF ansehen
                    </button>
                  ))}
                  {finding.id !== "net-summary" && sourceButton(draft.sourceLines, finding.evidenceIds)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="review-grid">
        <PdfPreview
          pdf={pdf}
          pageNumber={page}
          onPageChange={setPage}
          evidence={draft.sourceLines}
          activeEvidenceId={activeEvidenceId}
        />
        <div className="invoice-data">
          <section className="data-card" aria-labelledby="invoice-fields-heading">
            <h3 id="invoice-fields-heading">Rechnungsangaben</h3>
            <div className="field-grid">
              {FIELD_KEYS.map(key => {
                const field = draft.fields[key];
                return (
                  <div className="invoice-field" key={key}>
                    <label htmlFor={"field-" + key}>{FIELD_LABELS[key]}</label>
                    <input
                      id={"field-" + key}
                      type="text"
                      value={field?.value ?? ""}
                      placeholder="Nicht erkannt"
                      onChange={event => updateField(key, event.currentTarget.value)}
                    />
                    <div className="field-meta">
                      <span>{field ? (field.origin === "manual" ? "Manuell geändert · nicht belegt" : "Aus PDF erkannt") : "Unbekannt"}</span>
                      {sourceButton(draft.sourceLines, field?.evidenceIds ?? [])}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className={"total-check " + totals.status} role="status">
              {totals.status === "match" ? "Netto + Umsatzsteuer = Brutto · rechnerisch konsistent" :
                totals.status === "mismatch" ? "Widerspruch: Netto + Umsatzsteuer stimmt nicht mit Brutto überein." :
                  "Summen nicht vollständig prüfbar. Fehlende Werte werden nicht geschätzt."}
            </p>
          </section>
          <section className="data-card" aria-labelledby="line-items-heading">
            <h3 id="line-items-heading">Rechnungspositionen</h3>
            <div className="classification-action">
              <button type="button" onClick={() => void runClassification()}
                disabled={classifying || draft.items.length === 0}>
                {classifying ? "Lokales Modell läuft…" : "Positionen lokal klassifizieren"}
              </button>
              <p className="quiet">
                Vorschläge aus Regeln und optionalem fastText-WASM-Modell.
                Keine Weitergabe deiner Rechnung; die Kategorie legt weder Steuer noch Betrag fest.
              </p>
              {classificationError && <p role="alert" className="error">{classificationError}</p>}
            </div>
            {unclassifiedCount > 0 && (
              <p className="unclassified-summary">
                {unclassifiedCount} {unclassifiedCount === 1 ? "Position benötigt" : "Positionen benötigen"} eine Kategorie.
                Die betreffenden Positionen sind hervorgehoben.
              </p>
            )}
            {draft.items.length === 0 ? <p className="quiet">Keine eindeutig strukturierten Positionen erkannt. Bitte Original prüfen.</p> : (
              <div className="line-items">
                {draft.items.map((item, index) => {
                  const assigned = classifications[item.id] ?? classifyDescription(item.description);
                  return (
                  <div
                    className={assigned.category === "unknown" ? "line-item line-item--unclassified" : "line-item"}
                    id={"line-item-" + item.id}
                    key={item.id}
                  >
                    <div className="line-item-title">
                      <div className="line-item-heading">
                        <strong>Position {index + 1}</strong>
                        {assigned.category === "unknown" && (
                          <span className="category-review-label">Kategorie prüfen</span>
                        )}
                      </div>
                      {sourceButton(draft.sourceLines,item.evidenceIds)}
                    </div>
                    <label>Beschreibung
                      <input type="text" aria-label={"Position " + (index+1) + " Beschreibung"}
                        value={item.description} onChange={event => updateItem(item.id,"description",event.currentTarget.value)}/>
                    </label>
                    <div className="line-item-values">
                      <label>Betrag (Basis unbekannt)
                        <input type="text" aria-label={"Position " + (index+1) + " Betrag"}
                          value={item.amount} onChange={event => updateItem(item.id,"amount",event.currentTarget.value)}/>
                      </label>
                      <label>Steuersatz laut Position
                        <input type="text" aria-label={"Position " + (index+1) + " Steuersatz"}
                          placeholder="Nicht angegeben" value={item.taxRate ?? ""}
                          onChange={event => updateItem(item.id,"taxRate",event.currentTarget.value)}/>
                      </label>
                    </div>
                    <label className="category-field">Interne Kategorie
                      <select aria-label={"Position " + (index+1) + " Kategorie"}
                        value={assigned.category}
                        onChange={event => setCategory(item.id,event.currentTarget.value as Category)}>
                        {CATEGORY_IDS.map(id => <option key={id} value={id}>{CATEGORY_LABELS[id]}</option>)}
                      </select>
                    </label>
                    {!item.taxRate && (
                      <p className="position-review-note">Kein Steuersatz aus dem Original erkannt – hier prüfen.</p>
                    )}
                    <p className="category-origin">
                      <strong>Kategoriestatus: {CATEGORY_REVIEW_STATUS_LABELS[getCategoryReviewStatus(assigned)]}</strong>
                      {" · "}
                      <span>{assigned.source === "manual" ? "Manuell gewählt" :
                        assigned.source === "rule" ? "Regelbasierter Vorschlag" :
                          assigned.source === "fasttext" ? "Lokaler fastText-Vorschlag · " +
                            Math.round((assigned.confidence ?? 0)*100) + " % Modellwahrscheinlichkeit" :
                            "Keine sichere Zuordnung"}</span>
                    </p>
                    {item.quantity && <p className="quiet">Menge: {item.quantity}{item.unitPrice ? " · Einzelpreis: " + item.unitPrice : ""}</p>}
                    {item.origin === "manual" && <p className="manual-warning">Manuelle Änderung – mit Original abgleichen.</p>}
                  </div>
                );})}
              </div>
            )}
            <div className="position-sum" role="status" aria-live="polite">
              <span className="position-sum-label">Summe der erkannten Positionen</span>
              <strong className="position-sum-value">
                {positionSum.totalCents === null
                  ? "Nicht berechenbar"
                  : formatEuroCents(positionSum.totalCents)}
              </strong>
              {positionSum.invalidCount > 0 && (
                <p className="position-sum-error">
                  {positionSum.invalidCount} Betragsangabe(n) sind ungültig oder unvollständig.
                </p>
              )}
              <p className="quiet">
                Summe aus {positionSum.itemCount} erkannten Positionen einschließlich manueller Änderungen.
                Die Betragsbasis (netto/brutto) und Vollständigkeit sind nicht geprüft.
                Deshalb ist dies kein automatischer Abgleich mit dem Rechnungsbetrag.
              </p>
            </div>
          </section>
          <section className="data-card" aria-labelledby="category-summary-heading">
            <h3 id="category-summary-heading">Kategorienübersicht</h3>
            {categorySummary.length === 0 ? (
              <p className="quiet">Noch keine Rechnungspositionen erkannt.</p>
            ) : (
              <div className="category-summary-scroll">
                <table className="category-summary-table">
                  <thead>
                    <tr>
                      <th scope="col">Kategorie</th>
                      <th scope="col">Positionen</th>
                      <th scope="col">Summe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categorySummary.map(group => (
                      <tr key={group.category}>
                        <th scope="row">{CATEGORY_LABELS[group.category]}</th>
                        <td>{group.count}</td>
                        <td>
                          {group.totalCents === null
                            ? "Nicht berechenbar"
                            : formatEuroCents(group.totalCents)}
                          {group.invalidCount > 0 && (
                            <span className="category-summary-invalid">
                              {" · " + group.invalidCount + " ungültige Betragsangabe(n)"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="quiet">
              Die Übersicht wird bei jeder Änderung von Kategorie oder Positionsbetrag automatisch aktualisiert.
              „Unbekannt“ bleibt von „Sonstiges“ getrennt; „Sonstiges“ wird nur bewusst manuell
              zugeordnet. Ein Vorschlag ist nicht bestätigt. Die Rechnungsprüfung oben ist
              unabhängig von diesen Kategorien. Es werden nur erkannte Positionen addiert;
              die Netto-/Brutto-Basis und Vollständigkeit sind nicht geprüft.
              Kategorien ändern keine Steuersätze und werden nicht als ZUGFeRD-Klassifikationscodes verwendet.
            </p>
          </section>
          <section className="data-card" aria-labelledby="tax-groups-heading">
            <h3 id="tax-groups-heading">Ausgewiesene Steuergruppen</h3>
            {draft.taxGroups.length === 0 ? <p className="quiet">Keine eindeutig ausgewiesenen Steuergruppen erkannt.</p> : (
              <div className="tax-groups">
                {draft.taxGroups.map((group, index) => (
                  <div className="tax-group" key={index}>
                    <strong>{group.rate}</strong>
                    <span>Netto {group.net}</span>
                    <span>Steuer {group.tax}</span>
                    {sourceButton(draft.sourceLines,group.evidenceIds)}
                  </div>
                ))}
              </div>
            )}
            <p className="quiet">Steuergruppen und Positionen werden nicht automatisch umverteilt oder als Brutto/Netto angenommen.</p>
          </section>
          {draft.warnings.length > 0 && (
            <section className="data-card warnings" aria-labelledby="warnings-heading">
              <h3 id="warnings-heading">Offene Punkte</h3>
              <ul>{draft.warnings.map((text,index) => <li key={index}>{text}</li>)}</ul>
            </section>
          )}
          <details className="data-card raw-lines">
            <summary>Ausgelesenen Originaltext anzeigen ({draft.sourceLines.length} Zeilen)</summary>
            <ol>{draft.sourceLines.map(line => <li key={line.id}>
              <button type="button" className="source-row" onClick={() => focusEvidence(line.id)}>
                <span>S. {line.page}</span> {line.text}
              </button>
            </li>)}</ol>
          </details>
        </div>
      </div>
      {inspectedEvidence && (
        <dialog
          ref={inspectorRef}
          className="evidence-dialog"
          open={typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype.showModal !== "function"}
          aria-label="Fundstelle im Originaldokument"
          onClose={() => setInspectedEvidence(null)}
        >
          <div className="evidence-dialog-content">
            <div className="evidence-dialog-toolbar">
              <strong>Fundstelle im Original</strong>
              <button type="button" onClick={() => setInspectedEvidence(null)}>
                Zur Prüfung zurück
              </button>
            </div>
            <PdfPreview
              pdf={pdf}
              pageNumber={page}
              onPageChange={setPage}
              evidence={draft.sourceLines}
              activeEvidenceId={inspectedEvidence}
            />
          </div>
        </dialog>
      )}
    </section>
  );
}
