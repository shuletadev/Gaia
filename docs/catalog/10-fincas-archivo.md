# 10 · Coffee farms: photo archive

Blueprint `cr-fincas-archivo` · code `cfinca` · **Status: Spec** · Batch 2

**Exam mapping:** DP-900 (non-relational data: unstructured data, blob storage; core data concepts) · AZ-900 (architecture and services: storage services, access tiers, redundancy, migration tools).

## Scenario
A coffee cooperative in Los Santos has years of photos of harvests, soil tests and inspection reports on a few hard
drives. Some drives already failed once. The photos from this year are used daily; the ones from five years ago almost
never, but must be kept.

## Students learn
- Place photos, reports and logs on the structured / semi-structured / unstructured spectrum.
- Choose Hot, Cool or Archive for different files and explain the cost trade-off and retrieval delay.
- Create a lifecycle rule that moves and deletes data automatically.
- Explain soft delete, versioning and redundancy as protections against mistakes and failures.
- Compare Blob, Files, Queue and Table storage by use case.

## Architecture
Storage account with containers per farm, an Azure Files share for the office, lifecycle management rules
(30 days to Cool, 90 days to Archive), blob soft delete and versioning, and a **synthetic** photo and report set.

## Knobs
`redundancy`, `enableVersioning`, `lifecycleDays` (so the effect shows in class instead of in a year).

## Cost and time
About $0/hour. Deploy 2 to 4 min. Lifetime: one class.

## Student activities
Upload with Storage Explorer or AzCopy; set a blob to Archive and try to open it (rehydration); delete and recover a
blob; edit the lifecycle rule; compare the three tiers' prices on the pricing calculator.

## Student-mode policy pack
Standard storage accounts (LRS/GRS), no premium tiers, no immutable storage, capacity soft limit, region allowlist.

## Build notes and risks
- Needs a blob-upload content kind with generated synthetic files (small, so the repo stays light).
- Archive rehydration takes hours: demonstrate that it is blocked, do not wait for it.
- Lifecycle rules run on a daily schedule, so they will not act within class; teach them by inspecting the rule.
