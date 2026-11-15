/// <reference lib="webworker" />
import { FastText } from "fasttext.wasm";
import coreUrl from "fasttext.wasm/dist/core/fasttext.mjs?url";
import wasmUrl from "fasttext.wasm/dist/core/fasttext.wasm?url";

type Prediction = { category: string; probability: number };
type Request = { descriptions: string[] };
let pending: Promise<FastText> | undefined;

async function loadModel(): Promise<FastText> {
  const response = await fetch(new URL("/models/invoice-categories-v1.ftz", self.location.origin));
  if (!response.ok) throw new Error("Local classification model is unavailable");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 1024 * 1024) throw new Error("Local model exceeds size budget");
  const fastText = await FastText.create({ corePath: coreUrl, wasmPath: wasmUrl });
  fastText.loadModel(bytes);
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
  } catch {
    // Do not leak invoice descriptions into errors, telemetry or log output.
    self.postMessage({ error: "Lokales Klassifikationsmodell konnte nicht geladen werden." });
  }
};
