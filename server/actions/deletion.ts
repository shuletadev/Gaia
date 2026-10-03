import type { ArmClient } from "../azure/arm.ts";
import type { GraphResource, GraphResourceGroup } from "../azure/resourceGraph.ts";
import type { LabctlConfig } from "../config.ts";
import { canManualDelete, canModify, parseResourceId } from "../guard.ts";
import { isResourceGroupId } from "./tags.ts";
import { buildRelations } from "../audit/relations.ts";
import { ArmError } from "../azure/arm.ts";
import { planDeletion, type Blocker, type DeletePlan, type FixAction, type PlanStep } from "./deletePlan.ts";
import type { JobRunner, Job } from "../jobs.ts";

const RG_API = "2021-04-01";

export interface DeletePreviewItem {
  id: string;
  name: string;
  type: string;
  allowed: boolean;
  reason?: string;
  /** For resource groups: everything that will be deleted with it. */
  contains: { id: string; name: string; type: string }[];
  /** Resources that depend on this one (or, for a group, on its contents from outside it). Deleting may fail or break them. */
  referencedBy: { id: string; name: string; type: string }[];
  /** Unbound resource that appears to have been created for another (name / DNS label affinity). */
  reservedFor?: { id: string; name: string; type: string };
  /** Dependents that would make Azure refuse the delete; add them to the selection or keep this target. */
  blockers?: Blocker[];
  locks: string[];
  cost30dUsd?: number;
}

export interface DeletePreview {
  items: DeletePreviewItem[];
  /** Exact text the user must type to confirm. */
  confirmPhrase: string;
  /** Ordered steps (detaches on resources that stay, then deletes in dependency order), blockers and warnings. */
  plan: DeletePlan;
}

/** One target: its name. Several: "delete N". Keeps typing effort low without making it a single click. */
export function confirmPhraseFor(names: string[]): string {
  return names.length === 1 ? names[0]! : `delete ${names.length}`;
}

export function buildPreview(
  config: LabctlConfig,
  targetIds: string[],
  resources: GraphResource[],
  groups: GraphResourceGroup[],
  costs?: Map<string, number>,
  locksById: Map<string, string[]> = new Map(),
): DeletePreview {
  const unique = [...new Map(targetIds.map((id) => [id.toLowerCase(), id])).values()];
  const byId = new Map(resources.map((r) => [r.id.toLowerCase(), r]));
  const groupsById = new Map(groups.map((g) => [g.id.toLowerCase(), g]));
  const relations = buildRelations(resources);
  const brief = (r: GraphResource) => ({ id: r.id, name: r.name, type: r.type });
  const consumersOf = (id: string) =>
    (relations.usedBy.get(id.toLowerCase()) ?? []).map((l) => byId.get(l.id)).filter((r): r is GraphResource => Boolean(r));

  const items = unique.map((id): DeletePreviewItem => {
    const key = id.toLowerCase();
    const verdict = canManualDelete(config, id);
    const locks = locksById.get(key) ?? [];
    if (isResourceGroupId(id)) {
      const g = groupsById.get(key);
      const rgName = parseResourceId(id).resourceGroup!;
      const inside = (r: GraphResource) => r.resourceGroup.toLowerCase() === rgName.toLowerCase();
      const members = resources.filter(inside);
      const contains = members.map(brief);
      // Consumers outside the group that would break when its contents disappear.
      const external = new Map<string, GraphResource>();
      for (const m of members) for (const c of consumersOf(m.id)) if (!inside(c)) external.set(c.id.toLowerCase(), c);
      const cost = costs ? contains.reduce((s, c) => s + (costs.get(c.id.toLowerCase()) ?? 0), 0) : undefined;
      const exists = Boolean(g);
      return {
        id,
        name: g?.name ?? rgName,
        type: "Microsoft.Resources/resourceGroups",
        allowed: verdict.allowed && exists && locks.length === 0,
        reason: !verdict.allowed ? verdict.reason : !exists ? "resource group not found" : locks.length ? "locked" : undefined,
        contains,
        referencedBy: [...external.values()].map(brief),
        locks,
        cost30dUsd: cost,
      };
    }
    const r = byId.get(key);
    const reservedId = relations.likelyFor.get(key);
    const reservedFor = reservedId ? byId.get(reservedId) : undefined;
    // A lock on the group protects everything in it.
    const allLocks = [...locks, ...(locksById.get(rgIdOf(key)) ?? [])];
    return {
      id,
      name: r?.name ?? id.split("/").pop() ?? id,
      type: r?.type ?? "unknown",
      allowed: verdict.allowed && Boolean(r) && allLocks.length === 0,
      reason: !verdict.allowed ? verdict.reason : !r ? "resource not found" : allLocks.length ? "locked" : undefined,
      contains: [],
      referencedBy: consumersOf(id).map(brief),
      reservedFor: reservedFor ? brief(reservedFor) : undefined,
      locks: allLocks,
      cost30dUsd: costs?.get(key),
    };
  });

  // Plan the allowed targets; targets held by a dependent that can't be detached become blocked.
  const canTouch = (cid: string): string | undefined => {
    const v = canModify(config, cid);
    if (!v.allowed) return v.reason;
    const l = [...(locksById.get(cid.toLowerCase()) ?? []), ...(locksById.get(rgIdOf(cid)) ?? [])];
    return l.length ? `locked (${l.join(", ")})` : undefined;
  };
  const plan = planDeletion(
    items.filter((i) => i.allowed).map((i) => ({ id: i.id, name: i.name, type: i.type, isGroup: isResourceGroupId(i.id) })),
    resources,
    { canTouch },
  );
  for (const i of items) {
    const held = plan.blockers.filter((b) => b.target.id.toLowerCase() === i.id.toLowerCase());
    if (!held.length) continue;
    i.allowed = false;
    i.blockers = held;
    i.reason = `held by ${[...new Set(held.map((b) => b.consumer.name))].join(", ")}`;
  }

  return { items, confirmPhrase: confirmPhraseFor(items.filter((i) => i.allowed).map((i) => i.name)), plan };
}

