import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ArmClient } from "./azure/arm.ts";
import { listResourceGroups } from "./azure/resourceGraph.ts";
import { ConfigMissingError, readConfigFile, type LabctlConfig } from "./config.ts";
import { logAction, type Db } from "./db.ts";
import { downloadIcons, iconsInstalled, ICONS_TERMS } from "./icons.ts";
import type { JobRunner } from "./jobs.ts";
import { azLogin, azStatus, listSubscriptions, TENANT_INPUT, type AzRunner, type AzSubscription } from "./setup/azcli.ts";
import { applyInPlace, AZURE_REGIONS, blankConfig, diffSettings, parseSettings, saveConfig, SettingsError, suggestProtectedGroups } from "./settings.ts";

export interface SetupDeps {
  /** The live config shared with every route; replaced in place when settings are saved. */
  config: LabctlConfig;
  runtime: { configured: boolean };
  configPath: string;
  arm: ArmClient;
  db: Db;
  jobs: JobRunner;
  /** Called once when first-run setup completes (start the sweeper, reconcile labs…). */
  onConfigured: () => void;
  /** Called after any later settings change (restart the sweeper with the new schedule). */
  onChanged: () => void;
  /** Injected for tests. */
  az?: AzRunner;
  armFor?: (tenantId?: string) => Pick<ArmClient, "get" | "post">;
}

