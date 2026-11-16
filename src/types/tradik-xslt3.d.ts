/**
 * Minimal audited public API surface of @tradik/xslt3 1.0.0.
 * The package currently ships JavaScript without TypeScript declarations.
 * This is an interface contract for the methods used by the offline
 * EN16931 Schematron runner, not a type assertion for XML validity.
 */
declare module "@tradik/xslt3" {
  export type XmlLoader = (uri: string, baseUri?: string) => string | Document;

  export interface CompileStylesheetOptions {
    parseXml: (text: string) => Document;
    baseUri?: string;
    loadStylesheet?: XmlLoader;
    documentLoader?: XmlLoader;
  }

  export interface TransformOptions {
    source: Document;
    dynamicEvaluation?: boolean;
    documentLoader?: XmlLoader;
  }

  export interface TransformationResult {
    principal: unknown;
    output: unknown;
  }

  export interface CompiledStylesheet {
    transform(options: TransformOptions): TransformationResult;
  }

  export function compileStylesheet(
    stylesheet: string,
    options: CompileStylesheetOptions,
  ): CompiledStylesheet;

  export function serialize(nodes: unknown[], output: unknown): string;
}
