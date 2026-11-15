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
    expect(screen.getAllByText("Nicht berechenbar")).toHaveLength(2);
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
    fireEvent.click(screen.getByRole("button", {name: "Fundstelle S. 2 im PDF ansehen"}));
    expect(screen.getByRole("dialog", {name:"Fundstelle im Originaldokument"})).toBeInTheDocument();
    expect(screen.getAllByTestId("original-pdf-preview")).toEqual(expect.arrayContaining([
      expect.objectContaining({textContent:"2:amount"}),
    ]));
    fireEvent.click(screen.getByRole("button", {name:"Zur Prüfung zurück"}));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows actionable warnings before the long list of positions", () => {
    render(<Harness />);
    const status = screen.getByRole("heading", {name:"Rechnerische Plausibilitätsprüfung"});
    const positions = screen.getByRole("heading", {name:"Rechnungspositionen"});
    expect(status.compareDocumentPosition(positions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/mindestens eine position hat keinen belegten steuersatz/i)).toBeInTheDocument();
    const missingTax = screen.getByRole("button", {name:"Position 7: Kurtaxe bearbeiten"});
    fireEvent.click(missingTax);
    expect(screen.getByRole("textbox", {name:"Position 7 Steuersatz"})).toHaveFocus();
  });

  it("links net/group mismatches to each printed PDF amount separately", () => {
    const draft: InvoiceDraft = {
      ...initialDraft,
      fields: {
        ...emptyFields(),
        netTotal: {value:"130,00", origin:"pdf", evidenceIds:["net-total"]},
      },
      taxGroups: [{rate:"7%", net:"100,00", tax:"7,00", evidenceIds:["group-7"]}],
      sourceLines: [
        {id:"group-7",page:1,text:"7% Netto 100,00",box:{x:.1,y:.3,width:.5,height:.02}},
        {id:"net-total",page:2,text:"Netto 130,00",box:{x:.1,y:.7,width:.5,height:.02}},
      ],
    };
    render(<InvoiceReview pdf={{numPages:2} as PDFDocumentProxy} draft={draft} onDraftChange={vi.fn()} />);
    expect(screen.getByRole("button",{name:"Steuergruppe 7% im PDF ansehen"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Gesamtnetto im PDF ansehen"}));
    expect(screen.getByRole("dialog",{name:"Fundstelle im Originaldokument"})).toBeInTheDocument();
    expect(screen.getAllByTestId("original-pdf-preview")).toEqual(expect.arrayContaining([
      expect.objectContaining({textContent:"2:net-total"}),
    ]));
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

  it("shows category totals and reassigns an amount immediately when a category changes", () => {
    render(<Harness />);
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("Unbekannt – prüfen");
    expect(table).toHaveTextContent("6");
    expect(table).toHaveTextContent("421,00 €");
    expect(table).toHaveTextContent("Kurtaxe / Beherbergungssteuer");
    expect(table).toHaveTextContent("10,50 €");

    fireEvent.change(screen.getByRole("combobox", {name:"Position 1 Kategorie"}), {
      target:{value:"accommodation"},
    });
    expect(table).toHaveTextContent("Übernachtung");
    expect(table).toHaveTextContent("105,00 €");
    expect(table).toHaveTextContent("316,00 €");
    expect(table).toHaveTextContent("5");
    // Reclassification does not affect the overall position sum.
    expect(screen.getByText("431,50 €")).toBeInTheDocument();
  });

  it("updates the category amount sum immediately after editing a position", () => {
    render(<Harness />);
    const table = screen.getByRole("table");
    fireEvent.change(screen.getByRole("textbox", {name:"Position 1 Betrag"}), {
      target:{value:"106,00"},
    });
    expect(table).toHaveTextContent("422,00 €");
    expect(screen.getByText("432,50 €")).toBeInTheDocument();
  });

  it("never displays a partial category sum after an invalid amount", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox", {name:"Position 2 Betrag"}), {
      target:{value:"invalid"},
    });
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("Nicht berechenbar");
    expect(table).toHaveTextContent("1 ungültige Betragsangabe(n)");
    expect(table).toHaveTextContent("10,50 €");
  });

  it("highlights unknown categories and removes the highlight after assigning a category", () => {
    render(<Harness />);
    const first = screen.getByText("Position 1").closest(".line-item");
    const known = screen.getByText("Position 7").closest(".line-item");
    expect(first).toHaveClass("line-item--unclassified");
    expect(first).toHaveTextContent("Kategorie prüfen");
    expect(known).not.toHaveClass("line-item--unclassified");
    expect(screen.getByText(/6 Positionen benötigen eine Kategorie/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", {name:"Position 1 Kategorie"}), {
      target: {value:"accommodation"},
    });
    expect(first).not.toHaveClass("line-item--unclassified");
    expect(first).not.toHaveTextContent("Kategorie prüfen");
    expect(screen.getByText(/5 Positionen benötigen eine Kategorie/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", {name:"Position 1 Kategorie"}), {
      target: {value:"unknown"},
    });
    expect(first).toHaveClass("line-item--unclassified");
    expect(screen.getByText(/6 Positionen benötigen eine Kategorie/)).toBeInTheDocument();
  });

  it("updates the unknown highlight when a description gains a known rule match", () => {
    render(<Harness />);
    const first = screen.getByText("Position 1").closest(".line-item");
    expect(first).toHaveClass("line-item--unclassified");
    fireEvent.change(screen.getByRole("textbox", {name:"Position 1 Beschreibung"}), {
      target: {value:"Konferenzlunch"},
    });
    expect(first).not.toHaveClass("line-item--unclassified");
    expect(screen.getByRole("combobox", {name:"Position 1 Kategorie"})).toHaveValue("food");
    expect(screen.getByText(/5 Positionen benötigen eine Kategorie/)).toBeInTheDocument();
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

  it("does not show an original-PDF consistency verdict after manual net or tax corrections",()=>{
    const draft: InvoiceDraft = {
      ...initialDraft,
      fields: {
        ...emptyFields(),
        netTotal: {value:"100,00",origin:"manual",evidenceIds:[]},
        taxTotal: {value:"19,00",origin:"manual",evidenceIds:[]},
        grossTotal: {value:"119,00",origin:"pdf",evidenceIds:["gross"]},
      },
    };
    render(<InvoiceReview pdf={pdf} draft={draft} onDraftChange={vi.fn()} />);
    expect(screen.getByText(/Summen nicht vollständig prüfbar/i)).toBeInTheDocument();
    expect(screen.getByText(/Manuell geänderte Summen sind nicht durch das Original belegt/i)).toBeInTheDocument();
    expect(screen.queryByText(/rechnerisch konsistent/i)).not.toBeInTheDocument();
  });

});
