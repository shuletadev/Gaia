# Microsoft Learn labs students will run: inventory (research, 2026-10-04)

Students do **not** build Gaia's catalog labs (those are instructor demos). They run Microsoft's own labs, in the
business subscription. This inventory records what those labs actually deploy, so student guardrails (policy,
budgets, access, cleanup) are built from fact instead of from our catalog cards.

## How this was researched

Read directly from Microsoft's published lab instructions on GitHub (`MicrosoftLearning` organisation) and from
Microsoft Learn pages, on 2026-10-04. Each exam file says what was read in full and what was only skimmed. **Not covered:
AZ-104** (later), and the content of every lab step: I extracted resources, SKUs, regions and permissions, not the whole
instructions. Re-check before each cohort: these repositories change often (several were updated within the last week).

| Exam | Source (last updated) | Labs |
|---|---|---|
| AZ-900 | [AZ-900-Microsoft-Azure-Fundamentals](https://github.com/MicrosoftLearning/AZ-900-Microsoft-Azure-Fundamentals) (2026-08-13) | 5 |
| AI-900 | [mslearn-ai-fundamentals](https://github.com/MicrosoftLearning/mslearn-ai-fundamentals) (2026-10-02); the older [AI-900-AIFundamentals](https://github.com/MicrosoftLearning/AI-900-AIFundamentals) (2024-09) is **stale** | 7 (current) |
| DP-900 | [DP-900T00A-Azure-Data-Fundamentals](https://github.com/MicrosoftLearning/DP-900T00A-Azure-Data-Fundamentals) (2026-06-22) | 6 |
| SC-900 | [SC-900-Microsoft-Security-Compliance-and-Identity-Fundamentals](https://github.com/MicrosoftLearning/SC-900-Microsoft-Security-Compliance-and-Identity-Fundamentals) (2026-10-02) | 14 labs + a setup lab, with matching demos |

Per exam: [AZ-900](az-900.md) · [AI-900](ai-900.md) · [DP-900](dp-900.md) · [SC-900](sc-900.md)

## What changed my assumptions

1. **The labs need a real subscription, not Microsoft's sandbox.** The Azure Fundamentals modules I checked on Learn
   (six of eleven, all updated in 2026) have **no exercise units any more**; the hands-on work is in the GitHub lab
   repository. Microsoft's own forum answers say the Learn sandbox is module-specific, time-limited and not always
   available. This supports running students in your business subscription.
2. **Fixed resource-group names collide.** AZ-900 labs tell every student to create `IntroAzureRG`; SC-900 uses
   `LabsSC900` and `SC900-Sentinel-RG`. In one shared subscription only one student can. Students need their own
   pre-created group, and a short substitution note ("where the lab says `IntroAzureRG`, use your group").
3. **Some labs need more than Contributor.** The AZ-900 resource-lock lab creates and deletes locks, which Contributor
   cannot do. The student role has to be Contributor **plus** lock rights on their own group (and still no role
   assignments or policy changes).
4. **Cloud Shell wants a storage account.** Several labs use Cloud Shell, which by default creates a storage account
   (and its own resource group) in the subscription. A student confined to one group will hit this. Options: pre-create
   it inside their group, or tell them to use an ephemeral session (to verify in a real subscription).
5. **Quotas are shared across the subscription.** Model deployments (GPT-5 family tokens-per-minute), vCPU families and
   free (F0) resources are per subscription and per region. A class deploying the same thing at once can exhaust them.
6. **Labs prescribe regions.** AZ-900 locks lab: Central US. AI-900 content understanding: West US, Sweden Central or
   Australia East. Foundry labs: a "recommended regions" list. The allowed-locations policy must be the union per course.
7. **"Leave default" sizes.** AZ-900 VM labs say to leave the VM size at its default (a D-series). A policy that
   restricts VM sizes can break the lab. Budgets and expiry are safer than size denies for these.
8. **Not everything is Azure.** SC-900's labs run in a **Microsoft 365 lab tenant provided by an "authorized lab
   hoster"**, with licenses and pre-built resources. DP-900's analytics labs use **Microsoft Fabric** (tenant-level, not a
   resource group) and Power BI Desktop (local). Gaia cannot guard or clean these with Azure Policy.
9. **Stale labs exist.** The old AI-900 repository (machine-learning designer labs, Custom Vision, bots) predates the
   exam's May 2025 update. The current repository is Foundry-only.

## What this means for Gaia

Student environment (proposal, for discussion):

- A **pre-created resource group per student**, tagged for Gaia's existing expiry and cleanup (the engine already
  adopts a group with an expiry and removes it when it passes). When a student's lab says "delete the resource group",
  they end their own sandbox: Gaia needs a one-click **re-provision**.
- A **student role** at group scope: Contributor plus lock rights, no role assignments, no policy changes.
- **Policy per course** built from the exam files here (allowed locations and resource types), with budgets and expiry as
  the real cost brakes.
- **Admission control** for shared quotas: stagger deployments of models and large VMs, and request quota ahead of class.
- **Outside Gaia's reach**: SC-900's tenant labs and DP-900's Fabric labs need their own delivery plan.

Decisions needed from you:

1. Are you comfortable giving students a one-page substitution note (their resource group instead of `IntroAzureRG`)?
2. How will you deliver SC-900's labs (an authorized lab hoster, a Microsoft 365 developer tenant, or demos only)? I
   did not verify what is currently available to independent MCTs.
3. Does the business tenant have Microsoft Fabric (a trial or a paid capacity) for the DP-900 labs?
4. Which model quota does the business subscription have for the AI-900 Foundry labs, and do you want to request more?

## Effect on the instructor catalog

- **Lab 11 (sales report)** is built on Synapse, but the current DP-900 labs teach Fabric. Keep it as a data-lake demo or
  add a Fabric variant (Fabric capacity can be created from a template, but needs tenant settings).
- **Lab 09 (guide chat)** already uses `gpt-5-mini`, the model the current AI-900 labs use.
- **Lab 14 (ML)**: the current AI-900 labs dropped the machine-learning designer exercises, but the exam still tests ML
  principles, so it stays a demo.
