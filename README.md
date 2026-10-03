<img src="web/public/gaia.svg" width="56" alt="" align="left" />

# Project Gaia

Azure lab control room: cost and orphan audits, park/resume, dependency-aware delete and quick API Management /
networking labs. Internally the tool is still **labctl** — tags (`managedBy=labctl`), stack names, the CLI, the
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
| `npm test` | Unit tests (guards, security checks, audit rules, ARM retry) |
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

| Blueprint | What you get | ≈ $/hr (centralus) | Deploy |
|---|---|---|---|
| `apim-v2-quickstart` | APIM Basic v2 / Standard v2, public, with an httpbin sample API | 0.21 / 0.96 | 2–10 min |
| `apim-classic` | **Vanilla APIM** on Developer / Basic / Standard / Premium (1–12 units), optional External/Internal VNet injection (stv2 NSG + own public IP), optional sample API. Presets: Developer, Developer · Internal VNet, Premium, Premium · External VNet | 0.07 / 0.20 / 0.94 / 3.83 per unit | 25–90 min |
| `apim-private-endpoint` | APIM (classic tier) reached through an inbound **Private Endpoint** (`Gateway`), `privatelink.azure-api.net` zone linked to a client VNet, public access switched off afterwards (it must be on at creation) | 0.08 | 45–90 min |
| `frontdoor-apim` | **Front Door** Standard/Premium → APIM Basic v2 / Standard v2 origin, optional `X-Azure-FDID` check so the gateway only answers through this profile | 0.25 (Std) | 15–40 min |
| `hub-spoke-firewall` | Hub VNet + Azure Firewall Basic (policy, mgmt NIC), 1–3 peered spokes forced through the firewall by UDR | 0.41 | 10–20 min |
| `apim-internal-appgw` | APIM Developer in **internal** VNet mode (stv2 NSG rules, own public IP), `azure-api.net` private zone, App Gateway WAF_v2 (DRS 2.1) publishing it | 0.52 | 40–75 min |
| `apim-selfhosted` | APIM Developer/Premium + gateway resource + API assigned to it, and the **v2 self-hosted gateway** container with the token wired in — on a B2s Linux VM running Docker (default; ports 8080/8081 only) or on Azure Container Apps (consumption, 0.5 vCPU) | 0.11 / 0.12 | 30–55 min |
| `apim-workspaces` | APIM **Premium** with a workspace (*Team A*), an API inside it and a dedicated **workspace gateway** (Standard/Premium) | 4.51 / 5.75 | 45–80 min |
| `appgw-mtls` | App Gateway Standard_v2 with **frontend mutual TLS** (SSL profile, trusted client CA, optional issuer-DN check), client-cert headers forwarded to httpbin; certificates generated for you | 0.25 | 8–20 min |
| `dns-resolver-hybrid` | **DNS Private Resolver**: inbound endpoint (static 10.95.0.4), outbound endpoint, forwarding ruleset (`onprem.contoso.test` → 10.200.0.4), `lab.internal` zone, optional spoke using the resolver as DNS | 0.50 | 5–15 min |

`apim-classic` also takes a **2nd region** (Premium, VNet None): an additional location with the same units, billed at
the primary region's unit price and checked for tier availability in that region.

