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
