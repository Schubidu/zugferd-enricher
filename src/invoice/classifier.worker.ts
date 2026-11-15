/// <reference lib="webworker" />
import { RustFastText } from "./rust-fasttext";
import type { ModelErrorCode } from "./model-errors";

type Prediction = { category: string; probability: number };
type Request = { descriptions: string[] };
let pending: Promise<RustFastText> | undefined;

class ModelLoadError extends Error {
  constructor(readonly code: ModelErrorCode) { super(code); }
}

/** Fetch only project-shipped assets from our own origin. */
async function loadModel(): Promise<RustFastText> {
  if (typeof WebAssembly === "undefined") throw new ModelLoadError("WASM_UNAVAILABLE");

  let modelBytes: Uint8Array;
  let wasmBytes: ArrayBuffer;
  try {
    const [model, wasm] = await Promise.all([
      fetch(new URL("/models/invoice-categories-v1.ftz", self.location.origin)),
      fetch(new URL("/models/fasttext-rust-v1.wasm", self.location.origin)),
    ]);
    if (!model.ok || !wasm.ok) throw new Error("Missing local classifier asset");
    modelBytes = new Uint8Array(await model.arrayBuffer());
    wasmBytes = await wasm.arrayBuffer();
    if (!modelBytes.length || modelBytes.byteLength > 1024 * 1024 ||
      wasmBytes.byteLength === 0 || wasmBytes.byteLength > 1024 * 1024) {
      throw new Error("Invalid static classifier asset");
    }
  } catch {
    throw new ModelLoadError("MODEL_FETCH_FAILED");
  }

  let classifier: RustFastText;
  try {
    const source = await WebAssembly.instantiate(wasmBytes, {});
    classifier = new RustFastText(source.instance);
  } catch {
    throw new ModelLoadError("WASM_INIT_FAILED");
  }

  try {
    classifier.loadModel(modelBytes);
  } catch {
    throw new ModelLoadError("MODEL_DECODE_FAILED");
  }
  return classifier;
}

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    pending ??= loadModel();
    const classifier = await pending;
    const predictions: Prediction[][] = data.descriptions.map(description =>
      classifier.predict(description));
    self.postMessage({ predictions });
  } catch (error) {
    pending = undefined;
    const code: ModelErrorCode = error instanceof ModelLoadError ? error.code : "INFERENCE_FAILED";
    // Fixed code only; never include invoice descriptions, paths, or error stacks.
    self.postMessage({ error: code });
  }
};