/** Thrown for requests that need the user to act (sign in, confirm) — mapped to 409 with a reason. */
export class SetupConflict extends Error {
  constructor(
    message: string,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

const guid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export function registerSetupRoutes(app: FastifyInstance, d: SetupDeps) {
  const az = d.az;
  const armFor = d.armFor ?? ((tenantId?: string) => new ArmClient({ tenantId }));
  // Settings edit the saved file; the live config may carry env overrides (port, sweep) that must not be written back.
  let stored: LabctlConfig;
  try {
    stored = readConfigFile(d.configPath);
  } catch (e) {
    if (!(e instanceof ConfigMissingError)) throw e;
    stored = blankConfig();
  }

  /** The subscriptions must be ones the signed-in CLI account can see, all in the chosen tenant. */
  async function verifySubscriptions(next: LabctlConfig): Promise<AzSubscription[]> {
    const known = await listSubscriptions(az);
    const byId = new Map(known.map((s) => [s.id.toLowerCase(), s]));
    for (const s of next.subscriptions) {
      const k = byId.get(s.id.toLowerCase());
      if (!k) throw new SettingsError(`Your Azure CLI sign-in can't see subscription ${s.name} (${s.id}). Sign in to its tenant first.`);
      if (k.tenantId.toLowerCase() !== next.tenantId.toLowerCase()) throw new SettingsError(`Subscription ${k.name} belongs to another tenant; pick subscriptions from one tenant`);
      // Names come from Azure, not the browser.
      s.name = k.name;
    }
    return known;
  }

  app.get("/api/setup/state", async () => ({
    configured: d.runtime.configured,
    configPath: d.configPath,
    az: await azStatus(az),
    icons: { installed: iconsInstalled(), terms: ICONS_TERMS },
    regions: AZURE_REGIONS,
    defaults: blankConfig(),
  }));

  app.post("/api/setup/login", async (req) => {
    const { tenant } = z.object({ tenant: z.string().trim().regex(TENANT_INPUT).optional() }).parse(req.body ?? {});
    return d.jobs.start("setup.login", "setup:az-login", tenant ? `az login · ${tenant}` : "az login", () => azLogin(tenant, az));
  });

  // Tenant display names are a nicety; everything works without them.
  const names = new Map<string, { name?: string; domain?: string }>();
  async function loadTenantNames(timeoutMs: number) {
    try {
      const r = await Promise.race([
        armFor().get<{ value: { tenantId: string; displayName?: string; defaultDomain?: string }[] }>("/tenants?api-version=2022-12-01"),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
      ]);
      for (const t of r.value) names.set(t.tenantId.toLowerCase(), { name: t.displayName, domain: t.defaultDomain });
    } catch {
      /* keep what we have */
    }
  }

  app.get("/api/setup/subscriptions", async () => {
    const subscriptions = await listSubscriptions(az);
    await loadTenantNames(15_000);
    const tenants = [...new Set(subscriptions.map((s) => s.tenantId.toLowerCase()))].map((id) => ({
      tenantId: id,
      name: names.get(id)?.name,
      domain: names.get(id)?.domain,
      count: subscriptions.filter((s) => s.tenantId.toLowerCase() === id).length,
    }));
    tenants.sort((a, b) => Number(b.tenantId === d.config.tenantId?.toLowerCase()) - Number(a.tenantId === d.config.tenantId?.toLowerCase()) || a.count - b.count);
    return { subscriptions, tenants };
  });

  app.get("/api/setup/suggestions", async (req) => {
    const q = z.object({ tenantId: guid, subscriptionId: z.array(guid).or(guid) }).parse(req.query);
    const subs = Array.isArray(q.subscriptionId) ? q.subscriptionId : [q.subscriptionId];
    try {
      const groups = await listResourceGroups(armFor(q.tenantId) as ArmClient, subs);
      return { groups: groups.map((g) => ({ name: g.name, subscriptionId: g.subscriptionId })).sort((a, b) => a.name.localeCompare(b.name)), suggested: suggestProtectedGroups(groups) };
    } catch (e) {
      throw new SetupConflict("Can't read that subscription yet", { error: `Can't read resource groups: ${(e as Error).message.slice(0, 200)}. Sign in to this tenant, then try again.`, signInTenant: q.tenantId });
    }
  });

  app.post("/api/setup/icons", async (req) => {
    z.object({ acceptTerms: z.literal(true) }).parse(req.body);
    return d.jobs.start("icons.download", "setup:icons", "Azure icons", async () => {
      const r = await downloadIcons();
      return `${r.extracted}/${r.wanted} icons installed`;
    });
  });

  app.post("/api/setup", async (req) => {
    if (d.runtime.configured) throw new SetupConflict("Already set up", { error: "Gaia is already set up; change things in Settings." });
    const next = parseSettings(req.body, stored);
    await verifySubscriptions(next);
    saveConfig(d.configPath, next);
    stored = next;
    applyInPlace(d.config, next);
    d.arm.setTenant(next.tenantId);
    d.runtime.configured = true;
    logAction(d.db, { action: "setup.complete", target: next.tenantId, outcome: "ok", detail: `${next.subscriptions.map((s) => s.name).join(", ")}; ${next.excludedResourceGroups.length} protected groups` });
    d.onConfigured();
    return { ok: true };
  });

  app.get("/api/settings", async () => {
    if (!d.runtime.configured) throw new SetupConflict("Not set up", { error: "Finish setup first", setupRequired: true });
    const tenant = stored.tenantId.toLowerCase();
    if (!names.has(tenant)) await loadTenantNames(8_000);
    return { settings: stored, configPath: d.configPath, regions: AZURE_REGIONS, tenantName: names.get(tenant)?.name ?? names.get(tenant)?.domain };
  });

  app.put("/api/settings", async (req) => {
    if (!d.runtime.configured) throw new SetupConflict("Not set up", { error: "Finish setup first", setupRequired: true });
    const body = z.object({ settings: z.unknown(), confirm: z.boolean().optional() }).parse(req.body);
    const next = parseSettings(body.settings, stored);
    await verifySubscriptions(next);
    const change = diffSettings(stored, next);
    if (!change.summary.length) return { ok: true, summary: [] };
    // Widening Gaia's reach or removing a safety net needs an explicit second click.
    if (change.sensitive.length && !body.confirm) throw new SetupConflict("Confirmation needed", { error: "Confirm these changes", needsConfirmation: change.sensitive, summary: change.summary });
    saveConfig(d.configPath, next);
    stored = next;
    const tenantChanged = next.tenantId.toLowerCase() !== d.config.tenantId.toLowerCase();
    applyInPlace(d.config, next);
    if (tenantChanged) d.arm.setTenant(next.tenantId);
    logAction(d.db, { action: "settings.update", target: "settings", outcome: "ok", detail: change.summary.join("; ").slice(0, 1000) });
    d.onChanged();
    return { ok: true, summary: change.summary };
  });
}
