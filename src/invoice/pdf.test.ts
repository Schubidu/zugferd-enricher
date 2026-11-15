import { describe, expect, it } from "vitest";
import { loadInvoicePdf } from "./pdf";

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
      expect(result.draft.fields.grossTotal?.value).toBe("243,75");
      expect(result.draft.items.map(x => x.taxRate)).toEqual(["7%", "19%"]);
      expect(result.draft.sourceLines.some(x => x.page === 2)).toBe(true);
      expect(result.draft.fields.grossTotal?.evidenceIds[0]).toMatch(/^page-2-line-/);
      expect(result.draft.sourceLines.every(x =>
        x.box.x >= 0 && x.box.x <= 1 && x.box.y >= 0 && x.box.y <= 1)).toBe(true);
    } finally {
      await result.pdf.destroy();
    }
  });

  it("reports a PDF page without extractable text instead of manufacturing invoice data", async () => {
    const result = await loadInvoicePdf(fakeLocalPdf(makePdf([[]])));
    try {
      expect(result.draft.fields.invoiceNumber).toBeNull();
      expect(result.draft.warnings.some(x => /OCR/i.test(x))).toBe(true);
    } finally {
      await result.pdf.destroy();
    }
  });

  it("rejects malformed bytes without returning a misleading invoice", async () => {
    await expect(loadInvoicePdf(fakeLocalPdf(new Uint8Array([0,1,2,3])))).rejects.toThrow();
  });
});
