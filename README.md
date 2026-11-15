# zugferd-enricher

Local-first, privacy-friendly tool to analyze, validate, and enrich existing PDF invoices with ZUGFeRD data.

> **Project stage – Issue #1:** The current application only selects a PDF locally. PDF text extraction, invoice verification, OCR, classification and ZUGFeRD export are **not implemented** yet.

## What this project will do

- Read existing PDF invoices locally, including optional OCR for scanned invoices.
- Identify source-backed invoice line items, tax rates, tax groups and totals.
- Report ambiguities instead of inventing missing amounts or tax splits.
- Optionally generate an independently validated PDF/A-3 + EN 16931 XML **processing copy** later.

The supplier's original PDF must stay intact. A user-created ZUGFeRD processing copy is **not** an invoice issued or corrected by the supplier.

**Out of scope:** travel expense reimbursement, meal allowances, employer policies and claiming tax refunds. Circula is an optional external consumer of the documents, not an API dependency.

## Privacy contract

Invoice files, file names, extracted data and model input **must stay in the browser**. This foundation contains no invoice upload endpoint, backend, analytics, external AI inference or document persistence. The selection UI stores only the chosen browser File object in React state; it never reads or transmits its bytes.

Future OCR/classifier assets may be downloaded as public, versioned static files **on demand**, with local caching where feasible. Requests for application/model assets are not invoice uploads. The public repository uses synthetic test data only.

The current picker filters by filename extension and size (maximum 50 MB) for UX. **It does not validate PDF structure, invoices or tax values.** Those functions will follow in later issues.

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
