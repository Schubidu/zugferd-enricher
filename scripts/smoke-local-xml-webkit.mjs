#!/usr/bin/env node
/**
 * Real WebKit browser + dedicated-worker probe. Synthetic invoice only.
 * Does not rely on a REST validator and must never send the XML elsewhere.
 */
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import {readFileSync} from "node:fs";
import {URL} from "node:url";
import {webkit} from "playwright";

const file = process.argv[2];
assert.ok(file,"Pass synthetic CII fixture filename");
const original = readFileSync(file,"utf8");
const changed = original.replace(
  "<ram:GrandTotalAmount>190.40</ram:GrandTotalAmount>",
  "<ram:GrandTotalAmount>190.41</ram:GrandTotalAmount>",
);
assert.notEqual(changed,original,"Negative fixture mutation failed");

const origin = "http://127.0.0.1:5173";
const browser = await webkit.launch({headless:true});
try {
  const page = await browser.newPage();
  const outside = [];
  const browserErrors = [];
  page.on("pageerror",error => browserErrors.push(error.message));
  page.on("console",message => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("request",request => {
    if (new URL(request.url()).origin !== origin) outside.push(request.url());
  });
  await page.route("**/*",route => {
    if (new URL(route.request().url()).origin !== origin) {
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  await page.goto(origin,{waitUntil:"load"});

  async function validate(xml) {
    return page.evaluate(async payload => {
      const {validateCiiXmlInBrowser} =
        await import("/src/export/local-xml-validator.ts");
      return validateCiiXmlInBrowser(payload);
    },xml);
  }
  const accepted = await validate(original);
  console.log("WEBKIT positive:",JSON.stringify(accepted));
  assert.deepEqual(accepted,{status:"valid-xml-only",checkedProfiles:2},
    "Real WebKit must accept source-faithful synthetic EN16931 XML");

  const rejected = await validate(changed);
  console.log("WEBKIT tampered gross:",JSON.stringify(rejected));
  assert.equal(rejected.status,"invalid");
  assert.ok(rejected.failures.some(item => item.includes("BR-CO-15")),
    "Official EN16931 business rules did not detect the changed grand total");

  const dtd = await validate("<!DOCTYPE a>" + original);
  assert.equal(dtd.status,"invalid");
  assert.deepEqual(outside,[],"Unexpected external network request");
  assert.deepEqual(browserErrors,[],"WebKit worker or resource errors");
  console.log("PASS: real WebKit worker uses bundled XSD and both Schematron profiles without external network");
} finally {
  await browser.close();
}
