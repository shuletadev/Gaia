import type { ArmClient } from "../azure/arm.ts";
import type { LabctlConfig } from "../config.ts";
import type { Db } from "../db.ts";
import { deployMinutesFor, type Blueprint } from "./blueprints.ts";
import { labResourceTypes, prepareLab, type LabRequest } from "./engine.ts";
import { evaluateFeasibility, gatherFacts, namespacesOf, type FeasibilityCheck } from "./feasibility.ts";
import { estimate } from "./pricing.ts";
import { recentCapacityEvent } from "./capacity.ts";
import { variantOf } from "./timing.ts";

/**
 * When a launch is blocked (tier not offered, quota) or expensive, finds the cheapest variants that
 * would deploy: the same setup in another enabled region, or a blueprint-declared cheaper variant
 * (with what it gives up), and a lifetime that keeps the month inside budget.
 */

export interface Alternative {
  region: string;
  params: Record<string, unknown>;
  hourly: number;
  /** Human-readable differences from the current request. */
  changes: string[];
  loses?: string;
}

export interface AlternativesResult {
  current: { hourly: number; feasible: boolean };
  alternatives: Alternative[];
  /** Longest lifetime that keeps the month-end forecast within budget, when the current one doesn't. */
  ttl?: { hours: number; reason: string };
}

/** Checks that decide whether a candidate can be deployed at all (cost and naming are judged separately). */
const BLOCKING = /^(config|providers|region|apim-sku.*|quota|rbac|vm-.*)$/;
export const isViable = (checks: FeasibilityCheck[]) => !checks.some((c) => c.status === "fail" && BLOCKING.test(c.id));

/** "Tier: Developer (was Premium)" for each field that differs. */
export function describeChanges(b: Pick<Blueprint, "fields">, from: Record<string, unknown>, to: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const f of b.fields) {
    if (String(from[f.key]) === String(to[f.key])) continue;
    const show = (v: unknown) => (v === "" || v === undefined ? (f.emptyLabel ?? "none") : f.options?.find((o) => o.value === String(v))?.label ?? (typeof v === "boolean" ? (v ? "on" : "off") : String(v)));
    out.push(`${f.label}: ${show(to[f.key])} (was ${show(from[f.key])})`);
  }
  return out;
}

/** Longest whole-hour lifetime that keeps forecast + lab cost within budget; undefined when not needed or impossible. */
export function budgetTtl(hourly: number, ttlHours: number, budget: number, forecast?: number): number | undefined {
  if (forecast === undefined || hourly <= 0) return undefined;
  if (forecast + hourly * ttlHours <= budget) return undefined;
  const max = Math.floor((budget - forecast) / hourly);
  return max >= 1 && max < ttlHours ? max : undefined;
}

/** Runs tasks with at most `n` in flight; failed tasks are dropped. */
export async function limited<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const t = tasks[next++]!;
      try {
        out.push(await t());
      } catch {
        /* skip */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return out;
}

export async function suggestAlternatives(
  arm: ArmClient,
  db: Db,
  config: LabctlConfig,
  req: LabRequest,
  deps: { forecastMonth?: (subscriptionId: string) => Promise<number | undefined> } = {},
): Promise<AlternativesResult> {
  const base = prepareLab(config, req, new Date(), { skipRules: true });
  const b = base.blueprint;
  const variants = [{ params: base.params, loses: undefined as string | undefined }, ...(b.alternatives?.(base.params) ?? []).map((a) => ({ params: { ...base.params, ...a.params }, loses: a.loses }))];
  const forecast = await deps.forecastMonth?.(base.subscriptionId).catch(() => undefined);

  const evaluate = async (region: string, params: Record<string, unknown>) => {
    const parsed = b.schema.parse(params) as Record<string, unknown>;
    const rules = b.rules?.(parsed) ?? [];
    const types = labResourceTypes(b, parsed);
    const apimSku = b.apimSku?.(parsed);
    const quotas = b.quotas?.(parsed);
    const vmSizes = b.vmSizes?.(parsed) ?? [];
    const facts = await gatherFacts(arm, db, base.subscriptionId, region, {
      namespaces: namespacesOf([...types, "Microsoft.Resources/deploymentStacks"]),
      apim: Boolean(apimSku),
      quotas: Boolean(quotas && Object.keys(quotas).length),
      vms: Boolean(vmSizes.length),
    });
    const est = await estimate(db, region, b.meters(parsed), b.notes);
    const checks = evaluateFeasibility(
      {
        region,
        enabledRegions: config.labs.regions,
        ttlHours: req.ttlHours,
        hourly: est.hourly,
        resourceTypes: types,
        apimSku,
        quotas,
        vmSizes,
        rules,
        deployMinutes: deployMinutesFor(b, parsed),
        budget: { monthlyUsd: config.budget.monthlyUsd, forecastMonth: forecast },
      },
      facts,
    );
    // An unpriced meter would make the variant look free; it only counts when every meter is priced.
    // A region that just ran out of capacity for this lab is not a useful suggestion.
    const capacityShort = Boolean(recentCapacityEvent(db, b.id, variantOf(b, parsed), region));
    return { region, params: parsed, hourly: est.hourly, viable: isViable(checks) && !capacityShort, priced: est.missing.length === 0 };
  };

  const current = await evaluate(base.region, base.params);
  const tasks: (() => Promise<Awaited<ReturnType<typeof evaluate>> & { loses?: string }>)[] = [];
  for (const v of variants) {
    for (const region of config.labs.regions) {
      if (region === base.region && v === variants[0]) continue;
      tasks.push(() => evaluate(region, v.params).then((r) => ({ ...r, loses: v.loses })));
    }
  }
  // A few at a time: the Retail Prices API throttles bursts.
  const results = await limited(tasks, 4);

  const worthIt = results.filter((r) => r.viable && r.priced && (!current.viable || r.hourly < current.hourly - 1e-9));
  // Cheapest first; among equals, staying in the requested region wins.
  worthIt.sort((x, y) => x.hourly - y.hourly || Number(x.region !== base.region) - Number(y.region !== base.region));
  const seen = new Set<string>();
  const alternatives: Alternative[] = [];
  for (const r of worthIt) {
    const key = JSON.stringify(r.params);
    // One region per variant keeps the list short; the cheapest region is already first.
    if (seen.has(key)) continue;
    seen.add(key);
    const changes = [...(r.region !== base.region ? [`Region: ${r.region} (was ${base.region})`] : []), ...describeChanges(b, base.params, r.params)];
    alternatives.push({ region: r.region, params: r.params, hourly: r.hourly, changes, loses: r.loses });
    if (alternatives.length >= 4) break;
  }

  const hours = current.viable ? budgetTtl(current.hourly, req.ttlHours, config.budget.monthlyUsd, forecast) : undefined;
  return {
    current: { hourly: current.hourly, feasible: current.viable },
    alternatives,
    ttl: hours ? { hours, reason: `keeps the month within $${config.budget.monthlyUsd} (forecast $${Math.round(forecast!)})` } : undefined,
  };
}
