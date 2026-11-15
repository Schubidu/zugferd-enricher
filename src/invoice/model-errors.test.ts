import { describe, expect, it } from "vitest";
import { MODEL_ERROR_MESSAGES, modelErrorMessage } from "./model-errors";

describe("privacy-preserving WASM and Worker diagnostics", () => {
  it("distinguishes every supported loading stage without including invoice content", () => {
    for (const code of Object.keys(MODEL_ERROR_MESSAGES)) {
      const text = modelErrorMessage(new Error(code));
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toContain("fake-invoice-2026");
      expect(text).not.toContain("stack:");
    }
    expect(modelErrorMessage(new Error("WASM_UNAVAILABLE"))).toMatch(/WebAssembly/i);
    expect(modelErrorMessage(new Error("MODEL_FETCH_FAILED"))).toMatch(/Modelldatei/i);
    expect(modelErrorMessage(new Error("WASM_INIT_FAILED"))).toMatch(/WebAssembly-Kern/i);
  });

  it("never reveals unexpected exception messages or stack data", () => {
    const exception = new Error("private-invoice-2026.pdf customer confidential");
    expect(modelErrorMessage(exception)).toBe(MODEL_ERROR_MESSAGES.INFERENCE_FAILED);
    expect(modelErrorMessage(null)).toBe(MODEL_ERROR_MESSAGES.INFERENCE_FAILED);
  });
});
