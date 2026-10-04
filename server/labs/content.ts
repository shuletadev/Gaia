import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { ArmClient } from "../azure/arm.ts";
import { BLUEPRINT_DIR } from "./compile.ts";
import type { ContentDef, SampleSource, SqlSeedContent } from "./blueprints.ts";
import { generateSamples } from "./samples.ts";

/**
 * Content deployment: puts files or data on a service the template created, after the stack update and
 * before the readiness gate. Kinds: a Static Web App (SWA CLI), a Storage static website and blob uploads
 * (Azure CLI), and a SQL seed script (the `tedious` driver).
 */

/** The SWA CLI is fetched on demand (not an install-time dependency: it is ~290 MB with a native module). Pinned. */
export const SWA_CLI = "@azure/static-web-apps-cli@2.0.10";
const SWA_API = "2023-12-01";
const STORAGE_API = "2023-05-01";
const SQL_API = "2023-08-01-preview";

export interface ContentCtx {
  arm: Pick<ArmClient, "post"> & Partial<Pick<ArmClient, "lro">>;
  subscriptionId: string;
  labName: string;
  blueprintId: string;
  outputs: Record<string, unknown>;
  /** The lab's parameters (sample generators read them). */
  params?: Record<string, unknown>;
  /** Values labctl generated for the lab (passwords). Never logged. */
  secrets?: Record<string, unknown>;
}

export type CommandRunner = (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<{ stdout: string; stderr: string }>;

export interface SqlTarget {
  server: string;
  database: string;
  user: string;
  password: string;
}
export type SqlRunner = (target: SqlTarget, batches: string[]) => Promise<void>;

export interface ContentDeps {
  runner?: CommandRunner;
  sql?: SqlRunner;
  sleep?: (ms: number) => Promise<void>;
}

const run = promisify(execFile);

/** `npx` and `az` are .cmd files on Windows, which Node only spawns through a shell; every argument is a fixed string or a path we built. */
export const realRunner: CommandRunner = async (cmd, args, { env, timeoutMs }) => {
  const win = process.platform === "win32";
  const { stdout, stderr } = await run(win ? `${cmd}.cmd` : cmd, args, { env, timeout: timeoutMs, windowsHide: true, shell: win, maxBuffer: 16 * 1024 * 1024 });
  return { stdout, stderr };
};

export const contentDir = (blueprintId: string, def: { dir: string }) => resolve(BLUEPRINT_DIR, blueprintId, def.dir);

/** A secret must never reach a log, an error message or the lab's stored state. */
export function scrub(text: string, ...secrets: string[]): string {
  return secrets.filter(Boolean).reduce((t, s) => t.split(s).join("***"), text);
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The files to upload: a folder from the blueprint, or generated synthetic data written to a temp folder. */
export function materialize(source: SampleSource, ctx: Pick<ContentCtx, "blueprintId" | "params">): { dir: string; cleanup: () => void } {
  if ("dir" in source) {
    const dir = resolve(BLUEPRINT_DIR, ctx.blueprintId, source.dir);
    if (!existsSync(dir)) throw new Error(`Sample folder ${source.dir} does not exist`);
    return { dir, cleanup: () => undefined };
  }
  const dir = mkdtempSync(resolve(tmpdir(), "labctl-samples-"));
  for (const f of generateSamples(source.generator, ctx.params ?? {})) {
    const p = resolve(dir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.data);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function storageKey(ctx: ContentCtx, account: string): Promise<string> {
  const r = await ctx.arm.post<{ keys?: { value?: string }[] }>(
    `/subscriptions/${ctx.subscriptionId}/resourceGroups/${ctx.labName}/providers/Microsoft.Storage/storageAccounts/${account}/listKeys?api-version=${STORAGE_API}`,
    {},
  );
  const key = r?.keys?.[0]?.value;
  if (!key) throw new Error(`Azure returned no key for storage account ${account}`);
  return key;
}

const out = (e: unknown) => {
  const x = e as { stderr?: string; stdout?: string; message: string };
  return String(x.stderr || x.stdout || x.message).trim();
};

/** A fresh storage account can refuse its first calls for a moment (key and DNS propagation), so retry a few times. */
async function withRetry<T>(fn: () => Promise<T>, sleep: (ms: number) => Promise<void>, attempts = 4, waitMs = 10_000): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      await sleep(waitMs);
    }
  }
}

async function deployStaticWebApp(def: Extract<ContentDef, { kind: "static-web-app" }>, ctx: ContentCtx, runner: CommandRunner): Promise<string> {
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
    throw new Error(`${def.label}: ${scrub(out(e), token).slice(-600) || "the SWA CLI failed"}`);
  }
  return `${def.label} published to ${siteName}`;
}

/** Runs `az storage ...` against one account, with the account key in the environment (never on the command line). */
async function azStorage(account: string, key: string, args: string[], runner: CommandRunner, sleep: (ms: number) => Promise<void>): Promise<void> {
  try {
    await withRetry(
      () => runner("az", ["storage", ...args], { env: { ...process.env, AZURE_STORAGE_ACCOUNT: account, AZURE_STORAGE_KEY: key, AZURE_CORE_ONLY_SHOW_ERRORS: "1" }, timeoutMs: 5 * 60_000 }),
      sleep,
    );
  } catch (e) {
    throw new Error(scrub(out(e), key).slice(-600) || "the Azure CLI failed");
  }
}

