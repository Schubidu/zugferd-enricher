import { classifyDescription } from "./classify";
import type { Classification } from "./classify";
import type { LineItem } from "./model";

type WorkerResponse = {
  predictions?: Array<Array<{ category: string; probability: number }>>;
  error?: string;
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

  const worker = new Worker(new URL("./classifier.worker.ts", import.meta.url), { type: "module" });
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
        reject(new Error(event.data.error ?? "Ungültige Modellantwort"));
        return;
      }
      uncertain.forEach((item, index) => {
        results[item.id] = classifyDescription(item.description, event.data.predictions?.[index] ?? []);
      });
      resolve(results);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("Lokale Modellberechnung fehlgeschlagen."));
    };
    worker.postMessage({ descriptions: uncertain.map(item => item.description) });
    if (signal.aborted) abort();
  });
}
