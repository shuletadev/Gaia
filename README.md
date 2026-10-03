<img src="web/public/gaia.svg" width="56" alt="" align="left" />

# Project Gaia

Azure lab control room: cost and orphan audits, park/resume, dependency-aware delete and preconfigured labs, growing into
the operations center for a cloud-certification training business (see [docs/ROADMAP.md](docs/ROADMAP.md)). Internally the tool is still **labctl** — tags (`managedBy=labctl`), stack names, the CLI, the
scheduled task and the database keep that name so existing labs and automations keep working.

## Team quick start

Gaia runs on your own machine, as you, against **your own** sandbox subscription. Nothing is shared between
teammates except the code — usually as a zip (see [Sharing](#sharing)).

**You need:** Node.js 22.13+ (24 recommended), Git, the Azure CLI, the Bicep CLI (`az bicep install` is enough) and
Contributor (or Owner, to register resource providers) on a subscription you own and may spend on.

```powershell
# unzip the Gaia package (or clone the repo), then:
cd Gaia
npm install
npm start                            # builds the UI and serves it on http://127.0.0.1:4870
```

Open http://127.0.0.1:4870. The first run opens a setup wizard:

1. **Sign in** — uses your Azure CLI sign-in (or signs you in, optionally to another tenant).
2. **Subscription** — pick one or more subscriptions from one tenant; the first is the default for new labs.
3. **Guardrails** — monthly budget, default lab lifetime, owner tag, regions, and protected resource groups
   (suggested from what is in your subscription: governance groups, `NetworkWatcherRG`, AKS `MC_*` groups…).
4. **Icons** — optional download of the official Azure icons.
5. **Review** → **Start Gaia**.

Everything can be changed later under **Settings**; with several subscriptions, the switcher next to the page
title chooses which one the screens and new labs use. Changes that widen what Gaia may touch (another subscription,
another tenant) or remove a safety net (unprotecting a group, turning auto-clean off) ask for confirmation first.
The optional automations below are per user and can be added later.

### Azure icons

`npm run icons -- --accept-terms` downloads Microsoft's official
[Azure architecture icon set](https://learn.microsoft.com/azure/architecture/icons/) and extracts the icons labctl uses
into `web/public/azure-icons/` (git-ignored — the icons are Microsoft's and are used under their
[icon terms](https://learn.microsoft.com/azure/architecture/icons/#icon-terms)). Without them the UI falls back to
monogram tiles. The type → icon mapping lives in `web/src/iconMap.ts`.

| Script | Purpose |
|---|---|
| `npm run dev` | API (watch mode) + Vite dev server on http://127.0.0.1:5173 |
| `npm run audit` | Read-only baseline audit; writes `data/reports/baseline-*.md` and `.json` |
| `npm test` | Unit tests (guards, security checks, audit rules, ARM retry, lab engine) |
| `npm run typecheck` | TypeScript check |
| `npm run package` | Shareable zip of the last commit (see [Sharing](#sharing)) |

## Sharing

`npm run package` builds `release/Gaia-<version>-<build>.zip` (plus a `.sha256` checksum) from the **last commit**:
source code and a `START-HERE.md` for the recipient — no repo access needed on their side. Before writing the zip
it refuses if:

- there are uncommitted changes (`--allow-dirty` packages the last commit anyway);
- the commit contains `labctl.config.json`, `data/`, the Azure icons, build output, `.env` files, databases or keys;
- any file mentions an identifier from **your** environment: tenant and subscription IDs and names, owner,
  protected groups, and the resource and group names from your latest audits (`--allow <name>` for a false positive).

`--out <folder>` writes the zip elsewhere. Bump `version` in `package.json` when you send out a new release.

## Configuration (`labctl.config.json`)

Written by the setup wizard and the Settings screen (atomically; edits apply without a restart). It can also be
edited by hand — `labctl.config.example.json` shows the shape.

- `tenantId`, `subscriptions` — the **only** subscriptions labctl will query or change (allow-list, one tenant)
- `excludedResourceGroups` — never reported, never deleted
- `budget.monthlyUsd`, `budget.alertThresholds` — dashboard target and warning levels (notify only)
- `ttlHours` — default lab lifetime, with per-template overrides
- `labs` — enabled regions and default, auto-clean on/off and interval
- `server.port` — not editable in the UI (needs a restart)

`labctl.config.json` and `data/` (SQLite database, reports) are git-ignored.

Environment overrides, for running a second instance side by side: `LABCTL_PORT`, `LABCTL_SWEEP=0` (no auto-clean),
`LABCTL_CONFIG` (config file path), `LABCTL_DATA_DIR` (database and reports). Overrides are never written back to the file.

## Screens

| Screen | What it does |
|---|---|
| **Overview** | Month-to-date vs budget, forecast (see below), burn rate, leak meter (30-day cost of flagged resources), daily trend, "fix first" list, running labs |
| **Inventory** | Every resource group and resource with cost, power state and flags. **Park / Resume** (Firewall, App Gateway, VM, AKS), **Pin** (tag `lifecycle=persistent` — stops always-on flags), **Adopt** a group as a lab with an expiry, **Extend / Release** labs, **Delete** |
| **Hunt** | Orphan and idle findings with bulk select → dry-run preview (contents, references, locks) → typed confirmation |
| **Log** | Every audit, dry run and action with its outcome |
| **Settings** | Subscriptions and tenant, budget, auto-clean, lab lifetimes, regions, protected groups, Azure icons |

Long-running actions (park, resume, delete) run as background jobs; the tray shows progress and the views refresh when they finish.
Parking an Azure Firewall saves its IP configuration in the local database **and** in a `labctlParked` tag on the firewall,
so it can be resumed even if the database is lost.

### Forecast

Two month-end forecasts, both = completed days this month (Cost Management) + a daily rate × days left (today included):

- **Live** (shown) — each resource's typical daily cost (the *median* of its last 5 complete days, so a one-off spike
  such as a temporary scale-up doesn't set the rate), summed only for resources that **still exist** and aren't parked. Deleting or parking something takes it out right away. Charges not tied to a
  resource (support, marketplace) are kept.
- **Trend** — the subscription's 7-day average. It keeps counting deleted resources for a week and amplifies one-off
  spikes; *How it's forecast* on the Overview shows both and how much of the trend comes from deleted resources.

Cost Management data lags 8–24 h, so a deletion made today shows in the actual daily bars tomorrow.

### Relationships

`server/audit/relations.ts` builds a dependency graph from Resource Graph properties so that orphan rules, the
Inventory ("uses / used by") and the delete preview agree on what is in use:

- **ARM ID references**, with direction: forward references (a firewall's `publicIPAddress`, an APIM's
  `publicIpAddressId`) mean *uses*; back-references (a public IP's `ipConfiguration`, an NSG's `subnets`, a VNet subnet's
  `ipConfigurations`) mean *used by*. Child IDs are folded to their parent resource.
- **IP address and FQDN matches** — e.g. an App Gateway backend pointing at a public IP's FQDN, or a UDR whose
  next hop is a firewall's private IP (only when that private IP has a single owner).
- **Reservation inference** — PaaS services bind dedicated public IPs one way, so an IP created for an APIM, App Gateway,
  Firewall, Bastion or gateway shows no `ipConfiguration` while it waits to be bound. An unbound IP whose name or DNS
  label matches such a resource (e.g. `NorthwindIP` / `northwind` → APIM `Northwind`) is reported as *reserved for* it — a review
  item, never selected by bulk delete.

**Keep** on a finding tags the resource `lifecycle=persistent`; kept resources (and kept empty groups) are no longer flagged.

### Dependency-ordered delete

Azure refuses to delete something still referenced (`InUseNetworkSecurityGroupCannotBeDeleted`,
`PublicIPAddressCannotBeDeleted`, `InUseSubnetCannotBeDeleted`, a private DNS zone with VNet links…). The delete dry run
(`server/actions/deletePlan.ts`) therefore plans the whole selection before anything starts:

| Reference to a deleted resource from one that stays | Plan |
|---|---|
| NSG / route table / NAT gateway on a subnet; NSG on a NIC; public IP on a NIC | **Detach** it on the resource that stays (GET → drop the reference → PUT) |
| Peering on another VNet pointing at a deleted VNet; private DNS / forwarding-ruleset link to it | **Delete** that peering / link first (they'd dangle otherwise) |
| NIC, private endpoint, App Gateway, APIM, firewall… in a subnet; public IP on a firewall/gateway/APIM; NIC on a VM; disk on a VM; policies in use | **Blocked** up front — the target is skipped with the reason and an **Include** button that adds the dependent to the selection |
| Anything else (e.g. an app setting holding a resource ID) | Note: it will keep a broken reference |

Targets are then deleted in **waves**: consumers before what they use (VM → NIC → public IP / VNet → NSG), resource
groups ordered by cross-group references, VNet↔VNet peerings ignored as prerequisites, cycles deleted together. Each
step is a job that waits for its prerequisites and is skipped if one fails. Deletes retry while Azure releases a
reference (`InUse…`, `NicReservedForAnotherVm`, `AnotherOperationInProgress`), treat 404 as done, delete a DNS zone's
links before the zone, and force-delete VMs in a group (`forceDeletionTypes`). Detaches are only made on resources
labctl may modify and that aren't locked (a group lock counts); otherwise the target is blocked. Lab destroy checks the
same plan first: it removes peerings/DNS links pointing at the lab and fails fast with the reason when an outside
resource would hold the group delete hostage. Notes flag soft-deleted services (APIM, Key Vault) that keep their names.

## Lab catalog

The catalog is being rebuilt for the training business (see [docs/ROADMAP.md](docs/ROADMAP.md)): the original
API Management / networking blueprints were removed, and new showcase scenarios are added under `blueprints/<id>/`
as Bicep (preferably [Azure Verified Modules](https://aka.ms/avm)). `server/labs/blueprints.ts` declares each
blueprint's parameters, rules, presets, stages/gates, quotas, progress steps and price meters; a blueprint can also
be created from an existing resource group with **Save as blueprint** (below). Each showcase blueprint carries a
`scenario` (business story, learning objectives, exams covered) shown in the launch dialog.

| Blueprint | What you get | ≈ $/hr | Deploy |
|---|---|---|---|
| `cr-farmacia-recibos` | **Farmacia Pura Vida**: a pharmacy's digital receipts. Static Web App (Free) front end, Cosmos DB serverless sales database, Storage account for receipt files (LRS or GRS) | ~0 (usage-based) | 3–8 min |

**Launch** (Catalog) → pick a preset or region, parameters, lifetime and purpose; the hourly estimate comes from the
public [Retail Prices API](https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices).
Invalid combinations are flagged as you choose them and rejected by the server.

**Feasibility preflight** — *Check & launch* runs every check that can fail a deployment before anything is created;
a clean result launches straight away, failures block (with a fix where possible) and warnings need *Launch anyway*:

| Check | Source |
|---|---|
| Configuration | Blueprint rules |
| Resource providers | Registration state per namespace — **Register** button when missing |
| Available in region | Provider metadata per resource type (global types pass) |
| Network quotas | `Microsoft.Network` regional usages (public IPs, VNets, NSGs, App Gateways, route tables, private endpoints) |
| VM sizes | Compute SKU list for the region (offered, not `NotAvailableForSubscription`) and family + regional vCPU quota |
| Permissions | Effective RBAC actions (wildcards and notActions) for every `…/write` the lab needs |
| Lifetime | Deploy time vs the chosen lifetime |
| Budget | Lab cost over its lifetime vs the live month-end forecast and budget; any lab ≥ $1/h warns |
| Names | Resource group free |
| Template + policy | Deployment-stack *validate* (template, Azure Policy) |

**Stages and readiness gates** — blueprints can deploy in stages (the template's `stage` parameter; every stage
contains the previous ones, so the stack never deletes earlier work). After each stage a gate polls for the *real*
signal before the next stage starts. Today there is one gate kind, `http-ok` (an output `url` answers 200); more are
added in `server/labs/gates.ts` as blueprints need them. Blocking gates fail the lab with the stage and reason;
**Resume k/N** continues from that stage instead of starting over. Gates on the last stage are non-blocking: the lab
is Ready with a readiness warning.

**Generated values** — a stage can need a value only labctl can produce. Blueprints declare *parameter hooks*
(`server/labs/hooks.ts`; today `vm-password`, a random admin password). Pre-launch validation uses placeholders.

**Learned deploy times** — every run records stage, gate and total durations per blueprint *variant* in
`lab_timings`; earlier labs are backfilled. Estimates, the lifetime check and the ETA use your last runs (same region
preferred) and fall back to the static range until there is data.

**Cheapest viable** — when the checks show a blocker another region or tier avoids, or cost pressure, the launch dialog
lists deployable alternatives sorted by price — same setup in another enabled region, or a blueprint-declared cheaper
variant with what it gives up — plus the longest lifetime that keeps the month within budget. **Apply** fills them in.

**Capacity memory** — regional shortages can't be queried ahead of time. When a deployment fails with one
(`…CapacityHeavyUsage`, `AllocationFailed`, `SkuNotAvailable`…), it's remembered for 24 h per blueprint *variant*:
launches of that variant in that region get a *Capacity* warning and alternatives move elsewhere.

**Lifecycle** — each lab is a subscription-scope **deployment stack** (`labctl-<lab>`) that owns a tagged resource group
(`managedBy=labctl`, `expiresOn`, `blueprint`, `purpose`, `owner`, `createdOn`). Destroy removes the stack without
touching resources (detach), then deletes the resource group, letting Azure order everything. The Labs screen shows
live per-module progress, outputs, countdown, running cost, **+4h / +1d**, **Retry / Resume** for failed deployments
and **Destroy**, plus a history with estimated cost per lab.

**Expiry** — a local sweeper runs at start-up and every `labs.sweepIntervalMinutes` (default 15) while the app is
open, destroying only groups that pass the auto-delete policy. After a restart, labs left mid-deploy or mid-destroy are
reconciled against Azure. `npm run sweep [-- --dry-run]` runs one sweep from the command line.

Set `LABCTL_PORT` / `LABCTL_SWEEP=0` to run a second instance (e.g. for testing) alongside your main one.

## Investigate

| Feature | Where | What it does |
|---|---|---|
| **Validate** | Lab card · Inventory group header (pulse icon) | Per-type health checks: App Gateway **backend health**, APIM provisioning and network status, firewall allocation / rules, route-table **next hops**, VNet **peerings**, private DNS zone **links**, public IP DNS names, plus end-to-end HTTP probes from lab outputs. Problems on unattached route tables are reported as *latent* warnings. |
| **Topology** | Lab card · Inventory group header | Network diagram laid out with ELK: VNets → subnets → injected resources (official icons), NSG / route table / NAT badges on subnets, UDR next-hop edges, peerings, private DNS links, public IPs folded onto their owners, out-of-group dependencies dashed. Pan/zoom, hover to isolate, **Download SVG**. |
| **Save as blueprint** | Inventory group header (upload icon) | Exports a resource group's template and makes it re-deployable as a lab: names derived from the lab name, global names and DNS labels prefixed, location/tags parameterised. Keeps `lab.bicep` when the decompiled Bicep compiles, otherwise deploys `lab.json` (ARM). Saved in `blueprints/custom-*` (git-ignored). |

The UI defaults to **dark mode**; the sun/moon button in the sidebar switches and remembers the choice.

## Safety model

- Until setup is finished only the setup endpoints answer; everything else returns `409 setupRequired`.
- Settings are validated on the server: every subscription must be visible to your Azure CLI sign-in and belong to the
  chosen tenant (names come from Azure, not the browser).
- Bound to `127.0.0.1` only. Every `/api` call is checked for an allowed `Host` (DNS-rebinding protection), an
  allowed `Origin`/`Sec-Fetch-Site`, and mutating calls need the per-launch session token.
- Subscription allow-list and resource-group exclusions are enforced on the server.
- Unattended deletion is only ever allowed for resource groups tagged `managedBy=labctl` whose `expiresOn` has passed.
  Everything else is report-only or needs explicit, typed confirmation (the resource name, or `delete N` for several),
  which the server re-validates against a fresh dry run before anything is deleted.
- Excluded resource groups cannot be tagged, parked or deleted.
- Every action is written to the local `action_log` table.

## Layout

```
server/            Fastify API (Node + TypeScript)
  azure/           ARM client (Azure CLI credential, retry/backoff, long-running operations), Resource Graph, Cost Management
  audit/           Orphan/idle rules (pure functions) and the audit runner
  actions/         Park/resume, tags (adopt, extend, release, pin), delete preview + execution
  snapshot.ts      Single payload behind every screen (inventory, findings, costs, forecast)
  costService.ts   Cached cost queries (stale data served when throttled)
  jobs.ts          Background job runner
  settings.ts      Settings validation, atomic save, live apply, sensitive-change detection
  setupRoutes.ts   Setup wizard + Settings API
  setup/azcli.ts   Azure CLI discovery (status, subscriptions, sign-in)
  guard.ts         Allow-list, exclusions, delete policy
  security.ts      Host/Origin/token checks
web/               React + Tailwind UI (screens/, components/)
scripts/           Baseline audit report
tests/             Vitest suites
```
