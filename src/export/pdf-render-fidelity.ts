import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

/**
 * A strict, browser-local *rendered-page* comparison prerequisite.
 *
 * A matching image is neither proof of PDF/A compliance nor proof that all
 * invoice facts have been extracted. It must be combined with PDF text,
 * source/XML semantic, and independent PDF/A + EN16931 checks. No upload.
 */
export type PdfRenderFidelity =
  | {status: "matched-render"; pages: number}
  | {status: "mismatch"; reasons: Array<{
    page: number | null;
    code: "PAGE_COUNT" | "PAGE_LIMIT" | "PAGE_SIZE" |
      "PIXELS_DIFFERENT" | "RENDER_UNSUPPORTED";
  }>};

const MAX_PAGES = 150;
const MAX_PIXELS_PER_CANVAS = 1_500_000;
const TARGET_SCALE = 1.5;

/** Compare all RGBA channels, not merely text or luminance. */
export function identicalPixels(
  original: Uint8ClampedArray,
  derivative: Uint8ClampedArray,
  width: number,
  height: number,
): boolean {
  const size = width * height * 4;
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_PIXELS_PER_CANVAS * 4 ||
    original.length !== size || derivative.length !== size) return false;
  for (let i = 0; i < size; i++) {
    if (original[i] !== derivative[i]) return false;
  }
  return true;
}

function dimension(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) &&
    width > 0 && height > 0 && width * height <= MAX_PIXELS_PER_CANVAS;
}

function pageSize(page: PDFPageProxy): {width: number; height: number} {
  const view = page.getViewport({scale:1});
  return {width:view.width,height:view.height};
}

async function renderPixels(
  page: PDFPageProxy,
  width: number,
  height: number,
  scale: number,
  signal?: AbortSignal,
): Promise<Uint8ClampedArray> {
  if (typeof document === "undefined") throw new Error("No browser canvas");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d", {alpha: false, willReadFrequently: true});
    if (!context) throw new Error("2D canvas not available");
    const task = page.render({canvas, canvasContext:context,viewport:page.getViewport({scale})});
    const cancel = () => { task.cancel(); };
    signal?.addEventListener("abort",cancel,{once:true});
    try {
      if (signal?.aborted) {
        cancel();
        throw new DOMException("PDF comparison cancelled","AbortError");
      }
      await task.promise;
      if (signal?.aborted) throw new DOMException("PDF comparison cancelled","AbortError");
      return context.getImageData(0,0,width,height).data;
    } finally {
      signal?.removeEventListener("abort",cancel);
    }
  } finally {
    // Release memory immediately after each page, also on Safari/iPhone.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Compare one PDF page at a time to bound transient canvas memory.
 * The caller owns both PDF proxies. No rounding tolerance is used: any pixel
 * difference is an actionable non-match, not permission to silently change
 * an invoice. Oversized pages and unavailable canvas fail closed.
 */
export async function comparePdfRenderFidelity(
  original: PDFDocumentProxy,
  derivative: PDFDocumentProxy,
  signal?: AbortSignal,
): Promise<PdfRenderFidelity> {
  const reasons: Extract<PdfRenderFidelity,{status:"mismatch"}>["reasons"] = [];
  const abort = () => {
    if (signal?.aborted) throw new DOMException("PDF comparison cancelled","AbortError");
  };
  abort();
  if (original.numPages < 1 || derivative.numPages < 1 ||
    original.numPages !== derivative.numPages) {
    return {status:"mismatch",reasons:[{page:null,code:"PAGE_COUNT"}]};
  }
  if (original.numPages > MAX_PAGES) {
    return {status:"mismatch",reasons:[{page:null,code:"PAGE_LIMIT"}]};
  }
  for (let number = 1; number <= original.numPages; number++) {
    abort();
    let before: PDFPageProxy | null = null;
    let after: PDFPageProxy | null = null;
    try {
      before = await original.getPage(number);
      abort();
      after = await derivative.getPage(number);
      abort();
      const a = pageSize(before);
      const b = pageSize(after);
      if (!Number.isFinite(a.width) || !Number.isFinite(a.height) ||
        !Number.isFinite(b.width) || !Number.isFinite(b.height) ||
        Math.abs(a.width-b.width) > 0.001 || Math.abs(a.height-b.height) > 0.001) {
        reasons.push({page:number,code:"PAGE_SIZE"});
        continue;
      }
      // Never claim fidelity after reducing a page below normal viewing size.
      const scale = Math.min(TARGET_SCALE,
        Math.sqrt(MAX_PIXELS_PER_CANVAS / (a.width * a.height)));
      const width = Math.ceil(a.width * scale);
      const height = Math.ceil(a.height * scale);
      if (scale < 1 || !dimension(width,height)) {
        reasons.push({page:number,code:"RENDER_UNSUPPORTED"});
        continue;
      }
      const first = await renderPixels(before,width,height,scale,signal);
      abort();
      const second = await renderPixels(after,width,height,scale,signal);
      abort();
      if (!identicalPixels(first,second,width,height)) {
        reasons.push({page:number,code:"PIXELS_DIFFERENT"});
      }
    } catch (error) {
      abort();
      if (error instanceof Error && error.name === "AbortError") throw error;
      reasons.push({page:number,code:"RENDER_UNSUPPORTED"});
    } finally {
      before?.cleanup();
      after?.cleanup();
    }
  }
  return reasons.length
    ? {status:"mismatch",reasons}
    : {status:"matched-render",pages:original.numPages};
}
