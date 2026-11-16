import type { PDFDocumentProxy } from "pdfjs-dist";
import { comparePdfTextFidelity } from "./pdf-text-fidelity";
import type { PdfTextFidelity } from "./pdf-text-fidelity";
import { comparePdfRenderFidelity } from "./pdf-render-fidelity";
import type { PdfRenderFidelity } from "./pdf-render-fidelity";

/**
 * Two independent local checks are always required: the PDF's extractable
 * text/layout and its rendered pixels. This function is a *prerequisite*,
 * never a source of PDF/A/EN16931 export approval.
 */
export type PdfVisibleFidelity =
  | {status: "matched-prerequisites"; pages: number}
  | {status: "mismatch"; stage: "text";
    reasons: Extract<PdfTextFidelity,{status:"mismatch"}>["reasons"]}
  | {status: "mismatch"; stage: "render";
    reasons: Extract<PdfRenderFidelity,{status:"mismatch"}>["reasons"]};

export async function comparePdfVisibleFidelity(
  original: PDFDocumentProxy,
  derivative: PDFDocumentProxy,
  signal?: AbortSignal,
): Promise<PdfVisibleFidelity> {
  const text = await comparePdfTextFidelity(original,derivative,signal);
  if (text.status === "mismatch") {
    return {status:"mismatch",stage:"text",reasons:text.reasons};
  }
  const render = await comparePdfRenderFidelity(original,derivative,signal);
  if (render.status === "mismatch") {
    return {status:"mismatch",stage:"render",reasons:render.reasons};
  }
  // Independently checked at both stages. Export still remains blocked.
  if (text.pages !== render.pages) {
    return {status:"mismatch",stage:"text",reasons:[{page:null,code:"PAGE_COUNT"}]};
  }
  return {status:"matched-prerequisites",pages:text.pages};
}
