import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { describe, expect, it, vi } from "vitest";
import InvoiceReview from "./InvoiceReview";
import { emptyFields } from "./model";
import type { InvoiceDraft } from "./model";

vi.mock("./PdfPreview", () => ({
  default: ({ pageNumber, activeEvidenceId }: {pageNumber: number; activeEvidenceId: string | null}) =>
    <div data-testid="original-pdf-preview">{pageNumber + ":" + activeEvidenceId}</div>,
}));

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
  it("highlights the value line rather than the label when evidence spans two lines", () => {
    const draft: InvoiceDraft = {
      ...initialDraft,
      fields: {
        ...emptyFields(),
        grossTotal: { value: "119,00", origin: "pdf", evidenceIds: ["label", "amount"] },
      },
      sourceLines: [
        {id: "label", page: 1, text: "Gesamtbetrag", box: {x:0.1,y:0.1,width:0.3,height:0.02}},
        {id: "amount", page: 2, text: "119,00", box: {x:0.1,y:0.1,width:0.3,height:0.02}},
      ],
    };
    render(<InvoiceReview pdf={{numPages:2} as PDFDocumentProxy} draft={draft} onDraftChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", {name: "Fundstelle S. 2"}));
    expect(screen.getByTestId("original-pdf-preview")).toHaveTextContent("2:amount");
  });

  it("renders source-backed tax findings separately from category suggestions", () => {
    const draft: InvoiceDraft = {
      ...initialDraft,
      fields: {
        ...emptyFields(),
        netTotal: {value:"100,00",origin:"pdf",evidenceIds:["n"]},
        taxTotal: {value:"19,00",origin:"pdf",evidenceIds:["t"]},
        grossTotal: {value:"120,00",origin:"pdf",evidenceIds:["g"]},
      },
      items: [{...initialDraft.items[0]!,description:"Kurtaxe",taxRate:null,quantity:null,unitPrice:null}],
    };
    render(<InvoiceReview pdf={pdf} draft={draft} onDraftChange={vi.fn()} />);
    expect(screen.getByRole("heading",{name:"Rechnerische Plausibilitätsprüfung"})).toBeInTheDocument();
    expect(screen.getByText(/Netto \+ Steuer weicht/i)).toBeInTheDocument();
    expect(screen.getByText(/Kategorien ersetzen keine Steuerangaben/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox",{name:"Position 1 Kategorie"})).toHaveValue("city_tax");
  });

  it("manual category changes do not modify extracted tax rates or amounts", () => {
    render(<Harness />);
    expect(screen.getByRole("combobox",{name:"Position 1 Kategorie"})).toHaveValue("unknown");
    const input = screen.getByRole("textbox",{name:"Position 1 Steuersatz"});
    expect(input).toHaveValue("7%");
    fireEvent.change(screen.getByRole("combobox",{name:"Position 1 Kategorie"}),{
      target:{value:"beverage"},
    });
    expect(screen.getByRole("combobox",{name:"Position 1 Kategorie"})).toHaveValue("beverage");
    expect(screen.getByText("Manuell gewählt")).toBeInTheDocument();
    expect(input).toHaveValue("7%");
    expect(screen.getByText("431,50 €")).toBeInTheDocument();
  });

});
