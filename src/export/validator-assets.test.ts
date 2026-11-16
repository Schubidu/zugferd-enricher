import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { VALIDATOR_RESOURCES, loadValidatorResources } from "./validator-assets";

describe("the bundled version-pinned FeRD validator resources", () => {
  it("ships all seven official files with exactly the committed checksums", () => {
    const entries = Object.entries(VALIDATOR_RESOURCES);
    expect(entries).toHaveLength(7);
    for (const [name,expected] of entries) {
      const bytes = readFileSync(resolve("public","validation","ferd-2.5.2",name));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected);
    }
  });

  it("loads only same-origin resources and rejects any modified bytes", async () => {
    const entries = Object.entries(VALIDATOR_RESOURCES);
    const original = new Map(entries.map(([name]) => [
      name,readFileSync(resolve("public","validation","ferd-2.5.2",name)),
    ]));
    const fetchMock = vi.fn(async (url: URL, options?: RequestInit) => {
      expect(options?.mode).toBe("same-origin");
      return {
        ok:true,
        arrayBuffer:async () => Uint8Array.from(original.get(url.pathname.split("/").pop()!)!).buffer,
      };
    });
    vi.stubGlobal("crypto",webcrypto);
    vi.stubGlobal("fetch",fetchMock);
    try {
      // jsdom has the same relative-location URL model as a web worker.
      const resources = await loadValidatorResources();
      expect(resources.size).toBe(7);
      expect(fetchMock).toHaveBeenCalledTimes(7);
      for (const [url,options] of fetchMock.mock.calls) {
        expect(url.origin).toBe(location.origin);
        expect(options).toMatchObject({
          method:"GET",mode:"same-origin",redirect:"error",credentials:"same-origin",
        });
      }
      original.set("FACTUR-X_EN16931.xsd",Buffer.from("tampered"));
      await expect(loadValidatorResources()).rejects.toThrow(
        /Validation resource changed or unsupported/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
