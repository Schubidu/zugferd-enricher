import { DOMParser } from "@xmldom/xmldom";
import {
  XmlBufferInputProvider, XmlDocument, XsdValidator, xmlRegisterInputProvider,
} from "libxml2-wasm";
import { compileStylesheet, serialize } from "@tradik/xslt3";
import type { ValidatorResourceName, ValidatorResources } from "./validator-assets";

/**
 * Local EN16931 validation of a CII XML candidate. This does not establish
 * any PDF/A-3 or full original-invoice fidelity and never enables export.
 */
export type LocalXmlValidation =
  | {status: "valid-xml-only"; checkedProfiles: 2}
  | {status: "invalid"; failures: string[]}
  | {status: "unavailable"; reason: string};

const RULES = [
  "EN16931-CII-validation.xslt",
  "FACTUR-X_EN16931.xslt",
] as const;
const SVRL = "http://purl.oclc.org/dsdl/svrl";
const PRIMARY_SCHEMA = "FACTUR-X_EN16931.xsd";
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder("utf-8", {fatal:true});
const MAX_XML_LENGTH = 2_000_000;

function safeInput(xml: string) {
  if (xml.length < 50 || xml.length > MAX_XML_LENGTH ||
    /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("Unsupported or unsafe CII XML");
  }
}
function parseXml(xml: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("DTD prohibited");
  const parser = new DOMParser({
    errorHandler: {
      warning: message => {throw new Error("XML warning: " + message);},
      error: message => {throw new Error("XML error: " + message);},
      fatalError: message => {throw new Error("Invalid XML: " + message);},
    },
  });
  const doc = parser.parseFromString(xml,"application/xml");
  if (!doc || !doc.documentElement || doc.getElementsByTagName("parsererror").length) {
    throw new Error("Malformed XML");
  }
  return doc as unknown as Document;
}
function asResource(resources: ValidatorResources, name: ValidatorResourceName): string {
  const bytes = resources.get(name);
  if (!bytes) throw new Error("Missing verified rule: " + name);
  return DECODER.decode(bytes);
}

/**
 * Schematron document lookups and stylesheet imports are resolved from a
 * strict allowlist, not from the network, filesystem or arbitrary paths.
 */
function localResource(uri: string, resources: ValidatorResources): ValidatorResourceName {
  if (!/^(?:[A-Za-z0-9_.-]+\.(?:xslt|xml)|memory:\/\/\/schematron\/[A-Za-z0-9_.-]+\.(?:xslt|xml))$/.test(uri)) {
    throw new Error("External stylesheet reference forbidden");
  }
  const file = uri.substring(uri.lastIndexOf("/") + 1);
  if (file !== "FACTUR-X_EN16931.xslt" &&
    file !== "EN16931-CII-validation.xslt" &&
    file !== "FACTUR-X_EN16931_codedb.xml") {
    throw new Error("Unknown stylesheet document: " + file);
  }
  if (!resources.has(file)) throw new Error("Missing stylesheet document: " + file);
  return file;
}

/**
 * One-shot validation scoped to the calling Worker. WASM resources are
 * disposed in finally; the Worker is terminated after each request.
 */
export function validateCiiXmlLocally(xml: string, resources: ValidatorResources): LocalXmlValidation {
  try {
    safeInput(xml);
    const xmlBytes = ENCODER.encode(xml);
    const xsdFiles = Object.fromEntries(
      [...resources].filter(([name]) => name.endsWith(".xsd"))
        .map(([name,bytes]) => ["memory:///schemas/" + name, bytes]),
    );
    if (Object.keys(xsdFiles).length !== 4) throw new Error("Incomplete XSD bundle");
    const provider = new XmlBufferInputProvider(xsdFiles);
    if (!xmlRegisterInputProvider(provider)) throw new Error("Cannot initialize XSD resolver");

    let schema: XmlDocument | null = null;
    let candidate: XmlDocument | null = null;
    let validator: XsdValidator | null = null;
    try {
      schema = XmlDocument.fromBuffer(xsdFiles["memory:///schemas/" + PRIMARY_SCHEMA]!, {
        url:"memory:///schemas/" + PRIMARY_SCHEMA,
      });
      if (schema.warnings.length) throw new Error("Schema XML parser warnings");
      validator = XsdValidator.fromDoc(schema);
      candidate = XmlDocument.fromBuffer(xmlBytes, {
        url:"memory:///invoices/candidate.xml",
      });
      if (candidate.warnings.length) throw new Error("Invoice XML parser warnings");
      try {
        validator.validate(candidate);
      } catch {
        return {status:"invalid",failures:["XSD_SCHEMA_VIOLATION"]};
      }
    } finally {
      candidate?.dispose();
      validator?.dispose();
      schema?.dispose();
    }

    const xmlDocument = parseXml(xml);
    const cache = new Map<string,Document>();
    const loadText = (uri: string): string =>
      asResource(resources, localResource(uri,resources));
    const loadDocument = (uri: string): Document => {
      const file = localResource(uri,resources);
      if (!cache.has(file)) cache.set(file,parseXml(asResource(resources,file)));
      return cache.get(file)!;
    };

    const failures: string[] = [];
    for (const name of RULES) {
      const compiled = compileStylesheet(asResource(resources,name),{
        parseXml,
        baseUri:"memory:///schematron/" + name,
        loadStylesheet:loadText,
        documentLoader:loadDocument,
      });
      const transformation = compiled.transform({
        source:xmlDocument,
        dynamicEvaluation:false,
        documentLoader:loadDocument,
      });
      const reportXml = serialize([transformation.principal].flat(),transformation.output);
      const report = parseXml(reportXml);
      const root = report.documentElement;
      if (!root || root.namespaceURI !== SVRL || root.localName !== "schematron-output") {
        throw new Error("Not a Schematron report");
      }
      const fired = report.getElementsByTagNameNS(SVRL,"fired-rule");
      if (fired.length === 0) throw new Error("No Schematron rules executed");
      const invalid = Array.from(report.getElementsByTagNameNS(SVRL,"failed-assert"));
      // Treat warnings conservatively until severity mapping is cross-checked.
      const warnings = report.getElementsByTagNameNS(SVRL,"successful-report");
      if (warnings.length > 0) failures.push(name + ":UNCLASSIFIED_WARNING");
      failures.push(...invalid.map(node =>
        name + ":" + (node.getAttribute("id") || "UNNAMED_ASSERTION")));
    }
    return failures.length
      ? {status:"invalid",failures}
      : {status:"valid-xml-only",checkedProfiles:2};
  } catch (error) {
    return {status:"unavailable",reason:String(error instanceof Error ? error.message : error)};
  }
}