async function deployStorageSite(def: Extract<ContentDef, { kind: "storage-static-site" }>, ctx: ContentCtx, runner: CommandRunner, sleep: (ms: number) => Promise<void>): Promise<string> {
  const account = String(ctx.outputs[def.accountOutput] ?? "");
  if (!account) throw new Error(`The deployment has no ${def.accountOutput} output`);
  const files = materialize(def.source, ctx);
  try {
    if (!existsSync(resolve(files.dir, "index.html"))) throw new Error("The site files have no index.html");
    const key = await storageKey(ctx, account);
    // Static website hosting is a data-plane setting, not part of the ARM template.
    await azStorage(account, key, ["blob", "service-properties", "update", "--static-website", "--index-document", "index.html", "--404-document", "404.html"], runner, sleep).catch((e: Error) => {
      throw new Error(`${def.label}: enabling the static website failed: ${e.message}`);
    });
    await azStorage(account, key, ["blob", "upload-batch", "-s", files.dir, "-d", "$web", "--overwrite"], runner, sleep).catch((e: Error) => {
      throw new Error(`${def.label}: upload failed: ${e.message}`);
    });
  } finally {
    files.cleanup();
  }
  return `${def.label} published to ${account}`;
}

async function deployBlobUpload(def: Extract<ContentDef, { kind: "blob-upload" }>, ctx: ContentCtx, runner: CommandRunner, sleep: (ms: number) => Promise<void>): Promise<string> {
  const account = String(ctx.outputs[def.accountOutput] ?? "");
  if (!account) throw new Error(`The deployment has no ${def.accountOutput} output`);
  const files = materialize(def.source, ctx);
  try {
    await azStorage(account, await storageKey(ctx, account), ["blob", "upload-batch", "-s", files.dir, "-d", def.container, "--overwrite"], runner, sleep).catch((e: Error) => {
      throw new Error(`${def.label}: ${e.message}`);
    });
  } finally {
    files.cleanup();
  }
  return `${def.label} uploaded to ${account}/${def.container}`;
}

/** Splits a T-SQL script into batches on lines that are only GO. */
export function sqlBatches(script: string): string[] {
  return script
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter(Boolean);
}

/** A connection refused for the caller's IP names it in the error; labctl opens that address and retries. */
export const CLIENT_IP = /Client with IP address '([\d.]+)' is not allowed/i;

/** The real driver, loaded only when a lab seeds a database. */
export const tediousRunner: SqlRunner = async (t, batches) => {
  const { Connection, Request } = await import("tedious");
  await new Promise<void>((resolveRun, reject) => {
    const conn = new Connection({
      server: `${t.server}.database.windows.net`,
      authentication: { type: "default", options: { userName: t.user, password: t.password } },
      options: { database: t.database, encrypt: true, port: 1433, connectTimeout: 30_000, requestTimeout: 120_000, rowCollectionOnRequestCompletion: false },
    });
    conn.on("error", reject);
    conn.connect((err) => {
      if (err) return reject(err);
      const next = (i: number) => {
        if (i >= batches.length) {
          conn.close();
          return resolveRun();
        }
        const req = new Request(batches[i]!, (e) => (e ? (conn.close(), reject(e)) : next(i + 1)));
        conn.execSqlBatch(req);
      };
      next(0);
    });
  });
};

async function seedSql(def: SqlSeedContent, ctx: ContentCtx, sql: SqlRunner, sleep: (ms: number) => Promise<void>): Promise<string> {
  const server = String(ctx.outputs[def.serverOutput] ?? "");
  if (!server) throw new Error(`The deployment has no ${def.serverOutput} output`);
  const password = String(ctx.secrets?.[def.passwordParam] ?? "");
  if (!password) throw new Error("The database admin password was not generated");
  const path = resolve(BLUEPRINT_DIR, ctx.blueprintId, def.script);
  if (!existsSync(path)) throw new Error(`Script ${def.script} does not exist`);
  const batches = sqlBatches(readFileSync(path, "utf8"));
  const target: SqlTarget = { server, database: def.database, user: def.adminUser, password };

  let opened = false;
  for (let attempt = 1; ; attempt++) {
    try {
      await sql(target, batches);
      return `${def.label} ran ${batches.length} batches on ${def.database}`;
    } catch (e) {
      const message = scrub((e as Error).message, password);
      const ip = CLIENT_IP.exec(message)?.[1];
      // First refusal: open this machine's address on the server (the rule lives in the lab's group and goes with it).
      if (ip && !opened && ctx.arm.lro) {
        await ctx.arm.lro(
          "PUT",
          `/subscriptions/${ctx.subscriptionId}/resourceGroups/${ctx.labName}/providers/Microsoft.Sql/servers/${server}/firewallRules/labctl-deployer?api-version=${SQL_API}`,
          { properties: { startIpAddress: ip, endIpAddress: ip } },
          { timeoutMs: 5 * 60_000, pollMs: 3000 },
        );
        opened = true;
      }
      // New firewall rules and a new database take a few minutes to be usable; wait rather than fail.
      if (attempt >= 20) throw new Error(`${def.label}: ${message.slice(-400)}`);
      await sleep(15_000);
    }
  }
}

/** Deploys one content item to the lab's resources. Returns a one-line summary. */
export async function deployContent(def: ContentDef, ctx: ContentCtx, runner: CommandRunner = realRunner, deps: Omit<ContentDeps, "runner"> = {}): Promise<string> {
  const sleep = deps.sleep ?? realSleep;
  switch (def.kind) {
    case "static-web-app":
      return deployStaticWebApp(def, ctx, runner);
    case "storage-static-site":
      return deployStorageSite(def, ctx, runner, sleep);
    case "blob-upload":
      return deployBlobUpload(def, ctx, runner, sleep);
    case "sql-seed":
      return seedSql(def, ctx, deps.sql ?? tediousRunner, sleep);
  }
}
