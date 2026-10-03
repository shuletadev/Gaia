import { spawn } from "node:child_process";

/**
 * Discovery through the Azure CLI the user is already signed in to: which accounts and subscriptions
 * it can see, and interactive sign-in. Nothing here stores credentials; the CLI keeps its own token cache.
 */

export interface AzSubscription {
  id: string;
  name: string;
  tenantId: string;
  state: string;
  isDefault: boolean;
  user?: string;
}

export interface AzStatus {
  installed: boolean;
  version?: string;
  signedIn: boolean;
  user?: string;
  defaultTenantId?: string;
  error?: string;
}

/** Login and subscription selection prompts must never wait on a console nobody sees. */
const AZ_ENV = { ...process.env, AZURE_CORE_LOGIN_EXPERIENCE_V2: "off", AZURE_CORE_ONLY_SHOW_ERRORS: "true", AZURE_CORE_NO_COLOR: "true" };

export interface AzResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type AzRunner = (args: string[], opts?: { timeoutMs?: number }) => Promise<AzResult>;

/** Arguments are fixed flags or validated tenant IDs/domains; anything else is refused rather than quoted. */
const SAFE_ARG = /^[\w.@:/=-]+$/;

/** Runs `az` (az.cmd on Windows) with fixed arguments; inputs are validated by callers before they get here. */
export const runAz: AzRunner = (args, opts = {}) =>
  new Promise((resolveP) => {
    if (!args.every((a) => SAFE_ARG.test(a))) return resolveP({ code: 1, stdout: "", stderr: "Refused an unexpected Azure CLI argument." });
    // az is a .cmd on Windows, which needs a shell; with only safe characters the joined command line is exact.
    const child =
      process.platform === "win32"
        ? spawn(["az.cmd", ...args].join(" "), { env: AZ_ENV, stdio: ["ignore", "pipe", "pipe"], shell: true, windowsHide: true })
        : spawn("az", args, { env: AZ_ENV, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 60_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolveP({ code: -1, stdout, stderr: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveP({ code: code ?? -1, stdout, stderr });
    });
  });

const firstLine = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";

export async function azStatus(az: AzRunner = runAz): Promise<AzStatus> {
  const v = await az(["version", "--output", "json"], { timeoutMs: 30_000 });
  if (v.code !== 0) return { installed: false, signedIn: false, error: "Azure CLI not found. Install it from https://aka.ms/installazurecli" };
  let version: string | undefined;
  try {
    version = (JSON.parse(v.stdout) as Record<string, string>)["azure-cli"];
  } catch {
    /* version is cosmetic */
  }
  const s = await az(["account", "show", "--output", "json"], { timeoutMs: 30_000 });
  if (s.code !== 0) return { installed: true, version, signedIn: false, error: firstLine(s.stderr) || "Not signed in" };
  const acct = JSON.parse(s.stdout) as { tenantId?: string; user?: { name?: string } };
  return { installed: true, version, signedIn: true, user: acct.user?.name, defaultTenantId: acct.tenantId };
}

export function parseAccountList(json: string): AzSubscription[] {
  const rows = JSON.parse(json) as { id: string; name: string; tenantId: string; state?: string; isDefault?: boolean; user?: { name?: string } }[];
  return rows
    .filter((r) => r.id && r.tenantId)
    .map((r) => ({ id: r.id, name: r.name, tenantId: r.tenantId, state: r.state ?? "Enabled", isDefault: Boolean(r.isDefault), user: r.user?.name }));
}

/** Every subscription the CLI knows about, across tenants (from its cache; refresh after a sign-in). */
export async function listSubscriptions(az: AzRunner = runAz): Promise<AzSubscription[]> {
  const r = await az(["account", "list", "--all", "--output", "json"], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(firstLine(r.stderr) || "az account list failed");
  return parseAccountList(r.stdout);
}

/** A tenant ID or a domain such as contoso.onmicrosoft.com — the only user input passed to `az login`. */
export const TENANT_INPUT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i;

/** Interactive browser sign-in (optionally to a specific tenant). Resolves when the CLI finishes. */
export async function azLogin(tenant: string | undefined, az: AzRunner = runAz): Promise<string> {
  if (tenant && !TENANT_INPUT.test(tenant)) throw new Error("Enter a tenant ID or domain");
  const r = await az(["login", ...(tenant ? ["--tenant", tenant] : []), "--output", "none"], { timeoutMs: 5 * 60_000 });
  if (r.code !== 0) throw new Error(firstLine(r.stderr) || "Sign-in did not complete");
  return tenant ? `Signed in to ${tenant}` : "Signed in";
}
