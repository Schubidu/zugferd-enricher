// @vitest-environment node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { FastText } from "fasttext.wasm";
import { classifyDescription } from "./classify";

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

    // Fully synthetic withheld and out-of-domain cases. This is a diagnostic
    // benchmark, not a claim about accuracy on real-world supplier invoices.
    const known: Array<[string,string]> = [
      ["Lodging one night","accommodation"],
      ["Einzelzimmer Übernachtungsleistung","accommodation"],
      ["Restaurant Mittagessen","food"],
      ["Speisen Abendmenü","food"],
      ["Cappuccino Bar","beverage"],
      ["Frühstücksgetränke Hotel","beverage"],
      ["Parkticket Tiefgarage","parking"],
      ["Garage parking day","parking"],
      ["Ortstaxe Gemeinde","city_tax"],
      ["Kurtaxe je Nacht","city_tax"],
      ["Business arrangement","bundle"],
      ["Kombipaket Hotel","bundle"],
      ["Büromaterial Papier","other"],
      ["USB Kabel Adapter","other"],
    ];
    const outOfScope = [
      "Invoice number H-2026-123",
      "IBAN DE89 3704 0044 0532 0130 00",
      "Umsatzsteuer 19 Prozent",
      "Grand total 119.00",
      "Unbekannte Zusatzposition XYZ",
      "Buchung Referenzcode 12345",
      "Rechnungsempfänger Musterstraße 3",
      "Frühstück und Getränke",
    ];
    function assign(text: string) {
      const predictions = Array.from(ft.predict(text.toLocaleLowerCase("de-DE"), 2, 0))
        .map(([label, probability]) => ({
          category: label.replace(/^__label__/, ""), probability,
        }));
      return classifyDescription(text, predictions).category;
    }
    const correct = known.filter(([description, category]) => assign(description) === category).length;
    const falseAccepted = outOfScope.filter(description => assign(description) !== "unknown").length;
    const withheld = outOfScope.length - falseAccepted;
    console.info("Synthetic fastText WASM benchmark", {
      heldOut: known.length,
      correct,
      outOfDomain: outOfScope.length,
      falseAccepted,
      withheld,
    });
    expect(correct).toBeGreaterThanOrEqual(11);
    expect(withheld).toBeGreaterThanOrEqual(5);

  });
});
