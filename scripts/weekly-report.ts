/**
 * Weekly summary for Teams: spend vs budget, labs, findings and what changed since the last report.
 * Used by the Scout "labctl weekly report" automation:  npm run --silent weekly
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "../server/config.ts";
import { runAudit, type AuditReport } from "../server/audit/runAudit.ts";
import { listResourceGroups, listResources } from "../server/azure/resourceGraph.ts";
import { liveProjectionFor } from "../server/snapshot.ts";
import { project } from "../server/azure/cost.ts";
import { listLabs, logAction, saveAuditRun, type Db } from "../server/db.ts";
import { expiresAt, isLabManaged } from "../server/guard.ts";
import { buildWeekly } from "../server/labs/weekly.ts";
import { context, withRetry } from "./context.ts";

function auditBefore(db: Db, sub: string, beforeIso: string): AuditReport | undefined {
  const row = (db.prepare("SELECT report_json FROM audit_runs WHERE subscription_id = ? AND at <= ? ORDER BY id DESC LIMIT 1").get(sub, beforeIso) ??
    db.prepare("SELECT report_json FROM audit_runs WHERE subscription_id = ? ORDER BY id ASC LIMIT 1").get(sub)) as { report_json: string } | undefined;
  return row ? (JSON.parse(row.report_json) as AuditReport) : undefined;
}

const { config, arm, db, costs } = context();
const now = new Date();
const out: string[] = [];

for (const sub of config.subscriptions) {
  const previous = auditBefore(db, sub.id, new Date(now.getTime() - 6 * 86_400_000).toISOString());
  const report = await withRetry(() => runAudit(arm, config, sub.id, costs, { refreshCosts: true }), 3, 30_000);
  saveAuditRun(db, sub.id, report);
  const daily = (await costs.daily30(sub.id).catch(() => undefined))?.value ?? [];
  const groups = await listResourceGroups(arm, [sub.id]);
  const running = groups.filter((g) => isLabManaged(g.tags)).map((g) => ({ name: g.name, expiresOn: expiresAt(g.tags)?.toISOString() }));
  const text = buildWeekly({
    now,
    report,
    previous,
    daily,
    projection: daily.length ? project(daily, now) : undefined,
    live: daily.length ? await liveProjectionFor(costs, db, sub.id, await listResources(arm, [sub.id]), daily).catch(() => undefined) : undefined,
    labs: listLabs(db, 500).filter((l) => l.subscription_id.toLowerCase() === sub.id.toLowerCase()),
    running,
    appUrl: `http://127.0.0.1:${config.server.port}`,
  });
  out.push(text);
  const dir = resolve(DATA_DIR, "reports");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `weekly-${now.toISOString().slice(0, 10)}-${sub.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`), text);
  logAction(db, { action: "report.weekly", target: sub.id, outcome: "ok", detail: `${report.findings.length} findings` });
}

console.log(out.join("\n\n"));
