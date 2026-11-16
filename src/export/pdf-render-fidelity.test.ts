import { afterEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { comparePdfRenderFidelity, identicalPixels } from "./pdf-render-fidelity";

type FakePage = {width:number; height:number; alterPixel?:boolean; abortOnRender?:() => void};

function fakePdf(pages: FakePage[]): PDFDocumentProxy {
  return {
    numPages: pages.length,
    getPage: vi.fn(async (index: number) => {
      const page = pages[index - 1]!;
      return {
        getViewport: ({scale}: {scale:number}) => ({
          width:page.width*scale,height:page.height*scale,
        }),
        render: ({canvas,canvasContext}: {canvas:HTMLCanvasElement;
          canvasContext:CanvasRenderingContext2D}) => {
          const frame = new Uint8ClampedArray(canvas.width*canvas.height*4).fill(255);
          if (page.alterPixel) frame[0] = 40;
          (canvasContext as unknown as {frame: Uint8ClampedArray}).frame = frame;
          page.abortOnRender?.();
          return {promise:Promise.resolve(),cancel:vi.fn()};
        },
        cleanup:vi.fn(),
      };
    }),
  } as unknown as PDFDocumentProxy;
}

function browserCanvases() {
  const create = document.createElement.bind(document);
  const canvases: Array<{width:number;height:number}> = [];
  vi.spyOn(document,"createElement").mockImplementation((name,options) => {
    if (name !== "canvas") return create(name,options);
    const context = {
      frame:new Uint8ClampedArray(),
      getImageData() {return {data:this.frame};},
    };
    const canvas = {
      width:0,height:0,
      getContext(type:string) {return type === "2d" ? context : null;},
    };
    canvases.push(canvas);
    return canvas as unknown as HTMLCanvasElement;
  });
  return canvases;
}
afterEach(() => vi.restoreAllMocks());

describe("browser-local PDF pixel parity", () => {
  it("compares complete RGBA buffers without tolerance or silently ignoring alpha", () => {
    const a = new Uint8ClampedArray([255,255,255,255,100,100,100,255]);
    const b = Uint8ClampedArray.from(a);
    expect(identicalPixels(a,b,2,1)).toBe(true);
    b[0] = 254;
    expect(identicalPixels(a,b,2,1)).toBe(false);
    b[0] = 255;
    b[7] = 254;
    expect(identicalPixels(a,b,2,1)).toBe(false);
    expect(identicalPixels(a,new Uint8ClampedArray(3),2,1)).toBe(false);
    expect(identicalPixels(a,a,0,0)).toBe(false);
  });

  it("confirms matching pages and frees both canvases immediately", async () => {
    const canvases = browserCanvases();
    const first = fakePdf([{width:12,height:16},{width:14,height:18}]);
    const second = fakePdf([{width:12,height:16},{width:14,height:18}]);
    expect(await comparePdfRenderFidelity(first,second)).toEqual({
      status:"matched-render",pages:2,
    });
    expect(canvases).toHaveLength(4);
    expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
    expect(first.getPage).toHaveBeenCalledTimes(2);
  });

  it("rejects a one-pixel change even if the text was not modified", async () => {
    browserCanvases();
    const original = fakePdf([{width:12,height:16}]);
    const changed = fakePdf([{width:12,height:16,alterPixel:true}]);
    expect(await comparePdfRenderFidelity(original,changed)).toEqual({
      status:"mismatch",reasons:[{page:1,code:"PIXELS_DIFFERENT"}],
    });
  });

  it("does not mistake an edited later page for matching all pages", async () => {
    browserCanvases();
    const first = fakePdf([{width:12,height:16},{width:12,height:16}]);
    const second = fakePdf([{width:12,height:16},{width:12,height:16,alterPixel:true}]);
    expect(await comparePdfRenderFidelity(first,second)).toEqual({
      status:"mismatch",reasons:[{page:2,code:"PIXELS_DIFFERENT"}],
    });
  });

  it("fails closed for page count, dimensions and oversized pages", async () => {
    const one = fakePdf([{width:12,height:16}]);
    expect(await comparePdfRenderFidelity(one,fakePdf([]))).toEqual({
      status:"mismatch",reasons:[{page:null,code:"PAGE_COUNT"}],
    });
    const different = fakePdf([{width:12,height:17}]);
    expect(await comparePdfRenderFidelity(one,different)).toEqual({
      status:"mismatch",reasons:[{page:1,code:"PAGE_SIZE"}],
    });
    const large = fakePdf([{width:4000,height:4000}]);
    expect(await comparePdfRenderFidelity(large,large)).toEqual({
      status:"mismatch",reasons:[{page:1,code:"RENDER_UNSUPPORTED"}],
    });
    const many = fakePdf(Array.from({length:151},() => ({width:12,height:16})));
    expect(await comparePdfRenderFidelity(many,many)).toEqual({
      status:"mismatch",reasons:[{page:null,code:"PAGE_LIMIT"}],
    });
  });

  it("fails closed when the browser canvas renderer is unavailable", async () => {
    const create = document.createElement.bind(document);
    vi.spyOn(document,"createElement").mockImplementation((name,options) =>
      name === "canvas"
        ? {width:0,height:0,getContext:() => null} as unknown as HTMLCanvasElement
        : create(name,options));
    const pdf = fakePdf([{width:12,height:16}]);
    expect(await comparePdfRenderFidelity(pdf,pdf)).toEqual({
      status:"mismatch",reasons:[{page:1,code:"RENDER_UNSUPPORTED"}],
    });
  });

  it("cancels without opening or rendering a PDF page", async () => {
    const controller = new AbortController();
    controller.abort();
    const first = fakePdf([{width:12,height:16}]);
    await expect(comparePdfRenderFidelity(first,first,controller.signal))
      .rejects.toMatchObject({name:"AbortError"});
    expect(first.getPage).not.toHaveBeenCalled();
  });

  it("propagates cancellation during a rendering task", async () => {
    browserCanvases();
    const controller = new AbortController();
    const first = fakePdf([{width:12,height:16,abortOnRender:() => controller.abort()}]);
    const second = fakePdf([{width:12,height:16}]);
    await expect(comparePdfRenderFidelity(first,second,controller.signal))
      .rejects.toMatchObject({name:"AbortError"});
    expect(second.getPage).toHaveBeenCalledTimes(1);
  });
});
