import type { LabctlConfig } from "../config.ts";
import type { ArmClient } from "../azure/arm.ts";
import { listResourceGroups, listResources, type GraphResource, type GraphResourceGroup } from "../azure/resourceGraph.ts";
import { type CostRow } from "../azure/cost.ts";
import type { CostService } from "../costService.ts";
import { evaluateRules, type Finding } from "./rules.ts";
import { parseResourceId } from "../guard.ts";

export interface ResourceGroupSummary {
  name: string;
  location: string;
  resourceCount: number;
  excluded: boolean;
  tags: Record<string, string>;
  cost30dUsd?: number;
  costMtdUsd?: number;
  costPrevMonthUsd?: number;
}

export interface AuditReport {
  generatedAt: string;
  subscription: { id: string; name: string };
  totals: {
    resources: number;
    resourceGroups: number;
    costMtdUsd?: number;
    costPrevMonthUsd?: number;
    cost30dUsd?: number;
    budgetUsd: number;
    /** Last-30-day cost of resources flagged by any finding (excluding info). */
    flaggedCost30dUsd?: number;
  };
  resourceGroups: ResourceGroupSummary[];
  topResources: { resourceId: string; name: string; resourceGroup: string; cost30dUsd: number; exists: boolean }[];
  findings: Finding[];
  warnings: string[];
}

const sum = (rows: CostRow[]) => rows.reduce((s, r) => s + r.cost, 0);
const round = (n: number) => Math.round(n * 100) / 100;

async function tryCost<T>(label: string, warnings: string[], fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    warnings.push(`Cost data unavailable (${label}): ${(e as Error).message}`);
    return undefined;
  }
}

export interface AuditData {
  report: AuditReport;
  resources: GraphResource[];
  resourceGroups: GraphResourceGroup[];
  /** Lowercased resource ID -> last-30-day cost, when cost data was available. */
  resourceCost30d?: Map<string, number>;
}

export async function auditWithData(
  arm: ArmClient,
  config: LabctlConfig,
  subscriptionId: string,
  costs: CostService,
  opts: { refreshCosts?: boolean; now?: Date } = {},
): Promise<AuditData> {
  const now = opts.now ?? new Date();
  const refresh = opts.refreshCosts ?? false;
  const sub = config.subscriptions.find((s) => s.id.toLowerCase() === subscriptionId.toLowerCase());
  if (!sub) throw new Error(`Subscription ${subscriptionId} is not in the allow-list`);

  const [resources, resourceGroups] = await Promise.all([listResources(arm, [sub.id]), listResourceGroups(arm, [sub.id])]);
  const warnings: string[] = [];

  // Sequential on purpose: Cost Management throttles aggressively.
  const byResource30d = await tryCost("last 30 days", warnings, async () => (await costs.byResource30d(sub.id, refresh)).value);
  const byRgMtd = await tryCost("month to date", warnings, async () => (await costs.byRgMonthToDate(sub.id, refresh)).value);
  const byRgPrev = await tryCost("previous month", warnings, async () => (await costs.byRgPreviousMonth(sub.id, refresh)).value);

  const resourceCost = new Map((byResource30d ?? []).map((r) => [r.key, r.cost]));
  const rgCost30d = new Map<string, number>();
  for (const row of byResource30d ?? []) {
    try {
      const rg = parseResourceId(row.key).resourceGroup?.toLowerCase();
      if (rg) rgCost30d.set(rg, (rgCost30d.get(rg) ?? 0) + row.cost);
    } catch {
      /* costs not tied to a resource ID (e.g. marketplace, support) */
    }
  }
  const rgMtd = new Map((byRgMtd ?? []).map((r) => [r.key, r.cost]));
  const rgPrev = new Map((byRgPrev ?? []).map((r) => [r.key, r.cost]));

  const findings = evaluateRules({ config, resources, resourceGroups, now });
  if (byResource30d) {
    for (const f of findings) {
      if (f.type === "Microsoft.Resources/resourceGroups") continue;
      f.cost30dUsd = round(resourceCost.get(f.resourceId.toLowerCase()) ?? 0);
    }
  }

  const flaggedIds = new Set(findings.filter((f) => f.severity !== "info" && f.type !== "Microsoft.Resources/resourceGroups").map((f) => f.resourceId.toLowerCase()));
  const flaggedCost = byResource30d ? round([...flaggedIds].reduce((s, id) => s + (resourceCost.get(id) ?? 0), 0)) : undefined;

  const excluded = new Set(config.excludedResourceGroups.map((g) => g.toLowerCase()));
  const countByRg = new Map<string, number>();
  for (const r of resources) countByRg.set(r.resourceGroup.toLowerCase(), (countByRg.get(r.resourceGroup.toLowerCase()) ?? 0) + 1);

  const rgSummaries: ResourceGroupSummary[] = resourceGroups
    .map((g) => {
      const k = g.name.toLowerCase();
      return {
        name: g.name,
        location: g.location,
        resourceCount: countByRg.get(k) ?? 0,
        excluded: excluded.has(k),
        tags: g.tags ?? {},
        cost30dUsd: byResource30d ? round(rgCost30d.get(k) ?? 0) : undefined,
        costMtdUsd: byRgMtd ? round(rgMtd.get(k) ?? 0) : undefined,
        costPrevMonthUsd: byRgPrev ? round(rgPrev.get(k) ?? 0) : undefined,
      };
    })
    .sort((a, b) => (b.cost30dUsd ?? 0) - (a.cost30dUsd ?? 0) || a.name.localeCompare(b.name));

  const nameById = new Map(resources.map((r) => [r.id.toLowerCase(), r]));
  const rgDisplay = new Map(resourceGroups.map((g) => [g.name.toLowerCase(), g.name]));
  const topResources = (byResource30d ?? [])
    .filter((r) => r.cost > 0.005)
    .slice(0, 10)
    .map((r) => {
      const res = nameById.get(r.key);
      let rg = "";
      try {
        rg = parseResourceId(r.key).resourceGroup ?? "";
      } catch {
        rg = "";
      }
      return {
        resourceId: res?.id ?? r.key,
        name: res?.name ?? r.key.split("/").pop() ?? r.key,
        resourceGroup: rgDisplay.get(rg.toLowerCase()) ?? rg,
        cost30dUsd: round(r.cost),
        // Cost rows can reference resources deleted during the window, or subscription-level charges.
        exists: Boolean(res),
      };
    });

  return {
    report: {
      generatedAt: now.toISOString(),
      subscription: { id: sub.id, name: sub.name },
      totals: {
        resources: resources.length,
        resourceGroups: resourceGroups.length,
        costMtdUsd: byRgMtd ? round(sum(byRgMtd)) : undefined,
        costPrevMonthUsd: byRgPrev ? round(sum(byRgPrev)) : undefined,
        cost30dUsd: byResource30d ? round(sum(byResource30d)) : undefined,
        budgetUsd: config.budget.monthlyUsd,
        flaggedCost30dUsd: flaggedCost,
      },
      resourceGroups: rgSummaries,
      topResources,
      findings,
      warnings,
    },
    resources,
    resourceGroups,
    resourceCost30d: byResource30d ? resourceCost : undefined,
  };
}

export async function runAudit(
  arm: ArmClient,
  config: LabctlConfig,
  subscriptionId: string,
  costs: CostService,
  opts: { refreshCosts?: boolean; now?: Date } = {},
): Promise<AuditReport> {
  return (await auditWithData(arm, config, subscriptionId, costs, opts)).report;
}
