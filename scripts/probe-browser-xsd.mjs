#!/usr/bin/env node
/**
 * CI-only libxml2-wasm feasibility proof.
 *
 * The source XML is GENERATED FROM A SYNTHETIC INVOICE. No user or external
 * invoices are used or uploaded, and no validation result is considered
 * browser-runtime EN16931 export approval. Schematron is NOT tested here.
 *
 * The official CII schema is provided by a fixed, checksum-verified Mustang
 * distribution. All XSD include/import dependencies must resolve from a
 * memory-only virtual IO provider: never a remote URL.
 */
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { TextDecoder, TextEncoder } from "node:util";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  XmlDocument, XsdValidator, XmlBufferInputProvider, xmlRegisterInputProvider,
} from "libxml2-wasm";

const [schemaDirectory, candidatePath] = process.argv.slice(2);
if (!schemaDirectory || !candidatePath) {
  throw new Error("Usage: node scripts/probe-browser-xsd.mjs <schema-directory> <synthetic.xml>");
}
const encoding = new TextEncoder();
const files = readdirSync(schemaDirectory).filter(name => name.endsWith(".xsd"));
const primary = "FACTUR-X_EN16931.xsd";
assert.ok(files.includes(primary), "Pinned EN16931 root schema is missing");
assert.ok(files.length >= 4, "Missing schema dependencies");
const data = Object.fromEntries(files.map(name => [
  "memory:///schemas/" + name, readFileSync(join(schemaDirectory, name)),
]));

for (const [virtualUrl, bytes] of Object.entries(data)) {
  const definition = new TextDecoder().decode(bytes);
  assert.ok(!/<!DOCTYPE|<!ENTITY/i.test(definition), `DTD forbidden in ${virtualUrl}`);
  const locations = [...definition.matchAll(/\bschemaLocation\s*=\s*["']([^"']+)["']/g)]
    .map(match => match[1]);
  for (const location of locations) {
    assert.match(location, /^[A-Za-z0-9_.-]+\.xsd$/, "External schema references forbidden");
    assert.ok(Object.hasOwn(data, "memory:///schemas/" + location),
      `Dangling schema dependency ${virtualUrl} => ${location}`);
  }
}
const provider = new XmlBufferInputProvider(data);
assert.equal(xmlRegisterInputProvider(provider), true, "Memory-only XML provider registration failed");

const start = performance.now();
let schema = null;
let validator = null;
try {
  schema = XmlDocument.fromBuffer(data["memory:///schemas/" + primary], {
    url:"memory:///schemas/" + primary,
  });
  assert.equal(schema.warnings.length, 0, "Schema XML parser warnings");
  validator = XsdValidator.fromDoc(schema);

  const original = readFileSync(candidatePath, "utf8");
  assert.ok(!/<!DOCTYPE|<!ENTITY/i.test(original), "DTD forbidden in candidate XML");
  assert.ok(original.length > 200 && original.length < 2_000_000,
    "Unexpected XML fixture size");

  function check(xml, expectedValid, label) {
    let doc = null;
    try {
      // Fail to parse is NOT accepted as proof that the XSD rejected an XML.
      doc = XmlDocument.fromBuffer(encoding.encode(xml), {
        url: "memory:///invoices/synthetic-cii.xml",
      });
      assert.equal(doc.warnings.length, 0, `${label} XML parser warnings`);
      let rejected = false;
      let failure = "";
      try {
        validator.validate(doc);
      } catch (error) {
        rejected = true;
        failure = String(error?.message ?? error);
      }
      if (expectedValid) {
        assert.equal(rejected, false, `${label} must pass official XSD: ${failure}`);
      } else {
        assert.equal(rejected, true, `${label} must fail official XSD`);
      }
      console.log(`PASS: ${label} ${rejected ? "rejected" : "accepted"} by XSD`);
    } finally {
      doc?.dispose();
    }
  }

  check(original, true, "genuine TypeScript synthetic CII");
  function mutate(from, label) {
    const changed = original.replace(from, "");
    assert.notEqual(changed, original, `Fixture node not found for ${label}`);
    check(changed, false, label);
  }
  // Both are well-formed XML, but structurally violate required schema nodes.
  mutate(/<rsm:ExchangedDocument>[\s\S]*?<\/rsm:ExchangedDocument>/,
    "missing ExchangedDocument");
  mutate(/<ram:SpecifiedTradeSettlementHeaderMonetarySummation>[\s\S]*?<\/ram:SpecifiedTradeSettlementHeaderMonetarySummation>/,
    "missing header monetary summary");

  const consumed = Math.round(performance.now() - start);
  console.log(`PASS: ${files.length} pinned official XSDs, memory-only resolution, ${consumed}ms`);
  console.log(`Node memory usage (MB): ${Math.round(process.memoryUsage().rss/1_048_576)} RSS`);
  console.log("NOTE: XSD-only. Official Schematron, on-device iPhone and PDF/A-3 remain unverified.");
} finally {
  validator?.dispose();
  schema?.dispose();
}
