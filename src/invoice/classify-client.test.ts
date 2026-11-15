import { afterEach, describe, expect, it, vi } from "vitest";
import type { LineItem } from "./model";
import { classifyLocally } from "./classify-client";

const fixture: LineItem = {
  id: "line-1", description: "Unbekannte Zusatzposition XYZ",
  amount: "10,00", taxRate: null, quantity: null, unitPrice: null,
  origin: "pdf", evidenceIds: ["p1-1"],
};

afterEach(() => vi.unstubAllGlobals());

describe("local classification worker lifecycle", () => {
  it("reports a failed worker creation as a safe error code", async () => {
    vi.stubGlobal("Worker", class {
      constructor() { throw new DOMException("Cross-origin worker could not start", "SecurityError"); }
    });
    await expect(classifyLocally([fixture], new AbortController().signal))
      .rejects.toThrow("WORKER_START_FAILED");
  });

  it("preserves model-loading stage information and terminates a failed worker", async () => {
    let terminated = false;
    class TestWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onmessageerror: (() => void) | null = null;
      postMessage() {
        this.onmessage?.({ data: {error: "WASM_INIT_FAILED"} } as MessageEvent);
      }
      terminate() { terminated = true; }
    }
    vi.stubGlobal("Worker", TestWorker);
    await expect(classifyLocally([fixture], new AbortController().signal))
      .rejects.toThrow("WASM_INIT_FAILED");
    expect(terminated).toBe(true);
  });

  it("does not transmit any invoice data when a keyword rule is sufficient", async () => {
    const worker = vi.fn();
    vi.stubGlobal("Worker", worker);
    const result = await classifyLocally([{...fixture,description:"Kurtaxe"}], new AbortController().signal);
    expect(result["line-1"]?.category).toBe("city_tax");
    expect(worker).not.toHaveBeenCalled();
  });

  it("terminates the Worker when Safari reports a module script error", async () => {
    let terminated = false;
    class TestWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onmessageerror: (() => void) | null = null;
      postMessage() { this.onerror?.(); }
      terminate() { terminated = true; }
    }
    vi.stubGlobal("Worker", TestWorker);
    await expect(classifyLocally([fixture], new AbortController().signal))
      .rejects.toThrow("WORKER_START_FAILED");
    expect(terminated).toBe(true);
  });

  it("aborts work on document changes without exposing any document text", async () => {
    let terminated = false;
    class TestWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onmessageerror: (() => void) | null = null;
      postMessage() {}
      terminate() { terminated = true; }
    }
    vi.stubGlobal("Worker", TestWorker);
    const controller = new AbortController();
    const promise = classifyLocally([fixture], controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({name:"AbortError"});
    expect(terminated).toBe(true);
  });
});
