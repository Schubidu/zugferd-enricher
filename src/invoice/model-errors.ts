/**
 * Safe, non-document-specific diagnostics. Do not include source text, paths,
 * invoice names, raw worker errors, or exception stacks in UI messages.
 */
export const MODEL_ERROR_MESSAGES = {
  WORKER_START_FAILED: "Der Klassifizierungs-Worker konnte nicht gestartet werden. Bitte Safari neu laden und erneut versuchen.",
  WASM_UNAVAILABLE: "WebAssembly steht auf diesem Gerät nicht zur Verfügung. Bitte Safari-Einstellungen und gegebenenfalls den Blockierungsmodus prüfen.",
  WASM_INIT_FAILED: "Der WebAssembly-Kern konnte nicht initialisiert werden. Bitte den aktuellen Browser-Stand und die Sicherheitsrichtlinie prüfen.",
  MODEL_FETCH_FAILED: "Die lokale Modelldatei konnte nicht geladen werden. Prüfe die Verbindung und versuche es erneut.",
  MODEL_DECODE_FAILED: "Das lokale Modell konnte nicht gelesen werden. Bitte die Webapp neu laden und erneut versuchen.",
  INFERENCE_FAILED: "Die lokale Klassifizierung ist fehlgeschlagen. Regelbasierte Vorschläge bleiben verfügbar.",
} as const;

export type ModelErrorCode = keyof typeof MODEL_ERROR_MESSAGES;

export function modelErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return code in MODEL_ERROR_MESSAGES
    ? MODEL_ERROR_MESSAGES[code as ModelErrorCode]
    : MODEL_ERROR_MESSAGES.INFERENCE_FAILED;
}
