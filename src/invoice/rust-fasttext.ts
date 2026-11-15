import type { Category } from "./classify";
import { hasKnownModelTerm } from "./model-vocabulary";

export type Prediction = { category: Category; probability: number };
type WasmExports = {
  memory: WebAssembly.Memory;
  ft_alloc: (length: number) => number;
  ft_free: (pointer: number, length: number) => void;
  ft_load: (pointer: number, length: number) => number;
  ft_predict: (pointer: number, length: number, out: number) => number;
};
const categories: readonly Category[] = [
  "unknown", "accommodation", "food", "beverage",
  "parking", "city_tax", "bundle", "other",
];

/** Small, direct WebAssembly ABI: no Emscripten, generated JS glue, or eval. */
export class RustFastText {
  private readonly wasm: WasmExports;

  constructor(instance: WebAssembly.Instance) {
    const exports = instance.exports as unknown as WasmExports;
    if (!(exports.memory instanceof WebAssembly.Memory) ||
      typeof exports.ft_alloc !== "function" ||
      typeof exports.ft_free !== "function" ||
      typeof exports.ft_load !== "function" ||
      typeof exports.ft_predict !== "function") {
      throw new Error("WASM_INIT_FAILED");
    }
    this.wasm = exports;
  }

  private withBytes<T>(bytes: Uint8Array, action: (pointer: number) => T): T {
    if (bytes.length === 0 || bytes.length > 1_048_576) throw new Error("MODEL_DECODE_FAILED");
    const pointer = this.wasm.ft_alloc(bytes.length);
    if (!pointer) throw new Error("WASM_INIT_FAILED");
    try {
      // WASM memory may grow during allocation; never reuse a stale buffer view.
      new Uint8Array(this.wasm.memory.buffer, pointer, bytes.length).set(bytes);
      return action(pointer);
    } finally {
      this.wasm.ft_free(pointer, bytes.length);
    }
  }

  loadModel(bytes: Uint8Array): void {
    this.withBytes(bytes, pointer => {
      if (this.wasm.ft_load(pointer, bytes.length) !== 1) {
        throw new Error("MODEL_DECODE_FAILED");
      }
    });
  }

  predict(description: string): Prediction[] {
    const encoded = new TextEncoder().encode(description.toLocaleLowerCase("de-DE"));
    // The native ABI rejects >8192 bytes. Abstain per item, never fail the batch.
    if (!encoded.length || encoded.byteLength > 8192) return [];
    // Quantized fastText softmax may assign >98% to completely OOV strings.
    // Only infer when real training-category vocabulary is present.
    if (!hasKnownModelTerm(description)) return [];
    return this.withBytes(encoded, pointer => {
      const out = this.wasm.ft_alloc(16);
      if (!out) throw new Error("INFERENCE_FAILED");
      try {
        const count = this.wasm.ft_predict(pointer, encoded.length, out);
        // A description with no known tokens is unknown, never a guessed category.
        if (count === -4) return [];
        if (count < 0 || count > 2) throw new Error("INFERENCE_FAILED");
        const view = new DataView(this.wasm.memory.buffer, out, 16);
        const predictions: Prediction[] = [];
        for (let i = 0; i < count; i++) {
          const index = view.getUint32(i * 8, true);
          const probability = view.getFloat32(i * 8 + 4, true);
          const category = categories[index];
          if (category && category !== "unknown" && Number.isFinite(probability)) {
            predictions.push({ category, probability });
          }
        }
        return predictions;
      } finally {
        this.wasm.ft_free(out, 16);
      }
    });
  }
}
