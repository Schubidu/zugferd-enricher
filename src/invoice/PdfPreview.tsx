import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { SourceLine } from "./model";

type Props = {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  onPageChange: (page: number) => void;
  evidence: SourceLine[];
  activeEvidenceId: string | null;
};

export default function PdfPreview({pdf, pageNumber, onPageChange, evidence, activeEvidenceId}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({width: 612, height: 792});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    async function render() {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const viewport = page.getViewport({scale: 1.35});
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(viewport.width * ratio);
        canvas.height = Math.round(viewport.height * ratio);
        setDimensions({width: viewport.width, height: viewport.height});
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas context is unavailable");
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio,0,0,ratio,0,0],
        });
        await renderTask.promise;
        if (!cancelled) setError(null);
      } catch {
        if (!cancelled) setError("Diese PDF-Seite konnte nicht dargestellt werden.");
      }
    }
    void render();
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [pdf, pageNumber]);

  return (
    <section className="pdf-preview" aria-label="Original-PDF mit Fundstellen">
      <div className="preview-toolbar">
        <strong>Originaldokument</strong>
        <div className="pager">
          <button type="button" disabled={pageNumber <= 1} onClick={() => onPageChange(pageNumber-1)} aria-label="Vorherige Seite">‹</button>
          <span>Seite {pageNumber} / {pdf.numPages}</span>
          <button type="button" disabled={pageNumber >= pdf.numPages} onClick={() => onPageChange(pageNumber+1)} aria-label="Nächste Seite">›</button>
        </div>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="pdf-scroll">
        <div className="pdf-paper" style={{width: dimensions.width, aspectRatio: dimensions.width + " / " + dimensions.height}}>
          <canvas ref={canvasRef} aria-label={"PDF-Seite " + pageNumber}/>
          <div className="evidence-overlay" aria-hidden="true">
            {evidence.filter(line => line.page === pageNumber && line.id === activeEvidenceId).map(line => (
              <div
                key={line.id}
                className="evidence-highlight"
                style={{
                  left: line.box.x*100 + "%",
                  top: line.box.y*100 + "%",
                  width: line.box.width*100 + "%",
                  height: line.box.height*100 + "%",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
