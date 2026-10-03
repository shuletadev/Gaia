import type { AuditReport } from "../audit/runAudit.ts";
import type { DailyCost, LiveProjection, Projection } from "../azure/cost.ts";
import type { LabRow } from "../db.ts";
import type { Finding } from "../audit/rules.ts";

export interface WeeklyInput {
  now: Date;
  report: AuditReport;
  previous?: AuditReport;
  daily: DailyCost[];
  projection?: Projection;
  live?: LiveProjection;
  labs: LabRow[];
  /** Labs currently alive in Azure (managedBy=labctl groups) with their expiry. */
  running: { name: string; expiresOn?: string }[];
  appUrl: string;
}

const usd = (n: number | undefined, d = 0) => (n === undefined ? "n/a" : `$${n.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`);
const key = (f: Finding) => `${f.ruleId}|${f.resourceId}`.toLowerCase();
const day = (d: Date) => d.toISOString().slice(0, 10);

export function diffFindings(current: Finding[], previous: Finding[] | undefined) {
  if (!previous) return { added: [] as Finding[], resolved: [] as Finding[] };
  const prev = new Set(previous.map(key));
  const cur = new Set(current.map(key));
  return { added: current.filter((f) => !prev.has(key(f))), resolved: previous.filter((f) => !cur.has(key(f))) };
}

/** Sum of the last `n` complete days, and the `n` before that. */
export function weekOverWeek(daily: DailyCost[], now: Date, n = 7) {
  const complete = daily.filter((d) => d.date < day(now));
  const sum = (xs: DailyCost[]) => xs.reduce((s, d) => s + d.cost, 0);
  const thisWeek = sum(complete.slice(-n));
  const lastWeek = complete.length >= 2 * n ? sum(complete.slice(-2 * n, -n)) : undefined;
  const change = lastWeek && lastWeek > 0 ? (thisWeek - lastWeek) / lastWeek : undefined;
  return { thisWeek, lastWeek, change };
}

export function buildWeekly(i: WeeklyInput): string {
  const { report, now } = i;
  const t = report.totals;
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const wow = weekOverWeek(i.daily, now);
  const pct = t.costMtdUsd !== undefined ? Math.round((t.costMtdUsd / t.budgetUsd) * 100) : undefined;
  // The live forecast drops deleted resources immediately; the trend one lags a week.
  const forecast = i.live?.liveForecastMonth ?? i.projection?.forecastMonth;
  const over = forecast !== undefined && forecast > t.budgetUsd;
  const trend = wow.change === undefined ? "" : ` (${wow.change >= 0 ? "▲" : "▼"}${Math.abs(Math.round(wow.change * 100))}% vs prior week)`;

  const weekLabs = i.labs.filter((l) => new Date(l.created_at) >= from);
  const labCost = weekLabs.reduce((s, l) => {
    const end = l.destroyed_at ? new Date(l.destroyed_at) : now;
    return s + (l.est_hourly ?? 0) * Math.max(0, (end.getTime() - new Date(l.created_at).getTime()) / 3_600_000);
  }, 0);

  const open = report.findings.filter((f) => f.severity !== "info");
  const high = open.filter((f) => f.severity === "high");
  const { added, resolved } = diffFindings(report.findings, i.previous?.findings);

  const lines: string[] = [];
  lines.push(`🌍 Project Gaia weekly — ${report.subscription.name} (${day(from)} → ${day(now)})`);
  lines.push("");
  lines.push(`💰 ${usd(t.costMtdUsd)} month-to-date of ${usd(t.budgetUsd)}${pct !== undefined ? ` (${pct}%)` : ""} · forecast ${usd(forecast)}${over ? " ⚠️ over budget" : ""}`);
  lines.push(`   Last 7 days ${usd(wow.thisWeek, 2)}${trend} · run rate ${usd(i.live ? i.live.liveDailyRate / 24 : i.projection?.hourlyBurn, 2)}/hr`);
  if (i.live && i.projection) lines.push(`   Trend forecast ${usd(i.projection.forecastMonth)} still counts ${usd(i.live.removedDailyRate, 2)}/day of deleted resources`);
  lines.push("");
  lines.push(`🧪 Labs: ${weekLabs.length} launched this week (≈${usd(labCost, 2)}) · ${i.running.length} running now`);
  for (const r of i.running) lines.push(`   • ${r.name}${r.expiresOn ? ` — expires ${r.expiresOn.replace("T", " ").slice(0, 16)} UTC` : ""}`);
  lines.push("");
  lines.push(`🔎 Findings: ${open.length} open (${high.length} high), ≈${usd(t.flaggedCost30dUsd)} / 30 days on flagged resources`);
  if (i.previous) lines.push(`   Since last report: +${added.length} new, −${resolved.length} resolved`);
  for (const f of added.filter((x) => x.severity !== "info").slice(0, 5)) lines.push(`   + ${f.name} — ${f.title}${f.cost30dUsd ? ` (${usd(f.cost30dUsd, 2)}/30d)` : ""}`);
  for (const f of high.slice(0, 3)) if (!added.includes(f)) lines.push(`   ! ${f.name} — ${f.title} (${usd(f.cost30dUsd, 2)}/30d)`);
  lines.push("");
  const top = report.topResources.filter((r) => r.exists).slice(0, 3);
  if (top.length) lines.push(`🏷 Top cost (30d): ${top.map((r) => `${r.name} ${usd(r.cost30dUsd)}`).join(" · ")}`);
  lines.push(`Open Gaia: ${i.appUrl}`);
  return lines.join("\n");
}
