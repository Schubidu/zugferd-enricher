// @vitest-environment node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RustFastText } from "./rust-fasttext";
import { classifyDescription } from "./classify";

describe("pure-Rust WASM and quantized model compatibility", () => {
  it("loads the generated .ftz in the actual fastText WebAssembly runtime", async () => {
    const wasmBytes = await readFile(resolve("public/models/fasttext-rust-v1.wasm"));
    const modelBytes = await readFile(resolve("public/models/invoice-categories-v1.ftz"));
    expect(modelBytes.byteLength).toBeLessThan(1024 * 1024);
    expect(wasmBytes.byteLength).toBeLessThan(1024 * 1024);
    const source = await WebAssembly.instantiate(wasmBytes, {});
    const ft = new RustFastText(source.instance);
    ft.loadModel(new Uint8Array(modelBytes));
    const food = ft.predict("frühstück speisen");
    const drinks = ft.predict("frühstücksgetränke hotel");
    expect(food[0]?.category).toBe("food");
    expect(drinks[0]?.category).toBe("beverage");
    expect(food[0]?.probability).toBeGreaterThan(0.5);

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
      const predictions = ft.predict(text);
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
