# 10 · Coffee farms: photo archive

Blueprint `cr-fincas-archivo` · code `cfinca` · **Status: Built** (Bicep, blueprint, tests; not yet deployed to Azure) · Batch 2

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

## Class activities (instructor-led)
Upload with Storage Explorer or AzCopy; set a blob to Archive and try to open it (rehydration); delete and recover a
blob; edit the lifecycle rule; compare the three tiers' prices on the pricing calculator.

## Build notes and risks
- Needs a blob-upload content kind with generated synthetic files (small, so the repo stays light).
- Archive rehydration takes hours: demonstrate that it is blocked, do not wait for it.
- Lifecycle rules run on a daily schedule, so they will not act within class; teach them by inspecting the rule.

## As built
- One container (fincas) with a folder per farm instead of a container per farm; 9 synthetic PNG photos, 3 soil reports and a readme, generated at deploy time.
- Lifecycle rule: Cool after N days, Archive after 3N, delete after 12N (N is a knob, default 30). Soft delete (7 days) always on; versioning is a knob. A file share, a queue and a table are created so all four storage types can be compared.
