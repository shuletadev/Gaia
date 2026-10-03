import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { ArmClient } from "../azure/arm.ts";
import { BLUEPRINT_DIR } from "./compile.ts";
import type { ContentDef } from "./blueprints.ts";

/**
 * Content deployment: puts an app (a folder of static files) on a service the template created, after the
 * stack update and before the readiness gate. Today: Azure Static Web Apps, published with Microsoft's SWA CLI.
 */

/** The SWA CLI is fetched on demand (not an install-time dependency: it is ~290 MB with a native module). Pinned. */
export const SWA_CLI = "@azure/static-web-apps-cli@2.0.10";
const SWA_API = "2023-12-01";

export interface ContentCtx {
  arm: Pick<ArmClient, "post">;
  subscriptionId: string;
  labName: string;
  blueprintId: string;
  outputs: Record<string, unknown>;
}

export type CommandRunner = (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<{ stdout: string; stderr: string }>;

const run = promisify(execFile);

/** `npx` is a .cmd on Windows, which Node only spawns through a shell; every argument here is a fixed string or a path we built. */
export const realRunner: CommandRunner = async (cmd, args, { env, timeoutMs }) => {
  const win = process.platform === "win32";
  const { stdout, stderr } = await run(win ? "npx.cmd" : cmd, args, { env, timeout: timeoutMs, windowsHide: true, shell: win, maxBuffer: 16 * 1024 * 1024 });
  return { stdout, stderr };
};

export const contentDir = (blueprintId: string, def: ContentDef) => resolve(BLUEPRINT_DIR, blueprintId, def.dir);

/** The deployment token must never reach a log, an error message or the lab's stored state. */
export function scrub(text: string, secret: string): string {
  return secret ? text.split(secret).join("***") : text;
}

/** Deploys the blueprint's app folder to the Static Web App named in the stack outputs. Returns a one-line summary. */
export async function deployContent(def: ContentDef, ctx: ContentCtx, runner: CommandRunner = realRunner): Promise<string> {
  const siteName = String(ctx.outputs[def.siteOutput] ?? "");
  if (!siteName) throw new Error(`The deployment has no ${def.siteOutput} output to publish to`);
  const dir = contentDir(ctx.blueprintId, def);
  if (!existsSync(resolve(dir, "index.html"))) throw new Error(`App folder ${def.dir} has no index.html`);

  const secrets = await ctx.arm.post<{ properties?: { apiKey?: string } }>(
    `/subscriptions/${ctx.subscriptionId}/resourceGroups/${ctx.labName}/providers/Microsoft.Web/staticSites/${siteName}/listSecrets?api-version=${SWA_API}`,
    {},
  );
  const token = secrets?.properties?.apiKey;
  if (!token) throw new Error("Azure returned no deployment token for the Static Web App");

  try {
    // The token travels in the environment, not on the command line (command lines show up in process lists).
    await runner("npx", ["--yes", SWA_CLI, "deploy", dir, "--env", "production"], {
      env: { ...process.env, SWA_CLI_DEPLOYMENT_TOKEN: token, SWA_CLI_DEBUG: "" },
      timeoutMs: 10 * 60_000,
    });
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message: string };
    const detail = scrub(String(err.stderr || err.stdout || err.message).trim(), token).slice(-600);
    throw new Error(`${def.label}: ${detail || "the SWA CLI failed"}`);
  }
  return `${def.label} published to ${siteName}`;
}
