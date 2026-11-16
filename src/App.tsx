import { useEffect, useRef, useState } from "react";
import InvoiceReview from "./invoice/InvoiceReview";
import ExportStatus from "./export/ExportStatus";
import type { LoadedInvoice } from "./invoice/pdf";
import type { ChangeEvent, DragEvent } from "react";
import { formatFileSize, validatePdfSelection } from "./pdf-selection";
import type { PdfSelectionError } from "./pdf-selection";

const messages: Record<PdfSelectionError, string> = {
  "invalid-type": "Bitte wähle eine Datei mit der Endung .pdf.",
  empty: "Die ausgewählte PDF-Datei ist leer.",
  "too-large": "Die Datei ist größer als 50 MB. Bitte wähle eine kleinere Rechnung.",
};

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [loaded, setLoaded] = useState<LoadedInvoice | null>(null);
  const loadedRef = useRef<LoadedInvoice | null>(null);
  const generation = useRef(0);
  const extractionController = useRef<AbortController | null>(null);

  useEffect(() => () => {
    generation.current++;
    extractionController.current?.abort();
    extractionController.current = null;
    if (loadedRef.current) void loadedRef.current.pdf.loadingTask.destroy();
    loadedRef.current = null;
  }, []);

  function clearLoaded() {
    generation.current++;
    extractionController.current?.abort();
    extractionController.current = null;
    if (loadedRef.current) void loadedRef.current.pdf.loadingTask.destroy();
    loadedRef.current = null;
    setLoaded(null);
    setReading(false);
  }

  async function readSelectedPdf() {
    if (!selectedFile || reading) return;
    const active = ++generation.current;
    const controller = new AbortController();
    extractionController.current = controller;
    setReading(true);
    setError(null);
    try {
      const { loadInvoicePdf } = await import("./invoice/pdf");
      const result = await loadInvoicePdf(selectedFile, controller.signal);
      if (generation.current !== active) {
        void result.pdf.loadingTask.destroy();
        return;
      }
      if (loadedRef.current) void loadedRef.current.pdf.loadingTask.destroy();
      loadedRef.current = result;
      setLoaded(result);
    } catch {
      if (generation.current === active) {
        setError("Diese PDF konnte nicht ausgelesen werden. Bitte prüfe die Datei und versuche es erneut.");
      }
    } finally {
      if (generation.current === active) {
        extractionController.current = null;
        setReading(false);
      }
    }
  }

  function selectFile(file: File | null) {
    if (!file) return;
    clearLoaded();
    // Always reset the native picker so the same file can be reselected after a drop.
    if (inputRef.current) inputRef.current.value = "";
    const reason = validatePdfSelection(file);
    if (reason) {
      setSelectedFile(null);
      setError(messages[reason]);
      return;
    }
    setSelectedFile(file);
    setError(null);
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.currentTarget.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    selectFile(event.dataTransfer.files.item(0));
  }

  function resetSelection() {
    clearLoaded();
    setSelectedFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <main className="page">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="ZUGFeRD Enricher Startseite">
          <span className="wordmark-icon" aria-hidden="true">ZE</span>
          <span>ZUGFeRD <strong>Enricher</strong></span>
        </a>
      </header>

      <section className={loaded ? "hero hero--reviewing" : "hero"} aria-labelledby="main-heading">
        <h1 id="main-heading">PDF-Rechnung lokal prüfen</h1>
        {!loaded && (
          <p className="lead">Rechnungspositionen und Beträge auslesen und mit dem Original abgleichen.</p>
        )}

        <section
          className="upload-panel"
          aria-label="PDF-Datei auswählen"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          {!loaded && (
            <div className="file-mark" aria-hidden="true">
              <svg viewBox="0 0 48 48" width="42" height="42" fill="none">
                <path d="M12 5h17l9 9v28H12V5Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
                <path d="M29 5v10h9M18 29h14M18 34h10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </div>
          )}
          <h2>{loaded ? "Ausgewählte Rechnung" : "Wähle deine Rechnung"}</h2>
          {!loaded && <p>PDF hier ablegen oder eine Datei auswählen</p>}
          <label className="file-button" htmlFor="invoice-pdf">{loaded ? "Andere PDF auswählen" : "PDF auswählen"}</label>
          <input
            ref={inputRef}
            className="file-input"
            id="invoice-pdf"
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleInput}
            aria-describedby="upload-help"
          />
          <p id="upload-help" className="upload-hint">PDF · bis 50 MB · keine Übertragung an einen Server</p>
          {error && <p className="error" role="alert">{error}</p>}
          {selectedFile && (
            <div className="selected-file" role="status">
              <div className="selected-file-details">
                <strong>{selectedFile.name}</strong>
                <span>{formatFileSize(selectedFile.size)} · lokal ausgewählt</span>
              </div>
              <button type="button" className="reset-button" onClick={resetSelection}>
                Entfernen
              </button>
            </div>
          )}
          {selectedFile && !loaded && (
            <button
              type="button"
              className="read-button"
              disabled={reading}
              onClick={() => void readSelectedPdf()}
            >
              {reading ? "PDF wird lokal ausgelesen…" : "PDF lokal auslesen"}
            </button>
          )}
        </section>
        {!loaded && (
          <p className="scope-note">OCR für gescannte PDFs und der ZUGFeRD-Export sind noch nicht verfügbar.</p>
        )}
      </section>

      {loaded && (
        <>
          <InvoiceReview
            key={generation.current}
            pdf={loaded.pdf}
            draft={loaded.draft}
            onDraftChange={draft => setLoaded(current => current ? {...current, draft} : current)}
          />
          <ExportStatus original={loaded.originalDraft} reviewed={loaded.draft} />
        </>
      )}

      <footer className="footer">
        <span>Keine Reisekostenabrechnung. Originalrechnung bleibt unverändert.</span>
        <a href="https://github.com/Schubidu/zugferd-enricher" rel="noreferrer" target="_blank">Quellcode auf GitHub</a>
      </footer>
    </main>
  );
}

export default App;
