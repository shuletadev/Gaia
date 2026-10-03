import type { ArmClient } from "./azure/arm.ts";
import type { LabctlConfig } from "./config.ts";
import type { CostService } from "./costService.ts";
import { auditWithData, type AuditReport } from "./audit/runAudit.ts";
import type { Finding } from "./audit/rules.ts";
import { liveProject, project, type DailyCost, type LiveProjection, type Projection } from "./azure/cost.ts";
import { getParkedState, type Db } from "./db.ts";
import { expiresAt, isExcludedResourceGroup, isLabManaged, isPersistent } from "./guard.ts";
import { powerInfo, type PowerInfo } from "./actions/power.ts";
import type { GraphResource, GraphResourceGroup } from "./azure/resourceGraph.ts";
import { buildRelations } from "./audit/relations.ts";

export interface ResourceRef {
  id: string;
  name: string;
  type: string;
}

export interface InventoryResource {
  id: string;
  name: string;
  type: string;
  location: string;
  sku?: string;
  tags: Record<string, string>;
  persistent: boolean;
  cost30dUsd?: number;
  power?: PowerInfo;
  findings: string[];
  uses: ResourceRef[];
  usedBy: ResourceRef[];
  reservedFor?: ResourceRef;
}

export interface InventoryGroup {
  id: string;
  name: string;
  location: string;
  tags: Record<string, string>;
  excluded: boolean;
  persistent: boolean;
  lab: { managed: boolean; expiresOn?: string; expired: boolean };
  cost30dUsd?: number;
  costMtdUsd?: number;
  resources: InventoryResource[];
}

export interface Snapshot {
  generatedAt: string;
  subscription: { id: string; name: string };
  budget: LabctlConfig["budget"];
  totals: AuditReport["totals"] & Partial<Projection> & Partial<LiveProjection>;
  daily: DailyCost[];
  groups: InventoryGroup[];
  findings: Finding[];
  topResources: AuditReport["topResources"];
  warnings: string[];
  costFetchedAt?: number;
}

function skuLabel(r: GraphResource): string | undefined {
  const s = r.sku ?? (r.properties?.sku as { name?: string; tier?: string } | undefined);
  const parts = [s?.name, s?.tier && s.tier !== s.name ? s.tier : undefined].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

export function buildInventory(
  config: LabctlConfig,
  db: Db,
  resources: GraphResource[],
  groups: GraphResourceGroup[],
  findings: Finding[],
  report: AuditReport,
  costs?: Map<string, number>,
  now = new Date(),
): InventoryGroup[] {
  const findingsById = new Map<string, string[]>();
  for (const f of findings) {
    const k = f.resourceId.toLowerCase();
    findingsById.set(k, [...(findingsById.get(k) ?? []), f.ruleId]);
  }
  const rgCost = new Map(report.resourceGroups.map((g) => [g.name.toLowerCase(), g]));
  const relations = buildRelations(resources);
  const byId = new Map(resources.map((r) => [r.id.toLowerCase(), r]));
  const ref = (id: string): ResourceRef | undefined => {
    const r = byId.get(id);
    return r ? { id: r.id, name: r.name, type: r.type } : undefined;
  };
  const refs = (links?: { id: string }[]) => (links ?? []).map((l) => ref(l.id)).filter((x): x is ResourceRef => Boolean(x));
  return groups
    .map((g): InventoryGroup => {
      const exp = expiresAt(g.tags);
      const members = resources.filter((r) => r.resourceGroup.toLowerCase() === g.name.toLowerCase());
      return {
        id: g.id,
        name: g.name,
        location: g.location,
        tags: g.tags ?? {},
        excluded: isExcludedResourceGroup(config, g.name),
        persistent: isPersistent(g.tags),
        lab: { managed: isLabManaged(g.tags), expiresOn: exp?.toISOString(), expired: exp ? exp.getTime() <= now.getTime() : false },
        cost30dUsd: rgCost.get(g.name.toLowerCase())?.cost30dUsd,
        costMtdUsd: rgCost.get(g.name.toLowerCase())?.costMtdUsd,
        resources: members
          .map((r) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            location: r.location,
            sku: skuLabel(r),
            tags: r.tags ?? {},
            persistent: isPersistent(r.tags),
            cost30dUsd: costs ? Math.round((costs.get(r.id.toLowerCase()) ?? 0) * 100) / 100 : undefined,
            power: powerInfo(r, Boolean(getParkedState(db, r.id))),
            findings: findingsById.get(r.id.toLowerCase()) ?? [],
            uses: refs(relations.uses.get(r.id.toLowerCase())),
            usedBy: refs(relations.usedBy.get(r.id.toLowerCase())),
            reservedFor: relations.likelyFor.has(r.id.toLowerCase()) ? ref(relations.likelyFor.get(r.id.toLowerCase())!) : undefined,
          }))
          .sort((a, b) => (b.cost30dUsd ?? 0) - (a.cost30dUsd ?? 0) || a.name.localeCompare(b.name)),
      };
    })
    .sort((a, b) => Number(a.excluded) - Number(b.excluded) || (b.cost30dUsd ?? 0) - (a.cost30dUsd ?? 0) || a.name.localeCompare(b.name));
}

export async function buildSnapshot(
  arm: ArmClient,
  config: LabctlConfig,
  db: Db,
  costs: CostService,
  subscriptionId: string,
  refresh: boolean,
): Promise<{ snapshot: Snapshot; resources: GraphResource[]; resourceGroups: GraphResourceGroup[]; costMap?: Map<string, number> }> {
  const data = await auditWithData(arm, config, subscriptionId, costs, { refreshCosts: refresh });
  const { report } = data;
  let daily: DailyCost[] = [];
  let costFetchedAt: number | undefined;
  try {
    const d = await costs.daily30(subscriptionId, refresh);
    daily = d.value;
    costFetchedAt = d.fetchedAt;
  } catch (e) {
    report.warnings.push(`Daily cost unavailable: ${(e as Error).message}`);
  }
  const projection = daily.length ? project(daily) : undefined;
  const live = daily.length ? await liveProjectionFor(costs, db, subscriptionId, data.resources, daily, refresh, report.warnings) : undefined;
  return {
    snapshot: {
      generatedAt: report.generatedAt,
      subscription: report.subscription,
      budget: config.budget,
      totals: { ...report.totals, ...(projection ?? {}), ...(live ?? {}) },
      daily,
      groups: buildInventory(config, db, data.resources, data.resourceGroups, report.findings, report, data.resourceCost30d),
      findings: report.findings,
      topResources: report.topResources,
      warnings: report.warnings,
      costFetchedAt,
    },
    resources: data.resources,
    resourceGroups: data.resourceGroups,
    costMap: data.resourceCost30d,
  };
}

/** Live forecast: recent per-resource cost of what still exists (see liveProject). */
export async function liveProjectionFor(
  costs: CostService,
  db: Db,
  subscriptionId: string,
  resources: GraphResource[],
  daily: DailyCost[],
  refresh = false,
  warnings?: string[],
): Promise<LiveProjection | undefined> {
  try {
    const byResource = (await costs.resourceDaily(subscriptionId, refresh)).value;
    const ids = new Set(resources.map((r) => r.id.toLowerCase()));
    return liveProject(
      daily,
      byResource,
      (id) => ids.has(id),
      (id) => Boolean(getParkedState(db, id)),
    );
  } catch (e) {
    warnings?.push(`Live forecast unavailable: ${(e as Error).message}`);
    return undefined;
  }
}
