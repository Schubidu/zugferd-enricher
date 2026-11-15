// @vitest-environment node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { FastText } from "fasttext.wasm";

describe("published quantized model runtime compatibility", () => {
  it("loads the generated .ftz in the actual fastText WebAssembly runtime", async () => {
    const corePath = pathToFileURL(resolve("node_modules/fasttext.wasm/dist/core/fasttext.mjs")).href;
    const wasmPath = resolve("node_modules/fasttext.wasm/dist/core/fasttext.wasm");
    const ft = await FastText.create({ corePath, wasmPath });
    const bytes = await readFile(resolve("public/models/invoice-categories-v1.ftz"));
    expect(bytes.byteLength).toBeLessThan(1024 * 1024);
    ft.loadModel(new Uint8Array(bytes));
    const food = Array.from(ft.predict("frühstück speisen", 2, 0));
    const drinks = Array.from(ft.predict("frühstücksgetränke hotel", 2, 0));
    expect(food[0]?.[0]).toBe("__label__food");
    expect(drinks[0]?.[0]).toBe("__label__beverage");
    expect(food[0]?.[1]).toBeGreaterThan(0.5);
  });
});
