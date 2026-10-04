# 01 · Farmacia Pura Vida: digital receipts

Blueprint `cr-farmacia-recibos` · code `cfarm` · **Status: Built** (infrastructure and Spanish cashier app; not yet deployed to Azure)

**Exam mapping:** AZ-900 (cloud concepts: PaaS, serverless, consumption pricing; storage redundancy) · DP-900 (non-relational data).

## Scenario
A family pharmacy in San José replaces paper receipts with digital ones. It wants a record of every sale for the
monthly accounts and a screen the cashier can open from any computer, without buying or maintaining a server.

## Students learn
- Choose PaaS and serverless services instead of virtual machines, and say why.
- Explain LRS vs GRS redundancy and when a business pays for it.
- Compare a document database with a relational one (contrast with lab 02).
- Find the resources, region and cost of a workload in the portal.

## Architecture
Static Web App (Free) with the cashier app, Cosmos DB serverless (`ventas`, `productos`), Storage account (`recibos`, private).

## Knobs
`redundancy`: LRS or GRS.

## Cost and time
About $0/hour idle (usage-based). Deploy 3 to 8 min. Suggested lifetime: one class.

## Class activities (instructor-led)
Open the app and make a sale; find each resource in the portal; change storage redundancy and read the cost change;
explain why Cosmos DB is "serverless".

## Build notes and risks
- Next step: a Static Web Apps managed API so sales really land in Cosmos DB and receipts in Blob Storage.
- Cosmos DB capacity is occasionally short in some regions; the engine's capacity memory covers it.
- IVA rates in the app are demo values; confirm before class.
