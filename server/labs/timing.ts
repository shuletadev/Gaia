import type { Db } from "../db.ts";
import type { Blueprint } from "./blueprints.ts";

/**
 * Learns how long labs really take. Every deployment records its stage, gate and total durations;
 * estimates then come from the last runs of the same blueprint variant (same region preferred)
 * instead of the static guess, and deploying labs get an ETA.
 */

export interface TimingSample {
  lab: string;
  blueprint: string;
  variant: string;
  region: string;
  kind: "total" | "stage" | "gate";
  stage: number;
  seconds: number;
  at: string;
}

export function ensureTimingTable(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lab_timings (
      lab TEXT NOT NULL,
      blueprint TEXT NOT NULL,
      variant TEXT NOT NULL,
      region TEXT NOT NULL,
      kind TEXT NOT NULL,
      stage INTEGER NOT NULL,
      seconds REAL NOT NULL,
      at TEXT NOT NULL,
      PRIMARY KEY (lab, kind, stage)
    );
  `);
}

export function variantOf(b: Pick<Blueprint, "timingKey">, params: Record<string, unknown>): string {
  try {
    return b.timingKey?.(params) ?? "";
  } catch {
    return "";
  }
}

export function recordTiming(db: Db, s: TimingSample) {
  ensureTimingTable(db);
  db.prepare("INSERT OR REPLACE INTO lab_timings (lab, blueprint, variant, region, kind, stage, seconds, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    s.lab,
    s.blueprint,
    s.variant,
    s.region,
    s.kind,
    s.stage,
    s.seconds,
    s.at,
  );
}

/** Seeds totals from labs deployed before timings were recorded (created → ready). */
export function backfillTimings(db: Db, blueprintOf: (id: string) => Pick<Blueprint, "timingKey" | "schema"> | undefined): number {
  ensureTimingTable(db);
  const rows = db
    .prepare("SELECT name, blueprint, region, params_json, created_at, ready_at FROM labs WHERE ready_at IS NOT NULL AND name NOT IN (SELECT lab FROM lab_timings WHERE kind = 'total')")
    .all() as { name: string; blueprint: string; region: string; params_json: string; created_at: string; ready_at: string }[];
  let n = 0;
  for (const r of rows) {
    const seconds = (Date.parse(r.ready_at) - Date.parse(r.created_at)) / 1000;
    if (!(seconds > 30 && seconds < 6 * 3600)) continue;
    const b = blueprintOf(r.blueprint);
    if (!b) continue;
    let params: Record<string, unknown> = {};
    try {
      params = b.schema.parse(JSON.parse(r.params_json)) as Record<string, unknown>;
    } catch {
      continue;
    }
    recordTiming(db, { lab: r.name, blueprint: r.blueprint, variant: variantOf(b, params), region: r.region, kind: "total", stage: -1, seconds, at: r.ready_at });
    n++;
  }
  return n;
}

export function samplesFor(db: Db, blueprint: string, variant: string, kind: TimingSample["kind"] = "total", stage = -1): TimingSample[] {
  ensureTimingTable(db);
  return db
    .prepare("SELECT * FROM lab_timings WHERE blueprint = ? AND variant = ? AND kind = ? AND stage = ? ORDER BY at DESC LIMIT 20")
    .all(blueprint, variant, kind, stage) as unknown as TimingSample[];
}

export interface DeployTime {
  minutes: [number, number];
  source: "learned" | "static";
  samples: number;
  /** Median of the samples used, in minutes. */
  typical?: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Pure: turns recorded totals into a range. Same-region samples are preferred when there are at least
 * two; one sample gives a ±30 % band, more give min −15 % to max +20 % of the last ten.
 */
export function learnedRange(samples: { seconds: number; region: string }[], region: string, fallback: [number, number]): DeployTime {
  const local = samples.filter((s) => s.region === region);
  const use = (local.length >= 2 ? local : samples).slice(0, 10).map((s) => s.seconds / 60);
  if (!use.length) return { minutes: fallback, source: "static", samples: 0 };
  const lo = use.length === 1 ? use[0]! * 0.7 : Math.min(...use) * 0.85;
  const hi = use.length === 1 ? use[0]! * 1.3 : Math.max(...use) * 1.2;
  return { minutes: [Math.max(1, Math.floor(lo)), Math.max(2, Math.ceil(hi))], source: "learned", samples: use.length, typical: Math.round(median(use)) };
}

export function deployTimeFor(db: Db, b: Blueprint<any>, params: Record<string, unknown>, region: string, fallback: [number, number]): DeployTime {
  return learnedRange(samplesFor(db, b.id, variantOf(b, params)), region, fallback);
}

/**
 * Minutes left for a deploying lab: the typical duration of the stages still ahead plus what remains
 * of the current one; falls back to the typical total minus elapsed time.
 */
export function etaMinutes(
  db: Db,
  b: Blueprint<any>,
  params: Record<string, unknown>,
  state: { index: number; total: number; stageStartedAt?: string } | undefined,
  createdAt: string,
  now = Date.now(),
): number | undefined {
  const variant = variantOf(b, params);
  if (state && state.stageStartedAt) {
    const per: number[] = [];
    for (let i = 0; i < state.total; i++) {
      const stages = samplesFor(db, b.id, variant, "stage", i).map((s) => s.seconds);
      if (!stages.length) break;
      const gates = samplesFor(db, b.id, variant, "gate", i).map((s) => s.seconds);
      per.push(median(stages) + (gates.length ? median(gates) : 0));
    }
    if (per.length === state.total) {
      const inCurrent = (now - Date.parse(state.stageStartedAt)) / 1000;
      const rest = per.slice(state.index + 1).reduce((s, x) => s + x, 0) + Math.max(0, per[state.index]! - inCurrent);
      return Math.max(1, Math.round(rest / 60));
    }
  }
  const totals = samplesFor(db, b.id, variant).map((s) => s.seconds);
  if (!totals.length) return undefined;
  return Math.max(1, Math.round((median(totals) - (now - Date.parse(createdAt)) / 1000) / 60));
}
