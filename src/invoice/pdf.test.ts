import { describe, expect, it, vi } from "vitest";

// Vitest runs in Node, but Vite's ?url is a browser asset path.
// Resolve the same installed worker as a file URL for PDF.js's Node fake worker.
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", async () => {
  const { resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  return {
    default: pathToFileURL(resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs")).href,
  };
});
import { loadInvoicePdf } from "./pdf";
import { sumLineItemAmounts } from "./money";
import { reconcileInvoice } from "./reconcile";

/** Synthetic, fully in-memory PDFs; never add real customer invoices to this repository. */
function makePdf(pages: string[][]): Uint8Array {
  const encoder = new TextEncoder();
  const pageIds = pages.map((_, i) => 4 + 2*i);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [" + pageIds.map(id => id + " 0 R").join(" ") + "] /Count " + pages.length + " >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  pages.forEach((lines, index) => {
    const contentId = 5 + 2*index;
    const stream = lines.map((line, i) => {
      const safe = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      return "BT /F1 12 Tf 50 " + (740-24*i) + " Td (" + safe + ") Tj ET\n";
    }).join("");
    objects.push(
      "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [0 0 612 792] /Contents " + contentId + " 0 R >>",
      "<< /Length " + encoder.encode(stream).length + " >>\nstream\n" + stream + "endstream",
    );
  });
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(encoder.encode(text).length);
    text += (index + 1) + " 0 obj\n" + body + "\nendobj\n";
  });
  const xref = encoder.encode(text).length;
  text += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    text += String(offset).padStart(10, "0") + " 00000 n \n";
  }
  text += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return encoder.encode(text);
}
function fakeLocalPdf(bytes: Uint8Array): File {
  // jsdom's File has no arrayBuffer; the application reads the same browser API.
  return {
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  } as File;
}

