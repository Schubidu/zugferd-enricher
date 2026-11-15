import { useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { FieldKey, InvoiceDraft, SourceLine } from "./model";
import { FIELD_KEYS, FIELD_LABELS } from "./model";
import { checkTotals } from "./money";
import PdfPreview from "./PdfPreview";

type Props = {
  pdf: PDFDocumentProxy;
  draft: InvoiceDraft;
  onDraftChange: (next: InvoiceDraft) => void;
};
export default function InvoiceReview({pdf, draft, onDraftChange}: Props) {
  const [page, setPage] = useState(1);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const totals = checkTotals(
    draft.fields.netTotal?.value ?? null,
    draft.fields.taxTotal?.value ?? null,
    draft.fields.grossTotal?.value ?? null,
  );
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
    onDraftChange({
      ...draft,
      items: draft.items.map(item => item.id === id ? {...item, [key]: value, origin: "manual"} : item),
    });
  }
  function sourceButton(lines: SourceLine[], ids: string[]) {
    const source = lines.find(line => ids.includes(line.id));
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
            {draft.items.length === 0 ? <p className="quiet">Keine eindeutig strukturierten Positionen erkannt. Bitte Original prüfen.</p> : (
              <div className="line-items">
                {draft.items.map((item, index) => (
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
                    {item.quantity && <p className="quiet">Menge: {item.quantity}{item.unitPrice ? " · Einzelpreis: " + item.unitPrice : ""}</p>}
                    {item.origin === "manual" && <p className="manual-warning">Manuelle Änderung – mit Original abgleichen.</p>}
                  </div>
                ))}
              </div>
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
