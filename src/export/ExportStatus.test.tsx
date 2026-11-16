import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { recognizeInvoice } from "../invoice/recognize";
import type { InvoiceDraft, SourceLine } from "../invoice/model";
import ExportStatus from "./ExportStatus";

function invoice(): InvoiceDraft {
  const lines = [
    "Rechnungsaussteller: Nordlicht Digital GmbH",
    "Rechnungsempfänger: Testkunde GmbH",
    "Rechnungsnummer: ND-2026-001",
    "Rechnungsdatum: 16.11.2026",
    "Beratungsleistung 2 x 80,00 160,00 19%",
    "USt 19% Netto 160,00 Steuer 30,40",
    "Nettosumme 160,00",
    "Umsatzsteuer gesamt 30,40",
    "Gesamtbetrag 190,40",
  ].map((text, index): SourceLine => ({
    id:"source-" + index, page:1, text,
    box:{x:.1,y:index*.05,width:.7,height:.02},
  }));
  return recognizeInvoice(lines,1);
}

describe("secondary export status disclosure", () => {
  it("does not distract from a successful invoice review with non-actionable blockers", () => {
    const source = invoice();
    render(<ExportStatus original={source} reviewed={structuredClone(source)}/>);
    expect(screen.getByRole("region",{name:"ZUGFeRD-Export"})).toBeInTheDocument();
    expect(screen.getByText(/noch nicht verfügbar/)).toBeInTheDocument();
    const summary = screen.getByText(/ZUGFeRD-Export/);
    const disclosure = summary.closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.queryByRole("button",{name:/export|herunterladen|erstellen/i})).not.toBeInTheDocument();
    fireEvent.click(summary);
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByText(/Die Rechnungsprüfung funktioniert bereits/)).toBeInTheDocument();
    expect(screen.getByText(/vollständige EN-16931-Datenbasis/)).toBeInTheDocument();
    expect(screen.queryByRole("heading",{name:"Offene Rechnungsangaben"})).not.toBeInTheDocument();
    expect(screen.queryByRole("heading",{name:"Änderungen gegenüber dem Original"})).not.toBeInTheDocument();
  });

  it("shows real source deviations when reviewed values change", () => {
    const source = invoice();
    const edited = structuredClone(source);
    edited.fields.grossTotal = {...edited.fields.grossTotal!,origin:"manual"};
    const {rerender} = render(<ExportStatus original={source} reviewed={source}/>);
    expect(screen.queryByRole("heading",{name:"Änderungen gegenüber dem Original"})).not.toBeInTheDocument();
    rerender(<ExportStatus original={source} reviewed={edited}/>);
    expect(screen.getByRole("heading",{name:"Änderungen gegenüber dem Original"})).toBeInTheDocument();
    expect(screen.getByText(/Brutto weicht vom Originalstand ab/i)).toBeInTheDocument();
    expect(source.fields.grossTotal?.origin).toBe("pdf");
    expect(screen.queryByRole("button",{name:/export|herunterladen|erstellen/i})).not.toBeInTheDocument();
  });

  it("shows only concrete missing fields, not every permanently unsupported XML feature", () => {
    const original = invoice();
    const reviewed = structuredClone(original);
    original.fields.recipient = null;
    reviewed.fields.recipient = null;
    render(<ExportStatus original={original} reviewed={reviewed}/>);
    expect(screen.getByRole("heading",{name:"Offene Rechnungsangaben"})).toBeInTheDocument();
    expect(screen.getByText(/Rechnungsempfänger ist nicht eindeutig/i)).toBeInTheDocument();
    expect(screen.queryByText(/Währungscode ist nicht unabhängig belegt/i)).not.toBeInTheDocument();
  });
});
