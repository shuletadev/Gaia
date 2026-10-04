/**
 * Headless expiry sweep: destroys expired labctl labs and waits for the deletes to finish.
 * Run by hand:  npm run sweep [-- --dry-run]
 */
import { listResourceGroups } from "../server/azure/resourceGraph.ts";
import { canAutoDelete } from "../server/guard.ts";
import { Sweeper } from "../server/labs/sweeper.ts";
import { arg, context, logLine, withRetry } from "./context.ts";

const LOG = "sweep.log";
const trigger = arg("trigger") ?? "cli";
const { config, arm, db, jobs } = context();

try {
  if (arg("dry-run")) {
    const groups = await withRetry(() => listResourceGroups(arm, config.subscriptions.map((s) => s.id)));
    const expired = groups.filter((g) => canAutoDelete(config, { id: g.id, name: g.name, tags: g.tags }).allowed).map((g) => g.name);
    logLine(LOG, `[${trigger}] dry run: ${expired.length ? `would destroy ${expired.join(", ")}` : "nothing expired"}`);
  } else {
    const sweeper = new Sweeper(arm, db, config, jobs);
    const result = await withRetry(() => sweeper.run(trigger));
    logLine(LOG, `[${trigger}] checked ${result.checked} groups; expired: ${result.expired.join(", ") || "none"}${result.skipped.length ? `; skipped: ${result.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}` : ""}`);
    if (result.started.length) {
      await jobs.drain();
      for (const j of jobs.recent(50).filter((x) => x.kind === "lab.expire" && result.started.includes(x.target_name) && x.pid === process.pid)) {
        logLine(LOG, `[${trigger}] ${j.target_name}: ${j.status}${j.error ? ` — ${j.error}` : ""}`);
      }
    }
  }
} catch (e) {
  logLine(LOG, `[${trigger}] FAILED: ${(e as Error).message}`);
  process.exitCode = 1;
}

