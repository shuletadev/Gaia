# 19 · Clínica Dental Sonrisa: backup and recovery

Blueprint `cr-dental-respaldo` · code `cdent` · **Status: Built** (Bicep, blueprint, tests, destroy support; not deployed to Azure) · Batch 4

**Exam mapping:** AZ-104 (implement backup and recovery: Recovery Services vault, Backup vault, backup policies, backup and restore, Site Recovery, backup reports and alerts).

## Scenario
A dental clinic in Cartago keeps appointments and files on one small server. A power surge corrupted the disk and the receptionist
re-typed two weeks of appointments. The owner wants automatic daily copies she can restore from, and to know what happens if the building floods.

## Students learn
Vault, policy and restore point; backing up on demand and reading the job; recovering a deleted file or restoring the disk;
locally versus geo-redundant backups; how a Backup vault differs from a Recovery Services vault; what Site Recovery adds.

## Architecture / Knobs
Ubuntu B1s server (no inbound rules, a public IP only so the backup extension can reach Azure; a data folder with fictional
files), a Recovery Services vault (redundancy set before first protection), a daily policy (02:00 UTC, N days), the server
protected by it (optional), and an empty Backup vault. Knobs: `vaultRedundancy`, `protectVm`, `retentionDays`.

## Cost and time
About $0.03/h: VM B1s $0.0125, disk $0.003, public IP $0.005, backup protected instance $10/month (about $0.014/h) plus storage.
Deploy 5 to 10 min. Lifetime: a class.

## Class activities (instructor-led)
Back up now; follow the job; delete `/srv/expedientes/citas-de-hoy.csv` through Run Command; recover it with File Recovery or
restore the disk to a new one; compare the policy's retention with the instant-restore days; open Backup center, reports and alerts;
open the (empty) Backup vault and compare its supported workloads; walk through enabling Site Recovery without finishing it.

## Build notes and risks
- **Destroy needed engine work (done):** a vault with backup items refuses to be deleted with its group. `purgeBackupItems` turns soft delete off, stops protection and deletes the data of every item in the lab's vaults before the group delete. If the instructor stopped protection earlier and kept the data, an item may sit in a soft-deleted state; the purge reports the error as a note and the group delete may fail until the item is undeleted and deleted in the portal.
- Backup of a VM creates a restore point collection in a service-managed group named `AzureBackupRG_<region>_1`; it is removed when the items are deleted (an empty leftover group is possible).
- The first backup takes a while; the initial protection is a registration, not a backup. Trigger one before class.
- Site Recovery is discussion only: failover needs a second region and more cost.

## As built
- Modules `server` and `vault` (inside `lab`). Protection uses the standard container and item naming (`iaasvmcontainer;iaasvmcontainerv2;<group>;<vm>`). The vault and Backup vault templates compiled without warnings; protection is the likeliest first-deploy surprise.