const rgIdOf = (id: string) => (/^\/subscriptions\/[^/]+\/resourcegroups\/[^/]+/i.exec(id)?.[0] ?? "").toLowerCase();

/** Resources the plan modifies (kept, detached) and the groups they live in, whose locks must be checked. */
export function fixConsumers(plan: DeletePlan): string[] {
  return [...new Set(plan.steps.filter((s) => s.kind === "fix").flatMap((s) => [s.target.id.toLowerCase(), rgIdOf(s.target.id)]))];
}

export async function listLocks(arm: ArmClient, scopeId: string): Promise<string[]> {
  const res = await arm.get<{ value: { name: string; properties: { level: string } }[] }>(
    `${scopeId}/providers/Microsoft.Authorization/locks?api-version=2020-05-01`,
  );
  return res.value.map((l) => `${l.name} (${l.properties.level})`);
}

const apiVersionCache = new Map<string, string>();

/** Latest stable API version for a resource type, from the provider's metadata in this subscription. */
export async function apiVersionFor(arm: ArmClient, resourceId: string, type: string): Promise<string> {
  const key = type.toLowerCase();
  const hit = apiVersionCache.get(key);
  if (hit) return hit;
  const { subscriptionId } = parseResourceId(resourceId);
  const [namespace, ...rest] = type.split("/");
  const resourceType = rest.join("/").toLowerCase();
  const provider = await arm.get<{ resourceTypes: { resourceType: string; apiVersions: string[] }[] }>(
    `/subscriptions/${subscriptionId}/providers/${namespace}?api-version=2021-04-01`,
  );
  const rt = provider.resourceTypes.find((t) => t.resourceType.toLowerCase() === resourceType);
  const version = rt?.apiVersions.find((v) => !v.includes("preview")) ?? rt?.apiVersions[0];
  if (!version) throw new Error(`No API version found for ${type}`);
  apiVersionCache.set(key, version);
  return version;
}

/** Errors Azure returns while a reference is still being released (seconds to minutes after its consumer goes). */
export const TRANSIENT_DELETE = /InUse|PublicIPAddressCannotBeDeleted|AnotherOperationInProgress|RetryableError|NicReservedForAnotherVm|ReferencedResourceNotProvisioned|CannotDeleteResource|Conflict|OperationNotAllowed/i;

export async function withDeleteRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; waitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 10;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const transient = e instanceof ArmError && (e.status === 409 || e.status === 400 || e.status === 429) && TRANSIENT_DELETE.test(`${e.code ?? ""} ${e.message}`);
      if (!transient || i >= attempts) throw e;
      await sleep(opts.waitMs ?? 30_000);
    }
  }
}

const gone = (e: unknown) => e instanceof ArmError && e.status === 404;

const NET_API = "2024-05-01";

