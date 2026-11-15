import { describe, expect, it } from "vitest";
import { formatFileSize, MAX_PDF_SIZE_BYTES, validatePdfSelection } from "./pdf-selection";

describe("PDF selection validation", () => {
  it("accepts PDF file names irrespective of case", () => {
    const file = new File(["test"], "Receipt.PDF", { type: "application/pdf" });
    expect(validatePdfSelection(file)).toBeNull();
  });

  it("rejects non-PDF file names even when the MIME type claims PDF", () => {
    const file = new File(["test"], "receipt.txt", { type: "application/pdf" });
    expect(validatePdfSelection(file)).toBe("invalid-type");
  });

  it("rejects empty PDFs", () => {
    expect(validatePdfSelection(new File([], "invoice.pdf"))).toBe("empty");
  });

  it("rejects files larger than the documented cap", () => {
    const big = new File(["test"], "invoice.pdf");
    Object.defineProperty(big, "size", { value: MAX_PDF_SIZE_BYTES + 1 });
    expect(validatePdfSelection(big)).toBe("too-large");
  });

  it("formats file sizes for the UI", () => {
    expect(formatFileSize(5)).toBe("5 B");
    expect(formatFileSize(1024 * 1024)).toBe("1 MB");
  });
});
