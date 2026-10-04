import type { Db } from "../db.ts";

export type SandboxStatus = "active" | "ended" | "failed";

export interface SandboxRow {
  rg_name: string;
  subscription_id: string;
  student_upn: string;
  student_name: string;
  object_id: string;
  course: string;
  location: string;
  budget_usd: number;
  created_at: string;
  expires_on: string;
  /** active: the group exists. ended: it is gone (the student deleted it, it expired, or an admin did). failed: provisioning did not finish. */
  status: SandboxStatus;
  ended_at: string | null;
  error: string | null;
}

export function ensureSandboxTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sandboxes (
      rg_name TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      student_upn TEXT NOT NULL,
      student_name TEXT NOT NULL,
      object_id TEXT NOT NULL,
      course TEXT NOT NULL,
      location TEXT NOT NULL,
      budget_usd REAL NOT NULL,
      created_at TEXT NOT NULL,
      expires_on TEXT NOT NULL,
      status TEXT NOT NULL,
      ended_at TEXT,
      error TEXT
    );
  `);
}

export function saveSandbox(db: Db, row: SandboxRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO sandboxes (rg_name, subscription_id, student_upn, student_name, object_id, course, location, budget_usd, created_at, expires_on, status, ended_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.rg_name, row.subscription_id, row.student_upn, row.student_name, row.object_id, row.course, row.location, row.budget_usd, row.created_at, row.expires_on, row.status, row.ended_at, row.error);
}

export function getSandbox(db: Db, rgName: string): SandboxRow | undefined {
  return db.prepare("SELECT * FROM sandboxes WHERE rg_name = ?").get(rgName) as SandboxRow | undefined;
}

export function listSandboxes(db: Db): SandboxRow[] {
  return db.prepare("SELECT * FROM sandboxes ORDER BY created_at DESC").all() as unknown as SandboxRow[];
}

export function setSandboxStatus(db: Db, rgName: string, status: SandboxStatus, extra: { ended_at?: string | null; error?: string | null } = {}): void {
  db.prepare("UPDATE sandboxes SET status = ?, ended_at = ?, error = ? WHERE rg_name = ?").run(status, extra.ended_at ?? null, extra.error ?? null, rgName);
}