Blueprints live in `blueprints/<id>/` as Bicep built on [Azure Verified Modules](https://aka.ms/avm). AVM defaults that
inflate lab cost (zones `[1,2,3]`, APIM capacity 3, fixed App Gateway capacity 2) are overridden explicitly.
`server/labs/blueprints.ts` declares each blueprint's parameters, rules, presets, stages/gates, quotas, progress steps
and price meters.

**Launch** (Catalog) → pick a preset or region, parameters, lifetime and purpose; the hourly estimate comes from the public
[Retail Prices API](https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices) (Front Door's
monthly base fee is spread per hour; the private endpoint uses its list price). Invalid combinations (e.g. VNet injection on
Standard, 2 Developer units) are flagged as you choose them and rejected by the server.

**Feasibility preflight** — *Check & launch* runs every check that can fail a deployment before anything is created;
a clean result launches straight away, failures block (with a fix where possible) and warnings need *Launch anyway*:

| Check | Source |
|---|---|
| Configuration | Blueprint rules (tier vs VNet mode, units per tier) |
| Resource providers | Registration state per namespace — **Register** button when missing |
| Available in region | Provider metadata per resource type (global types pass) |
| APIM tier | Subscription SKU catalog: offered + unrestricted in the region, units ≤ regional capacity; suggests regions that have it |
| Network quotas | `Microsoft.Network` regional usages (public IPs, VNets, NSGs, App Gateways, route tables, private endpoints) |
| VM sizes | Compute SKU list for the region (offered, not `NotAvailableForSubscription`) and family + regional vCPU quota |
| Permissions | Effective RBAC actions (wildcards and notActions) for every `…/write` the lab needs |
| Lifetime | Deploy time (per parameters, e.g. Premium/VNet take longer) vs the chosen lifetime |
| Budget | Lab cost over its lifetime vs the live month-end forecast and budget; any lab ≥ $1/h warns |
| Names | Resource group free; APIM name available (soft-deleted names count as taken) |
| Template + policy | Deployment-stack *validate* (template, Azure Policy) |

**Stages and readiness gates** — blueprints deploy in stages (the template's `stage` parameter; every stage contains the
previous ones, so the stack never deletes earlier work). After each stage a gate polls for the *real* signal before the
next stage starts:

| Gate | Waits for | Used by |
|---|---|---|
| APIM ready | `Succeeded`, private IP (VNet modes), required `/networkstatus` dependencies `Success`, gateway `status-0123456789abcdef` 200 when publicly reachable | quick start, classic, PE, internal + App GW, Front Door |
| Firewall IP | Firewall `Succeeded` with a private IP (routes need it) | hub-spoke |
| Peerings | Every peering `Connected` / `FullyInSync` | hub-spoke |
| App GW end-to-end | Backend health `Healthy`, then the sample request returns 200 | internal + App GW |
| PE approved | Connection `Approved`, endpoint NIC IP, `privatelink.azure-api.net` A record → that IP | PE |
| Public gateway closed | `publicNetworkAccess=Disabled` and a public API call rejected with 403 (the `status-0123456789abcdef` health endpoint keeps answering 200 by design) | PE |
| Edge 200 | Front Door endpoint 200 (propagation 10–20 min) and the direct gateway call blocked (403) | Front Door |
| Self-hosted gateway | The VM / Container App serves `/httpbin/get` through the v2 gateway | self-hosted |
| Workspace gateway | The workspace gateway hostname serves the workspace API | workspaces |
| mTLS | 200 with the client certificate, refused without it (400), cert headers seen by the backend | App GW mTLS |
| Resolver | Resolver `Connected`, inbound/outbound endpoints provisioned, inbound IP | DNS resolver |

Blocking gates (needed by the next stage) fail the lab with the stage and reason; **Resume k/N** continues from that
stage instead of starting over. Gates on the last stage are non-blocking: the lab is Ready with a readiness warning.
The Labs card shows a stage track, the live gate status and **~N min left**.

**Generated values** — some stages need values only labctl can produce: the self-hosted gateway **token** (generated
through ARM `generateToken` after APIM exists, passed as a secure parameter), a random gateway **VM password** (no SSH\nport is opened) and the mTLS **certificates** (a lab CA,
a server certificate for the gateway's DNS name and a client certificate, generated locally with node-forge and kept
in `data/labs/<lab>/` with `client.pfx` (password `labctl`) and a ready Windows `curl` command shown on the lab — deleted
with the lab). Pre-launch validation uses placeholders for them.

**Learned deploy times** — every run records stage, gate and total durations per blueprint *variant* (tier, VNet mode,
regions…) in `lab_timings`; earlier labs are backfilled. Estimates, the lifetime check and the ETA use your last runs
(same region preferred) and fall back to the static range until there is data.

**Cheapest viable** — when the checks show a blocker another region or tier avoids (tier not offered, quota, a recent
capacity shortage) or cost pressure, the launch dialog lists deployable alternatives sorted by price — same setup in
another enabled region, or a blueprint-declared cheaper variant with what it gives up (e.g. *Developer instead of
Premium — loses SLA, scale units, zones and multi-region*) — plus the longest lifetime that keeps the month within
budget. **Apply** fills them in.

**Capacity memory** — regional shortages can't be queried ahead of time. When a deployment fails with one
(`…CapacityHeavyUsage`, `AllocationFailed`, `SkuNotAvailable`…), it's remembered for 24 h per blueprint *variant*: launches of\nthat variant in that region get a *Capacity* warning and alternatives move to another region or host (e.g. the\nself-hosted gateway's Container Apps host was short in centralus and eastus while its VM host was fine).

