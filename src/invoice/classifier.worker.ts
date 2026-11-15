/// <reference lib="webworker" />
import { FastText } from "fasttext.wasm";
import coreUrl from "fasttext.wasm/dist/core/fasttext.mjs?url";
import wasmUrl from "fasttext.wasm/dist/core/fasttext.wasm?url";
import type { ModelErrorCode } from "./model-errors";

type Prediction = { category: string; probability: number };
type Request = { descriptions: string[] };
let pending: Promise<FastText> | undefined;

class ModelLoadError extends Error {
  constructor(readonly code: ModelErrorCode) { super(code); }
}

/**
 * Only project-shipped, same-origin, public model/runtime assets are fetched.
 * Never include private invoice data in errors or diagnostic messages.
 */
async function loadModel(): Promise<FastText> {
  if (typeof WebAssembly === "undefined") throw new ModelLoadError("WASM_UNAVAILABLE");

  let bytes: Uint8Array;
  try {
    const response = await fetch(new URL("/models/invoice-categories-v1.ftz", self.location.origin));
    if (!response.ok) throw new Error("non-success model response");
    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 1024 * 1024) throw new Error("invalid model size");
  } catch {
    throw new ModelLoadError("MODEL_FETCH_FAILED");
  }

  let fastText: FastText;
  try {
    fastText = await FastText.create({ corePath: coreUrl, wasmPath: wasmUrl });
  } catch {
    throw new ModelLoadError("WASM_INIT_FAILED");
  }
  try {
    fastText.loadModel(bytes);
  } catch {
    throw new ModelLoadError("MODEL_DECODE_FAILED");
  }
  return fastText;
}

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    pending ??= loadModel();
    const model = await pending;
    const predictions: Prediction[][] = data.descriptions.map(description =>
      Array.from(model.predict(description.toLocaleLowerCase("de-DE"), 2, 0))
        .map(([label, probability]) => ({
          category: label.replace(/^__label__/, ""), probability,
        })),
    );
    self.postMessage({ predictions });
  } catch (error) {
    pending = undefined; // Allows a subsequent attempt after a temporary failure.
    const code = error instanceof ModelLoadError ? error.code : "INFERENCE_FAILED";
    self.postMessage({ error: code });
  }
};
