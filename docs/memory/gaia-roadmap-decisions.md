---
name: gaia-roadmap-decisions
description: "Decisions and constraints for evolving Gaia into a cert-training operations center (tenants, hosting, language, safety, exam scope)"
metadata:
  node_type: memory
  type: project
  originSessionId: 8c633da8-44a4-4227-a1dd-10ebf615cc32
  modified: 2026-10-05T12:56:26.458Z
---

Gaia started as a personal Azure sandbox control room (cost/orphan audits, park/resume, safe delete, labs) and is being grown into an operations center for a two-person MCT certification-prep business. Full plan: `docs/ROADMAP.md`; lab specs: `docs/catalog/`; current state and next steps: `docs/HANDOFF.md`.

Decisions (2026-10-03 to 05):
- Personal and business subscriptions are in **different Entra tenants** (workspaces need one tenant each). The business subscription is pay-as-you-go; its model quota is still unknown.
- Each admin runs Gaia locally; shared state for the business (students, money, locks) is planned in Azure (Postgres + an always-on worker), not on laptops.
- Admin-only first (no student portal). Admin UI in English; Spanish for anything students read (guides, the sandbox message).
- Pilot course: AZ-900. **Catalog scope now: AZ-900, AI-901 and AZ-104 only** (AI-900 retired 30 June 2026). DP-900 and SC-900 cards stay as built; no Microsoft Fabric yet; SC-900 delivery undecided (instructor demos for now).
- Remote: private GitHub repo `shuletadev/Gaia`. Commit identity is `shuletadev` via the GitHub noreply email.
- MCTs do not get Azure Pass codes, so student usage is paid by the business.
- Navigation is five sections (Overview, Labs, Students, Resources, Settings); sub-pages are tabs. Microsoft's Azure icons are not committed (downloaded per machine with `npm run icons -- --accept-terms`).

**Why:** the user wants one place to manage the whole student lifecycle (registration, payment confirmation, labs, spend caps, cleanup, exam).

**How to apply:** check `docs/ROADMAP.md` "Decisions so far" before proposing architecture; keep UI work inside the rules in `CLAUDE.md` (design-workflow skill first, audit then plan then approval, verify desktop and phone, both themes); commit and push only when asked; do not deploy labs or create real student sandboxes without the user saying so.

See [[catalog-is-instructor-reference]], [[catalog-scope-az900-ai901-az104]] and [[student-sandbox-status]].
