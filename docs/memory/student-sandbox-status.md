---
name: student-sandbox-status
description: "AZ-900 student sandbox: built, tested and on the Students screen, but never run on Azure; first real test and decisions waiting on the user"
metadata:
  node_type: memory
  type: project
  originSessionId: 8c633da8-44a4-4227-a1dd-10ebf615cc32
  modified: 2026-10-05T12:56:20.895Z
---

Built and pushed 2026-10-05 (commits 394a525, 07f2a5b, fa7563b, b5b05a3): `server/sandbox/` (courses, plan and provisioning, Graph directory lookup, store), routes `/api/sandboxes*`, and the **Students** screen (list, New sandbox with a Spanish copyable message for the student, Delete, Create again). One group per student (`stu-<name>-az900`), Contributor plus a custom "Gaia Student Locks" role on that group only, two built-in policies (allowed locations, not-allowed resource types), a budget, expiry through the existing sweeper, re-provision after the group is deleted. 20 unit tests with a fake ARM client. **Never run against a real subscription**; the UI was checked only with mocked responses.

**Why:** AZ-900's Learn labs hard-code `IntroAzureRG`, need lock rights Contributor lacks, and students must not hold rights outside their group. See [[microsoft-learn-labs-inventory]].

**How to apply:** the next step is one real test with a student the user controls (a second address invited as a guest to the business tenant): check the group, its IAM, policies and budget in the portal, and whether Cloud Shell works without a storage account. Decisions still open for the user: the custom lock role versus Owner on the group, the blocked-types list, the eight US regions, the 14 day and $25 defaults. Not built: a spend column, quota admission control, AZ-104 (needs a set of groups per student, constrained role assignments, quota checks) and AI-901 (model quota and region rules). Details in `docs/student-sandbox.md` and `docs/HANDOFF.md`.
