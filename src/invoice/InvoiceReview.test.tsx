import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { describe, expect, it, vi } from "vitest";
import InvoiceReview from "./InvoiceReview";
import { emptyFields } from "./model";
import type { InvoiceDraft } from "./model";

vi.mock("./PdfPreview", () => ({ default: () => <div data-testid="original-pdf-preview" /> }));

const itemAmounts = ["105,00", "125,00", "118,00", "42,00", "15,00", "16,00", "10,50"];
const initialDraft: InvoiceDraft = {
  pageCount: 1, sourceLines: [], fields: emptyFields(), taxGroups: [], warnings: [],
  items: itemAmounts.map((amount, index) => ({
    id: "position-" + index,
    description: index === 6 ? "Kurtaxe" : "Position " + (index + 1),
    quantity: "1", unitPrice: amount, amount,
    taxRate: index === 6 ? null : index > 3 && index < 6 ? "19%" : "7%",
    evidenceIds: [], origin: "pdf",
  })),
};
const pdf = { numPages: 1 } as PDFDocumentProxy;

function Harness() {
  const [draft, setDraft] = useState(initialDraft);
  return <InvoiceReview pdf={pdf} draft={draft} onDraftChange={setDraft} />;
}

describe("position sum in the browser invoice review", () => {
  it("shows a separate cent-accurate sum, not the invoice gross amount", () => {
    render(<Harness />);
    expect(screen.getByText("Summe der erkannten Positionen")).toBeInTheDocument();
    expect(screen.getByText("431,50 €")).toBeInTheDocument();
    expect(screen.getByText(/kein automatischer Abgleich mit dem Rechnungsbetrag/i)).toBeInTheDocument();
  });

  it("recomputes the displayed sum immediately after a manual amount correction", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox", { name: "Position 5 Betrag" }), { target: { value: "16,00" } });
    expect(screen.getByText("432,50 €")).toBeInTheDocument();
    expect(screen.queryByText("431,50 €")).not.toBeInTheDocument();
  });

  it("does not show a misleading partial sum after an invalid manual amount", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox", { name: "Position 5 Betrag" }), { target: { value: "invalid" } });
    expect(screen.getByText("Nicht berechenbar")).toBeInTheDocument();
    expect(screen.getByText(/1 Betragsangabe\(n\) sind ungültig/i)).toBeInTheDocument();
    expect(screen.queryByText("431,50 €")).not.toBeInTheDocument();
  });
});
