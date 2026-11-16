import type { LocalXmlValidation } from "./local-xml-engine";

export type { LocalXmlValidation } from "./local-xml-engine";

/**
 * Request exactly one local EN16931 check. A fresh Worker ensures parsed CII,
 * WASM validators and XSLT result DOMs are released on completion/cancellation.
 *
 * This API does not produce or authorize a ZUGFeRD document. Even a
 * valid-xml-only result leaves assessExportPreflight.exportAllowed === false.
 */
export function validateCiiXmlInBrowser(
  xml: string,
  signal?: AbortSignal,
): Promise<LocalXmlValidation> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Validation cancelled","AbortError"));
  }
  if (xml.length < 50 || xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    return Promise.resolve({status:"invalid",failures:["UNSAFE_XML"]});
  }

  return new Promise((resolve,reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./local-xml-worker.ts",import.meta.url),{type:"module"});
    } catch {
      resolve({status:"unavailable",reason:"LOCAL_VALIDATION_WORKER_UNAVAILABLE"});
      return;
    }

    let done = false;
    const finish = (response: LocalXmlValidation | null, error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort",abort);
      worker.terminate(); // Avoid persistent parsed financial data in memory.
      if (error) reject(error);
      else resolve(response ?? {status:"unavailable",reason:"LOCAL_VALIDATION_UNAVAILABLE"});
    };
    const abort = () => finish(null,new DOMException("Validation cancelled","AbortError"));
    // Avoid unbounded XSLT recursion or a stuck WebAssembly worker on iPhone.
    const timeout = setTimeout(
      () => finish({status:"unavailable",reason:"LOCAL_VALIDATION_TIMEOUT"}),30_000,
    );
    signal?.addEventListener("abort",abort,{once:true});
    worker.onerror = () =>
      finish({status:"unavailable",reason:"LOCAL_VALIDATION_WORKER_FAILED"});
    worker.onmessage = (event: MessageEvent<
      {id: number; result: LocalXmlValidation} | {id:number; progress:string}
    >) => {
      const message = event.data;
      if (message?.id !== 1) {
        finish({status:"unavailable",reason:"LOCAL_VALIDATION_INVALID_RESPONSE"});
        return;
      }
      // Only the separately built CI smoke entry accepts diagnostic frames.
      // They contain fixed technical stage names, never a PDF or XML value.
      if ("progress" in message) {
        if (import.meta.env.VITE_VALIDATOR_SMOKE === "1" && typeof message.progress === "string") {
          console.info("[xml-smoke] " + message.progress);
          return;
        }
        finish({status:"unavailable",reason:"LOCAL_VALIDATION_INVALID_RESPONSE"});
        return;
      }
      const result = message.result;
      if (!result || !["valid-xml-only","invalid","unavailable"].includes(result.status)) {
        finish({status:"unavailable",reason:"LOCAL_VALIDATION_INVALID_RESPONSE"});
        return;
      }
      finish(result);
    };
    if (signal?.aborted) { abort(); return; }
    try {
      worker.postMessage({id:1,xml});
    } catch {
      finish({status:"unavailable",reason:"LOCAL_VALIDATION_DISPATCH_FAILED"});
    }
  });
}
