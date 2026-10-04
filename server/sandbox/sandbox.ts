import { createHash } from "node:crypto";
import { ArmError, type ArmClient } from "../azure/arm.ts";
import type { LabctlConfig } from "../config.ts";
import { logAction, type Db } from "../db.ts";
import { EXPIRES_TAG, MANAGED_BY_TAG, MANAGED_BY_VALUE, assertAllowedSubscription } from "../guard.ts";
import { COURSES, getCourse, type CoursePack } from "./courses.ts";
import type { Directory, DirectoryUser } from "./graph.ts";
import { getSandbox, listSandboxes, saveSandbox, setSandboxStatus, type SandboxRow } from "./store.ts";

/**
 * A student sandbox: one resource group per student and course, where the student can do what the course's Learn labs
 * need and nothing else. Everything is scoped to that group, so deleting the group (the student at the end of a lab,
 * the expiry sweep, or an admin) removes the role assignments, policies and budget with it.
 *
 * Nothing here runs against Azure until an admin provisions a student: see docs/student-sandbox.md.
 */

const RG_API = "2021-04-01";
const ROLE_DEF_API = "2022-04-01";
const ROLE_ASSIGN_API = "2022-04-01";
const POLICY_API = "2023-04-01";
const BUDGET_API = "2023-05-01";

/** Built-in IDs, checked with `az policy definition show` and `az role definition list`. */
const POLICY_ALLOWED_LOCATIONS = "e56962a6-4747-49cd-b67b-bf8b01975c4c";
const POLICY_NOT_ALLOWED_TYPES = "6c112d4e-5bc7-47ae-a041-ea2d9dccd749";
const ROLE_CONTRIBUTOR = "b24988ac-6180-42a0-ab88-20f7382dd24c";

/**
 * Contributor cannot create or delete locks (it is denied everything under Microsoft.Authorization), and the AZ-900
 * lock lab does exactly that. This custom role adds only locks, and is assigned at the student's group.
 */
export const LOCK_ROLE_NAME = "Gaia Student Locks";
const LOCK_ROLE_ACTIONS = ["Microsoft.Authorization/locks/read", "Microsoft.Authorization/locks/write", "Microsoft.Authorization/locks/delete"];

export interface SandboxDeps {
  arm: Pick<ArmClient, "get" | "raw" | "lro">;
  db: Db;
  config: LabctlConfig;
  directory: Directory;
  now?: () => Date;
}

export interface ProvisionRequest {
  /** Email address or sign-in name of the student in the business tenant. */
  student: string;
  course: string;
  /** Lifetime in days (default: the course's). */
  days?: number;
  subscriptionId?: string;
}

export interface ProvisionResult {
  record: SandboxRow;
  /** What to tell the student: which group to use instead of the one the lab names, and the limits. */
  note: string;
  /** Things an admin should know (policies take minutes to apply, and so on). */
  warnings: string[];
}

export class SandboxError extends Error {}

/** A stable GUID from names, so provisioning twice produces the same role definition and assignment IDs. */
export function guidFrom(...parts: string[]): string {
  const h = createHash("sha1").update(parts.join("|").toLowerCase()).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** `maria.perez@correo.cr` becomes `maria-perez`: lower case, letters and digits, short. */
export function slugOf(email: string): string {
  const local = email.split("@")[0] ?? email;
  return (
    local
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24)
      .replace(/-+$/g, "") || "student"
  );
}

export function groupNameFor(email: string, course: CoursePack): string {
  return `stu-${slugOf(email)}-${course.id.replace(/-/g, "")}`;
}

async function exists(arm: Pick<ArmClient, "get">, path: string): Promise<boolean> {
  try {
    await arm.get(path);
    return true;
  } catch (e) {
    if (e instanceof ArmError && e.status === 404) return false;
    throw e;
  }
}

const rgPath = (sub: string, name: string) => `/subscriptions/${sub}/resourcegroups/${name}`;

