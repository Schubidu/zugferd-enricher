export const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024;

export type PdfSelectionError = "invalid-type" | "empty" | "too-large";

export function validatePdfSelection(file: File): PdfSelectionError | null {
  // Filename is a UI filter only. Actual PDF parsing and validation come later.
  if (!file.name.toLowerCase().endsWith(".pdf")) return "invalid-type";
  if (file.size === 0) return "empty";
  if (file.size > MAX_PDF_SIZE_BYTES) return "too-large";
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return String(bytes) + " B";
  const unit = bytes < 1024 * 1024 ? " KB" : " MB";
  const divisor = bytes < 1024 * 1024 ? 1024 : 1024 * 1024;
  return (bytes / divisor).toLocaleString("de-DE", {
    maximumFractionDigits: 1,
  }) + unit;
}
