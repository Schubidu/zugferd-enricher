import { classifyDescription } from "./classify";
import type { Classification } from "./classify";
import type { LineItem } from "./model";
import { MODEL_ERROR_MESSAGES } from "./model-errors";
import type { ModelErrorCode } from "./model-errors";

type WorkerResponse = {
  predictions?: Array<Array<{ category: string; probability: number }>>;
  error?: ModelErrorCode;
};

/** Worker and quantized model load only after explicit user action. */
export async function classifyLocally(
  items: readonly LineItem[],
  signal: AbortSignal,
): Promise<Record<string, Classification>> {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const results = Object.fromEntries(items.map(item => [item.id, classifyDescription(item.description)]));
  const uncertain = items.filter(item => results[item.id]?.category === "unknown");
  if (!uncertain.length) return results;

  let worker: Worker;
  try {
    worker = new Worker(new URL("./classifier.worker.ts", import.meta.url), { type: "module" });
  } catch {
    throw new Error("WORKER_START_FAILED");
  }
  return new Promise<Record<string, Classification>>((resolve, reject) => {
    const abort = () => {
      worker.terminate();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const finish = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      finish();
      if (event.data.error || event.data.predictions?.length !== uncertain.length) {
        const code = event.data.error && event.data.error in MODEL_ERROR_MESSAGES
          ? event.data.error : "INFERENCE_FAILED";
        reject(new Error(code));
        return;
      }
      uncertain.forEach((item, index) => {
        results[item.id] = classifyDescription(item.description, event.data.predictions?.[index] ?? []);
      });
      resolve(results);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("WORKER_START_FAILED"));
    };
    worker.onmessageerror = () => {
      finish();
      reject(new Error("WORKER_START_FAILED"));
    };
    try {
      worker.postMessage({ descriptions: uncertain.map(item => item.description) });
    } catch {
      finish();
      reject(new Error("WORKER_START_FAILED"));
    }
    if (signal.aborted) abort();
  });
}
