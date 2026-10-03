import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, DATA_DIR } from "../server/config.ts";
import { ArmClient } from "../server/azure/arm.ts";
import { runAudit, type AuditReport } from "../server/audit/runAudit.ts";
import { openDb, saveAuditRun, logAction } from "../server/db.ts";
import { CostService } from "../server/costService.ts";

const usd = (n?: number) => (n === undefined ? "n/a" : `$${n.toFixed(2)}`);

export function toMarkdown(r: AuditReport): string {
  const lines: string[] = [];
  lines.push(`# Baseline audit — ${r.subscription.name}`, "");
  lines.push(`Generated ${r.generatedAt} · subscription \`${r.subscription.id}\``, "");
  lines.push("## Totals", "");
  lines.push("| Metric | Value |", "|---|---|");
  lines.push(`| Resources | ${r.totals.resources} |`);
  lines.push(`| Resource groups | ${r.totals.resourceGroups} |`);
  lines.push(`| Month to date | ${usd(r.totals.costMtdUsd)} of ${usd(r.totals.budgetUsd)} budget |`);
  lines.push(`| Previous month | ${usd(r.totals.costPrevMonthUsd)} |`);
  lines.push(`| Last 30 days | ${usd(r.totals.cost30dUsd)} |`);
  lines.push(`| Last 30 days on flagged resources | ${usd(r.totals.flaggedCost30dUsd)} |`, "");

  lines.push("## Findings", "");
  if (r.findings.length === 0) lines.push("No findings.", "");
  else {
    lines.push("| Severity | Rule | Resource | Resource group | 30-day cost | Suggested | Detail |", "|---|---|---|---|---|---|---|");
    for (const f of r.findings) {
      lines.push(`| ${f.severity} | ${f.title} | ${f.name} | ${f.resourceGroup} | ${usd(f.cost30dUsd)} | ${f.action} | ${f.detail} |`);
    }
    lines.push("");
  }

  lines.push("## Resource groups", "");
  lines.push("| Resource group | Location | Resources | 30-day | MTD | Prev month | Excluded |", "|---|---|---|---|---|---|---|");
  for (const g of r.resourceGroups) {
    lines.push(`| ${g.name} | ${g.location} | ${g.resourceCount} | ${usd(g.cost30dUsd)} | ${usd(g.costMtdUsd)} | ${usd(g.costPrevMonthUsd)} | ${g.excluded ? "yes" : ""} |`);
  }
  lines.push("");

  lines.push("## Top resources by 30-day cost", "");
  lines.push("| Resource | Resource group | 30-day cost |", "|---|---|---|");
  for (const t of r.topResources) {
    const label = t.exists ? t.name : `${t.name} *(no longer exists / subscription-level)*`;
    lines.push(`| ${label} | ${t.resourceGroup || "—"} | ${usd(t.cost30dUsd)} |`);
  }
  lines.push("");

  if (r.warnings.length) {
    lines.push("## Warnings", "", ...r.warnings.map((w) => `- ${w}`), "");
  }
  return lines.join("\n");
}

const config = loadConfig();
const arm = new ArmClient({ tenantId: config.tenantId });
const db = openDb();
const costs = new CostService(arm, db);
const outDir = resolve(DATA_DIR, "reports");
mkdirSync(outDir, { recursive: true });

for (const sub of config.subscriptions) {
  const report = await runAudit(arm, config, sub.id, costs, { refreshCosts: true });
  saveAuditRun(db, sub.id, report);
  logAction(db, { action: "audit.baseline", target: sub.id, outcome: "ok", detail: `${report.findings.length} findings` });
  const stamp = report.generatedAt.slice(0, 10);
  const base = resolve(outDir, `baseline-${stamp}-${sub.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${base}.md`, toMarkdown(report));
  console.log(`${sub.name}: ${report.findings.length} findings -> ${base}.md`);
  if (report.warnings.length) console.warn(report.warnings.join("\n"));
}
