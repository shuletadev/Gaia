import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, resolve } from "node:path";
import { promisify } from "node:util";
import { PROJECT_ROOT } from "../config.ts";

const run = promisify(execFile);
export const BLUEPRINT_DIR = resolve(PROJECT_ROOT, "blueprints");

const cache = new Map<string, { stamp: number; json: Record<string, unknown> }>();

/** BICEP_PATH, else `bicep` on PATH, else the copy `az bicep install` keeps under ~/.azure/bin. */
export function bicepPath(): string {
  if (process.env.BICEP_PATH) return process.env.BICEP_PATH;
  const exe = process.platform === "win32" ? "bicep.exe" : "bicep";
  const onPath = (process.env.PATH ?? "").split(delimiter).some((d) => d && existsSync(resolve(d, exe)));
  const azCopy = resolve(homedir(), ".azure", "bin", exe);
  return !onPath && existsSync(azCopy) ? azCopy : "bicep";
}

function newestMtime(dir: string): number {
  return Math.max(...readdirSync(dir).map((f) => statSync(resolve(dir, f)).mtimeMs));
}

/** Compiles blueprints/<id>/main.bicep to an ARM template with the local Bicep CLI (cached until a file changes). */
export async function compileBlueprint(id: string): Promise<Record<string, unknown>> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid blueprint id");
  const dir = resolve(BLUEPRINT_DIR, id);
  const stamp = newestMtime(dir);
  const hit = cache.get(id);
  if (hit && hit.stamp === stamp) return hit.json;
  const bicep = bicepPath();
  try {
    const { stdout } = await run(bicep, ["build", resolve(dir, "main.bicep"), "--stdout"], { maxBuffer: 128 * 1024 * 1024, windowsHide: true });
    const json = JSON.parse(stdout) as Record<string, unknown>;
    cache.set(id, { stamp, json });
    return json;
  } catch (e) {
    const err = e as { stderr?: string; message: string; code?: string };
    if (err.code === "ENOENT") throw new Error("Bicep CLI not found. Run `az bicep install` (or winget install Microsoft.Bicep), or set BICEP_PATH.");
    throw new Error(`Bicep build failed: ${err.stderr?.trim() || err.message}`);
  }
}
