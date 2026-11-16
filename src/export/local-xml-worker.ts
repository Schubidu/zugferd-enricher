import { loadValidatorResources } from "./validator-assets";
import type { LocalXmlValidation } from "./local-xml-engine";

/**
 * Dedicated one-shot browser Worker: no page DOM, no server, no user-file
 * network access. The caller terminates it after one result or cancellation.
 */
type Request = {id: number; xml: string};
type Reply = {id: number; result: LocalXmlValidation} | {id:number; progress:string};
const context = self as unknown as {
  postMessage: (message: Reply) => void;
  onmessage: ((event: MessageEvent<Request>) => void) | null;
};

const trace = (id: number, stage: string) => {
  // Sent only in the dedicated CI build, contains no invoice data.
  if (import.meta.env.VITE_VALIDATOR_SMOKE === "1") context.postMessage({id,progress:stage});
};

context.onmessage = event => {
  const {id,xml} = event.data;
  void (async () => {
    let result: LocalXmlValidation;
    try {
      if (typeof xml !== "string" || xml.length > 2_000_000) {
        throw new Error("Unacceptable XML payload");
      }
      trace(id,"worker-start");
      const verified = await loadValidatorResources();
      trace(id,"resources-verified");
      // Lazy import makes the expensive WASM initialization independently
      // observable and allows the caller to cancel a stalled module load.
      const {validateCiiXmlLocally} = await import("./local-xml-engine");
      trace(id,"engine-module-ready");
      result = validateCiiXmlLocally(xml,verified,stage => trace(id,stage));
      trace(id,"engine-finished:" + result.status);
      // Inaccessible rule engines must not leak parser internals or invoice text
      // into the page or future user-visible diagnostics.
      if (result.status === "unavailable") {
        result = {status:"unavailable",reason:"LOCAL_VALIDATION_UNAVAILABLE"};
      }
    } catch {
      trace(id,"worker-exception");
      // Never echo user invoice content or a thrown network error to the page.
      result = {status:"unavailable",reason:"LOCAL_VALIDATION_UNAVAILABLE"};
    }
    context.postMessage({id,result});
  })();
};
