# 20 · Municipalidad de Grecia: who can do what

Blueprint `cr-municipio-accesos` · code `cmuni` · **Status: Built** (Bicep, blueprint, tests; not deployed to Azure) · Batch 4

**Exam mapping:** AZ-900 (Azure role-based access control, Zero Trust, defense in depth) · AZ-104 (manage access to Azure resources: built-in roles, assign roles at different scopes, interpret access assignments).

## Scenario
A municipality lets three groups work in one subscription: auditors who only look, operations staff who manage the storage account,
and a data team who read and write water reports. The mayor asks who exactly can do what, and why the internal reports page stopped
working after someone "cleaned up permissions".

## Students learn
Assigning built-in roles at three scopes; reading IAM and Check access; control-plane versus data-plane roles; removing and re-adding a
managed identity's role and watching access disappear and return; least privilege; managed identities versus keys.

## Architecture / Knobs
Three user-assigned managed identities as stand-ins for people (users and groups live in the tenant, not the subscription), a
storage account with an `informes` container, a Node web app with a system-assigned identity that reads
`informes/informe-acueducto.txt` using a token (no key), and role assignments: **Reader** on the group (audit), **Contributor** on
the storage account (operations), **Storage Blob Data Contributor** on the container (data), **Storage Blob Data Reader** on the
container (the web app). Knobs: `appTier` (Free or Basic), `appHasAccess` (start with or without the app's role).

## Cost and time
About $0/h on Free (Basic adds $0.018/h). Deploy 3 to 6 min. Lifetime: a class.

## Class activities (instructor-led)
Open the page and read the report. In the portal open the container's Access control (IAM): list the assignments, use Check access for
the operations identity (it can manage the account but is not a data reader through Entra), remove the app's assignment, wait a minute
or two, read again (denied), add it back (allowed). Show inheritance: the Reader at the group scope shows on the account too.
Discussion (no template): custom roles, Entra users and groups, PIM and management groups are tenant-level (see card 15).

## Build notes and risks
- **Needs Owner or User Access Administrator** to deploy and to destroy (preflight checks `roleAssignments/write`).
- Role changes can take a few minutes to reach a token the app already holds; the page asks for a fresh token each time, but the platform caches identity tokens for a while.
- No custom role is created, so nothing is left in the subscription after a destroy.
- Verified locally: the server's token flow and the denied case, with fake identity and storage servers.

## As built
- Modules `identities`, `storage`, `app`, `roles` (inside `lab`). Role definition IDs checked with `az role definition list`.
