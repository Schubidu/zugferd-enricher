import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { loadInvoicePdf } from "./invoice/pdf";

vi.mock("./invoice/pdf", () => ({loadInvoicePdf: vi.fn()}));

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
});
