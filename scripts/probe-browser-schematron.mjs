#!/usr/bin/env node
/**
 * Feasibility of BSD-3-Clause @tradik/xslt3 against the *exact official*
 * EN16931 profile/CEN Schematron XSLTs bundled in pinned Mustang 2.26.0.
 *
 * Non-production test fixture. Under NO circumstances treat successful
 * stylesheet compilation or a blank SVRL as certified rule validation.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";
import { compileStylesheet, serialize } from "@tradik/xslt3";

const [sourceDirectory, syntheticPath] = process.argv.slice(2);
if (!sourceDirectory || !syntheticPath) {
  throw new Error("Usage: node scripts/probe-browser-schematron.mjs <xslt-folder> <synthetic.xml>");
}
const parser = new JSDOM("").window.DOMParser;
function parseXml(input) {
  const result = new parser().parseFromString(input, "application/xml");
  assert.equal(result.getElementsByTagName("parsererror").length, 0,
    "XML parser error (a malformed stylesheet or output is never a valid rule result)");
  return result;
}
const input = readFileSync(syntheticPath,"utf8");
assert.ok(input.includes("<ram:GrandTotalAmount>190.40</ram:GrandTotalAmount>"),
  "Expected synthetic fixture missing");
assert.ok(!/<!DOCTYPE|<!ENTITY/i.test(input), "Untrusted XML with DTD is forbidden");

const files = readdirSync(sourceDirectory).filter(name => /\.(xml|xslt|xsl)$/.test(name));
const resources = new Map(files.map(name => [name,readFileSync(join(sourceDirectory,name),"utf8")]));
const rules = ["FACTUR-X_EN16931.xslt","EN16931-CII-validation.xslt"];
for(const name of rules) assert.ok(resources.has(name), "Missing official rule file " + name);

function loadFromMemory(uri, baseUri = "") {
  if (typeof uri !== "string") throw new Error("Invalid stylesheet resource name");
  const leaf = basename(uri);
  if (!/^[A-Za-z0-9_.-]+\.(xml|xsl|xslt)$/.test(uri) &&
    !/^memory:\/\/\/schematron\/[A-Za-z0-9_.-]+\.(xml|xsl|xslt)$/.test(uri)) {
    throw new Error("External stylesheet resources forbidden: " + uri + " base " + baseUri);
  }
  const found = resources.get(leaf);
  if (found === undefined) throw new Error("Missing pinned stylesheet resource: " + leaf);
  return found;
}
const source = parseXml(input);
const corrupted = parseXml(input.replace(
  "<ram:GrandTotalAmount>190.40</ram:GrandTotalAmount>",
  "<ram:GrandTotalAmount>190.41</ram:GrandTotalAmount>",
));
let sawOfficialBusinessRule = false;

for(const stylesheetName of rules) {
  const start = performance.now();
  const stylesheet = compileStylesheet(resources.get(stylesheetName), {
    parseXml,
    baseUri:"memory:///schematron/" + stylesheetName,
    loadStylesheet:loadFromMemory,
    documentLoader:loadFromMemory,
  });
  const check = (document,label) => {
    const transformation = stylesheet.transform({
      source:document, dynamicEvaluation:false,
      documentLoader:loadFromMemory,
    });
    const xml = serialize([transformation.principal].flat(),transformation.output);
    const report = parseXml(xml);
    const root = report.documentElement;
    assert.equal(root.localName,"schematron-output",
      "A transform without a real SVRL report must NEVER be accepted");
    assert.equal(root.namespaceURI,"http://purl.oclc.org/dsdl/svrl");
    const assertions = [...report.getElementsByTagNameNS(
      "http://purl.oclc.org/dsdl/svrl","failed-assert",
    )];
    const fired = report.getElementsByTagNameNS(
      "http://purl.oclc.org/dsdl/svrl","fired-rule",
    );
    assert.ok(fired.length > 0,"A zero-rule/no-op result must never be accepted");
    const ids = assertions.map(item => item.getAttribute("id")??"no-id");
    if (label === "valid") {
      assert.equal(assertions.length,0,
        stylesheetName + ": synthetic positive fixture produces false failures: " + ids.slice(0,10));
    } else if (ids.some(id => /^BR-CO-(?:15|16)$/.test(id))) {
      sawOfficialBusinessRule = true;
    }
    console.log("SCHEMATRON:",stylesheetName,label,"rules:",fired.length,"failed:",ids.length,
      "examples:",ids.slice(0,5).join(","));
  };
  check(source,"valid");
  check(corrupted,"invalid");
  console.log("COMPILATION/MS",stylesheetName,Math.round(performance.now()-start));
}
assert.equal(sawOfficialBusinessRule,true,
  "Corrupted invoice total must trigger real BR-CO-15/16 in the official CEN rules");
console.log("PASS: both official Schematron transforms, source memory only, independent positive/negative parity");
