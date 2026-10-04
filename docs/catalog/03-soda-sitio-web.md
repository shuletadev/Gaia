# 03 · Soda Doña Rosa: website and DNS

Blueprint `cr-soda-sitio-web` · code `csoda` · **Status: Built** (Bicep, blueprint, tests; not yet deployed to Azure) · Batch 1

**Exam mapping:** AZ-900 (architecture and services: regions, storage accounts and redundancy, DNS, endpoints; cloud concepts: the cost of simple hosting).

## Scenario
Doña Rosa's soda (a small restaurant) in Cartago wants a simple page with the menu, hours and a map, under her own
name. She has no IT staff and a very small budget.

## Students learn
- Host a static website from a Storage account and find its endpoint.
- Explain what DNS does and create the records (A, CNAME, TXT) that point a name at a site.
- Read the region, redundancy and cost of the account.
- Explain why a custom domain with HTTPS needs another service (and what that costs).

## Architecture
Storage account (Standard, static website enabled, `$web` container) with a Spanish menu page, an Azure DNS zone
(public) with sample records, and a diagram-ready layout.

## Knobs
`redundancy` (LRS/GRS/ZRS where offered), `accessTier` (Hot/Cool).

## Cost and time
About $0.50/month for the DNS zone plus storage pennies. Deploy 2 to 4 min. Lifetime: one class.

## Class activities (instructor-led)
Open the site URL; change a menu item and re-upload; add a CNAME record; explain what would be needed to serve
`www.sodadonarosa.example` over HTTPS (Front Door or CDN) and compare its price with this setup.

## Build notes and risks
- **Static website is not an ARM setting**: it is a data-plane property, so it needs a content kind (storage static site enable + upload).
- The DNS zone is not delegated to a real domain; students create records but nothing resolves publicly. Say so in the guide.
- A real custom domain is out of scope for the lab; it is a discussion and a price comparison.

## As built
- Static website is enabled and the Spanish menu uploaded by the new storage-static-site content step (Azure CLI with the account key in the environment).
- The account allows public blob access on purpose (a public website); every other container stays private. Shared key access is on because labctl uploads with the key.
- Records in the zone: A (documentation IP 203.0.113.10), CNAME www to the site host, TXT. The zone is not delegated, so nothing resolves publicly.
