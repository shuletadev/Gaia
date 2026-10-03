import type { ArmClient } from "../azure/arm.ts";
import { listResourceGroups } from "../azure/resourceGraph.ts";
import type { LabctlConfig } from "../config.ts";
import { logAction, type Db } from "../db.ts";
import { canAutoDelete, canModify } from "../guard.ts";
import { JobConflictError, type JobRunner } from "../jobs.ts";
import { destroyLab } from "./engine.ts";

export interface SweepResult {
  at: string;
  checked: number;
  expired: string[];
  started: string[];
  skipped: { name: string; reason: string }[];
}

/**
 * Local expiry sweep: runs at start-up, on an interval while the app is open, and on demand.
 * Only resource groups that pass canAutoDelete (labctl-managed, expired, allow-listed, not excluded) are destroyed.
 */
export class Sweeper {
  last?: SweepResult;
  nextAt?: string;
  private timer?: ReturnType<typeof setInterval>;
  private startTimer?: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(
    private readonly arm: ArmClient,
    private readonly db: Db,
    private readonly config: LabctlConfig,
    private readonly jobs: JobRunner,
  ) {}

  start(firstDelayMs = 30_000) {
    if (!this.config.labs.sweepEnabled) return;
    const every = this.config.labs.sweepIntervalMinutes * 60_000;
    const schedule = (ms: number) => (this.nextAt = new Date(Date.now() + ms).toISOString());
    schedule(firstDelayMs);
    this.startTimer = setTimeout(() => {
      void this.run("startup");
      schedule(every);
      this.timer = setInterval(() => {
        void this.run("interval");
        schedule(every);
      }, every);
    }, firstDelayMs);
  }

  stop() {
    clearTimeout(this.startTimer);
    clearInterval(this.timer);
    this.nextAt = undefined;
  }

  /** Re-reads the schedule after a settings change (on/off, interval). */
  restart(firstDelayMs = 10_000) {
    this.stop();
    this.start(firstDelayMs);
  }

  async run(trigger: string, now = new Date()): Promise<SweepResult> {
    if (this.running) return this.last ?? { at: now.toISOString(), checked: 0, expired: [], started: [], skipped: [] };
    this.running = true;
    try {
      const groups = await listResourceGroups(this.arm, this.config.subscriptions.map((s) => s.id));
      const result: SweepResult = { at: now.toISOString(), checked: groups.length, expired: [], started: [], skipped: [] };
      for (const g of groups) {
        if (!canAutoDelete(this.config, { id: g.id, name: g.name, tags: g.tags }, now).allowed) continue;
        result.expired.push(g.name);
        try {
          this.jobs.start("lab.expire", g.id, g.name, () => destroyLab(this.arm, this.db, g.subscriptionId, g.name, { canTouch: (id) => { const v = canModify(this.config, id); return v.allowed ? undefined : v.reason; } }));
          result.started.push(g.name);
        } catch (e) {
          result.skipped.push({ name: g.name, reason: e instanceof JobConflictError ? "job already running" : (e as Error).message });
        }
      }
      logAction(this.db, { action: "lab.sweep", target: trigger, outcome: "ok", detail: `${result.expired.length} expired, ${result.started.length} destroying` });
      this.last = result;
      return result;
    } catch (e) {
      logAction(this.db, { action: "lab.sweep", target: trigger, outcome: "failed", detail: (e as Error).message });
      throw e;
    } finally {
      this.running = false;
    }
  }
}
