# zugferd-enricher

Local-first, privacy-friendly tool to analyze, validate, and enrich existing PDF invoices with ZUGFeRD data.

> **Project stage – Issue #3:** Text-based PDFs are read locally with PDF.js. Basic classification suggestions and source-backed arithmetic checks are available. OCR, complete tax validation and ZUGFeRD export are not implemented.

## What this project will do

- Read existing PDF invoices locally, including optional OCR for scanned invoices.
- Identify source-backed invoice line items, tax rates, tax groups and totals.
- Report ambiguities instead of inventing missing amounts or tax splits.
- Optionally generate an independently validated PDF/A-3 + EN 16931 XML **processing copy** later.

The supplier's original PDF must stay intact. A user-created ZUGFeRD processing copy is **not** an invoice issued or corrected by the supplier.

**Out of scope:** travel expense reimbursement, meal allowances, employer policies and claiming tax refunds. Circula is an optional external consumer of the documents, not an API dependency.

## Privacy contract

Invoice files, file names, extracted data and model input **must stay in the browser**. This foundation contains no invoice upload endpoint, backend, analytics, external AI inference or document persistence. The selection UI stores the browser File object locally; only after the user presses "PDF lokal auslesen" does PDF.js read it with a local worker. No invoice bytes or extracted data leave the browser.

Future OCR/classifier assets may be downloaded as public, versioned static files **on demand**, with local caching where feasible. Requests for application/model assets are not invoice uploads. The public repository uses synthetic test data only.

The picker filters the filename and size (maximum 50 MB); PDF.js checks actual PDF readability after user action. Source lines retain page indexes and approximate bounding rectangles. The review UI shows detected candidates, allows manual correction, and checks explicitly listed net + tax = gross using exact cents. This is not full invoice/VAT validation; item amounts are never assumed to be net/gross and unspecified tax allocations are never invented. The webapp separately displays the exact sum of **recognized line-item amounts** (including separately itemized city tax), recomputes after manual edits, and refuses to display a partial sum if any amount is invalid. This **does not establish completeness** and is **not automatically comparable** with the invoice gross total unless the amount basis is known.

## Development

Requires Node.js 22.12+ and npm.

    npm ci
    npm run dev
    npm run check

The canonical quality gate is **npm run check** (ESLint, TypeScript, Vitest and production build). GitHub Actions performs quality verification only; it has no Cloudflare deployment credentials.

## Cloudflare Workers Static Assets

The static SPA builds into dist/ and the Wrangler configuration provides SPA fallback. Cloudflare Workers serves HTML/CSS/JS and future optional model files only; it does not process invoices. Security headers are in public/_headers.

**First PR exception:** No Cloudflare Worker or preview deployment is required for Issue #1. After the first PR is verified, reviewed and merged into main, the owner will connect this repo through **Cloudflare's native Git integration**:

- Production branch: main
- Build command: npm ci && npm run build
- Deploy command: npx wrangler deploy
- PR/branch preview: Cloudflare's native preview deployments

There are **no custom GitHub Actions deployment workflows**. From the next PR onward, a functioning Cloudflare preview will be part of merge readiness once integration is enabled.

## Roadmap

