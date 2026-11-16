# ZUGFeRD export gates (Issue #5)

Status: **implementation foundation only; export deliberately unavailable**.

Target specification: [FeRD ZUGFeRD 2.5.2 / Factur-X 1.09.2](https://www.ferd-net.de/publikationen-produkte/publikationen/detailseite/zugferd-252-deutsch), applicable since 2026-09-01. Obtain the official release package, profile-specific XSD/Schematron, codelists and terms before bundling conformance resources.

## Non-negotiable trust boundary

The input PDF is an invoice supplied by **another issuer**. A derivative processing copy is not a newly issued or corrected invoice from that issuer. The original bytes must remain independently available and unchanged. Do not insert internal category labels, expense-policy decisions, derived tax splits or missing facts into structured invoice XML.

A PDF.js text extraction is a **candidate** representation. A matching arithmetic sum does not prove it recognized every visible charge. The original PDF is the authority for which facts were printed; model probabilities are not.

## Pipeline and gates

1. **Source fidelity (implemented in `src/export/preflight.ts`).** Retain a separate, immutable snapshot of the initial PDF extraction. Compare source lines, fields, positions, taxes, amounts and evidence IDs against reviewed values. Re-run deterministic extraction against the original source lines rather than trusting an `origin: "pdf"` flag. Even unchanged values entered manually remain unverified.
2. **Semantic completeness (currently blocked).** Extract and independently verify required EN 16931 facts, including seller and buyer postal addresses/countries, currency code (BT-5), document type (BT-3), invoice ID/date, the amount basis and the **invoice-line VAT category** (BT-151). A percentage such as 19% is not itself a VAT-category code. A third-party city-tax pass-through is not automatically a zero-rated or VAT-exempt invoice line.
3. **Faithful structured XML (not implemented).** Map only source-verified facts to the appropriate CII/EN 16931 profile. Reconcile each source line and tax breakdown in exact decimal arithmetic. Do not manufacture separate lines, tax bases or amounts when source evidence is incomplete.
4. **Independent conformance checks (not implemented).** Validate XML syntax, version/profile-specific XSD and Schematron/business rules (including applicable German rules); independently verify PDF/A-3 using a conforming validator, plus Factur-X/ZUGFeRD PDF attachment metadata. Never conflate XML business-rule success with PDF/A-3 success.
5. **Original-to-derivative fidelity (not implemented).** Compare the visible source PDF facts against embedded XML (parties, identifiers, dates, items, rates, tax groups and totals); verify derivative visual content and preserve the supplier's visible invoice where feasible. Fail closed for unsupported fonts, color spaces, transparency or any lossy conversion.
6. **Export (not implemented).** Only after every gate succeeds, offer a clearly labelled **derivative processing copy** alongside the unchanged original. Don't imply issuer approval or correction.

No `Blob`, PDF download, XML serialiser or UI export button should be introduced until the conformance and fidelity gates exist and are wired into a single fail-closed release decision.

## Implementation notes

- `assessExportPreflight(original, reviewed)` currently returns `exportAllowed: false` by design. A clean source-alignment check is **not** export readiness; blockers are grouped by source, semantics and conformance.
- When the export pipeline is eventually integrated, the caller must retain the initial extraction separately from mutable review state and keep the original bytes. This slice does not yet wire a new UI or mutable source snapshot.
- Future rules and validation resources must be pinned and licensed. Candidate offline validators include [Mustangproject](https://github.com/ZUGFeRD/mustangproject) (Apache 2.0) and [veraPDF](https://verapdf.org/). Evaluate a genuine **browser-local** implementation and memory performance; do not upload invoices to an online validator.
- Test with synthetic invoices including TEST-01, TEST-02 and TEST-05, ambiguous taxes, missing parties, non-EUR currency, mixed VAT groups, scans, corrupted PDF, fonts/color profiles and manually corrected values. Test actual PDF/A-3 output with an independent validator; unit tests alone are never sufficient.

## Open questions for subsequent increments

- What local runtime produces standards-conformant PDF/A-3 from arbitrary existing PDFs while preserving their visible appearance? **Not selected.** A naive PDF attachment to the original does not turn it into PDF/A-3.
- How to acquire, ship and update official ZUGFeRD 2.5.2 validation resources under their licence terms. **Not selected.**
- How to capture full party addresses, invoice type, currency and original line-net bases with dependable evidence; existing `InvoiceDraft` intentionally lacks them.