/** Applies one detach on a resource that stays (GET, drop the reference, PUT). */
export async function applyFix(arm: ArmClient, a: FixAction): Promise<string> {
  if (a.op === "delete-child") {
    try {
      await arm.lro("DELETE", `${a.childId}?api-version=${a.apiVersion}`, undefined, { timeoutMs: 30 * 60_000 });
    } catch (e) {
      if (!gone(e)) throw e;
    }
    return `deleted ${a.childId.split("/").pop()}`;
  }
  if (a.op === "subnet-unset") {
    const url = `${a.subnetId}?api-version=${NET_API}`;
    const sub = await arm.get<{ properties: Record<string, unknown> }>(url);
    if (!sub.properties[a.property]) return `subnet ${a.subnetId.split("/").pop()} already clear`;
    const properties = { ...sub.properties };
    delete properties[a.property];
    await arm.lro("PUT", url, { properties }, { timeoutMs: 30 * 60_000 });
    return `cleared ${a.property} on subnet ${a.subnetId.split("/").pop()}`;
  }
  const url = `${a.nicId}?api-version=${NET_API}`;
  const nic = await arm.get<{ location: string; tags?: Record<string, string>; properties: Record<string, unknown> & { ipConfigurations?: { id?: string; properties?: Record<string, unknown> }[] } }>(url);
  const properties = { ...nic.properties };
  if (a.op === "nic-unset-nsg") {
    if (!properties.networkSecurityGroup) return "NIC NSG already clear";
    delete properties.networkSecurityGroup;
  } else {
    const cfg = properties.ipConfigurations?.find((c) => (c.id ?? "").toLowerCase() === a.ipConfigId.toLowerCase());
    if (!cfg?.properties?.publicIPAddress) return "public IP already detached";
    properties.ipConfigurations = properties.ipConfigurations!.map((c) => {
      if (c !== cfg) return c;
      const { publicIPAddress: _drop, ...rest } = c.properties ?? {};
      return { ...c, properties: rest };
    });
  }
  await arm.lro("PUT", url, { location: nic.location, tags: nic.tags, properties }, { timeoutMs: 30 * 60_000 });
  return a.op === "nic-unset-nsg" ? "cleared NIC NSG" : "detached public IP";
}

export async function deleteTarget(arm: ArmClient, item: { id: string; type: string }, opts: { forceVms?: boolean } = {}): Promise<string> {
  if (isResourceGroupId(item.id)) {
    // Azure's own fast path: VMs/VMSS are force-deleted (no graceful shutdown) so their NICs and disks free up sooner.
    const force = opts.forceVms ? "&forceDeletionTypes=Microsoft.Compute/virtualMachines,Microsoft.Compute/virtualMachineScaleSets" : "";
    try {
      await withDeleteRetry(() => arm.lro("DELETE", `${item.id}?api-version=${RG_API}${force}`, undefined, { timeoutMs: 2 * 60 * 60_000 }), { attempts: 3 });
    } catch (e) {
      if (gone(e)) return "Resource group already gone";
      throw e;
    }
    return "Resource group deleted";
  }
  // A private DNS zone can't be deleted while it still has virtual network links.
  if (item.type.toLowerCase() === "microsoft.network/privatednszones") {
    const links = await arm.get<{ value: { id: string }[] }>(`${item.id}/virtualNetworkLinks?api-version=2020-06-01`).catch(() => ({ value: [] }));
    for (const l of links.value) await applyFix(arm, { op: "delete-child", childId: l.id, apiVersion: "2020-06-01" });
  }
  const version = await apiVersionFor(arm, item.id, item.type);
  try {
    await withDeleteRetry(() => arm.lro("DELETE", `${item.id}?api-version=${version}`));
  } catch (e) {
    if (gone(e)) return "Already gone";
    throw e;
  }
  return "Deleted";
}

/**
 * Starts one job per plan step. Each job waits for the steps it depends on; if one of them fails, the
 * dependents fail with "skipped" instead of running into an in-use error.
 */
export function executePlan(arm: ArmClient, jobs: JobRunner, plan: DeletePlan, resources: GraphResource[]): Job[] {
  const conflicts = plan.steps.filter((s) => jobs.isBusy(s.target.id));
  if (conflicts.length) throw new JobConflictPlanError(`Another job is already running on ${conflicts.map((s) => s.target.name).join(", ")}`);
  const outcome = new Map<string, Promise<boolean>>();
  const nameOf = new Map(plan.steps.map((s) => [s.key, s.target.name]));
  const started: Job[] = [];
  for (const step of [...plan.steps].sort((a, b) => a.wave - b.wave)) {
    let settle!: (ok: boolean) => void;
    outcome.set(step.key, new Promise<boolean>((r) => (settle = r)));
    const work = async () => {
      try {
        for (const dep of step.after) {
          if (!(await outcome.get(dep))) throw new Error(`Skipped: ${nameOf.get(dep)} did not finish`);
        }
        const msg = await runStep(arm, step, resources);
        settle(true);
        return msg;
      } catch (e) {
        settle(false);
        throw e;
      }
    };
    started.push(jobs.start(step.kind === "fix" ? "detach" : "delete", step.target.id, step.target.name, work));
  }
  return started;
}

async function runStep(arm: ArmClient, step: PlanStep, resources: GraphResource[]): Promise<string> {
  if (step.kind === "fix") {
    const out: string[] = [];
    for (const f of step.fixes) out.push(await withDeleteRetry(() => applyFix(arm, f.action)));
    return out.join("; ");
  }
  const rg = step.target.id.toLowerCase();
  const forceVms = isResourceGroupId(step.target.id) && resources.some((r) => r.id.toLowerCase().startsWith(`${rg}/`) && /^microsoft\.compute\/virtualmachine/i.test(r.type));
  return deleteTarget(arm, step.target, { forceVms });
}

export class JobConflictPlanError extends Error {}
