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

context.onmessage = event => {
  const {id,xml} = event.data;
  void (async () => {
    let result: LocalXmlValidation;
    try {
      if (typeof xml !== "string" || xml.length > 2_000_000) {
        throw new Error("Unacceptable XML payload");
      }
      const verified = await loadValidatorResources();
      result = validateCiiXmlLocally(xml,verified);
    } catch {
      // Never echo user invoice content or a thrown network error to the page.
      result = {status:"unavailable",reason:"LOCAL_VALIDATION_UNAVAILABLE"};
    }
    context.postMessage({id,result});
  })();
};
