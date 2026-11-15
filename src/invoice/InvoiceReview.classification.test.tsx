import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { describe, expect, it, vi } from "vitest";
import InvoiceReview from "./InvoiceReview";
import { emptyFields } from "./model";
import type { InvoiceDraft } from "./model";
import { classifyLocally } from "./classify-client";

vi.mock("./PdfPreview", () => ({ default: () => <div data-testid="pdf-preview" /> }));
vi.mock("./classify-client", () => ({ classifyLocally: vi.fn() }));

const initial: InvoiceDraft = {
  pageCount: 1, sourceLines: [], fields: emptyFields(), taxGroups: [], warnings: [],
  items: [{
    id:"line-1",description:"Nicht zugeordnet",quantity:null,unitPrice:null,
    amount:"20,00",taxRate:null,evidenceIds:[],origin:"pdf",
  }],
};

function Harness() {
  const [draft, setDraft] = useState(initial);
  return <InvoiceReview
    pdf={{numPages:1} as PDFDocumentProxy}
    draft={draft}
    onDraftChange={setDraft}
  />;
}

describe("asynchronous category suggestions", () => {
  it("resets manual classifications when the PDF instance changes with reused item IDs", () => {
    const firstPdf = {numPages:1} as PDFDocumentProxy;
    const secondPdf = {numPages:1} as PDFDocumentProxy;
    const changedDraft: InvoiceDraft = {
      ...initial,
      items:[{...initial.items[0]!, description:"Kurtaxe", amount:"15,00"}],
    };
    const {rerender}=render(<InvoiceReview pdf={firstPdf} draft={initial} onDraftChange={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox",{name:"Position 1 Kategorie"}),{
      target:{value:"parking"},
    });
    expect(screen.getByRole("combobox",{name:"Position 1 Kategorie"})).toHaveValue("parking");
    rerender(<InvoiceReview pdf={secondPdf} draft={changedDraft} onDraftChange={vi.fn()} />);
    expect(screen.getByRole("combobox",{name:"Position 1 Kategorie"})).toHaveValue("city_tax");
    expect(screen.getByRole("table")).toHaveTextContent("15,00 €");
    expect(screen.getByRole("table")).not.toHaveTextContent("Parken");
  });

  it("aborts in-flight inference when the PDF object is replaced", async () => {
    const predict=vi.mocked(classifyLocally);
    predict.mockReset();
    let activeSignal: AbortSignal | undefined;
    predict.mockImplementation(async (_items, signal)=>{
      activeSignal=signal;
      return new Promise((_resolve,reject)=>{
        signal.addEventListener("abort",()=>{
          reject(new DOMException("Cancelled", "AbortError"));
        },{once:true});
      });
    });
    const originalPdf={numPages:1} as PDFDocumentProxy;
    const replacementPdf={numPages:1} as PDFDocumentProxy;
    const {rerender}=render(<InvoiceReview pdf={originalPdf} draft={initial} onDraftChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button",{name:"Positionen lokal klassifizieren"}));
    await waitFor(()=>expect(activeSignal).toBeDefined());
    rerender(<InvoiceReview pdf={replacementPdf} draft={{
      ...initial, items:[{...initial.items[0]!,description:"Frühstück Getränke",amount:"15,00"}],
    }} onDraftChange={vi.fn()} />);
    expect(activeSignal?.aborted).toBe(true);
    expect(screen.getByRole("combobox",{name:"Position 1 Kategorie"})).toHaveValue("beverage");
    expect(screen.getByText("15,00 €")).toBeInTheDocument();
  });

  it("aborts stale inference when the description changes and keeps the new category", async () => {
    const predict = vi.mocked(classifyLocally);
    predict.mockReset();
    let requestSignal: AbortSignal | undefined;
    predict.mockImplementation(async (_items, signal) => {
      requestSignal = signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new DOMException("Classification cancelled", "AbortError"));
        }, { once: true });
        // This promise deliberately never returns a stale suggestion.
        void resolve;
      });
    });

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", {name:"Positionen lokal klassifizieren"}));
    await waitFor(() => expect(predict).toHaveBeenCalledTimes(1));
    expect(requestSignal?.aborted).toBe(false);

    fireEvent.change(screen.getByRole("textbox", {name:"Position 1 Beschreibung"}), {
      target:{value:"Kurtaxe"},
    });
    expect(requestSignal?.aborted).toBe(true);
    expect(screen.getByRole("combobox", {name:"Position 1 Kategorie"})).toHaveValue("city_tax");
    expect(screen.getByRole("table")).toHaveTextContent("Kurtaxe / Beherbergungssteuer");
    expect(screen.getByRole("table")).toHaveTextContent("20,00 €");
    expect(screen.getByRole("button", {name:"Positionen lokal klassifizieren"})).toBeEnabled();
  });
});
