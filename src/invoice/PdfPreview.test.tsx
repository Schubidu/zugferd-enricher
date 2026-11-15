import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import PdfPreview from "./PdfPreview";
import type { SourceLine } from "./model";

const existingClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
afterEach(() => {
  vi.restoreAllMocks();
  if (existingClientHeight) Object.defineProperty(HTMLElement.prototype,"clientHeight",existingClientHeight);
  else Reflect.deleteProperty(HTMLElement.prototype,"clientHeight");
});

describe("PDF source highlight", () => {
  const source: SourceLine = {
    id: "highlight-value", page: 1, text: "Netto 100,00",
    box: {x: .2, y: .6, width: .35, height: .025},
  };
  const pdf = {
    numPages: 1,
    getPage: vi.fn(() => new Promise(() => undefined)),
  } as unknown as PDFDocumentProxy;

  it("renders a single non-interactive marker exactly over the evidence box", () => {
    const {container} = render(<PdfPreview
      pdf={pdf} pageNumber={1} onPageChange={vi.fn()}
      evidence={[source]} activeEvidenceId="highlight-value"
    />);
    const overlay = container.querySelector(".evidence-overlay");
    const marker = container.querySelector(".evidence-highlight") as HTMLElement;
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(marker).toBeInTheDocument();
    expect(marker.style.left).toBe("20%");
    expect(marker.style.top).toBe("60%");
    expect(marker.style.width).toBe("35%");
    expect(marker.style.height).toBe("2.5%");
  });

  it("calculates scroll position relative to the scrollport, including an already scrolled document", () => {
    Object.defineProperty(HTMLElement.prototype,"clientHeight",{
      configurable:true,get(this:HTMLElement) {
        return this.classList.contains("pdf-paper") ? 800 : 400;
      },
    });
    vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLElement) {
      return {top: this.classList.contains("pdf-paper") ? 100 : 50} as DOMRect;
    });
    const {container} = render(<PdfPreview
      pdf={pdf} pageNumber={1} onPageChange={vi.fn()}
      evidence={[source]} activeEvidenceId="highlight-value"
    />);
    const scroll = container.querySelector(".pdf-scroll") as HTMLElement;
    // Relative paper offset (100-50) + 60% of 800 - 32% of 400 = 402.
    expect(scroll.scrollTop).toBe(402);
  });
});