/** The Azure payloads for one sandbox, as plain data so they can be read and tested without calling Azure. */
export function sandboxPlan(args: { sub: string; rgName: string; course: CoursePack; objectId: string; location: string; tags: Record<string, string>; owner: string; now: Date }) {
  const { sub, rgName, course, objectId, location, tags, owner, now } = args;
  const scope = `/subscriptions/${sub}/resourceGroups/${rgName}`;
  const lockRoleId = guidFrom("gaia-student-locks", sub);
  const roleRef = (id: string) => `/subscriptions/${sub}/providers/Microsoft.Authorization/roleDefinitions/${id}`;
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00Z`;
  const notify = (threshold: number) => ({ enabled: true, operator: "GreaterThan", threshold, thresholdType: "Actual", contactEmails: [owner] });

  return {
    scope,
    lockRole: {
      id: lockRoleId,
      path: `/subscriptions/${sub}/providers/Microsoft.Authorization/roleDefinitions/${lockRoleId}?api-version=${ROLE_DEF_API}`,
      body: {
        properties: {
          roleName: LOCK_ROLE_NAME,
          description: "Create and delete resource locks. Assigned to students on their own resource group, next to Contributor.",
          type: "CustomRole",
          permissions: [{ actions: LOCK_ROLE_ACTIONS, notActions: [] }],
          assignableScopes: [`/subscriptions/${sub}`],
        },
      },
    },
    group: { path: `${rgPath(sub, rgName)}?api-version=${RG_API}`, body: { location, tags } },
    roleAssignments: [
      { label: "Contributor", roleId: ROLE_CONTRIBUTOR },
      { label: LOCK_ROLE_NAME, roleId: lockRoleId },
    ].map((r) => {
      const name = guidFrom(scope, objectId, r.roleId);
      return {
        label: r.label,
        path: `${scope}/providers/Microsoft.Authorization/roleAssignments/${name}?api-version=${ROLE_ASSIGN_API}`,
        body: { properties: { roleDefinitionId: roleRef(r.roleId), principalId: objectId, principalType: "User", description: `Gaia student sandbox (${course.id})` } },
      };
    }),
    policies: [
      {
        label: "Allowed locations",
        path: `${scope}/providers/Microsoft.Authorization/policyAssignments/gaia-allowed-locations?api-version=${POLICY_API}`,
        body: {
          properties: {
            displayName: "Gaia student sandbox: allowed locations",
            description: `Resources can only be created in the regions the ${course.title} labs use.`,
            policyDefinitionId: `/providers/Microsoft.Authorization/policyDefinitions/${POLICY_ALLOWED_LOCATIONS}`,
            parameters: { listOfAllowedLocations: { value: course.allowedLocations } },
            enforcementMode: "Default",
            nonComplianceMessages: [{ message: `This sandbox only allows these regions: ${course.allowedLocations.join(", ")}.` }],
          },
        },
      },
      {
        label: "Blocked resource types",
        path: `${scope}/providers/Microsoft.Authorization/policyAssignments/gaia-blocked-types?api-version=${POLICY_API}`,
        body: {
          properties: {
            displayName: "Gaia student sandbox: blocked resource types",
            description: `Types the ${course.title} labs do not use and that are costly or slow to remove.`,
            policyDefinitionId: `/providers/Microsoft.Authorization/policyDefinitions/${POLICY_NOT_ALLOWED_TYPES}`,
            parameters: { listOfResourceTypesNotAllowed: { value: course.blockedTypes } },
            enforcementMode: "Default",
            nonComplianceMessages: [{ message: "This resource type is not used by the course labs and is blocked in the sandbox. Ask your instructor." }],
          },
        },
      },
    ],
    budget: {
      path: `${scope}/providers/Microsoft.Consumption/budgets/gaia-student?api-version=${BUDGET_API}`,
      body: {
        properties: {
          category: "Cost",
          amount: course.budgetUsd,
          timeGrain: "Monthly",
          timePeriod: { startDate: month },
          notifications: { alerta80: notify(80), alerta100: notify(100) },
        },
      },
    },
  };
}

/** The message for the student: the group to use where the lab names its own, and what the sandbox allows. */
export function substitutionNote(rgName: string, course: CoursePack, expiresOn: string): string {
  const lab = course.labGroupNames.length ? course.labGroupNames.map((n) => `\`${n}\``).join(" and ") : "the resource group";
  return [
    `Your sandbox for ${course.title} is the resource group \`${rgName}\`. It already exists: you cannot create new groups.`,
    `Where a lab tells you to create or use ${lab}, use \`${rgName}\` instead (choose it from the list; do not try to create it).`,
    `Create resources only in: ${course.allowedLocations.join(", ")}. A few costly services are blocked on purpose.`,
    `If a lab ends with "delete the resource group", you may. That ends your sandbox, and your instructor can create it again.`,
    `Cloud Shell: when it asks for storage, choose to continue without a storage account.`,
    `Your sandbox is deleted automatically on ${expiresOn.slice(0, 10)}, with everything in it.`,
  ].join("\n");
}

