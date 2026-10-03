import type { Db } from "../db.ts";

/**
 * Regional capacity can't be queried ahead of time (AKS/Container Apps "heavy usage", VM allocation
 * failures, SKU not available). When a deployment hits one, it is remembered for a day so the next
 * launch in that region is warned and the suggested alternatives move to another region.
 */

export const CAPACITY_ERROR = /CapacityHeavyUsage|AllocationFailed|OverconstrainedAllocation|SkuNotAvailable|ZonalAllocationFailed|InsufficientCapacity|NotAvailableForSubscription|RegionCapacity|capacity (is|isn't|not) available/i;

const DAY = 24 * 3_600_000;

function ensure(db: Db) {
  db.exec("CREATE TABLE IF NOT EXISTS capacity_events (blueprint TEXT NOT NULL, region TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL)");
  // Shortages are per variant (e.g. Container Apps vs VM host), not per blueprint.
  const cols = db.prepare("PRAGMA table_info(capacity_events)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "variant")) db.exec("ALTER TABLE capacity_events ADD COLUMN variant TEXT NOT NULL DEFAULT \u0027\u0027");
}

export function recordCapacityEvent(db: Db, blueprint: string, variant: string, region: string, detail: string, at = new Date()) {
  ensure(db);
  db.prepare("INSERT INTO capacity_events (blueprint, variant, region, detail, at) VALUES (?, ?, ?, ?, ?)").run(blueprint, variant, region, detail.slice(0, 300), at.toISOString());
}

export function recentCapacityEvent(db: Db, blueprint: string, variant: string, region: string, now = Date.now()): { detail: string; at: string } | undefined {
  ensure(db);
  return db
    .prepare("SELECT detail, at FROM capacity_events WHERE blueprint = ? AND variant = ? AND region = ? AND at > ? ORDER BY at DESC LIMIT 1")
    .get(blueprint, variant, region, new Date(now - DAY).toISOString()) as { detail: string; at: string } | undefined;
}

/** Drops SDK dumps (status line, headers, raw body) that some resource providers append to their messages. */
export function tidyError(message: string): string {
  return message.split(/\r?\n(?:Status: \d|ErrorCode:|Content:|Headers:)/)[0]!.trim();
}