- [#1 Foundation](https://github.com/Schubidu/zugferd-enricher/issues/1)
- [#2 Text PDF extraction and source provenance](https://github.com/Schubidu/zugferd-enricher/issues/2)
- [#3 Local fastText classification and tax reconciliation](https://github.com/Schubidu/zugferd-enricher/issues/3)
- [#4 Optional small on-device OCR models](https://github.com/Schubidu/zugferd-enricher/issues/4)
- [#5 Derivative ZUGFeRD export with independent validation](https://github.com/Schubidu/zugferd-enricher/issues/5)
- [#6 Circula document-order acceptance tests](https://github.com/Schubidu/zugferd-enricher/issues/6)

## Trust and engineering

The model is an untrusted extraction aid, not a source of fiscal truth. Before XML export, all mandatory invoice values must agree with the received original, and schema/business rules plus PDF/A-3 must pass independent validation. Never fabricate an invoice split, amount or missing data. Treat ambiguous or unsupported content as needing user review or block export.

The project follows [Schubidu/engineering-standards](https://github.com/Schubidu/engineering-standards): deterministic tests, minimal privileges, canonical local verification, current-SHA self-review and no automatic merge.

## License and independence

MIT (see LICENSE). Future model weights, WASM runtimes, XML schemas and conformance tools each need separate license verification. This is an independent tool, not affiliated with FeRD. ZUGFeRD is a trademark of its respective owner. Keep original invoices and seek employer/accounting acceptance before using derivative files as reimbursement evidence.


## PDF extraction limitations (Issue #2)

- Browser-only PDF.js display and parsing. No invoice URL, document upload, analytics, or model-based extraction.
- Positions are approximate page-relative rectangles derived from PDF.js text fragments; unusual layouts (columns, tables, overlapping text, rotated text) may produce incorrect line grouping. The user can always inspect original source text and correct fields. Highlighted text is evidence of the *original extraction*, not proof of a manual edit.
- Labels are deliberately conservative: issuer/recipient are populated only when explicitly labeled; dates accept ISO, German dotted dates, or English month-name dates. Ambiguous numerical slash dates are never guessed. The basic regex reader supports a subset of line-item layouts and tax tables, not arbitrary invoice templates.
- A row's amount has an **unknown basis** (net/gross). Only explicitly printed amounts/rates are shown; the app does not calculate unstated VAT or split packages.
- Scans and image-only PDFs show an OCR-needed warning (planned separately in issue #4).
- The source PDF is unchanged; the parsed PDF worker/document is released when the user changes or removes the file. No export/rewriting is performed.
- Security boundaries: no PDF scripts are executed for invoice logic; PDF.js text worker runs locally, with evaluation disabled. Inspect the network panel to verify only the app's static assets load.


## Local classification and reconciliation (Issue #3)

- Positions are categorized as accommodation, food, drinks, parking, city tax, bundled services, other, or **unknown**. Categories are review aids, not tax rates, expenditure categories, accounting truth, or claims that the original invoice was corrected.
- High-precision keyword rules run instantly. The button **"Positionen lokal klassifizieren"** optionally loads a small, quantized, locally hosted fastText **WASM** model for uncertain descriptions. It runs inside a Web Worker; model, runtime and source PDF are not sent to any remote inference service.
- The model is trained **only from deterministic synthetic phrase templates** using \`scripts/train_fasttext.py\` and fasttext-new 0.1.0 (fastText-compatible). Reproduce with \`python -m pip install fasttext-new==0.1.0\` then \`python scripts/train_fasttext.py\`; the resulting \`public/models/invoice-categories-v1.ftz\` is served as a static versioned Cloudflare asset. This is **not** trained on real invoice data and the synthetic benchmark is not a claim of production accuracy.
- fastText suggestions are shown only at model probability ≥83% and at least 20 percentage points ahead of the runner-up. If evidence is conflicting, incomplete or uncertain, the category stays **unknown**. Explicit matching rules and any user manual selection take priority.
- Model inference is only considered when at least one meaningful token from the **versioned synthetic training vocabulary** occurs in the description. Unknown words such as `Xylophon`, wholly out-of-vocabulary entries, and descriptions above 8,192 UTF-8 bytes abstain instead of making confident guesses or failing a batch. The model vocabulary is generated by the training script and is not populated from uploaded invoices.
- The synthetic evaluation phrases are verified to be **disjoint from training examples** before model training; the benchmark remains a smoke test, never a production accuracy guarantee.

- A manual category selection does **not** change tax rates, tax groups, original descriptions, amounts or provenance. Any edited description invalidates its previous classifier suggestion.
- A separate deterministic check compares **printed** net + VAT against gross, **printed** tax-group net × printed rate against printed tax (1-cent tolerance for ordinary rounding), and printed quantity × printed unit-price against printed line total. Unstated VAT allocations and mixed-rate package splits are never invented. Tax-group coverage gaps are flagged for review rather than automatically classified as invoice errors.
- No large OCR or VLM download is needed to read born-digital PDFs. An invoice can be opened and checked without loading fastText at all. Training/model downloads are independent of normal file selection.
- The current parser still handles only a subset of invoice layouts and cannot establish that every item was recognized. Invoices with missing or conflicting fields must be reviewed manually before any future export.
- Original PDF fundstellen are displayed with a translucent yellow **text-marker overlay** using CSS `mix-blend-mode: multiply` without modifying the original. The PDF inspector uses scrollport-relative positions to bring the exact source line into view, including on narrow screens.
- Classification state and running workers are reset for each new PDF instance; manual date changes never inherit printed PDF source claims.


**Model provenance:** Browser inference uses [fasttext-pure-rs](https://github.com/silvermine/fasttext-pure-rs) (MIT) compiled with Rust 1.89 to a standalone `wasm32-unknown-unknown` asset. **No Emscripten, embind, generated JS loader or `unsafe-eval` is required.** The current `.ftz` model remains unchanged and is created from synthetic examples. Rebuild using `scripts/build-classifier-wasm.sh` and the checked-in `rust/invoice-classifier/Cargo.lock`. The WASM is a same-origin, versioned static asset.

### Live category overview

The review screen summarizes **recognized** invoice line amounts by category, including unknown/uncategorized lines and exempt city tax when itemized. Every change to a category or position amount recalculates the grouped count and exact integer-cent sum immediately, without storing a second copy of totals. Invalid amounts suppress that category's total rather than showing a misleading partial sum. A category sum does **not** establish completeness, net/gross comparability, or VAT treatment; it is not compared automatically to the supplier's gross invoice total.


### Safari / iOS 27 local WASM troubleshooting

- The Worker and pure-Rust fastText inference WASM are **same-origin static assets**; no Emscripten or dynamic JavaScript evaluation is involved. Safari/WebKit 27 can run the direct runtime with the strict CSP.
- The Cloudflare asset security policy uses \`script-src 'self' 'wasm-unsafe-eval'\` to enable **only** WebAssembly compilation. Do **not** add general \`'unsafe-eval'\`, \`'unsafe-inline'\` or broad third-party hosts.
- Worker failures and model-loading failures are now reported using non-sensitive **stage-specific error codes**: worker startup, unavailable WASM (including possible iOS Lockdown Mode restrictions), runtime initialization, model fetch, model decoding or prediction. Invoice text and file names must never be sent to an error collector or included in error logs.
- Check the `.ftz`, `fasttext-rust-v1.wasm` and module Worker files for HTTP 200 and correct MIME types. The old Emscripten `.mjs` loader is no longer required. A successful WebKit desktop test does not replace an actual iPhone/iOS 27 acceptance test.
- Safari's Lockdown Mode can restrict complex web technologies; if WebAssembly is unavailable, the app must preserve rule-based category suggestions. Test on an **actual iPhone with iOS 27** before declaring this hardware issue resolved.
- iOS 27's performance regression for plain-HTTP LAN dev servers does not apply to our HTTPS Cloudflare preview. No need for cross-origin isolation or threads for this small single-threaded model.
