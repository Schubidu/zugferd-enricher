# ZUGFeRD export gates (Issue #5)

Status: **implementation foundation only; export deliberately unavailable**.

Target specification: [FeRD ZUGFeRD 2.5.2 / Factur-X 1.09.2](https://www.ferd-net.de/publikationen-produkte/publikationen/detailseite/zugferd-252-deutsch), applicable since 2026-09-01. Obtain the official release package, profile-specific XSD/Schematron, codelists and terms before bundling conformance resources.

## Non-negotiable trust boundary

The input PDF is an invoice supplied by **another issuer**. A derivative processing copy is not a newly issued or corrected invoice from that issuer. The original bytes must remain independently available and unchanged. Do not insert internal category labels, expense-policy decisions, derived tax splits or missing facts into structured invoice XML.

A PDF.js text extraction is a **candidate** representation. A matching arithmetic sum does not prove it recognized every visible charge. The original PDF is the authority for which facts were printed; model probabilities are not.

## Pipeline and gates

1. **Source fidelity (implemented in `src/export/preflight.ts`).** Retain a separate, immutable snapshot of the initial PDF extraction. Compare source lines, fields, positions, taxes, amounts and evidence IDs against reviewed values. Re-run deterministic extraction against the original source lines rather than trusting an `origin: "pdf"` flag. Even unchanged values entered manually remain unverified.
2. **Semantic completeness (currently blocked).** Extract and independently verify required EN 16931 facts, including seller and buyer postal addresses/countries, currency code (BT-5), document type (BT-3), invoice ID/date, the amount basis and the **invoice-line VAT category** (BT-151). A percentage such as 19% is not itself a VAT-category code. A third-party city-tax pass-through is not automatically a zero-rated or VAT-exempt invoice line.
3. **Faithful structured XML (internal candidate implemented; no export).** `src/export/cii-evidence.ts` extracts a deliberately narrow, explicitly labelled subset of additional PDF facts (currency, invoice type, seller/buyer addresses, seller tax ID, payable amount, per-line category and unit code). `src/export/cii-candidate.ts` can assemble a CII EN16931 XML **candidate only** when it also has evidence-backed invoice fields and complete exact-cent/quantity/tax reconciliation. Arbitrary supplier PDFs do not yet meet this strict input model; a printed tax rate is not sufficient to assign category S. Neither generation nor XML parsing is equivalent to official validation. No XML is exposed for download.
4. **Independent conformance checks (not implemented).** Validate XML syntax, version/profile-specific XSD and Schematron/business rules (including applicable German rules); independently verify PDF/A-3 using a conforming validator, plus Factur-X/ZUGFeRD PDF attachment metadata. Never conflate XML business-rule success with PDF/A-3 success.
5. **Original-to-derivative fidelity (not implemented).** Compare the visible source PDF facts against embedded XML (parties, identifiers, dates, items, rates, tax groups and totals); verify derivative visual content and preserve the supplier's visible invoice where feasible. Fail closed for unsupported fonts, color spaces, transparency or any lossy conversion.
6. **Export (not implemented).** Only after every gate succeeds, offer a clearly labelled **derivative processing copy** alongside the unchanged original. Don't imply issuer approval or correction.

The internal XML candidate serializer may be tested without changing the release boundary. **No downloadable XML, `Blob`, derivative PDF or UI export action** may be introduced until all independent schema/business-rule, PDF/A-3, full-document coverage and original/XML fidelity gates are wired into a single fail-closed release decision.

## Implementation notes

- `assessExportPreflight(original, reviewed)` always returns `exportAllowed: false` by design, even for an internally generated `status: "unvalidated"` CII candidate. Evidence-backed mandatory fields can clear **specific** semantic blockers, never the independent conformance and visual-fidelity blockers. A clean source-alignment check is **not** export readiness.
- When the export pipeline is eventually integrated, the caller must retain the initial extraction separately from mutable review state and keep the original bytes. This slice does not yet wire a new UI or mutable source snapshot.
- Future rules and validation resources must be pinned and licensed. Candidate offline validators include [Mustangproject](https://github.com/ZUGFeRD/mustangproject) (Apache 2.0) and [veraPDF](https://verapdf.org/). Evaluate a genuine **browser-local** implementation and memory performance; do not upload invoices to an online validator.
- Test with synthetic invoices including TEST-01, TEST-02 and TEST-05, ambiguous taxes, missing parties, non-EUR currency, mixed VAT groups, scans, corrupted PDF, fonts/color profiles and manually corrected values. Test actual PDF/A-3 output with an independent validator; unit tests alone are never sufficient.

## Open questions for subsequent increments

- What local runtime produces standards-conformant PDF/A-3 from arbitrary existing PDFs while preserving their visible appearance? **Not selected.** A naive PDF attachment to the original does not turn it into PDF/A-3.
- How to acquire, ship and update official ZUGFeRD 2.5.2 validation resources under their licence terms. **Not selected.**
- How to capture full party addresses, invoice type, currency and original line-net bases with dependable evidence; existing `InvoiceDraft` intentionally lacks them.

## CII candidate limitations (2026-11-16)

- Current parser accepts **only** single, uniquely printed, explicitly labelled lines for: `Rechnungswährung: EUR`, `Rechnungstypcode: 380`, `Zahlbetrag: ...`, each separate seller/buyer address field and the seller's `Aussteller USt-ID`. This first slice does **not** guess data from "€", company names, current locale, a printed "Rechnung" heading or source VAT rates.
- Per-line VAT category `S` and unit `C62` require explicit PDF wording identifying the **exact description and amount** of the matching position. The code never derives either one from internal classifications. Any unallocated bundled service, third-party no-VAT Kurtaxe, unknown pricing basis, missing net unit price, conflicting reference, unknown currency/type or unsupported VAT arrangement blocks the candidate.
- The builder independently checks line quantity × net unit price, rate-specific group nets, calculated VAT, printed totals, and the separately printed amount due, all in integer cents. It does not create balancing rows or reverse-engineer allocations from tax totals. XML text is escaped; illegal XML 1.0 characters block instead of being silently replaced.
- Current synthetic `cii-candidate.test.ts` exercises the narrow positive fixture, XML parsing, two VAT rates, XML special characters, and deliberate blockers. **No official XSD or Schematron has been executed**; a browser-generated well-formed XML candidate is not a compliant ZUGFeRD invoice.
- No output appears in the app: the owner-approved compact preview and the original PDF remain unchanged. The next slice requires official 2.5.2 validation resources and a browser-local independent validator, followed by a faithful PDF/A-3 derivative renderer and independent veraPDF-class verification. A valid CII fragment alone is not a complete EN16931 validation result.

## Independent synthetic XML validation in CI

- `.github/workflows/cii-validation.yml` runs on affected PR changes using **Mustangproject 2.26.0** (Apache 2.0) fetched over HTTPS from Maven Central, with a **pinned SHA-256 digest**. No invoice bytes or user information are transferred; the synthetic fixture is produced by the TypeScript renderer in a GitHub runner.
- The validator applies the bundled ZUGFeRD 2.5.2 EN 16931 **XSD and Schematron** profile. The positive fixture must validate with **no XML warnings**. A second, intentionally corrupted grand total must fail independent validation; a green result without both controls is not accepted.
- Independent source checks remain important: even a validator-green XML cannot establish correct recognition of the visible original invoice, full coverage of every charge, issuer authorization, or PDF/A-3 packaging. CI is a **development-time oracle**, not a hidden server processor or runtime validator for user PDFs.
- For runtime delivery, an **on-device** browser-compatible XSD/Schematron implementation using pinned official FeRD 2.5.2 resources must still be selected and independently tested. **Never** call a remote public validation endpoint with an invoice.
- The independently validated synthetic fixture requires an **explicitly printed delivery/service date**; emitting an empty delivery node is rejected by the no-warnings gate. Missing or conflicting source service dates block instead of being copied from the invoice date.

## Browser-local fidelity prerequisites

- `src/export/xml-source-match.ts` parses the internally generated CII XML **again**, independently of the serializer, with the platform `DOMParser`. It checks the **mapped subset** of source-backed invoice IDs, dates, seller/buyer names, postal addresses and seller tax registration, line descriptions and IDs, units, quantities, net prices, VAT rates/categories, tax-group bases/taxes and all invoice totals. Missing/duplicated core fields, tampered text, wrong namespaces, malformed/DTD-bearing XML, extra invoice lines or contradictory amounts fail closed. The internal CII candidate builder rejects such mismatches.
- The result is deliberately labelled `matched-subset`, **not valid/fully verified**. A PDF.js extraction can omit visible charges. Official profile-specific XSD and Schematron are still required locally; CI Mustang validation of synthetic XML is not a browser capability.
- `src/export/pdf-text-fidelity.ts` independently compares the original and a future derivative's PDF.js page count, page sizes, extractable text and text-run coordinates. The future PDF/A converter must preserve these properties. A match is labelled `matched-text-layout` **only**; images, background graphics, overlays, vector shapes, color profiles, fonts, PDF/A rules and general rendered visual equivalence still require separate checks.
- Neither checker sends PDF contents to a server or produces a `Blob`/download. Both are prerequisites to, never substitutes for, a full offline export gate.

### Browser XSD/Schematron feasibility — not yet bundled

- **XSD**: [libxml2-wasm](https://github.com/jameslan/libxml2-wasm) is an MIT-licensed browser-compatible WebAssembly candidate. Its `XsdValidator` can validate documents against schemas; virtual-IO support for imported/included XSDs is marked experimental. Before adding a runtime dependency, demonstrate resolution of **every pinned official FeRD 2.5.2 EN16931 schema import** (including remote network references disabled), memory behavior and zero-false-positive acceptance against the independent Mustang CI oracle.
- **Schematron**: XSLT 2.0/3.0 support is required; the browser's built-in XSLT 1.0 engine is insufficient. [SaxonJS](https://www.saxonica.com/html/saxonjs/index.html) is browser-capable but **not Open Source**; evaluate its redistribution terms, compiling/packaging official stylesheets, and offline iPhone/Safari behavior before a selection. An untested hand-coded approximation of Schematron rules is not acceptable.
- **Acceptance:** Feed the same pinned positive and intentionally invalid CII fixtures to both the local engine and Mustang. Fail if either differs on schema errors or business-rule failures. Independently check on iPhone/Safari; no fallback to a cloud validator.


## Browser pixel parity (strict prerequisite)

- `src/export/pdf-render-fidelity.ts` compares PDF.js-rendered **RGBA pixels**, page by page, from the original PDF and a prospective derivative on the same device. Any changed channel, missing page, page-size mismatch, unsupported canvas or failed render is a blocking mismatch. A missing renderer is **not** considered visual approval.
- On mobile, each canvas is capped at **1.5 million pixels** and immediately released after its page is compared; no more than one page is rendered at a time. Pages requiring rendering below scale 1, or more than 150 pages, are unsupported and must fail closed. `AbortSignal` cancels pending PDF.js work when the user changes documents.
- This is intentionally conservative: **subtle font hinting/antialiasing changes can produce a mismatch even when the source text matches**. A future decision to permit any tolerance needs a separately justified, adversarially tested acceptance policy. Do not silently reduce the tolerance threshold until conversions become green.
- `comparePdfVisibleFidelity` executes both `comparePdfTextFidelity` and `comparePdfRenderFidelity` in sequence, failing closed if either returns a mismatch. Its success is deliberately called `matched-prerequisites`, not export approval. The export pipeline must *also* pass source-to-XML checks, independently valid XSD/Schematron and independently verified PDF/A-3. Matching sampled rendered pixels is not proof of color-profile fidelity, vector semantics, hidden overlays, image accessibility, signatures, or complete extracted original facts.
- CI uses **Poppler PPM raster reports** as an independent diagnostic, separately from the browser PDF.js renderer. Rendering at one DPI may agree and another may differ. The CI experiment reports exact per-pixel differences instead of claiming a PDF/A-3 container has passed every visual-fidelity gate.
