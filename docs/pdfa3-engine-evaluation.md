# Local PDF/A-3 engine feasibility (Issue #5)

Status: **unselected**. We must not ship a conversion engine based on README claims alone. The app is a MIT-licensed browser SPA with a strict no-upload promise.

## Requirements

1. Run entirely inside the browser (prefer a dedicated Web Worker). No PDF/metadata upload, localhost service dependency or third-party CDN request at inference time.
2. Accept the actual input PDF bytes and produce a **visually faithful** PDF/A-3 processing copy. Keep the original bytes untouched and independently available.
3. Preserve pagination, text, vector content and embedded fonts where possible. Any unavoidable rasterization or loss of semantic/text accessibility is a review/fail condition; visual similarity alone is not enough.
4. Embed the version-appropriate `factur-x.xml` with correct AFRelationship, MIME type, XMP and Factur-X profile metadata. Do not attach internal XML candidates.
5. Pass **independent** PDF/A-3 verification and FeRD 2.5.2 EN16931 XSD/Schematron, plus semantic source-PDF/XML comparison. The PDF generator's own `ok` response is never sufficient.
6. Explicitly verify dependency licences, transitive licences, bundled font rights, integrity-pinned WASM artifacts, browser memory and iPhone/Safari performance.

## Candidate comparison

