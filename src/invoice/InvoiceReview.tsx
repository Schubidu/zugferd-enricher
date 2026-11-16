import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { FieldKey, InvoiceDraft, SourceLine } from "./model";
import { FIELD_KEYS, FIELD_LABELS, isSourceBackedNet, isSourceBackedNoVat } from "./model";
import { formatEuroCents, sumLineItemAmounts } from "./money";
import PdfPreview from "./PdfPreview";
import { CATEGORY_IDS, CATEGORY_LABELS, classifyDescription } from "./classify";
import type { Category, Classification } from "./classify";
import { reconcileInvoice } from "./reconcile";
import { summarizeCategories } from "./category-summary";

type Props = {
  pdf: PDFDocumentProxy;
  draft: InvoiceDraft;
  onDraftChange: (next: InvoiceDraft) => void;
};
export default function InvoiceReview({pdf, draft, onDraftChange}: Props) {
  const [page, setPage] = useState(1);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [classifications, setClassifications] = useState<Record<string, Classification>>({});
  const inspectorRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [inspectedEvidence, setInspectedEvidence] = useState<string | null>(null);
  // Every PDF object is a new classification scope, even if item IDs repeat.
  // This also runs when a parent replaces the PDF without unmounting this view.
  useEffect(() => {
    setClassifications({});
    setPage(1);
    setActiveEvidenceId(null);
    setInspectedEvidence(null);
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
  const positionSum = sumLineItemAmounts(draft.items);
  const allNet = draft.items.length > 0 && draft.items.every(isSourceBackedNet);
  const categorySummary = summarizeCategories(draft.items, classifications);
  const findings = reconcileInvoice(draft);
  // These extraction warnings already have dedicated, actionable reconciliation tasks.
  const extraWarnings = draft.warnings.filter(message =>
    !message.startsWith("Mindestens eine Position hat keinen belegten Steuersatz") &&
    !(message === "Kein eindeutig ausgewiesener Gesamtbetrag gefunden." &&
      findings.some(finding => finding.id === "document-total")));

  // Description-only snapshot: changing tax or money must not restart inference.
  const descriptionSnapshot = JSON.stringify(draft.items.map(({id, description}) => ({id, description})));
  useEffect(() => {
    const items = JSON.parse(descriptionSnapshot) as {id: string; description: string}[];
    if (!items.some(item => classifyDescription(item.description).category === "unknown")) return;
    const controller = new AbortController();
    // Avoid repeatedly starting the WASM Worker during a typing burst.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { classifyLocally } = await import("./classify-client");
          if (controller.signal.aborted) return;
          const predicted = await classifyLocally(items, controller.signal);
          if (controller.signal.aborted) return;
          setClassifications(previous => ({
            ...predicted,
            ...Object.fromEntries(Object.entries(previous).filter(
              ([id, entry]) => entry.source === "manual" && items.some(item => item.id === id),
            )),
          }));
        } catch {
          // Optional model failure must never block invoice verification.
          // Rule-based suggestions continue working without WebAssembly.
        }
      })();
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [pdf, descriptionSnapshot]);

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
    const input = target?.querySelector<HTMLElement>(selector);
    if (input) input.focus({preventScroll: true});
    else if (target instanceof HTMLElement) target.focus({preventScroll: true});
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
      setClassifications(previous => {
        const next = {...previous};
        delete next[id];
        return next;
      });
    }
    onDraftChange({
      ...draft,
      items: draft.items.map(item => item.id === id ?
        {...item, [key]: value, taxTreatment: undefined, amountBasis: undefined, origin: "manual"} : item),
    });
  }
  function sourceButton(lines: SourceLine[], ids: string[]) {
    // For two-line fields the value is on the last evidence line, not the label.
    const source = lines.find(line => line.id === ids.at(-1));
    return source ? (
      <button className="evidence-link" type="button"
        aria-label={"Fundstelle S. " + source.page + " im PDF ansehen"}
        onClick={() => focusEvidence(source.id, true)}>
        PDF · S. {source.page}
      </button>
    ) : null;
  }
  return (
    <section className="review-workspace" aria-label="Rechnung prüfen">
      <div className="review-intro">
        <h2>Rechnung prüfen</h2>
      </div>
      {findings.length > 0 && (
        <section className="review-findings" aria-labelledby="reconciliation-heading">
          <div className="review-findings-heading">
            <h3 id="reconciliation-heading">Prüfhinweise</h3>
            <span>{findings.length}</span>
          </div>
          <ul className="reconciliation-findings">
            {findings.map(finding => (
              <li className={"reconciliation-" + finding.severity} key={finding.id}>
                <p>{finding.message}</p>
                <div className="finding-actions">
                  {finding.id === "missing-tax-rates" ? (
                    draft.items.filter(item => !item.taxRate && !isSourceBackedNoVat(item)).map(item => {
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
                  ) : finding.id === "item-net-sum" ? (
                    <button className="review-action" type="button"
                      onClick={() => focusReviewSection("line-items-heading")}>
                      Positionen prüfen
                    </button>
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
        </section>
      )}
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
            <h3 id="invoice-fields-heading" tabIndex={-1}>Rechnungsangaben</h3>
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
                      {field?.origin === "manual" && <span>Manuell geändert · nicht belegt</span>}
                      {sourceButton(draft.sourceLines, field?.evidenceIds ?? [])}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="data-card" aria-labelledby="line-items-heading">
            <h3 id="line-items-heading" tabIndex={-1}>Rechnungspositionen</h3>
            {draft.items.length === 0 ? <p className="quiet">Keine eindeutig strukturierten Positionen erkannt. Bitte Original prüfen.</p> : (
              <div className="line-items">
                {draft.items.map((item, index) => {
                  const assigned = classifications[item.id] ?? classifyDescription(item.description);
                  return (
                  <div
                    className="line-item"
                    id={"line-item-" + item.id}
                    key={item.id}
                  >
                    <div className="line-item-title">
                      <div className="line-item-heading">
                        <strong>Position {index + 1}</strong>
                        {item.quantity && item.unitPrice &&
                          <span className="line-item-meta">{item.quantity} × {item.unitPrice} €</span>}
                      </div>
                      {sourceButton(draft.sourceLines,item.evidenceIds)}
                    </div>
                    <label>Beschreibung
                      <input type="text" aria-label={"Position " + (index+1) + " Beschreibung"}
                        value={item.description} onChange={event => updateItem(item.id,"description",event.currentTarget.value)}/>
                    </label>
                    <div className="line-item-values">
                      <label>Betrag {isSourceBackedNet(item) ? "(Netto)" : "(Basis unbekannt)"}
                        <input type="text" aria-label={"Position " + (index+1) + " Betrag"}
                          value={item.amount} onChange={event => updateItem(item.id,"amount",event.currentTarget.value)}/>
                      </label>
                      {isSourceBackedNoVat(item) ? (
                        <div className="source-tax-treatment">
                          <span>Im Namen der Gemeinde · ohne USt (0,00 €)</span>
                          {sourceButton(draft.sourceLines, item.taxTreatment!.evidenceIds)}
                          <button type="button" className="review-action"
                            onClick={() => updateItem(item.id, "taxRate", "")}>
                            Steuerangabe korrigieren
                          </button>
                        </div>
                      ) : (
                        <label>Steuersatz laut Position
                          <input type="text" aria-label={"Position " + (index+1) + " Steuersatz"}
                            placeholder="Nicht angegeben" value={item.taxRate ?? ""}
                            onChange={event => updateItem(item.id,"taxRate",event.currentTarget.value)}/>
                        </label>
                      )}
                    </div>
                    <label className="category-field">Interne Kategorie
                      <select aria-label={"Position " + (index+1) + " Kategorie"}
                        value={assigned.category}
                        onChange={event => setCategory(item.id,event.currentTarget.value as Category)}>
                        {CATEGORY_IDS.map(id => <option key={id} value={id}>{CATEGORY_LABELS[id]}</option>)}
                      </select>
                    </label>
                    {assigned.source === "manual" &&
                      <span className="category-origin">Manuell gewählt</span>}
                    {item.origin === "manual" &&
                      <p className="manual-warning">Manuell geändert · mit Original vergleichen</p>}
                  </div>
                );})}
              </div>
            )}
            <div className="position-sum" role="status" aria-live="polite">
              <span className="position-sum-label">{allNet ? "Summe der erkannten Netto-Positionen" : "Summe der erkannten Positionen"}</span>
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
              {!allNet &&
                <p className="quiet">Kein automatischer Abgleich mit dem Rechnungsbetrag: Netto-/Bruttobasis nicht gesichert.</p>}
            </div>
          </section>
          <details className="data-card category-overview">
            <summary id="category-summary-heading">Kategorienübersicht</summary>
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
          </details>
          <section className="data-card" aria-labelledby="tax-groups-heading">
            <h3 id="tax-groups-heading" tabIndex={-1}>Ausgewiesene Steuergruppen</h3>
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
          </section>
          {extraWarnings.length > 0 && (
            <section className="data-card warnings" aria-labelledby="warnings-heading">
              <h3 id="warnings-heading">Weitere Auffälligkeiten</h3>
              <ul>{extraWarnings.map((text,index) => <li key={index}>{text}</li>)}</ul>
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