describe("PDF.js extraction integration with synthetic source PDFs", () => {
  it("reads real multi-page PDF bytes, preserves page evidence and recognizes labeled facts", async () => {
    const bytes = makePdf([
      ["Rechnungsaussteller: Beispiel GmbH", "Rechnungsnummer: H-2026-014", "Logis 2 x 100,00 200,00 7%"],
      ["Parking 25,00 19%", "Nettosumme 225,00", "Umsatzsteuer gesamt 18,75", "Gesamtbetrag 243,75"],
    ]);
    const result = await loadInvoicePdf(fakeLocalPdf(bytes));
    try {
      expect(result.pdf.numPages).toBe(2);
      expect(result.draft.fields.invoiceNumber?.value).toBe("H-2026-014");
      expect(result.originalDraft).toEqual(result.draft);
      expect(result.originalDraft).not.toBe(result.draft);
      expect(result.originalDraft.sourceLines).not.toBe(result.draft.sourceLines);
      result.draft.fields.invoiceNumber!.value = "MANUAL-CHANGE";
      expect(result.originalDraft.fields.invoiceNumber?.value).toBe("H-2026-014");
      expect(result.originalDraft.items[0]?.amount).toBe("200,00");
      expect(result.draft.fields.grossTotal?.value).toBe("243,75");
      expect(result.draft.items.map(x => x.taxRate)).toEqual(["7%", "19%"]);
      expect(result.draft.sourceLines.some(x => x.page === 2)).toBe(true);
      expect(result.draft.fields.grossTotal?.evidenceIds[0]).toMatch(/^page-2-line-/);
      expect(result.draft.sourceLines.every(x =>
        x.box.x >= 0 && x.box.x <= 1 && x.box.y >= 0 && x.box.y <= 1)).toBe(true);
    } finally {
      await result.pdf.loadingTask.destroy();
    }
  });

  it("reports a PDF page without extractable text instead of manufacturing invoice data", async () => {
    const result = await loadInvoicePdf(fakeLocalPdf(makePdf([[]])));
    try {
      expect(result.draft.fields.invoiceNumber).toBeNull();
      expect(result.draft.warnings.some(x => /OCR/i.test(x))).toBe(true);
    } finally {
      await result.pdf.loadingTask.destroy();
    }
  });

  it("rejects malformed bytes without returning a misleading invoice", async () => {
    await expect(loadInvoicePdf(fakeLocalPdf(new Uint8Array([0,1,2,3])))).rejects.toThrow();
  });
  it("rejects a cancelled extraction before opening the PDF worker", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadInvoicePdf(fakeLocalPdf(makePdf([["Invoice 119.00"]])), controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not start PDF.js when aborted while local file bytes are being read", async () => {
    let finishReading: ((value: ArrayBuffer) => void) | undefined;
    const file = {
      arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { finishReading = resolve; }),
    } as File;
    const controller = new AbortController();
    const pending = loadInvoicePdf(file, controller.signal);
    // File bytes may complete even after an abort; the worker must not be started.
    controller.abort();
    finishReading?.(Uint8Array.from(makePdf([["Gross total: 120.00"]])).buffer);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });


  it("reads a TEST-05-like Kurtaxe source note end-to-end through PDF.js", async () => {
    const result = await loadInvoicePdf(fakeLocalPdf(makePdf([[
      "Rechnungsaussteller: Hotel Am Markt Test GmbH",
      "Buyer: Musterwerk Analytics UG",
      "Rechnungsnummer: HAM-2026-315",
      "Rechnungsdatum: 15.11.2026",
      "LEISTUNG - MENGE x EINZELPREIS = POSITION NETTO - UST",
      "Logis 12.11.2026 1 x 105,00 105,00 7%",
      "Logis 13.11.2026 1 x 125,00 125,00 7%",
      "Logis 14.11.2026 1 x 118,00 118,00 7%",
      "Breakfast Speisen 3 x 14,00 42,00 7%",
      "Breakfast Drinks 3 x 5,00 15,00 19%",
      "Parken 2 x 8,00 16,00 19%",
      "Kurtaxe 3 x 3,50 10,50",
      "USt 7% Netto 390,00 Steuer 27,30",
      "USt 19% Netto 31,00 Steuer 5,89",
      "Kurtaxe (im Namen der Gemeinde, ohne Umsatzsteuer): 10,50",
      "Nettosumme 431,50",
      "Umsatzsteuer gesamt 33,19",
      "Gesamtbetrag 464,69",
    ]])));
    try {
      expect(result.draft.items).toHaveLength(7);
      expect(result.draft.items.every(item => item.amountBasis?.kind === "net")).toBe(true);
      expect(result.draft.items.filter(x => x.description === "Kurtaxe")).toHaveLength(1);
      expect(result.draft.items.find(x => x.description === "Kurtaxe")?.taxTreatment?.kind)
        .toBe("third_party_no_vat");
      expect(sumLineItemAmounts(result.draft.items).totalCents).toBe(43150n);
      expect(result.draft.fields.grossTotal?.value).toBe("464,69");
      expect(reconcileInvoice(result.draft)).toEqual([]);
    } finally {
      await result.pdf.loadingTask.destroy();
    }
  });

  it("keeps TEST-04's unknown bundle VAT status as the only arithmetic review action", async () => {
    const result = await loadInvoicePdf(fakeLocalPdf(makePdf([[
      "Rechnungsnummer: SAF-2026-802",
      "LEISTUNG / ARTIKEL - MENGE x EINZELPREIS = NETTOBETRAG - UST",
      "Logis 1 x 99,00 99,00 7%",
      "Logis 1 x 129,00 129,00 7%",
      "Logis 1 x 149,00 149,00 7%",
      "Logis 1 x 109,00 109,00 7%",
      "Logis 1 x 119,00 119,00 7%",
    ],[
      "Rechnungsnummer: SAF-2026-802",
      "LEISTUNG / ARTIKEL - MENGE x EINZELPREIS = NETTOBETRAG - UST",
      "Food 1 x 85,00 85,00 7%",
      "Dinner 1 x 28,00 28,00 7%",
      "Lunch 1 x 48,00 48,00 7%",
      "Parking 1 x 80,00 80,00 19%",
      "Drinks 1 x 15,00 15,00 19%",
      "Espresso 1 x 9,00 9,00 19%",
      "WLAN 1 x 10,00 10,00 19%",
    ],[
      "Rechnungsnummer: SAF-2026-802",
      "LEISTUNG / ARTIKEL - MENGE x EINZELPREIS = NETTOBETRAG - UST",
      "Business Paket 1 x 29,00 29,00",
      "USt 7% Netto 766,00 Steuer 53,62",
      "USt 19% Netto 143,00 Steuer 27,17",
      "Nettosumme 909,00",
      "Umsatzsteuer gesamt 80,79",
      "Gesamtbetrag 989,79",
    ]])));
    try {
      expect(result.draft.items).toHaveLength(13);
      expect(result.draft.items.every(item => item.amountBasis?.kind === "net")).toBe(true);
      expect(result.draft.items.find(item => item.description === "Business Paket")?.taxRate).toBeNull();
      expect(result.draft.fields.invoiceNumber?.value).toBe("SAF-2026-802");
      expect(sumLineItemAmounts(result.draft.items).totalCents).toBe(90900n);
      expect(reconcileInvoice(result.draft).map(x => x.id)).toEqual(["missing-tax-rates"]);
    } finally {
      await result.pdf.loadingTask.destroy();
    }
  });
});
