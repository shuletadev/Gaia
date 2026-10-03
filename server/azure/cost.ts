import type { ArmClient } from "./arm.ts";

interface QueryResult {
  properties: {
    columns: { name: string; type: string }[];
    rows: unknown[][];
    nextLink?: string | null;
  };
}

export interface CostRow {
  key: string;
  cost: number;
  currency: string;
}

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Runs a Cost Management query and returns rows as objects keyed by column name. */
async function runQuery(arm: ArmClient, subscriptionId: string, body: unknown): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let next: string | undefined = `/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
  while (next) {
    const res: QueryResult = await arm.post<QueryResult>(next, body);
    const cols = res.properties.columns.map((c) => c.name);
    for (const row of res.properties.rows) {
      out.push(Object.fromEntries(cols.map((c, i) => [c, row[i]])));
    }
    next = res.properties.nextLink ?? undefined;
  }
  return out;
}

function toCostRows(rows: Record<string, unknown>[], keyColumn: string): CostRow[] {
  return rows
    .map((r) => ({
      key: String(r[keyColumn] ?? "").toLowerCase(),
      cost: Number(r["Cost"] ?? r["PreTaxCost"] ?? 0),
      currency: String(r["Currency"] ?? "USD"),
    }))
    .sort((a, b) => b.cost - a.cost);
}

export async function costByDimension(
  arm: ArmClient,
  subscriptionId: string,
  dimension: "ResourceId" | "ResourceGroupName" | "MeterCategory",
  range: { from: Date; to: Date },
): Promise<CostRow[]> {
  const rows = await runQuery(arm, subscriptionId, {
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod: { from: `${isoDay(range.from)}T00:00:00Z`, to: `${isoDay(range.to)}T23:59:59Z` },
    dataset: {
      granularity: "None",
      aggregation: { Cost: { name: "Cost", function: "Sum" } },
      grouping: [{ type: "Dimension", name: dimension }],
    },
  });
  return toCostRows(rows, dimension);
}

export interface DailyCost {
  date: string;
  cost: number;
}

/** Daily total cost for the range; days with no charges are filled with zero. */
export async function dailyCost(arm: ArmClient, subscriptionId: string, range: { from: Date; to: Date }): Promise<DailyCost[]> {
  const rows = await runQuery(arm, subscriptionId, {
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod: { from: `${isoDay(range.from)}T00:00:00Z`, to: `${isoDay(range.to)}T23:59:59Z` },
    dataset: { granularity: "Daily", aggregation: { Cost: { name: "Cost", function: "Sum" } } },
  });
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const raw = String(r["UsageDate"] ?? "");
    const day = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(r["Cost"] ?? 0));
  }
  const out: DailyCost[] = [];
  for (let d = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate())); d <= range.to; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = isoDay(d);
    out.push({ date: key, cost: byDay.get(key) ?? 0 });
  }
  return out;
}

export interface Projection {
  /** Average of the last 7 complete days. */
  dailyRunRate: number;
  hourlyBurn: number;
  /** Completed days this month plus the run rate for every remaining day (including today). */
  forecastMonth: number;
}

/**
 * Projects month-end spend. Today's cost is ignored because Cost Management data lags by hours,
 * so the partial day would under-count; today is instead charged at the run rate.
 */
export function project(daily: DailyCost[], now = new Date()): Projection {
  const today = isoDay(now);
  const complete = daily.filter((d) => d.date < today);
  const last7 = complete.slice(-7);
  const dailyRunRate = last7.length ? last7.reduce((s, d) => s + d.cost, 0) / last7.length : 0;
  const monthPrefix = today.slice(0, 7);
  const monthSoFar = complete.filter((d) => d.date.startsWith(monthPrefix)).reduce((s, d) => s + d.cost, 0);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const remaining = daysInMonth - now.getUTCDate() + 1;
  return { dailyRunRate, hourlyBurn: dailyRunRate / 24, forecastMonth: monthSoFar + dailyRunRate * remaining };
}

export interface ResourceDayCost {
  /** Lowercased resource ID ("" for charges not tied to a resource, e.g. support or marketplace). */
  key: string;
  date: string;
  cost: number;
}

/** Daily cost per resource for the range (one query; rows are resource × day). */
export async function dailyCostByResource(arm: ArmClient, subscriptionId: string, range: { from: Date; to: Date }): Promise<ResourceDayCost[]> {
  const rows = await runQuery(arm, subscriptionId, {
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod: { from: `${isoDay(range.from)}T00:00:00Z`, to: `${isoDay(range.to)}T23:59:59Z` },
    dataset: { granularity: "Daily", aggregation: { Cost: { name: "Cost", function: "Sum" } }, grouping: [{ type: "Dimension", name: "ResourceId" }] },
  });
  return rows.map((r) => {
    const raw = String(r["UsageDate"] ?? "");
    const date = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw.slice(0, 10);
    return { key: String(r["ResourceId"] ?? "").toLowerCase(), date, cost: Number(r["Cost"] ?? 0) };
  });
}

export interface LiveProjection {
  /** Daily cost of what still exists (and isn't parked), from its recent days. */
  liveDailyRate: number;
  liveForecastMonth: number;
  /** Recent daily cost of resources that are gone — what the trend forecast still counts. */
  removedDailyRate: number;
  /** Recent daily cost of resources parked since (firewall/App Gateway stopped…). */
  parkedDailyRate: number;
  /** The days the rates are averaged over. */
  window: string[];
}

/**
 * Month-end forecast from the resources that exist now. The trend forecast averages the last 7 days of
 * the whole bill, so anything deleted keeps counting for a week; here each resource's typical daily cost
 * (median of the last `days` complete days since it first appears — one-off spikes such as a temporary
 * scale-up don't count) is summed only if it still exists, and parked ones count as zero.
 * Charges with no resource (support, marketplace) are kept.
 */
export function liveProject(
  daily: DailyCost[],
  byResource: ResourceDayCost[],
  exists: (id: string) => boolean,
  parked: (id: string) => boolean,
  now = new Date(),
  days = 5,
): LiveProjection {
  const today = isoDay(now);
  const window = [...new Set(byResource.map((r) => r.date))].filter((d) => d < today).sort().slice(-days);
  const perResource = new Map<string, Map<string, number>>();
  for (const r of byResource) {
    if (!window.includes(r.date)) continue;
    const m = perResource.get(r.key) ?? new Map<string, number>();
    m.set(r.date, (m.get(r.date) ?? 0) + r.cost);
    perResource.set(r.key, m);
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const k = Math.floor(s.length / 2);
    return s.length % 2 ? s[k]! : (s[k - 1]! + s[k]!) / 2;
  };
  let live = 0;
  let removed = 0;
  let parkedRate = 0;
  for (const [key, byDay] of perResource) {
    // Days before the resource first shows up don't count as zero-cost days.
    const first = window.findIndex((d) => byDay.has(d));
    const rate = first < 0 ? 0 : median(window.slice(first).map((d) => byDay.get(d) ?? 0));
    if (key && !exists(key)) removed += rate;
    else if (key && parked(key)) parkedRate += rate;
    else live += rate;
  }
  const complete = daily.filter((d) => d.date < today);
  const monthPrefix = today.slice(0, 7);
  const monthSoFar = complete.filter((d) => d.date.startsWith(monthPrefix)).reduce((s, d) => s + d.cost, 0);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const remaining = daysInMonth - now.getUTCDate() + 1;
  return { liveDailyRate: live, liveForecastMonth: monthSoFar + live * remaining, removedDailyRate: removed, parkedDailyRate: parkedRate, window };
}

export function lastNDays(n: number, now = new Date()) {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - (n - 1));
  return { from, to: new Date(now) };
}

export function last30Days(now = new Date()) {
  const to = new Date(now);
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from, to };
}

export function monthToDate(now = new Date()) {
  return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: new Date(now) };
}

export function previousMonth(now = new Date()) {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)),
  };
}
