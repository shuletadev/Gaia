import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "./config.ts";

export type Db = DatabaseSync;

export function openDb(path = resolve(DATA_DIR, "labctl.db")): Db {
  if (path !== ":memory:") mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      dry_run INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL,
      detail TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      subscription_id TEXT NOT NULL,
      report_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      target TEXT NOT NULL,
      target_name TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS cost_cache (
      key TEXT PRIMARY KEY,
      fetched_at INTEGER NOT NULL,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS parked_state (
      resource_id TEXT PRIMARY KEY,
      parked_at TEXT NOT NULL,
      spec_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS labs (
      name TEXT PRIMARY KEY,
      blueprint TEXT NOT NULL,
      subscription_id TEXT NOT NULL,
      region TEXT NOT NULL,
      params_json TEXT NOT NULL,
      purpose TEXT,
      est_hourly REAL,
      created_at TEXT NOT NULL,
      ready_at TEXT,
      destroyed_at TEXT,
      status TEXT NOT NULL,
      outputs_json TEXT,
      error TEXT
    );
  `);
  // Older databases predate the pid column.
  const cols = db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "pid")) db.exec("ALTER TABLE jobs ADD COLUMN pid INTEGER");
  const labCols = db.prepare("PRAGMA table_info(labs)").all() as { name: string }[];
  if (!labCols.some((c) => c.name === "stage_json")) db.exec("ALTER TABLE labs ADD COLUMN stage_json TEXT");
  db.exec("PRAGMA busy_timeout = 5000");
  recoverInterruptedJobs(db);
  return db;
}

export function isProcessAlive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The app, the logon sweep and the CLI scripts share this database. A "running" job is only
 * interrupted if the process that owns it is gone — never just because another process started.
 */
export function recoverInterruptedJobs(db: Db, alive: (pid: number | null) => boolean = isProcessAlive): number {
  const rows = db.prepare("SELECT id, pid FROM jobs WHERE status = 'running'").all() as { id: string; pid: number | null }[];
  const dead = rows.filter((r) => !alive(r.pid));
  const stmt = db.prepare("UPDATE jobs SET status = 'interrupted', finished_at = ? WHERE id = ?");
  for (const r of dead) stmt.run(new Date().toISOString(), r.id);
  return dead.length;
}

export interface ActionLogEntry {
  id: number;
  at: string;
  action: string;
  target: string;
  dry_run: number;
  outcome: string;
  detail: string | null;
}

export function recentActions(db: Db, limit = 200): ActionLogEntry[] {
  return db.prepare("SELECT * FROM action_log ORDER BY id DESC LIMIT ?").all(limit) as unknown as ActionLogEntry[];
}

export async function cached<T>(db: Db, key: string, ttlMs: number, refresh: boolean, fetcher: () => Promise<T>): Promise<{ value: T; fetchedAt: number }> {
  const row = db.prepare("SELECT fetched_at, json FROM cost_cache WHERE key = ?").get(key) as { fetched_at: number; json: string } | undefined;
  if (row && !refresh && Date.now() - row.fetched_at < ttlMs) return { value: JSON.parse(row.json) as T, fetchedAt: row.fetched_at };
  try {
    const value = await fetcher();
    const fetchedAt = Date.now();
    db.prepare("INSERT OR REPLACE INTO cost_cache (key, fetched_at, json) VALUES (?, ?, ?)").run(key, fetchedAt, JSON.stringify(value));
    return { value, fetchedAt };
  } catch (e) {
    // Serve stale data rather than nothing when the API throttles or fails.
    if (row) return { value: JSON.parse(row.json) as T, fetchedAt: row.fetched_at };
    throw e;
  }
}

export function saveParkedState(db: Db, resourceId: string, spec: unknown) {
  db.prepare("INSERT OR REPLACE INTO parked_state (resource_id, parked_at, spec_json) VALUES (?, ?, ?)").run(
    resourceId.toLowerCase(),
    new Date().toISOString(),
    JSON.stringify(spec),
  );
}

export function getParkedState<T>(db: Db, resourceId: string): T | undefined {
  const row = db.prepare("SELECT spec_json FROM parked_state WHERE resource_id = ?").get(resourceId.toLowerCase()) as { spec_json: string } | undefined;
  return row ? (JSON.parse(row.spec_json) as T) : undefined;
}

export function clearParkedState(db: Db, resourceId: string) {
  db.prepare("DELETE FROM parked_state WHERE resource_id = ?").run(resourceId.toLowerCase());
}

export type LabStatus = "deploying" | "ready" | "failed" | "destroying" | "destroyed";

export interface LabRow {
  name: string;
  blueprint: string;
  subscription_id: string;
  region: string;
  params_json: string;
  purpose: string | null;
  est_hourly: number | null;
  created_at: string;
  ready_at: string | null;
  destroyed_at: string | null;
  status: LabStatus;
  outputs_json: string | null;
  error: string | null;
  /** Serialized StageState: where a staged deployment is, so Retry and restarts resume there. */
  stage_json?: string | null;
}

export function insertLab(db: Db, lab: Omit<LabRow, "ready_at" | "destroyed_at" | "outputs_json" | "error" | "stage_json">) {
  db.prepare(
    "INSERT INTO labs (name, blueprint, subscription_id, region, params_json, purpose, est_hourly, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(lab.name, lab.blueprint, lab.subscription_id, lab.region, lab.params_json, lab.purpose, lab.est_hourly, lab.created_at, lab.status);
}

export function updateLab(db: Db, name: string, patch: Partial<Pick<LabRow, "status" | "ready_at" | "destroyed_at" | "outputs_json" | "error" | "stage_json">>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  db.prepare(`UPDATE labs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE name = ?`).run(...keys.map((k) => patch[k] ?? null), name);
}

export function getLab(db: Db, name: string): LabRow | undefined {
  return db.prepare("SELECT * FROM labs WHERE name = ?").get(name) as unknown as LabRow | undefined;
}

export function listLabs(db: Db, limit = 100): LabRow[] {
  return db.prepare("SELECT * FROM labs ORDER BY created_at DESC LIMIT ?").all(limit) as unknown as LabRow[];
}

export function logAction(db: Db, entry: { action: string; target: string; dryRun?: boolean; outcome: string; detail?: string }) {
  db.prepare("INSERT INTO action_log (at, action, target, dry_run, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)").run(
    new Date().toISOString(),
    entry.action,
    entry.target,
    entry.dryRun ? 1 : 0,
    entry.outcome,
    entry.detail ?? null,
  );
}

export function saveAuditRun(db: Db, subscriptionId: string, report: unknown) {
  db.prepare("INSERT INTO audit_runs (at, subscription_id, report_json) VALUES (?, ?, ?)").run(
    new Date().toISOString(),
    subscriptionId,
    JSON.stringify(report),
  );
}

export function latestAuditRun<T>(db: Db, subscriptionId: string): T | undefined {
  const row = db
    .prepare("SELECT report_json FROM audit_runs WHERE subscription_id = ? ORDER BY id DESC LIMIT 1")
    .get(subscriptionId) as { report_json: string } | undefined;
  return row ? (JSON.parse(row.report_json) as T) : undefined;
}

