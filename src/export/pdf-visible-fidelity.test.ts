import { afterEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";

vi.mock("./pdf-text-fidelity",() => ({comparePdfTextFidelity:vi.fn()}));
vi.mock("./pdf-render-fidelity",() => ({comparePdfRenderFidelity:vi.fn()}));

import { comparePdfTextFidelity } from "./pdf-text-fidelity";
import { comparePdfRenderFidelity } from "./pdf-render-fidelity";
import { comparePdfVisibleFidelity } from "./pdf-visible-fidelity";

const first = {numPages:1} as PDFDocumentProxy;
const second = {numPages:1} as PDFDocumentProxy;
const text = vi.mocked(comparePdfTextFidelity);
const render = vi.mocked(comparePdfRenderFidelity);

afterEach(() => vi.clearAllMocks());

describe("combined local original/derivative fidelity prerequisite", () => {
  it("requires both text and pixel parity before reporting any matched prerequisite", async () => {
    text.mockResolvedValue({status:"matched-text-layout",pages:1});
    render.mockResolvedValue({status:"matched-render",pages:1});
    expect(await comparePdfVisibleFidelity(first,second)).toEqual({
      status:"matched-prerequisites",pages:1,
    });
    expect(text).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(first,second,undefined);
  });

  it("never raster-renders a document when the text/structure comparison already failed", async () => {
    text.mockResolvedValue({status:"mismatch",reasons:[{page:1,code:"TEXT_CHANGED"}]});
    expect(await comparePdfVisibleFidelity(first,second)).toEqual({
      status:"mismatch",stage:"text",reasons:[{page:1,code:"TEXT_CHANGED"}],
    });
    expect(render).not.toHaveBeenCalled();
  });

  it("rejects changed pixels even though source and derivative have identical extractable text", async () => {
    text.mockResolvedValue({status:"matched-text-layout",pages:1});
    render.mockResolvedValue({
      status:"mismatch",reasons:[{page:1,code:"PIXELS_DIFFERENT"}],
    });
    expect(await comparePdfVisibleFidelity(first,second)).toEqual({
      status:"mismatch",stage:"render",reasons:[{page:1,code:"PIXELS_DIFFERENT"}],
    });
  });

  it("refuses conflicting page counts and propagates cancellation", async () => {
    text.mockResolvedValueOnce({status:"matched-text-layout",pages:1});
    render.mockResolvedValueOnce({status:"matched-render",pages:2});
    expect(await comparePdfVisibleFidelity(first,second)).toEqual({
      status:"mismatch",stage:"text",reasons:[{page:null,code:"PAGE_COUNT"}],
    });
    const controller = new AbortController();
    controller.abort();
    text.mockRejectedValueOnce(new DOMException("PDF comparison cancelled","AbortError"));
    await expect(comparePdfVisibleFidelity(first,second,controller.signal))
      .rejects.toMatchObject({name:"AbortError"});
    expect(render).toHaveBeenCalledTimes(1);
  });
});
