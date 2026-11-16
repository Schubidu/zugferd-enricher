import { validateCiiXmlLocally } from "./local-xml-engine";
import { loadValidatorResources } from "./validator-assets";
import type { LocalXmlValidation } from "./local-xml-engine";

/**
 * Dedicated one-shot browser Worker: no page DOM, no server, no user-file
 * network access. The caller terminates it after one result or cancellation.
 */
type Request = {id: number; xml: string};
type Reply = {id: number; result: LocalXmlValidation};
const context = self as unknown as {
  postMessage: (message: Reply) => void;
  onmessage: ((event: MessageEvent<Request>) => void) | null;
};

const trace = (stage: string) => {
  if (import.meta.env.VITE_VALIDATOR_SMOKE === "1") console.info("[xml-smoke] " + stage);
};

context.onmessage = event => {
  const {id,xml} = event.data;
  void (async () => {
    let result: LocalXmlValidation;
    try {
      if (typeof xml !== "string" || xml.length > 2_000_000) {
        throw new Error("Unacceptable XML payload");
      }
      trace("worker-start");
      const verified = await loadValidatorResources();
      trace("resources-verified");
      result = validateCiiXmlLocally(xml,verified);
      trace("engine-finished:" + result.status);
    } catch {
      trace("worker-exception");
      // Never echo user invoice content or a thrown network error to the page.
      result = {status:"unavailable",reason:"LOCAL_VALIDATION_UNAVAILABLE"};
    }
    context.postMessage({id,result});
  })();
};
