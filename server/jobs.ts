import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { logAction, recoverInterruptedJobs } from "./db.ts";

export type JobStatus = "running" | "succeeded" | "failed" | "interrupted";

export interface Job {
  id: string;
  kind: string;
  target: string;
  target_name: string;
  status: JobStatus;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  pid?: number | null;
}

export class JobRunner {
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly db: Db) {}

  /**
   * Starts a background job and returns immediately; outcome is persisted and written to the action log.
   * The conflict check and insert run in one write transaction, so two processes sharing the database
   * (app, logon sweep, CLI) can never start work on the same target at once.
   */
  start(kind: string, target: string, targetName: string, work: () => Promise<string | void>): Job {
    const job: Job = {
      id: randomUUID(),
      kind,
      target: target.toLowerCase(),
      target_name: targetName,
      status: "running",
      started_at: new Date().toISOString(),
      finished_at: null,
      error: null,
    };
    recoverInterruptedJobs(this.db);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const running = this.db.prepare("SELECT id FROM jobs WHERE target = ? AND status = 'running'").get(job.target) as { id: string } | undefined;
      if (running) throw new JobConflictError(`Another job is already running on ${targetName}`);
      this.db
        .prepare("INSERT INTO jobs (id, kind, target, target_name, status, started_at, pid) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(job.id, job.kind, job.target, job.target_name, job.status, job.started_at, process.pid);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }

    const done = work().then(
      (detail) => this.finish(job, "succeeded", null, detail ?? undefined),
      (err: unknown) => this.finish(job, "failed", (err as Error).message ?? String(err)),
    );
    this.inflight.set(job.id, done);
    void done.finally(() => this.inflight.delete(job.id));
    return job;
  }

  /** Resolves when every job this process started has finished (used by CLI scripts before exiting). */
  async drain(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight.values()]);
  }

  get(id: string): Job | undefined {
    return this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as unknown as Job | undefined;
  }

  /** True while any process has a running job on this target. */
  isBusy(target: string): boolean {
    recoverInterruptedJobs(this.db);
    return Boolean(this.db.prepare("SELECT 1 FROM jobs WHERE target = ? AND status = 'running'").get(target.toLowerCase()));
  }

  private finish(job: Job, status: JobStatus, error: string | null, detail?: string) {
    this.db.prepare("UPDATE jobs SET status = ?, finished_at = ?, error = ? WHERE id = ?").run(status, new Date().toISOString(), error, job.id);
    logAction(this.db, { action: job.kind, target: job.target, outcome: status, detail: error ?? detail ?? job.target_name });
  }

  recent(limit = 50): Job[] {
    return this.db.prepare("SELECT * FROM jobs ORDER BY started_at DESC LIMIT ?").all(limit) as unknown as Job[];
  }
}

export class JobConflictError extends Error {}
