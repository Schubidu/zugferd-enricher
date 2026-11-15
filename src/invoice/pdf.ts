import type { PDFDocumentProxy } from "pdfjs-dist";
import type { InvoiceDraft, SourceBox, SourceLine } from "./model";
import { recognizeInvoice } from "./recognize";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

export type LoadedInvoice = { pdf: PDFDocumentProxy; draft: InvoiceDraft };

type TextFragment = { text: string; x: number; y: number; width: number; height: number };
function clamp(value: number): number { return Math.min(1, Math.max(0, value)); }
function combineBox(parts: TextFragment[]): SourceBox {
  const x = Math.min(...parts.map(p => p.x));
  const y = Math.min(...parts.map(p => p.y));
  return {
    x: clamp(x),
    y: clamp(y),
    width: clamp(Math.max(...parts.map(p => p.x + p.width)) - x),
    height: clamp(Math.max(...parts.map(p => p.y + p.height)) - y),
  };
}

/** Convert PDF.js text fragments to page-relative, selectable evidence lines. */
export function groupTextFragments(fragments: TextFragment[], page: number): SourceLine[] {
  const rows: TextFragment[][] = [];
  for (const fragment of [...fragments].sort((a,b) => a.y-b.y || a.x-b.x)) {
    const row = rows.find(r => Math.abs(r[0]!.y - fragment.y) <= 0.006);
    if (row) row.push(fragment);
    else rows.push([fragment]);
  }
  return rows.map((row, index) => {
    row.sort((a,b) => a.x-b.x);
    return {
      id: "page-" + page + "-line-" + (index + 1),
      page,
      text: row.map(fragment => fragment.text.trim()).filter(Boolean).join(" ").replace(/\s+/g," ").trim(),
      box: combineBox(row),
    };
  }).filter(x => x.text.length > 0);
}

/** File bytes never leave the browser. The document is not modified or uploaded. */
export async function loadInvoicePdf(file: File): Promise<LoadedInvoice> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const loading = pdfjs.getDocument({
    data: sourceBytes,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  try {
    const pdf = await loading.promise;
    const lines: SourceLine[] = [];
    try {
      for (let pageNumber=1; pageNumber<=pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({scale: 1});
        const content = await page.getTextContent();
        const fragments: TextFragment[] = [];
        for (const item of content.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          const transform = pdfjs.Util.transform(viewport.transform, item.transform);
          const height = Math.max(1, Math.hypot(transform[2], transform[3]));
          fragments.push({
            text: item.str,
            x: clamp(transform[4] / viewport.width),
            y: clamp((transform[5]-height)/viewport.height),
            width: clamp(Math.abs(item.width)/viewport.width),
            height: clamp(height/viewport.height),
          });
        }
        lines.push(...groupTextFragments(fragments, pageNumber));
        page.cleanup();
      }
      return { pdf, draft: recognizeInvoice(lines, pdf.numPages) };
    } catch (e) {
      await pdf.destroy();
      throw e;
    }
  } catch (error) {
    await loading.destroy();
    throw error;
  }
}
