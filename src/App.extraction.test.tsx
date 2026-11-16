import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { loadInvoicePdf } from "./invoice/pdf";
import type { LoadedInvoice } from "./invoice/pdf";
import { emptyFields } from "./invoice/model";

vi.mock("./invoice/pdf", () => ({loadInvoicePdf: vi.fn()}));
vi.mock("./invoice/InvoiceReview", () => ({default: () => <section data-testid="invoice-review" />}));

const read = vi.mocked(loadInvoicePdf);

function selectAndRead() {
  fireEvent.change(screen.getByLabelText(/PDF auswählen/i), {
    target: {files: [new File(["synthetic"], "first.pdf", {type:"application/pdf"})]},
  });
  fireEvent.click(screen.getByRole("button", {name:"PDF lokal auslesen"}));
}

describe("cancelling a local extraction", () => {
  let signal: AbortSignal | undefined;

  beforeEach(() => {
    signal = undefined;
    read.mockReset();
    read.mockImplementation((_file, abortSignal) => {
      signal = abortSignal;
      return new Promise((_resolve, reject) => {
        abortSignal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), {once:true});
      });
    });
  });

  it("aborts the running extraction immediately when the selected PDF is removed", async () => {
    render(<App />);
    selectAndRead();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(signal?.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", {name:"Entfernen"}));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByText("first.pdf")).not.toBeInTheDocument();
  });

  it("aborts the previous PDF before replacing the selected file", async () => {
    render(<App />);
    selectAndRead();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(/PDF auswählen/i), {
      target: {files: [new File(["replacement"], "second.pdf", {type:"application/pdf"})]},
    });
    expect(signal?.aborted).toBe(true);
    expect(screen.getByText("second.pdf")).toBeInTheDocument();
  });

  it("aborts work on component unmount rather than leaving a worker running", async () => {
    const view = render(<App />);
    selectAndRead();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("reduces the introduction after extraction but retains accessible file switching", async () => {
    const destroy = vi.fn();
    read.mockResolvedValueOnce({
      pdf: {numPages: 1, loadingTask: {destroy}},
      draft: {pageCount: 1, sourceLines: [], fields: emptyFields(), items: [], taxGroups: [], warnings: []},
      originalDraft: {pageCount: 1, sourceLines: [], fields: emptyFields(), items: [], taxGroups: [], warnings: []},
    } as unknown as LoadedInvoice);
    render(<App />);
    selectAndRead();
    await waitFor(() => expect(screen.getByTestId("invoice-review")).toBeInTheDocument());
    expect(screen.getByRole("region", {name:"ZUGFeRD-Export"})).toBeInTheDocument();
    expect(screen.queryByRole("heading", {name: "Ausgewählte Rechnung"})).not.toBeInTheDocument();
    expect(screen.getByText("first.pdf")).toBeInTheDocument();
    expect(screen.queryByText(/Rechnungspositionen und Beträge auslesen/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/OCR für gescannte PDFs/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "PDF lokal auslesen"})).not.toBeInTheDocument();
    expect(screen.getByLabelText("PDF wechseln")).toBeInTheDocument();
    expect(screen.getByText("Wechseln")).toBeInTheDocument();
    expect(screen.queryByText(/keine Übertragung an einen Server/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Export noch nicht verfügbar\. Die erforderlichen/i)).not.toBeInTheDocument();
    expect(screen.getByText(/noch nicht verfügbar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Entfernen"}));
    expect(destroy).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("invoice-review")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "Wähle deine Rechnung"})).toBeInTheDocument();
  });
});
