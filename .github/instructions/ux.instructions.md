---
applyTo: "src/**/*.tsx,src/**/*.css"
---

# UI quality rules for ZUGFeRD Enricher

Use [anti-slop](https://github.com/miqdadbadjuber/anti-slop) as a **quality filter**, not a visual template or a reason to redesign the application. Preserve existing product direction unless a separate product design decision changes it. The project prioritizes local invoice verification, source evidence, privacy, and an unobtrusive interface.

- **Purpose before UI:** Render information only if it helps a person understand source evidence, make a decision, or perform an action. Do not show "0 findings", large green success panels, duplicate confirmations, or decorative status chips. No findings in a partial arithmetic check does not mean EN 16931 or ZUGFeRD compliance.
- **Product-specific language:** Prefer clear tasks such as "PDF lokal auslesen" or "Steuersatz prüfen". Avoid generic hero slogans, buzzwords, fictional claims and decorative three-step sections.
- **Content first:** When a PDF is loaded, give the original PDF, its verifiable data and necessary review tasks priority over introductory content. Keep source links and actionable findings close to what users need to correct.
- **Evidence boundaries:** Unknown or unverified invoice facts remain visible as unresolved; don't replace them with category guesses. Manual category selection never validates a tax rate, an amount, or source fidelity. Do not claim export readiness until independently validated.
- **Responsive and accessible:** Test narrow mobile widths and iOS Safari; avoid horizontal overflow, use legible labels, visible keyboard focus, useful accessible names and at least 44px touch targets for controls. Native elements are preferred. Modals must be keyboard operable and closable.
- **Real states and content:** Every process needs appropriate initial, pending, error, review and completed states. Disclose unavailable functionality truthfully, and never create dead buttons or links.
- **Privacy:** Invoice contents and user-entered changes stay on-device. Avoid logging or transmitting invoice content to infer a UI state.
- **Review & verification:** Explain the reason for each new card, badge, animation, instructional paragraph and visual effect. If it adds no clear value, remove it. Cover meaningful state changes with tests, run `npm run check`, inspect the PR preview and test interactive mobile behavior before declaring the UI ready.

These are project-specific adaptations, not a vendored copy of anti-slop. They complement [engineering standards](https://github.com/Schubidu/engineering-standards) and do not override fiscal-source validation requirements.
