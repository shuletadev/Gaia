---
name: microsoft-learn-labs-inventory
description: "What the official Microsoft Learn labs for AZ-900, AI-900, DP-900 and SC-900 deploy, the user's answers on delivery, and the guardrail implications for Gaia"
metadata:
  node_type: memory
  type: reference
  originSessionId: 8c633da8-44a4-4227-a1dd-10ebf615cc32
  modified: 2026-10-04T21:16:28.163Z
---

Inventory of the labs students run (researched 2026-10-04 from the `MicrosoftLearning` GitHub org and Learn pages) lives in `docs/learn-labs/` (README plus one file per exam).

Facts worth remembering without re-reading:
- Students run these in the **business subscription** (pay-as-you-go offer, per the user). The Learn sandbox is unreliable and the 2026 Azure Fundamentals modules have no exercise units; labs live in GitHub repos.
- Current repos: `AZ-900-Microsoft-Azure-Fundamentals` (5 labs), `mslearn-ai-fundamentals` (7 Foundry labs; the old `AI-900-AIFundamentals` is stale), `DP-900T00A-Azure-Data-Fundamentals` (SQL, Storage, Cosmos, then Fabric and Power BI), `SC-900-...` (needs a Microsoft 365 lab tenant from an authorized lab hoster).
- AZ-900 labs hard-code the resource group `IntroAzureRG`; the user accepts giving students a substitution note (their own group).
- The AZ-900 lock lab needs lock rights that Contributor lacks. Quotas (model tokens, vCPU families, free F0 resources) are subscription-wide.
- **No Microsoft Fabric yet** in the business tenant, so DP-900's Fabric labs cannot run hands-on for now.
- AZ-104 inventoried 2026-10-04 (`docs/learn-labs/az-104.md`): 14 labs, each makes its own `az104-rgN` group (two for lab 10), D2s_v5 VMs, Premium V3 App Service (09a), Application Gateway (06), Site Recovery (10), role assignments to self (07), policy and locks (02b); labs 01 (Entra users, guests) and 02a (management groups) are tenant-level and cannot run in the business tenant. AZ-900 re-checked: same five labs. AI repo re-checked: same seven exercises; AI-901 replaced AI-900 and no separate AI-901 lab repo was found.
- SC-900 delivery is undecided. Researched: Skillable (authorized lab hoster) gives MCTs free catalog access but paid student delivery is unverified; the M365 developer sandbox is not open to MCTs as such and is development-use only. Recommendation given: instructor demos for now.

**Why:** the catalog labs are instructor demos, so student guardrails must come from these labs, not from the catalog cards. See [[catalog-is-instructor-reference]].

**How to apply:** re-check the repos before each cohort (they change weekly). Next build: AZ-900 student sandbox (pre-created resource group per student, student role = Contributor + locks, policy from the lab list, expiry via Gaia's existing cleanup).
