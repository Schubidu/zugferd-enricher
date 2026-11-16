import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * Browser-local *text and geometry* parity between the original invoice PDF
 * and a prospective PDF/A derivative. This is not a visual/pixel comparison,
 * an image-content check, a PDF/A validator, or proof of completeness.
 *
 * Rejects uncertainty. Only the eventual independent render/pixel check,
 * veraPDF-class conformance and PDF/XML reconciliation may allow release.
 */
export type PdfTextFidelity =
  | {status: "matched-text-layout"; pages: number}
  | {status: "mismatch"; reasons: Array<{
    page: number | null;
    code: "PAGE_COUNT" | "PAGE_SIZE" | "TEXT_MISSING" |
      "TEXT_CHANGED" | "TEXT_LAYOUT_CHANGED" | "PAGE_UNSUPPORTED";
  }>};

type Signature = {
  width: number;
  height: number;
  text: string;
  runs: string[];
};

function quantize(value: number): number {
  // Deliberately conservative, ~0.01% of page dimensions.
  return Math.round(value * 10_000);
}

async function signature(pdf: PDFDocumentProxy, number: number): Promise<Signature | null> {
  const page = await pdf.getPage(number);
  try {
    const viewport = page.getViewport({scale:1});
    if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) ||
      viewport.width <= 0 || viewport.height <= 0) return null;
    const content = await page.getTextContent();
    const items = content.items.filter(item => "str" in item && item.str.trim());
    if (items.length === 0) return null;

    const runs = items.map(item => {
      if (!("str" in item)) return "";
      const transform = item.transform;
      const text = item.str.replace(/\s+/g," ").trim();
      return [
        text,
        quantize(transform[4]! / viewport.width),
        quantize(transform[5]! / viewport.height),
        quantize(item.width / viewport.width),
        quantize(item.height / viewport.height),
      ].join("|");
    });
    if (runs.join("").length > 300_000) return null;
    return {
      width: quantize(viewport.width),
      height: quantize(viewport.height),
      text: items.map(item => "str" in item ? item.str : "").join(" ").replace(/\s+/g," ").trim(),
      runs,
    };
  } finally {
    page.cleanup();
  }
}

/**
 * Compare two loaded PDFs without copying/uploading their bytes.
 * The caller owns both PDFDocumentProxy lifetimes and cancellation.
 */
export async function comparePdfTextFidelity(
  original: PDFDocumentProxy, derivative: PDFDocumentProxy,
  signal?: AbortSignal,
): Promise<PdfTextFidelity> {
  const reasons: Extract<PdfTextFidelity,{status:"mismatch"}>["reasons"] = [];
  const abort = () => {
    if (signal?.aborted) throw new DOMException("PDF comparison cancelled", "AbortError");
  };
  abort();
  if (original.numPages < 1 || derivative.numPages < 1 ||
    original.numPages !== derivative.numPages || original.numPages > 300) {
    return {status:"mismatch",reasons:[{page:null,code:"PAGE_COUNT"}]};
  }
  for (let page = 1; page <= original.numPages; page++) {
    abort();
    let first: Signature | null;
    let second: Signature | null;
    try {
      first = await signature(original,page);
      abort();
      second = await signature(derivative,page);
      abort();
    } catch (error) {
      abort();
      if (error instanceof Error && error.name === "AbortError") throw error;
      reasons.push({page,code:"PAGE_UNSUPPORTED"});
      continue;
    }
    if (!first || !second) {
      reasons.push({page,code:"TEXT_MISSING"});
      continue;
    }
    if (first.width !== second.width || first.height !== second.height) {
      reasons.push({page,code:"PAGE_SIZE"});
      continue;
    }
    if (first.text !== second.text) {
      reasons.push({page,code:"TEXT_CHANGED"});
      continue;
    }
    if (first.runs.length !== second.runs.length ||
      first.runs.some((value,index) => value !== second.runs[index])) {
      reasons.push({page,code:"TEXT_LAYOUT_CHANGED"});
    }
  }
  return reasons.length
    ? {status:"mismatch",reasons}
    : {status:"matched-text-layout",pages:original.numPages};
}
