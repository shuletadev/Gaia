# Gaia handoff (2026-10-05)

Read this first when you pick the project up on another machine or another Claude account. It says where things stand, what was
decided, what is unverified, and what to do next. The deeper documents are linked, not repeated.

## What Gaia is

A local control room for an Azure sandbox (cost and orphan audits, park and resume, dependency-aware delete, preconfigured labs),
being grown into the operations center of a two-person Microsoft Certified Trainer business that sells certification-prep classes
(AZ-900, AI-901, AZ-104 now; DP-900 and SC-900 later). Each admin runs Gaia locally. Server in `server/`, web app in `web/src`
(React 19, Vite, Tailwind 4), SQLite through `node:sqlite`, Bicep blueprints in `blueprints/`. Repo: private, `shuletadev/Gaia`, branch `main`.

## Resume on a new machine or account

```powershell
git clone https://github.com/shuletadev/Gaia.git
cd Gaia
npm install
az login                       # the tenant you want to work in (personal or business)
az bicep install
npm run icons -- --accept-terms   # Microsoft's Azure icons: downloaded per machine, not committed
npm start                      # http://127.0.0.1:4870, a setup wizard writes labctl.config.json
```

`npm run typecheck` and `npm test` should pass (25 files, 342 tests at the time of writing). Node 24 recommended.

**Not in the repo, by design:** `labctl.config.json` (tenant and subscription IDs), `data/` (the local database: lab history, action
log, student sandboxes), the downloaded icons, exported blueprints (`blueprints/custom-*`), and Claude's memory. A new machine starts
with an empty database. The memory is mirrored in `docs/memory/` (see its README to restore it).

## Where things are

| Need | Look at |
|---|---|
| The plan, decisions, risks | `docs/ROADMAP.md` |
| Rules for working here (UI process, skills, checks) | `CLAUDE.md`, `design/DESIGN.md` |
| The instructor lab catalog (22 labs, 2 guides) | `docs/catalog/README.md` and `server/labs/catalog/`, `blueprints/cr-*` |
| What Microsoft's own labs deploy (what students run) | `docs/learn-labs/` (AZ-900, AZ-104, AI-900 and AI-901, DP-900, SC-900) |
| The student sandbox design and how to try it | `docs/student-sandbox.md`, `server/sandbox/`, the Students screen |
| How it runs | `START-HERE.md`, `README.md` |

## State of the work

- **Catalog:** 22 instructor demo labs and two instructor guides (identity, infrastructure as code), with exam tags on the catalog page.
  Built for AZ-900, AI-901 and AZ-104 only (AI-900 retired on 30 June 2026). **None has been deployed to Azure.** Templates compile with
  no warnings and passed `az deployment sub validate` (shallow: nested resources are not deeply checked).
- **Students are not given the catalog.** They run Microsoft Learn's labs in the business subscription. The catalog is for the
  instructor to project. The inventory of what the Learn labs deploy is in `docs/learn-labs/`.
- **Student sandbox (AZ-900):** one resource group per student, Contributor plus a lock-only custom role on that group, two policies, a
  budget, expiry through the existing sweeper, re-provisioning. Server side and Students screen are built (list, New sandbox with a
  Spanish message to copy, Delete, Create again). **Never run against a real subscription.**
- **Engine additions this round:** content kinds (static site, blob upload, SQL seed), purges (soft-deleted vaults and AI accounts, ML
  workspaces, backup items), lock removal, region-free types, capacity memory, learned timings.
- **Navigation:** five sections (Overview, Labs, Students, Resources, Settings); sub-pages are tabs.

## Decisions to keep

- Personal and business subscriptions are in **different Entra tenants**; the business one is pay-as-you-go (model quota unknown).
- Admin-only for now; UI in English, anything students read in Spanish. No Azure Pass codes for MCTs, so the business pays for student usage.
- Microsoft Fabric is not available yet; SC-900 delivery is undecided (instructor demos for now; Skillable is the option to ask about).
- Student guardrails come from what the **Learn labs** deploy, never from the catalog cards.
- Shared business state (students, money, locks) is planned in Azure, not on laptops (`docs/ROADMAP.md`).

## How the owner wants to work

- Plain, short reports; say what is verified and what is not. Nothing has run on real Azure for labs or sandboxes yet.
- **Audit before deploying.** Do not deploy labs, create real sandboxes or run anything that bills until told.
- **Commit and push only when asked**, one phase at a time. No force-push without explicit words.
- UI work follows `CLAUDE.md`: design-workflow skill first, audit then plan then approval, both themes, phone and desktop.

## Next steps, in order

1. **One real sandbox test** with a student you control (a second address invited as a guest to the business tenant). In the portal check
   the group, its Access control, its policy assignments and its budget; confirm policies start blocking within 5 to 30 minutes; confirm
   Cloud Shell works without a storage account for a student with no rights outside their group. Fix what breaks.
2. **Decide the open sandbox choices:** the custom lock role versus Owner on the group, the blocked-types list in
   `server/sandbox/courses.ts`, the eight US regions, the 14 day and $25 defaults.
3. **Audit and deploy-test the catalog** in the business subscription, one lab at a time, cheapest first (16, 20, 17, 18, then 19, then the AI labs 22 to 24, which depend on model access and region).
   Check the Python scripts in labs 22 and 23, which were never run.
4. **Business model quota:** read the quota on the business subscription (read-only) before any AI-901 cohort.
5. **Spend per student** on the Students screen, and quota admission control for shared quota (vCPUs, model tokens).
6. **AZ-104 sandbox:** a set of groups per student, constrained role assignments, a plan for the two tenant-level labs (Entra users, management groups).
7. **Platform:** workspaces for the two tenants, the shared store, then the student lifecycle (registration, payment, Teams).
8. Smaller: VM scale sets, Bastion, private endpoints and user-defined routes have no lab; the 28px button height is under the touch-target norm app-wide; Spanish class notes (scope to confirm).

## Gotchas

- Edit code with the editor tools, not shell escaping. Line endings are mixed (some CRLF files). See `docs/memory/windows-tooling-quirks.md`.
- To test a screen without touching Azure, patch `window.fetch` in the browser and intercept POST and DELETE.
- A real create, delete or re-provision of a sandbox acts on the business subscription through the signed-in admin: do it on purpose.
