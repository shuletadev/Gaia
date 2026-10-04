# Gaia roadmap: from personal lab tool to training-business operations center

Status: draft for discussion · written 2026-10-03

## Context

Gaia today is a single-operator, local tool: cost and orphan audits, park/resume, dependency-aware delete, and a
catalog of Bicep lab blueprints with preflight, staged deploys and expiry. It acts as the signed-in user through the
Azure CLI and keeps state in a local SQLite file.

The goal is to grow it into the operations center for a cloud certification-training business run by two admins (both
MCTs), covering the whole student lifecycle from registration to exam, while still monitoring their personal
subscriptions.

### Requirements gathered

- **Two workspaces**: personal (monitor only) and business (labs, students, policies). The business workspace is
  administered by two people, each running Gaia on their own machine.
- **The catalog is instructor reference material** (clarified 2026-10-04): ready-to-deploy scenarios that show real
  Costa Rican use cases (pharmacy receipts, pulpería inventory, small-business websites), run by the instructor to
  explain what the exams cover. Students do **not** build these.
- **Student labs are Microsoft Learn's recommended labs.** Students do those themselves in the Azure portal. Gaia's job
  there is the guardrails (what those labs need and nothing more), spend tracking, access and cleanup, not the lab content.
- **Spend control**: track spend per student, with a cap per student, plus on-demand and automatic cleanup.
- **Access control**: manage student access (RBAC/IAM) from Gaia, with a view that makes it easy to see who has what.
- **Lifecycle (later)**: confirm a student is official (payment made, benefits granted), then automate Teams
  registration, learning resources and class invites.

## Decisions so far (2026-10-03, revised 2026-10-04)

- **Catalog vs student labs (2026-10-04).** The 14 catalog labs are for the instructor to demonstrate. The labs students
  build are Microsoft Learn's recommended ones, so student guardrails (policy packs) must come from what *those* labs
  deploy, not from the catalog cards. The inventory of the Learn labs per course is written: see [learn-labs/](learn-labs/README.md). Findings: the labs need a real subscription, fixed resource-group names collide, some need more than Contributor, and SC-900 needs a Microsoft 365 lab tenant.

- **Old catalog removed.** The 10 APIM / App Gateway / Front Door / firewall / DNS-resolver blueprints, their gates and
  hooks (APIM token, mTLS certificates), the APIM tier check and soft-delete purge were deleted. The generic engine
  stays: stacks, stages, gates (`http-ok`), hooks (`vm-password`), preflight, pricing, timing, capacity memory.
- **Personal-support features removed:** Repro from case (and the `caseId` tag), Teams nudges, weekly report, Windows
  logon task. `npm run sweep` stays as a CLI.
- **Admin-only first.** Students use only the Azure portal and Microsoft Learn's lab instructions; no student portal in v1.
- **Hosting:** shared backend and always-on worker in Azure, in the business subscription.
- **Tenants:** personal and business are in different Entra tenants, so workspaces need one tenant each (the config
  currently allows a single tenant per instance).