**Lifecycle** — each lab is a subscription-scope **deployment stack** (`labctl-<lab>`) that owns a tagged resource group
(`managedBy=labctl`, `expiresOn`, `blueprint`, `purpose`, `owner`, `createdOn`, optional `caseId`). Destroy removes the
stack without touching resources (detach), deletes the resource group — letting Azure order everything — then purges
soft-deleted API Management so names are reusable immediately. (Deleting *through* the stack removes resources one by
one, including APIM APIs/operations via the management endpoint on 3443, which is unreachable for VNet-injected APIM
while its network is torn down.) The Labs screen shows live per-module progress, outputs (URLs, sample `curl`),
countdown, running cost, **+4h / +1d**, **Retry / Resume** for failed deployments (re-applies the blueprint to the same
stack from the failed stage, keeping expiry and case tags) and **Destroy**, plus a history with estimated cost per lab.

**Expiry** — a local sweeper runs at start-up and every `labs.sweepIntervalMinutes` (default 15) while the app is
open, destroying only groups that pass the auto-delete policy. After a restart, labs left mid-deploy or mid-destroy are
reconciled against Azure (staged labs wait for the in-flight stage, then continue with its gate and the remaining
stages; destroys are re-run or marked done).

Set `LABCTL_PORT` / `LABCTL_SWEEP=0` to run a second instance (e.g. for testing) alongside your main one.

## Investigate

| Feature | Where | What it does |
|---|---|---|
| **Validate** | Lab card · Inventory group header (pulse icon) | Per-type health checks: App Gateway **backend health** (with probe log), APIM provisioning, gateway `/status-0123456789abcdef` probe and VNet **network status** dependencies, firewall allocation / private IP / rules, route-table **next hops** (black-holed, parked firewall, or a *public* IP such as a firewall's or APIM's — with the correct private IP), VNet **peerings** (state, sync, deleted remote VNet), private DNS zone **links** and `azure-api.net` A records vs APIM private IPs, public IP DNS names, plus end-to-end HTTP probes from lab outputs. Problems on unattached route tables are reported as *latent* warnings. |
| **Topology** | Lab card · Inventory group header | Network diagram laid out with ELK: VNets → subnets → injected resources (official icons), NSG / route table / NAT badges on subnets, UDR next-hop edges, peerings, private DNS links, public IPs folded onto their owners, *reserved-for* links, out-of-group dependencies dashed, unlinked resources in a grid. Pan/zoom, hover to isolate, **Download SVG** (icons inlined). |
| **Save as blueprint** | Inventory group header (upload icon) | Exports a resource group's template and makes it re-deployable as a lab: names derived from the lab name, global names and DNS labels prefixed, location/tags parameterised, VNet inline-peering cycles removed, outside references flagged. Keeps `lab.bicep` when the decompiled Bicep compiles, otherwise deploys `lab.json` (ARM). Priced from the template's SKUs. Saved in `blueprints/custom-*` (git-ignored). |
| **Repro from case** | Catalog | Paste a case # and symptoms; keyword signals (App Gateway, internal/stv2, 502/backend health, private DNS, firewall, UDR, spokes, v2 tiers, policies, regions…) pick a blueprint, parameters and region with the reasons shown. The lab is tagged `caseId`; the case text is analysed locally and not stored. |

The UI defaults to **dark mode**; the sun/moon button in the sidebar switches and remembers the choice.

## Automations

These are personal and optional: the Windows task works for anyone (`npm run task -- -Install`); the Teams nudges
and weekly report are Scout automations set up for one user.

| What | How | Where it reports |
|---|---|---|
| **Expiry sweep at logon / unlock** | Windows task `\labctl\labctl expiry sweep` runs `scripts/sweep.ts` hidden (via `conhost --headless`), so expired labs are destroyed even when the app is closed. Never runs two copies at once. | `data/logs/sweep.log` |
| **Expiry nudges** | `scripts/nudge.ts` lists labs expiring within 75 min, or overdue and still running; each lab + expiry is reported once (an Extend resets it). Prints `NONE` otherwise. | Teams via a Scout automation (every 30 min, 7am–10pm) |
| **Weekly report** | `scripts/weekly-report.ts` runs a fresh audit and summarises spend vs budget and forecast, week-over-week trend, labs launched / running, open findings and what changed since the last report. | Teams via a Scout automation (Mondays 9am); copy in `data/reports/weekly-*.txt` |

```powershell
npm run task -- -Install | -Status | -Run | -Uninstall   # manage the logon/unlock task
npm run sweep [-- --dry-run]                          # sweep now from the command line
npm run nudge                                         # preview nudges (add -- --mark to record them as sent)
npm run weekly                                        # print this week's report
```

The app, the task and the scripts share `data/labctl.db`. Each job records its process ID, and a "running" job is only
treated as interrupted when that process is gone; job start is a single write transaction, so two processes can never
work on the same lab at once.

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
