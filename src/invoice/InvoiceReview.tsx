import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { FieldKey, InvoiceDraft, SourceLine } from "./model";
import { FIELD_KEYS, FIELD_LABELS } from "./model";
import { checkTotals, formatEuroCents, sumLineItemAmounts } from "./money";
import PdfPreview from "./PdfPreview";
import { CATEGORY_IDS, CATEGORY_LABELS, classifyDescription } from "./classify";
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
  useEffect(() => () => classificationController.current?.abort(), []);
  // Manual edits remain visible but cannot make PDF-backed reconciliation pass.
  const totals = checkTotals(
    draft.fields.netTotal?.origin === "pdf" ? draft.fields.netTotal.value : null,
    draft.fields.taxTotal?.origin === "pdf" ? draft.fields.taxTotal.value : null,
    draft.fields.grossTotal?.origin === "pdf" ? draft.fields.grossTotal.value : null,
  );
  const positionSum = sumLineItemAmounts(draft.items);
  const categorySummary = summarizeCategories(draft.items, classifications);
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
  function focusEvidence(id: string) {
    const line = draft.sourceLines.find(x => x.id === id);
    if (line) {
      setPage(line.page);
      setActiveEvidenceId(line.id);
    }
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
      <button className="evidence-link" type="button" onClick={() => focusEvidence(source.id)}>
        Fundstelle S. {source.page}
      </button>
    ) : null;
  }
  return (
    <section className="review-workspace" aria-label="Rechnung prüfen">
      <div className="review-intro">
        <h2>Erkannte Rechnungsdaten</h2>
        <p>Dies ist ein prüfbarer Entwurf, keine berichtigte Rechnung. Erkannte Daten sind Vorschläge; manuelle Korrekturen gelten nicht als durch das Original belegt.</p>
      </div>
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
            {draft.items.length === 0 ? <p className="quiet">Keine eindeutig strukturierten Positionen erkannt. Bitte Original prüfen.</p> : (
              <div className="line-items">
                {draft.items.map((item, index) => {
                  const assigned = classifications[item.id] ?? classifyDescription(item.description);
                  return (
                  <div className="line-item" key={item.id}>
                    <div className="line-item-title"><strong>Position {index + 1}</strong>{sourceButton(draft.sourceLines,item.evidenceIds)}</div>
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
                    <label className="category-field">Kategorie (Vorschlag)
                      <select aria-label={"Position " + (index+1) + " Kategorie"}
                        value={assigned.category}
                        onChange={event => setCategory(item.id,event.currentTarget.value as Category)}>
                        {CATEGORY_IDS.map(id => <option key={id} value={id}>{CATEGORY_LABELS[id]}</option>)}
                      </select>
                    </label>
                    <p className="category-origin">
                      {assigned.source === "manual" ? "Manuell gewählt" :
                        assigned.source === "rule" ? "Regelbasierter Vorschlag" :
                          assigned.source === "fasttext" ? "Lokaler fastText-Vorschlag · " +
                            Math.round((assigned.confidence ?? 0)*100) + " % Modellwahrscheinlichkeit" :
                            "Keine sichere Zuordnung"}
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
              Auch „Unbekannt“ bleibt sichtbar. Es werden nur erkannte Positionen addiert;
              die Netto-/Brutto-Basis und Vollständigkeit sind nicht geprüft.
              Kategorien ändern keine Steuersätze und stellen keine Steueraufteilung dar.
            </p>
          </section>
          <section className="data-card" aria-labelledby="reconciliation-heading">
            <h3 id="reconciliation-heading">Rechnerische Plausibilitätsprüfung</h3>
            <p className="quiet">
              Vergleicht ausschließlich explizit belegte Beträge und Steuersätze.
              Die Kategorien werden nicht verwendet, um Steueranteile zu schätzen.
            </p>
            {findings.length === 0 ? (
              <p className="total-check match">Keine rechnerischen Abweichungen in den prüfbaren Angaben gefunden.</p>
            ) : (
              <ul className="reconciliation-findings">
                {findings.map(finding => (
                  <li className={"reconciliation-" + finding.severity} key={finding.id}>
                    <span>{finding.message}</span>
                    {sourceButton(draft.sourceLines,finding.evidenceIds)}
                  </li>
                ))}
              </ul>
            )}
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
    </section>
  );
}
