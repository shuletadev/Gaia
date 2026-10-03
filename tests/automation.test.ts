import { describe, expect, it } from "vitest";
import { openDb, recoverInterruptedJobs } from "../server/db.ts";
import { JobConflictError, JobRunner } from "../server/jobs.ts";
import { formatNudges, markNudged, selectNudges, sentNudges } from "../server/labs/nudges.ts";
import { buildWeekly, diffFindings, weekOverWeek } from "../server/labs/weekly.ts";
import type { AuditReport } from "../server/audit/runAudit.ts";
import type { Finding } from "../server/audit/rules.ts";

const now = new Date("2026-10-05T15:00:00Z");
const lab = (name: string, expiresOn?: string, extra: Record<string, string> = {}) => ({ name, tags: { managedBy: "labctl", ...(expiresOn ? { expiresOn } : {}), ...extra } });

describe("multi-process jobs", () => {
  it("only interrupts running jobs whose process is gone", () => {
    const db = openDb(":memory:");
    const ins = db.prepare("INSERT INTO jobs (id, kind, target, target_name, status, started_at, pid) VALUES (?, 'k', ?, ?, 'running', 'x', ?)");
    ins.run("live", "/a", "a", 111);
    ins.run("dead", "/b", "b", 222);
    ins.run("legacy", "/c", "c", null);
    expect(recoverInterruptedJobs(db, (pid) => pid === 111)).toBe(2);
    const status = Object.fromEntries((db.prepare("SELECT id, status FROM jobs").all() as { id: string; status: string }[]).map((r) => [r.id, r.status]));
    expect(status).toEqual({ live: "running", dead: "interrupted", legacy: "interrupted" });
  });

  it("blocks a second job on a target owned by another live process, and drains its own", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO jobs (id, kind, target, target_name, status, started_at, pid) VALUES ('other', 'lab.destroy', '/rg/lab-x', 'lab-x', 'running', 'x', ?)").run(process.pid);
    const runner = new JobRunner(db);
    expect(() => runner.start("lab.expire", "/RG/lab-x", "lab-x", async () => undefined)).toThrow(JobConflictError);
    let done = false;
    const job = runner.start("lab.expire", "/rg/lab-y", "lab-y", async () => {
      await new Promise((r) => setTimeout(r, 20));
      done = true;
      return "ok";
    });
    expect(job.pid).toBeUndefined();
    await runner.drain();
    expect(done).toBe(true);
    expect(runner.get(job.id)?.status).toBe("succeeded");
    expect(runner.get(job.id)?.pid).toBe(process.pid);
  });
});

describe("nudges", () => {
  const groups = [
    lab("lab-soon", "2026-10-05T15:40:00Z", { purpose: "case 123", blueprint: "apim-v2-quickstart" }),
    lab("lab-later", "2026-10-05T19:00:00Z"),
    lab("lab-overdue", "2026-10-05T13:30:00Z"),
    lab("lab-no-expiry"),
    { name: "SharedEnv", tags: { expiresOn: "2026-10-05T15:10:00Z" } },
  ];

  it("selects expiring and overdue labs only", () => {
    const n = selectNudges(groups, new Set(), now, 75);
    expect(n.map((x) => [x.lab, x.kind, x.minutes])).toEqual([
      ["lab-overdue", "overdue", -90],
      ["lab-soon", "expiring", 40],
    ]);
  });

  it("sends each lab+expiry once, and again after an extension", () => {
    const db = openDb(":memory:");
    markNudged(db, selectNudges(groups, sentNudges(db), now, 75));
    expect(selectNudges(groups, sentNudges(db), now, 75)).toEqual([]);
    const extended = [lab("lab-soon", "2026-10-05T16:10:00Z")];
    expect(selectNudges(extended, sentNudges(db), now, 75).map((x) => x.minutes)).toEqual([70]);
    // Once it lapses, the overdue nudge is separate from the expiring one.
    expect(selectNudges([lab("lab-soon", "2026-10-05T15:40:00Z")], sentNudges(db), new Date("2026-10-05T16:00:00Z"), 75).map((x) => x.kind)).toEqual(["overdue"]);
  });

  it("formats a short message with context and a link", () => {
    const text = formatNudges(selectNudges(groups, new Set(), now, 75), new Map([["lab-overdue", 0.52]]), "http://127.0.0.1:4870");
    expect(text).toContain("lab-soon (case 123 · apim-v2-quickstart) expires in 40 min");
    expect(text).toContain("lab-overdue expired 1h 30m ago and is still running (~$0.52/hr)");
    expect(text).toContain("http://127.0.0.1:4870/#labs");
  });
});

