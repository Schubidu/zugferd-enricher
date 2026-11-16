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

describe("ZUGFeRD export status disclosure", () => {
  it("shows a truthful non-exporting status, with details behind disclosure", () => {
    const source = invoice();
    render(<ExportStatus original={source} reviewed={structuredClone(source)}/>);
    expect(screen.getByRole("heading",{name:"ZUGFeRD-Verarbeitungskopie"})).toBeInTheDocument();
    expect(screen.getByText(/Export noch nicht verfügbar/i)).toBeInTheDocument();
    const disclosure = screen.getByText("Exportvoraussetzungen anzeigen").closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.queryByRole("button",{name:/export|herunterladen|erstellen/i})).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Exportvoraussetzungen anzeigen"));
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByRole("heading",{name:"Fehlende oder ungeklärte Rechnungsangaben"})).toBeInTheDocument();
    expect(screen.getByRole("heading",{name:"Technische Validierung"})).toBeInTheDocument();
    expect(screen.queryByRole("heading",{name:"Abweichungen zum Original"})).not.toBeInTheDocument();
    expect(screen.getByText(/Eine spätere Verarbeitungskopie ersetzt weder die Originalrechnung/i)).toBeInTheDocument();
  });

  it("reveals source-fidelity blockers on review edits, even for an unchanged amount", () => {
    const source = invoice();
    const edited = structuredClone(source);
    edited.fields.grossTotal = {...edited.fields.grossTotal!,origin:"manual"};
    const {rerender} = render(<ExportStatus original={source} reviewed={source}/>);
    expect(screen.queryByRole("heading",{name:"Abweichungen zum Original"})).not.toBeInTheDocument();
    rerender(<ExportStatus original={source} reviewed={edited}/>);
    expect(screen.getByRole("heading",{name:"Abweichungen zum Original"})).toBeInTheDocument();
    expect(screen.getByText(/Brutto weicht vom Originalstand ab/i)).toBeInTheDocument();
    expect(source.fields.grossTotal?.origin).toBe("pdf");
    expect(screen.queryByRole("button",{name:/export|herunterladen|erstellen/i})).not.toBeInTheDocument();
  });
});