| Candidate | Present evidence | Decision |
| --- | --- | --- |
| [BentoPDF Kura](https://github.com/alam00000/bentopdf-kura) | Claims browser WASM, PDF/A-3 variants, preflight and Factur-X embedding; conversion API available. **AGPL-3.0** or commercial licence. | **Evaluate** in an isolated proof of concept, not directly in the MIT app. Legal distribution/reciprocity and separate independent checks required. |
| [pdf-lib](https://pdf-lib.js.org/) | Useful PDF editing/attachment primitives. Cannot by itself establish archival PDF/A-3 compliance. | **Not a PDF/A-3 converter**. |
| [pdftopdfa](https://github.com/iRedPaul/pdftopdfa) | Claims PDF/A-2/3, direct content-preserving conversion via pikepdf/QPDF, MPL-2.0-or-later. Python/native pipeline, no verified browser WASM path. | **Alternative research**, not a browser implementation. |
| [veraPDF](https://docs.verapdf.org/validation/) | Independent open-source PDF/A-3 implementation checker, Java-based; valuable for CI and test fixtures. | **Reference oracle for CI**; its REST demo is **not** permitted because it uploads files. A browser-local independent validator still needs selection and proof. |

Sources: readme/official project pages checked 2026-11-16. Claims are not acceptance evidence. Licence review is required before packaging, including whether an AGPL library may be combined/distributed with our MIT application under our desired licence policy.

## Minimal evaluation plan

- Acquire only the pinned source and official release artifacts after licence review. Keep the WASM prototype separate from the main dependency graph.
- Convert the five **unaltered synthetic source PDFs** to PDF/A-3 **without XML** first and verify every result independently with veraPDF. Record file/page size, font/ICC repair findings and output hashes; fail for unconvertible documents.
- Compare original and derivative PDF rendering page by page at fixed scale, extract text from both and verify readable/semantic content. Detect disappearing or added charges, mis-sized pages and changed amounts.
- Test the WASM pipeline on real iPhone/Safari for initialization time, memory cap, cancellation, and cleanup after repeated PDF selection. No fallback to remote processing.
- Only then add a fully independently validated XML attachment, XMP mapping and source-to-XML content fidelity, with a single fail-closed export release decision.

This document is an **evaluation record**, not an engine commitment and not proof of PDF/A-3 support.

## Reproducible CI experiment (2026-11-16)

**Result: synthetic-only container mechanics confirmed; browser support not confirmed.**

`.github/workflows/pdfa3-feasibility.yml` creates a deterministic one-page text PDF with `scripts/make_synthetic_pdf.py` and produces the independently tested CII XML from the real TypeScript candidate builder. No invoice from an external issuer is used.

1. Ghostscript in the isolated GitHub runner converts the synthetic input to PDF/A-3b with a supplied sRGB ICC output intent and `-dPDFACompatibilityPolicy=2`, which aborts conversion on unsupported PDF/A constructs. The ICC profile is explicitly permitted for reading under Ghostscript's safety sandbox.
2. Independent **veraPDF 1.30.4** (Docker image `docker.io/verapdf/cli@sha256:f085855d442ad415e79fabbabcdd1803c2db4ee097cd5b94506c95ecdcfa1728`) validates the PDF/A-3b input. It also **rejects the original non-archival PDF** as a negative control.
3. Mustangproject CLI **2.26.0** (HTTPS + pinned SHA-256 jar) embeds the independently validated EN16931 CII into the PDF/A-3 using `--action combine --format zf --version 2 --profile E`. The output is validated again with veraPDF 3b and Mustang (both PDF and XML statuses must be valid).
4. The XML is extracted again and compared **byte-for-byte** with the generated XML; Poppler's page text extraction must be equal before and after converting and embedding.

The first passing proof run is [PDF/A-3 feasibility #43839771612](https://github.com/Schubidu/zugferd-enricher/actions/runs/43839771612); the pinned-image rerun is separately required for reproducibility.

**Limits:** This is a *CI experiment*, not a runtime implementation. Ghostscript is **AGPL-3.0**, invoked only as a separate development-time test tool, **not** bundled in the MIT app. Neither the Java Mustang CLI nor Docker veraPDF runs in the user's browser. A successful veraPDF result does not prove that an **arbitrary supplier invoice** was faithfully converted: real source fonts, colors, transparency, forms, annotations, images and page rendering still need independent visible-output checks. The synthetic PDF is only one page; exact equality of its extracted text does not prove pixel or semantic source completeness. No e-invoice is downloadable from the app.

### Next decisions

- **Rendering/conversion engine:** Demonstrate a browser/WASM PDF/A-3b conversion of existing invoices, with suitable open-source/redistribution licence. Never assume the CI-only Ghostscript pipeline is an acceptable client implementation.
- **FeRD resources:** Acquire the official version 2.5.2 EN16931 validation bundle under its download conditions. Test the exact XSD/Schematron packages locally and against Mustang's CI oracle on both valid and corrupted XML.
- **Acceptance on original five PDFs:** Run source PDFs unchanged through the same page/text evidence path, plus pixel/raster comparisons and independent PDF/A/embedded XML checks. Source content must match structured XML with no invented addresses, amounts, splits or tax codes.

## Render-parity findings (2026-11-16)

- Added `scripts/compare_ppm.py` and two-raster-resolution **diagnostic** runs at 120 and 144 DPI in `.github/workflows/pdfa3-feasibility.yml`. They report exact changed RGB pixels. Because this is an exploratory synthetic conversion, mismatches are emitted as **warnings** rather than silently accepted or described as conformance success. The separate browser release prerequisite is **strict and fail-closed**: `comparePdfVisibleFidelity` requires both the source/derivative PDF text/layout and its rendered pixels to match.
- When probed locally with Ghostscript **10.05.1** and Poppler at **96 DPI**, the *five unchanged synthetic input PDFs* showed unchanged rendered pixels on TEST-01 and TEST-03, but small raster differences on page 1 of TEST-02, TEST-04 and TEST-05. The remaining pages had no changed channels. Differences were **269, 156 and 801 RGB channels** respectively (roughly **0.010%, 0.006% and 0.030%** of that page's channels). These are **diagnostics, not proof of semantic equality**, and the unchanged original test PDFs have **not** been added to GitHub CI. Every difference is a blocker under the browser parity policy.
- The independent single-page synthetic CI source can be **pixel-identical at 96/144 DPI but differ at 108/120 DPI**, consistent with font rasterization/hinting differences. Rendering at one DPI alone must not be interpreted as preservation on all devices. The effective Safari PDF.js output is a separate acceptance concern.
- This does not weaken the independent veraPDF and Mustang checks; both are still required and neither is a visual fidelity oracle. A PDF/A-3-conformant derivative that changes a rendered glyph or position remains **not exportable** under the current strict policy.