describe("weekly report", () => {
  const f = (name: string, ruleId: string, severity: Finding["severity"] = "low", cost = 0): Finding => ({
    ruleId, severity, title: ruleId, action: "delete", resourceId: `/x/${name}`, name, type: "t", resourceGroup: "rg", detail: "", cost30dUsd: cost,
  });
  const daily = Array.from({ length: 21 }, (_, i) => {
    const d = new Date("2026-09-14T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), cost: i < 14 ? 10 : 15 };
  });

  it("diffs findings by rule and resource", () => {
    const { added, resolved } = diffFindings([f("a", "r1"), f("b", "r1")], [f("a", "r1"), f("c", "r2")]);
    expect(added.map((x) => x.name)).toEqual(["b"]);
    expect(resolved.map((x) => x.name)).toEqual(["c"]);
  });

  it("compares the last 7 complete days to the 7 before", () => {
    const w = weekOverWeek(daily, now);
    expect(w.thisWeek).toBe(105);
    expect(w.lastWeek).toBe(70);
    expect(w.change).toBeCloseTo(0.5);
  });

  it("builds the summary", () => {
    const report = {
      generatedAt: now.toISOString(),
      subscription: { id: "s", name: "Lab Sandbox" },
      totals: { resources: 30, resourceGroups: 9, costMtdUsd: 75, costPrevMonthUsd: 400, cost30dUsd: 380, budgetUsd: 600, flaggedCost30dUsd: 290 },
      resourceGroups: [],
      topResources: [{ resourceId: "/x/HubFW", name: "HubFW", resourceGroup: "SharedEnv", cost30dUsd: 280, exists: true }],
      findings: [f("HubFW", "always-on-costly", "high", 280), f("new-ip", "unattached-public-ip", "medium", 3.6)],
      warnings: [],
    } as AuditReport;
    const text = buildWeekly({
      now,
      report,
      previous: { ...report, findings: [f("HubFW", "always-on-costly", "high", 280), f("gone", "unassociated-nsg")] },
      daily,
      projection: { dailyRunRate: 15, hourlyBurn: 0.625, forecastMonth: 470 },
      labs: [{ name: "lab-apimqs-ab12", blueprint: "apim-v2-quickstart", subscription_id: "s", region: "centralus", params_json: "{}", purpose: null, est_hourly: 0.2, created_at: "2026-10-03T10:00:00Z", ready_at: null, destroyed_at: "2026-10-03T15:00:00Z", status: "destroyed", outputs_json: null, error: null }],
      running: [{ name: "lab-hubfw-x1y2", expiresOn: "2026-10-05T20:00:00.000Z" }],
      appUrl: "http://127.0.0.1:4870",
    });
    expect(text).toContain("$75 month-to-date of $600 (13%) · forecast $470");
    expect(text).toContain("Last 7 days $105.00 (▲50% vs prior week)");
    expect(text).toContain("1 launched this week (≈$1.00) · 1 running now");
    expect(text).toContain("lab-hubfw-x1y2 — expires 2026-10-05 20:00 UTC");
    expect(text).toContain("+1 new, −1 resolved");
    expect(text).toContain("+ new-ip");
    expect(text).toContain("! HubFW");
    expect(text).toContain("Top cost (30d): HubFW $280");
  });
});
