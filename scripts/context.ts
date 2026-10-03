import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigMissingError, DATA_DIR, loadConfig } from "../server/config.ts";
import { ArmClient } from "../server/azure/arm.ts";
import { openDb } from "../server/db.ts";
import { CostService } from "../server/costService.ts";
import { JobRunner } from "../server/jobs.ts";

/** Everything a headless script needs, wired the same way as the app. */
export function context() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    // First run: nothing to sweep or report until setup is done in the app.
    if (e instanceof ConfigMissingError) {
      console.error(e.message);
      process.exit(0);
    }
    throw e;
  }
  const arm = new ArmClient({ tenantId: config.tenantId });
  const db = openDb();
  return { config, arm, db, costs: new CostService(arm, db), jobs: new JobRunner(db) };
}

export function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

/** Appends a timestamped line to data/logs/<file> and echoes it. */
export function logLine(file: string, line: string) {
  const dir = resolve(DATA_DIR, "logs");
  mkdirSync(dir, { recursive: true });
  const text = `${new Date().toISOString()} ${line}`;
  appendFileSync(resolve(dir, file), `${text}\n`);
  console.log(text);
}

/** Retries transient failures (no network yet at logon, token refresh, throttling). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, delayMs = 20_000): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
}
