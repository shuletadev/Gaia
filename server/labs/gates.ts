import type { Probes } from "../validate.ts";
import type { GateDef, GateKind } from "./blueprints.ts";

/**
 * Readiness gates: checks polled between deployment stages. A stage's ARM deployment can report
 * Succeeded while the service behind it is still settling (an app still starting, DNS propagating).
 * Gates wait for the real signal before moving on.
 */

export interface GateCtx {
  x: Probes;
  sub: string;
  labName: string;
  params: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

/** One poll. `done: false` means "not yet" and the gate keeps polling until its timeout. */
export interface GateTick {
  done: boolean;
  ok: boolean;
  detail: string;
  outputs?: Record<string, unknown>;
}

export interface GateResult {
  ok: boolean;
  timedOut: boolean;
  detail: string;
  outputs: Record<string, unknown>;
  polls: number;
}

const waiting = (detail: string): GateTick => ({ done: false, ok: false, detail });
const passed = (detail: string, outputs?: Record<string, unknown>): GateTick => ({ done: true, ok: true, detail, outputs });
const failed = (detail: string): GateTick => ({ done: true, ok: false, detail });

async function httpOk(c: GateCtx): Promise<GateTick> {
  const url = String(c.outputs.url ?? "");
  if (!url) return failed("No url in the outputs");
  const r = await c.x.http(url);
  if (r.status !== 200) return waiting(`${url} → ${r.error ?? `HTTP ${r.status}`}`);
  return passed(`${url} → 200 in ${r.ms} ms`);
}

const CHECKS: Record<GateKind, (c: GateCtx) => Promise<GateTick>> = {
  "http-ok": httpOk,
};

export async function runGate(
  def: GateDef,
  ctx: GateCtx,
  opts: { pollMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number; onTick?: (t: GateTick) => void } = {},
): Promise<GateResult> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 20_000;
  const deadline = now() + def.timeoutMin * 60_000;
  let last: GateTick = waiting("Not checked yet");
  let polls = 0;
  for (;;) {
    polls++;
    try {
      last = await CHECKS[def.kind](ctx);
    } catch (e) {
      // Transient read errors (throttling, a resource mid-update) are retried until the timeout.
      last = waiting((e as Error).message.slice(0, 300));
    }
    opts.onTick?.(last);
    if (last.done) return { ok: last.ok, timedOut: false, detail: last.detail, outputs: last.outputs ?? {}, polls };
    if (now() >= deadline) return { ok: false, timedOut: true, detail: `Timed out after ${def.timeoutMin} min — ${last.detail}`, outputs: {}, polls };
    await sleep(pollMs);
  }
}