function pickUser(matches: DirectoryUser[], student: string): DirectoryUser {
  if (matches.length === 0) throw new SandboxError(`No one in the business tenant matches ${student}. Invite them as a guest first, or check the address.`);
  if (matches.length > 1) throw new SandboxError(`${matches.length} people match ${student} (${matches.map((m) => m.userPrincipalName).join(", ")}). Use the exact sign-in name.`);
  return matches[0]!;
}

export async function provisionSandbox(deps: SandboxDeps, req: ProvisionRequest): Promise<ProvisionResult> {
  const { arm, db, config } = deps;
  const course = getCourse(req.course);
  const days = req.days ?? course.ttlDays;
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new SandboxError("Days must be a whole number from 1 to 90");
  const sub = req.subscriptionId ?? config.subscriptions[0]!.id;
  assertAllowedSubscription(config, sub);

  const user = pickUser(await deps.directory.find(req.student), req.student);
  const now = (deps.now ?? (() => new Date()))();

  // One sandbox per student and course. A second, with a name clash between two students, gets a suffix.
  let rgName = groupNameFor(user.mail ?? user.userPrincipalName, course);
  const taken = getSandbox(db, rgName);
  if (taken && taken.object_id !== user.id) rgName = `${rgName}-${user.id.slice(0, 4)}`;
  const mine = getSandbox(db, rgName);
  if (mine?.status === "active" && (await exists(arm, `${rgPath(sub, rgName)}?api-version=${RG_API}`))) {
    throw new SandboxError(`${user.userPrincipalName} already has the sandbox ${rgName} (expires ${mine.expires_on.slice(0, 10)}). Delete it first, or extend it.`);
  }
  if (await exists(arm, `${rgPath(sub, rgName)}?api-version=${RG_API}`)) throw new SandboxError(`A resource group named ${rgName} already exists and is not an active sandbox.`);

  const location = course.allowedLocations[0]!;
  const expiresOn = new Date(now.getTime() + days * 86_400_000).toISOString();
  const tags: Record<string, string> = {
    [MANAGED_BY_TAG]: MANAGED_BY_VALUE,
    [EXPIRES_TAG]: expiresOn,
    owner: config.owner,
    kind: "student-sandbox",
    course: course.id,
    student: user.mail ?? user.userPrincipalName,
  };
  const plan = sandboxPlan({ sub, rgName, course, objectId: user.id, location, tags, owner: config.owner, now });
  const row: SandboxRow = {
    rg_name: rgName,
    subscription_id: sub,
    student_upn: user.mail ?? user.userPrincipalName,
    student_name: user.displayName,
    object_id: user.id,
    course: course.id,
    location,
    budget_usd: course.budgetUsd,
    created_at: now.toISOString(),
    expires_on: expiresOn,
    status: "failed",
    ended_at: null,
    error: null,
  };

  await applyPlan(deps, plan, row);
  row.status = "active";
  saveSandbox(db, row);
  logAction(db, { action: "sandbox.provision", target: rgName, outcome: "ok", detail: `${row.student_upn} (${course.id}), expires ${expiresOn.slice(0, 10)}` });
  return {
    record: row,
    note: substitutionNote(rgName, course, expiresOn),
    warnings: ["Policies take 5 to 30 minutes to start blocking, and a new role assignment can take a few minutes to show in the student's portal."],
  };
}

