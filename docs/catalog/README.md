# Gaia lab catalog: spec cards

One card per lab, written **before** any Bicep. Review and prune here; build only what survives.
Status of every card: **Spec** (not built) unless noted.

> **Verify before publishing.** Exam domains and topics below are mapped from the published skills outlines as I know
> them, and prices are rough list-price estimates. Check each exam's current study guide on Microsoft Learn (outlines
> change, and AI-900 and DP-900 have changed recently) and the Retail Prices API (the launch dialog already uses it)
> before a card becomes course material.

## How to read a card

| Section | Why it exists |
|---|---|
| Exam mapping | Which exam section the lab lets you explain |
| Scenario | The Costa Rican business story told in class |
| Students learn | Observable outcomes, not feature lists |
| Architecture / Knobs | What Gaia deploys and which parameters the instructor turns to teach a concept |
| Cost and time | Idle cost per hour, deploy time, suggested lifetime |
| Student activities | What students do in the Azure portal (mode 2) or the instructor demonstrates (mode 1) |
| Student-mode policy pack | The resource types and settings a student may create for this lab's course (feeds the policy-pack feature) |
| Build notes and risks | What the engine, quotas, soft-delete or licensing will make hard |

## The cards

| # | Lab | Blueprint id | Exam | Idle cost | Batch |
|---|---|---|---|---|---|
| [01](01-farmacia-recibos.md) | Farmacia Pura Vida: digital receipts | `cr-farmacia-recibos` | AZ-900, DP-900 | ~$0 | **Built** |
| [02](02-pulperia-inventario.md) | Pulpería Don Beto: inventory | `cr-pulperia-inventario` | DP-900, AZ-900 | low | 1 |
| [03](03-soda-sitio-web.md) | Soda Doña Rosa: website and DNS | `cr-soda-sitio-web` | AZ-900 | ~$0 | 1 |
| [04](04-taller-servidores.md) | Taller Los Ángeles: servers (IaaS vs PaaS) | `cr-taller-servidores` | AZ-900 | low | 1 |
| [05](05-cooperativa-gobierno.md) | Cooperativa: governance | `cr-cooperativa-gobierno` | AZ-900 | free | 1 |
| [06](06-tour-escala.md) | Tour operator: scale and uptime | `cr-tour-escala` | AZ-900 | moderate | 2 |
| [07](07-facturas-escaner.md) | Invoice scanner | `cr-facturas-escaner` | AI-900 | pay-per-use | 1 |
| [08](08-resenas-turismo.md) | Tourist reviews | `cr-resenas-turismo` | AI-900 | pay-per-use | 1 |
| [09](09-guia-turistico.md) | Tourist guide chat | `cr-guia-turistico` | AI-900 | varies | 2 |
| [10](10-fincas-archivo.md) | Coffee farms: photo archive | `cr-fincas-archivo` | DP-900, AZ-900 | ~$0 | 2 |
| [11](11-ventas-reporte.md) | Monthly sales report | `cr-ventas-reporte` | DP-900 | low | 2 |
| [12](12-clinica-seguridad.md) | Clinic: protecting data | `cr-clinica-seguridad` | SC-900 | low | 1 |
| [13](13-sucursales-red.md) | Branch network (later) | `cr-sucursales-red` | AZ-104 | moderate | 3 |
| [14](14-cafe-demanda.md) | Coffee: seasonal demand (ML) | `cr-cafe-demanda` | AI-900 | low + compute | 2 |
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

## Engine and platform work the catalog implies

Gathered from the cards, so the cards drive the platform backlog instead of the reverse.

| Needed by | Work |
|---|---|
| 03, 10 | Content kind that turns on a Storage account's static website and uploads files (a data-plane call, not ARM) |
| 07, 08, 10, 11, 14 | Content kind that uploads sample files (generated, synthetic data) to Blob Storage |
| 02, 11 | Content kind that seeds a database or data lake (SQL script, CSV/Parquet) |
| 04, 06 | App Service content (zip deploy) or a public container image, so the page is not Azure's default |
| 05 | Remove resource locks before destroying a lab; policy assignments at resource-group scope |
| 07, 08, 09, 12, 14 | Purge soft-deleted Key Vaults, AI services accounts and ML workspaces when a lab is destroyed, so names can be reused (the old APIM purge did this for one service) |
| 07, 08, 09, 14 | Preflight for access-gated services and compute quotas (the VM-size and quota checks already exist) |
| all | Student-mode policy pack generated from each card's allowed types |
