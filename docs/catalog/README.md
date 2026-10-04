# Gaia lab catalog: spec cards

> **Who these labs are for.** The catalog is **instructor reference material**: the instructor deploys a lab to show a
> real Costa Rican business scenario while explaining an exam topic. **Students do not build these.** The labs students
> build are Microsoft Learn's recommended labs (see ../ROADMAP.md). Student guardrails therefore come from what the Learn
> labs deploy, not from these cards.

One card per lab, written **before** any Bicep. Review and prune here; build only what survives.
Status of every card: **Spec** (not built) unless noted.

> **Verify before publishing.** Exam domains and topics below are mapped from the published skills outlines as I know
> them, and prices are rough list-price estimates. Check each exam's current study guide on Microsoft Learn (outlines
> change, and AI-900 and DP-900 have changed recently) and the Retail Prices API (the launch dialog already uses it)
> before a card becomes course material.

## How to read a carundefined - **Built** |

| Section | Why it exists |
|---|---|
| Exam mapping | Which exam section the lab lets you explain |
| Scenario | The Costa Rican business story told in class |
| Students learn | Observable outcomes, not feature lists |
| Architecture / Knobs | What Gaia deploys and which parameters the instructor turns to teach a concept |
| Cost and time | Idle cost per hour, deploy time, suggested lifetime |
| Class activities | What the instructor demonstrates and what attendees look at or answer during the demo |
| Build notes and risks | What the engine, quotas, soft-delete or licensing will make hard |

## The cards

| # | Lab | Blueprint id | Exam | Idle cost | Batch |
|---|---|---|---|---|---|
| [01](01-farmacia-recibos.md) | Farmacia Pura Vida: digital receipts | `cr-farmacia-recibos` | AZ-900, DP-900 | ~$0 | **Built** |
| [02](02-pulperia-inventario.md) | Pulpería Don Beto: inventory | `cr-pulperia-inventario` | DP-900, AZ-900 | low | 1 · **Built** |
| [03](03-soda-sitio-web.md) | Soda Doña Rosa: website and DNS | `cr-soda-sitio-web` | AZ-900 | ~$0 | 1 · **Built** |
| [04](04-taller-servidores.md) | Taller Los Ángeles: servers (IaaS vs PaaS) | `cr-taller-servidores` | AZ-900 | low | 1 · **Built** |
| [05](05-cooperativa-gobierno.md) | Cooperativa: governance | `cr-cooperativa-gobierno` | AZ-900 | free | 1 · **Built** |
| [06](06-tour-escala.md) | Tour operator: scale and uptime | `cr-tour-escala` | AZ-900 | moderate | 2 · **Built** |
| [07](07-facturas-escaner.md) | Invoice scanner | `cr-facturas-escaner` | AI-900 | pay-per-use | 1 · **Built** |
| [08](08-resenas-turismo.md) | Tourist reviews | `cr-resenas-turismo` | AI-900 | pay-per-use | 1 · **Built** |
| [09](09-guia-turistico.md) | Tourist guide chat | `cr-guia-turistico` | AI-900 | varies | 2 · **Built** |
| [10](10-fincas-archivo.md) | Coffee farms: photo archive | `cr-fincas-archivo` | DP-900, AZ-900 | ~$0 | 2 · **Built** |
| [11](11-ventas-reporte.md) | Monthly sales report | `cr-ventas-reporte` | DP-900 | low | 2 · **Built** |
| [12](12-clinica-seguridad.md) | Clinic: protecting data | `cr-clinica-seguridad` | SC-900 | low | 1 · **Built** |
| [13](13-sucursales-red.md) | Branch network (later) | `cr-sucursales-red` | AZ-104 | moderate | 3 · **Built** |
| [14](14-cafe-demanda.md) | Coffee: seasonal demand (ML) | `cr-cafe-demanda` | AI-900 | low + compute | 2 · **Built** |
| [15](15-entra-demo.md) | Identity demo (instructor-led) | none (guide only) | SC-900, AZ-900 | n/a | 3 |

Cards 14 and 15 were added to cover exam sections the first 13 left empty.

## Coverage: at least one lab per exam section

| Exam | Section | Labs |
|---|---|---|
| **AZ-900** | Cloud concepts | 04 (IaaS vs PaaS, shared responsibility), 06 (scalability, reliability), 01 |
| | Architecture and services | 03 (DNS, storage, regions), 10 (storage tiers, redundancy), 02, 12 (identity and security) |
| | Management and governance | 05 (policy, locks, budgets, tags), 04 (cost, tags) |
| **AI-900** | AI workloads and responsible AI | discussion in 07, 08, 09 |
| | Machine learning principles | 14 |
| | Computer vision | 07 |
| | Natural language processing | 08 |
| | Generative AI | 09 |
| **DP-900** | Core data concepts | 10, 11 |
| | Relational data | 02 |
| | Non-relational data | 01, 10 |
| | Analytics | 11 |
| **SC-900** | Security, compliance and identity concepts | 15, 12 |
| | Microsoft Entra capabilities | 15 (tenant-level, so instructor-led) |
| | Security solutions | 12 |
| | Compliance solutions | **Gap**: Microsoft Purview is a Microsoft 365 / tenant service, guide-only for now |
| **AZ-104** (later) | identity, storage, compute, networking, monitoring | 13, plus 04, 05, 10 |

PL-900 (Power Platform) and MS-900 (Microsoft 365) are not Azure infrastructure, so they have no labs here.

## Build order: one lab per section first

- **Batch 1** (one per section, cheapest to test): 04, 03, 05, 02, 07, 08, 12.
- **Batch 2:** 10, 11, 06, 14, 09.
- **Batch 3:** 13 (after demand for AZ-104 is clear) and the 15 guide.

## Engine and platform work the catalog implied

| Needed by | Work | Status |
|---|---|---|
| 03 | Enable a Storage static website and upload files (a data-plane setting) | **Done** (storage-static-site content step, Azure CLI) |
| 07, 08, 09, 10, 11, 14 | Upload synthetic sample files to Blob Storage | **Done** (blob-upload content step, deterministic generators in samples.ts) |
| 02 | Seed a SQL database | **Done** (sql-seed content step, tedious driver, opens the deployer IP) |
| 04, 06 | Page content on App Service without a deployment step | **Done** (tiny Node server through an app setting) |
| 05 | Remove resource locks before destroying a lab | **Done** (removeLocks) |
| 07, 08, 09, 12, 14 | Purge soft-deleted Key Vaults, AI accounts and ML workspaces on destroy | **Done** (purgeSoftDeleted, purgeMlWorkspaces) |
| 05, 11, 12 | Preflight warns when Owner rights are needed (role assignments, policy, locks) | **Done** (rbac check covers the extra types) |
| 07, 08, 09, 14 | Preflight for access-gated services (model access, ML compute quota) | Partly: VM-size quota is checked; model access and free-tier limits are not |
| all | Policy packs for the Microsoft Learn labs students build (not these cards) | Not started: needs an inventory of what each course's Learn labs deploy |
| all | A real deployment test pass in the sandbox | Not started (deferred until now, by choice) |
| all | Spanish class notes for the instructor (talk track per lab) | Not started; scope to confirm |