/** Creates the group and everything scoped to it. If a step fails, the half-built group is removed and the failure is recorded. */
async function applyPlan(deps: SandboxDeps, plan: ReturnType<typeof sandboxPlan>, row: SandboxRow): Promise<void> {
  const { arm, db } = deps;
  let groupMade = false;
  try {
    // The custom role is defined once per subscription (the same ID every time, so this is safe to repeat).
    await arm.raw("PUT", plan.lockRole.path, plan.lockRole.body);
    await arm.raw("PUT", plan.group.path, plan.group.body);
    groupMade = true;
    for (const r of plan.roleAssignments) {
      try {
        await arm.raw("PUT", r.path, r.body);
      } catch (e) {
        if (!(e instanceof ArmError && e.status === 409 && e.code === "RoleAssignmentExists")) throw e;
      }
    }
    for (const p of plan.policies) await arm.raw("PUT", p.path, p.body);
    await arm.raw("PUT", plan.budget.path, plan.budget.body);
  } catch (e) {
    const detail = (e as Error).message.slice(0, 500);
    if (groupMade) await arm.lro("DELETE", plan.group.path, undefined, { timeoutMs: 10 * 60_000, pollMs: 5000 }).catch(() => undefined);
    row.status = "failed";
    row.error = detail;
    saveSandbox(db, row);
    logAction(db, { action: "sandbox.provision", target: row.rg_name, outcome: "failed", detail });
    throw new SandboxError(`Could not create the sandbox: ${detail}`);
  }
}

/** Creates the sandbox again for a student whose group is gone (they deleted it as the lab said, or it expired). */
export async function reprovisionSandbox(deps: SandboxDeps, rgName: string, days?: number): Promise<ProvisionResult> {
  const row = getSandbox(deps.db, rgName);
  if (!row) throw new SandboxError(`No sandbox named ${rgName}`);
  const course = getCourse(row.course);
  assertAllowedSubscription(deps.config, row.subscription_id);
  if (await exists(deps.arm, `${rgPath(row.subscription_id, rgName)}?api-version=${RG_API}`)) throw new SandboxError(`${rgName} still exists; delete it or wait for it to end before creating it again.`);

  const now = (deps.now ?? (() => new Date()))();
  const lifetime = days ?? course.ttlDays;
  if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > 90) throw new SandboxError("Days must be a whole number from 1 to 90");
  const expiresOn = new Date(now.getTime() + lifetime * 86_400_000).toISOString();
  const tags = { [MANAGED_BY_TAG]: MANAGED_BY_VALUE, [EXPIRES_TAG]: expiresOn, owner: deps.config.owner, kind: "student-sandbox", course: course.id, student: row.student_upn };
  const plan = sandboxPlan({ sub: row.subscription_id, rgName, course, objectId: row.object_id, location: row.location, tags, owner: deps.config.owner, now });
  const next: SandboxRow = { ...row, created_at: now.toISOString(), expires_on: expiresOn, status: "failed", ended_at: null, error: null };
  await applyPlan(deps, plan, next);
  next.status = "active";
  saveSandbox(deps.db, next);
  logAction(deps.db, { action: "sandbox.reprovision", target: rgName, outcome: "ok", detail: `${row.student_upn}, expires ${expiresOn.slice(0, 10)}` });
  return { record: next, note: substitutionNote(rgName, course, expiresOn), warnings: ["Policies take 5 to 30 minutes to start blocking."] };
}

/** Marks sandboxes whose group no longer exists as ended, so they can be provisioned again. */
export async function syncSandboxes(deps: Pick<SandboxDeps, "arm" | "db">, now = new Date()): Promise<SandboxRow[]> {
  for (const s of listSandboxes(deps.db)) {
    if (s.status !== "active") continue;
    if (!(await exists(deps.arm, `${rgPath(s.subscription_id, s.rg_name)}?api-version=${RG_API}`))) setSandboxStatus(deps.db, s.rg_name, "ended", { ended_at: now.toISOString() });
  }
  return listSandboxes(deps.db);
}

/** After the group has been deleted (by an admin through Gaia), records the end. */
export function markEnded(db: Db, rgName: string, now = new Date()): void {
  if (getSandbox(db, rgName)) setSandboxStatus(db, rgName, "ended", { ended_at: now.toISOString() });
}

export const courseList = () => Object.values(COURSES);
