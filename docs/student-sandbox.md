# Student sandbox (AZ-900 first)

Status 2026-10-05: **server side built and unit-tested; never run against Azure.** The **Students** screen lists sandboxes and has a
**New sandbox** form that ends on the message to send the student (in Spanish, with a Copy button). Each row has **Delete** (live
sandboxes) or **Create again** (ended or failed ones). This document describes what it would change in the business subscription, so
you can review it before anyone provisions a student.

## What it does

For one student and one course, Gaia creates **one resource group** in the business subscription and scopes everything to it:

| Piece | What | Where it lives |
|---|---|---|
| Group | `stu-<name>-az900`, tagged `managedBy=labctl`, `expiresOn`, `owner`, `kind=student-sandbox`, `course`, `student` | the subscription |
| Role: Contributor | the built-in role, for everything the labs create | on the student's group only |
| Role: **Gaia Student Locks** | a custom role with only `locks/read`, `locks/write`, `locks/delete` (Contributor is denied locks, and the AZ-900 lock lab needs them) | defined once on the subscription, assigned on the group |
| Policy: allowed locations | built-in, the eight US regions the labs use (the lock lab needs Central US) | on the group |
| Policy: blocked resource types | built-in "not allowed resource types": gateways, firewalls, Bastion, scale sets, AKS, SQL and other databases, Synapse, Databricks, Machine Learning, AI services, API Management and similar | on the group |
| Budget | monthly, $25 for AZ-900, mails the owner at 80% and 100% (it alerts; it does not stop spending) | on the group |

Because all of it is scoped to the group, **deleting the group removes the roles, policies and budget with it**. The student does that
when a lab says "delete the resource group"; the existing expiry sweep does it on the end date (it already removes locks first); an
admin can do it. A group that is gone shows as *ended* and can be created again with one call (**re-provision**), same name, same
student, new end date.

The student keeps no rights outside their group: no subscription-level role, no role assignment rights, no policy changes. The one thing
this adds outside a student's group is the custom role definition `Gaia Student Locks`, created the first time.

Student identity: Gaia looks the person up in the business tenant's directory (Microsoft Graph, read-only, with the admin's own
Azure CLI sign-in) by email or sign-in name. A student with a personal email must be **invited as a guest** first. It refuses when
nobody or more than one person matches.

## What the student is told

In Spanish (the guides are Spanish): where the lab says `IntroAzureRG`, use the student's own group (choose it from the list, they cannot
create groups); create resources only in the allowed regions; if a lab ends with "delete the resource group" they may, and the
instructor can create it again; Cloud Shell: continue without a storage account; the sandbox ends on a date. Gaia returns this text
when it provisions, and the New sandbox form shows it with a Copy button.

## How to try it (when you decide to)

Use the **Students** screen (Students, then New sandbox), or the calls below. From the running app (`npm start`) they need the
per-launch token from `GET /api/session` in the `x-labctl-token` header:

- `GET /api/sandboxes/courses`: the course packs.
- `POST /api/sandboxes` with `{ "student": "name@example.com", "course": "az-900", "days": 14 }`: creates one (a few seconds).
- `GET /api/sandboxes`: lists them and marks the ones whose group is gone as ended.
- `POST /api/sandboxes/<group>/reprovision`: creates it again after it ended.
- `DELETE /api/sandboxes/<group>`: deletes the group as a job.

Try it first with **one test student you control** (a second personal address invited as a guest), and read the result in the portal:
the group, its Access control (IAM) page, its policy assignments and its budget. Policies start blocking 5 to 30 minutes after they
are assigned.

## Decisions I need from you

1. **Custom role.** The lock role is the only change outside a student's group. The alternative is giving students Owner on their
   group, which also lets them assign roles inside it. I chose the narrow role.
2. **Blocked resource types.** The list in `server/sandbox/courses.ts` is my guess at "costly or slow to remove and not used by AZ-900".
   Read it; add or remove.
3. **Regions.** Eight US regions. A Costa Rica business may prefer fewer.
4. **Lifetime and budget.** 14 days and $25 are placeholders.
5. **Cloud Shell.** "Continue without storage" is the documented option I could not verify in a real subscription. If it does not
   work for a student who has no rights outside their group, the fix is a storage account inside the sandbox, and I would add it.
6. **The screen.** Needs your approval before I build it (see below).

## Not built

- **A spend column** on the Students screen (the groups are tagged with the student, but Gaia does not read the spend yet).
- **Per-student spend.** Groups carry the `student` tag, so Cost Management can already group by it; Gaia does not show it yet.
- **Quota admission control** for shared quota (vCPUs, model tokens): needed before AZ-104 and AI-901 cohorts.
- **AZ-104** needs a set of groups per student, constrained role assignments, a plan for the two tenant-level labs and quota checks
  (see [learn-labs/az-104.md](learn-labs/az-104.md)). **AI-901** needs model quota and region rules.
- **Two admins, two tenants:** the sandbox is stored in the local database of the Gaia that created it.

## Where the code is

`server/sandbox/` (`courses.ts` the packs, `sandbox.ts` the plan and the provisioning, `graph.ts` the directory lookup, `store.ts` the
table), the routes in `server/index.ts`, and `tests/sandbox.test.ts` (20 tests with a fake Azure client: payloads, order, rollback,
re-provisioning, guards).
