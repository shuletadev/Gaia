# 17 · Dairy cooperative: storage administration

Blueprint `cr-lecheria-almacenamiento` · code `clech` · **Status: Built** (Bicep, blueprint, tests; not deployed to Azure) · Batch 4

**Exam mapping:** AZ-104 (configure access to storage: firewalls and virtual networks, SAS, stored access policies, keys · configure and manage storage accounts: redundancy, object replication, encryption, Storage Explorer and AzCopy · Azure Files and Blob Storage: tiers, soft delete, snapshots, lifecycle, versioning).

## Scenario
A dairy cooperative in Zona Norte keeps milk collection reports and producers' contracts in Azure Storage. A producer's assistant
needs access to one contract, the office wants only its own network to reach the account, and the manager wants a copy in a second
account in case someone deletes something by mistake.

## Students learn
SAS and stored access policies versus account keys; key rotation; the storage firewall; soft delete, versions, share snapshots;
object replication; lifecycle rules.

## Architecture / Knobs
Virtual network with a subnet that has the Storage service endpoint; main account (Hot, versioning, change feed, 7-day soft delete
for blobs and containers, container `documentos`, Azure Files share `oficina` with soft delete, lifecycle rule to Cool at 30 days
and Archive at 180); optional second account with versioning for object replication. Firewall is **open at the start** (default
action Allow; the subnet is already listed) so the upload works, and the class turns it on. Knobs: `redundancy` (LRS/ZRS/GRS),
`includeReplica`.

## Cost and time
About $0/h idle (a few KB of data). Deploy 3 to 6 min. Lifetime: a class.

## Class activities (instructor-led)
Commands the instructor runs (names come from the lab's outputs):

```bash
# Account key versus SAS versus stored access policy
az storage container policy create --account-name <cuenta> --container-name documentos --name lectura --permissions rl --expiry 2030-01-01 --auth-mode key
az storage blob generate-sas --account-name <cuenta> --container-name documentos --name contratos/contrato-1.pdf --policy-name lectura --full-uri --auth-mode key
az storage account keys renew --account-name <cuenta> --resource-group <lab> --key key1   # old SAS signed with key1 stops working
# AzCopy
azcopy copy "acopio/*" "https://<cuenta>.blob.core.windows.net/documentos?<sas>" --recursive
```
In the portal: Networking, then **Selected networks**, add the virtual network and subnet and watch a browser outside it get a 403;
Data protection (restore a deleted blob, a previous version); Azure Files share snapshot; **Object replication** (source container
`documentos`, destination account the lab created, destination container `documentos`); lifecycle rule; redundancy options (try
changing LRS to GRS and read what happens).

## Build notes and risks
- Object replication is **not** in the template on purpose: the source policy needs an ID the destination policy generates, which cannot be a resource name in one deployment. The class creates it (a one-minute portal task, and an exam skill).
- Stored access policies and SAS tokens are data-plane: they cannot be created by the template.
- ZRS needs a region with zones. Identity-based access for Azure Files needs a domain (Entra Domain Services or AD DS): discussion only.
- Content upload happens before the class turns the firewall on; if a lab is re-uploaded after, the firewall must allow the deployer.

## As built
- Modules `network`, `storage` (twice: `orig` and `repl`), `lifecycle`. Synthetic content: four farms' milk collections for March 2025 and two example contracts (`dairy-docs`).