- **Pilot course:** AZ-900. **Language:** English admin UI. Spanish class notes (to confirm: they supplement Microsoft Learn's English labs rather than replace them).
- **No Azure Pass codes** for MCTs, so student usage is paid by the business.

## Showcase catalog progress (instructor reference labs)

**All 14 labs in the catalog are built** (specs in catalog/, one file per lab under server/labs/catalog/), with 295+ unit tests and all Bicep compiling. **None has been deployed to Azure yet.** Next: a sandbox test pass, then student-mode policy packs and Spanish guides.

Spec cards for 15 labs (one per exam section at least) live in [docs/catalog/](catalog/README.md): review and prune
there before anything else is built. Build order: batch 1 (one per section) 04, 03, 05, 02, 07, 08, 12; batch 2 10,
11, 06, 14, 09; batch 3 13 and the identity demo. Deployment testing waits until several labs exist.

- [x] `cr-farmacia-recibos` (pharmacy digital receipts): infrastructure plus a Spanish cashier app deployed by the new
  content step (SWA deployment token + pinned SWA CLI). The app keeps sales in the browser; saving them to the lab's
  Cosmos DB and Blob Storage (a Static Web Apps managed API) is the next step.
- [x] `cr-taller-servidores` (IaaS vs PaaS, batch 1): Bicep, blueprint and tests done; same page on a VM and on App Service.
- [x] `cr-cooperativa-gobierno` (governance, batch 1): policies, delete lock, budget, tags; lab destroy now removes locks first.
- [x] Pulpería inventory
- [x] Small-business website (soda, lab 03)

## What the current code gives us

| Reusable as is | Needs to change |
|---|---|
| Lab engine: deployment stacks, staged deploys, readiness gates, resume (`server/labs/`) | Single operator, `AzureCliCredential` only |
| Preflight (quota, RBAC, SKU, region) and Retail Prices estimates | Localhost-only with a per-launch token as the only auth |
| Dependency-ordered delete planner and typed-confirmation guards | One `owner` in config; `labs` table has no owner or cohort |
| Audit rules, relationship graph, topology and validate views | Cost is per subscription, not per student |
| Sweeper, job runner, 233 tests | State is a local SQLite file; the sweeper lock only works on one machine |

Conclusion: the engine and the safety model are a solid base; evolve in place rather than rewrite. The missing layer is
identity, people, money and shared state.

## Key design decisions

### 1. Personal vs business workspaces

Gaia already runs side by side with separate config, data and port (`LABCTL_CONFIG`, `LABCTL_DATA_DIR`,
`LABCTL_PORT`), so a personal and a business instance work today. In-app workspaces are the polished version: each
workspace has its own tenant, subscriptions, database and mode. The personal workspace is monitor-only so student
features can never touch personal subscriptions.

Open: are both subscriptions in the same Entra tenant? Today's config assumes one tenant per instance.

### 2. Two admins, two laptops: shared state

Local SQLite on each laptop means no shared view of students, caps or the ledger; the sweeper lock does not protect
across machines; enforcement only runs while a laptop is on; and student personal data sits on two laptops.

Recommended hybrid:

- **Shared store** in the business subscription for people and money (students, cohorts, entitlements, spend ledger,
  locks), for example burstable Postgres (around $15/month). Both local Gaia instances connect with their own `az`
  sign-in.
- **Azure tags and policies** stay the source of truth for what exists (the reconcile logic already works this way).
- **Local SQLite** stays for caches, jobs and audit snapshots.
- **An always-on worker** (small Container App) runs the sweeper, cap enforcement and lifecycle automations so nothing
  depends on a laptop being open.

### 3. Isolation model for students

- A. Shared subscription, one resource group per student, access scoped by RBAC, guardrails by Azure Policy, budget per
  group. Cheap and fast; shared quotas.
- B. One subscription per student. Strongest isolation and native per-student cost, but needs an EA/MCA billing
  agreement and heavy onboarding.
- C. Hybrid: start with A and keep the subscription as a field on the student, so students can be sharded across
  subscriptions later.

Recommendation: A, designed so C stays open. (MCT status does not include Azure Pass codes, so the cost of student
usage is on the business.)

### 4. Student labs (Microsoft Learn): policy packs per course

*Revised 2026-10-04.* Students follow Microsoft Learn's recommended labs, so a course's pack is built from what those
labs deploy (resource types, SKUs, regions), not from our catalog. Some Learn exercises run in Microsoft's free sandbox
and need no subscription at all; others need the student's own Azure subscription. Which ones the course uses decides
how much Gaia has to guard (see the open questions).

A course defines allowed resource types, SKUs and regions, required tags and denies. Gaia compiles it into an Azure
Policy initiative assigned to each student's resource group. Students get Contributor on their own group only
(Contributor cannot change role assignments or delete locks). A budget per group backs it up, and Gaia checks for
drift.

Caveats:

- Policy can restrict *what* may be built but not *how many*; quantity is handled by budgets, quotas and cleanup.
- The allowed list must include dependent types (a VM needs a NIC, disk, VNet, NSG). Guides must be tested against the
  policy so students do not hit confusing deny errors in the portal.

### 5. Spend caps: five layers

Cost Management data lags by 8 to 24 hours, so no single mechanism is enough.

1. **Admission**: estimated cost x lifetime vs the student's remaining allowance, before launch.
2. **Accrual**: a ledger of estimated running cost (`est_hourly x runtime`) for real-time action.
3. **Reconciliation**: actual cost grouped by tag (`student`, `cohort`) corrects the ledger.
4. **Enforcement**: warn at 50% and 80%; at 100% park/destroy and block launches (sandbox mode: remove write access).
5. **Backstops**: Azure budgets/alerts per group; policy denying GPU and large SKUs, restricting regions, forcing tag
   inheritance.

### 6. IAM / RBAC view

Reading role assignments is possible through ARM. A "who has what, where" screen (student -> group -> role -> policy
pack) is feasible. Writing assignments needs a constrained role for Gaia's identity. Creating or inviting users uses
Microsoft Graph, a different API with its own permissions.

### 7. Student lifecycle

Lead -> paid -> onboarded -> active in cohort -> exam-ready -> certified or not -> alumni. Each stage carries
entitlements (courses, lab allowance, duration) and fires automations.

| Stage | Automation | Feasibility |
|---|---|---|
| Paid | Admin confirms payment | Manual first (SINPE Móvil is likely manual); integrate later |
| Onboard | Entra guest invite, resource group, policy pack, budget | Graph + ARM, doable |
| Onboard | Teams add, class invites, resource links | Graph, doable but separate work |
| Exam | Pass/fail tracking | No public API for exam results; admin enters it, or student shares a Learn transcript link |
| Alumni | Remove access, delete sandbox | Reuses cleanup |

Data protection: this holds student personal data (Costa Rica Law 8968; GDPR if EU students). Another reason for a
central, access-controlled store instead of laptops.

## Phases

0. **Decisions.** See open questions.
1. **Quick wins, in parallel.**
   - First 2 to 3 Costa Rica showcase blueprints (cheap services: Static Web Apps, App Service, Functions, Storage,
     SQL), each with scenario metadata: business story, topology, learning objectives, exam objectives covered.
   - Personal/business split using two instances.
2. **Shared business store**, roles for both admins, locks.
3. **Student registry and lifecycle**, manual payment confirmation. Provision a resource group per student; tag
   everything by student and cohort.
4. **Policy packs, RBAC/IAM view, budgets** for the Microsoft Learn labs of each course (needs the inventory of what those
   labs deploy first).
5. **Spend ledger and caps** (five layers), plus the always-on worker.
6. **Integrations**: Entra invites, Teams, calendar, resource delivery, payments.
7. **Exam tracking, alumni, cohort and margin reports** (feeds pricing of the subscription).

**Pilot milestone:** one AZ-900 cohort of 5 to 10 students, one policy pack, one resource group each, a per-student cap
and manual onboarding. That is phases 2 to 5 in thin form.

## Risks

- **Sandbox mode is the biggest cost leak.** Guided labs are bounded; anything else a student builds is not.
- **Abuse** (cryptomining, public IPs) is the business's liability: deny GPU and large VM sizes; review Azure terms.
- **Quota and capacity**: many students deploying the same service at once hit regional limits; needs admission
  control. Several blueprints take 25 to 90 minutes to deploy, so classes need pre-warming ("ready by 9:00").
- **Automated deletion at scale**: a scoping bug affects many students; every guard change needs tests.
- **Security**: moving from localhost to hosted/shared is the hardest change (least privilege, secrets, audit trail).
- **Localization**: decide early whether the UI and student content are Spanish-first.

## Open questions

1. ~~Same Entra tenant?~~ Answered: different tenants.
2. Should students be guests in the business tenant, or have accounts the business creates?
3. ~~Spanish-first?~~ Answered: English UI, Spanish guides.
4. Is there an existing Microsoft 365 / Teams tenant to use with Graph?
5. Which payment methods are expected: SINPE Móvil, cards, or both?
