import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigMissingError, loadConfig } from "../server/config.ts";
import { openDb, recentActions } from "../server/db.ts";
import { JobRunner } from "../server/jobs.ts";
import { prepareLab, prepareRetry } from "../server/labs/engine.ts";
import { azLogin, azStatus, parseAccountList, TENANT_INPUT, type AzRunner } from "../server/setup/azcli.ts";
import { applyInPlace, blankConfig, diffSettings, isConfigured, parseSettings, SettingsError, suggestProtectedGroups } from "../server/settings.ts";
import { registerSetupRoutes, SetupConflict } from "../server/setupRoutes.ts";
import type { ArmClient } from "../server/azure/arm.ts";
import { config, SUB, OTHER_SUB } from "./helpers.ts";

const TENANT = config.tenantId;
const OTHER_TENANT = "44444444-4444-4444-4444-444444444444";
const now = new Date("2026-10-03T18:00:00Z");

describe("config file", () => {
  it("reports a missing config as first run", () => {
    expect(() => loadConfig(join(tmpdir(), "nope", "labctl.config.json"))).toThrow(ConfigMissingError);
  });

  it("blank config is unconfigured; a filled one is configured", () => {
    expect(isConfigured(blankConfig())).toBe(false);
    expect(isConfigured(config)).toBe(true);
  });
});

describe("settings", () => {
  it("validates regions and duplicates, and keeps the running port", () => {
    const base = structuredClone(config);
    expect(parseSettings({ ...base, server: { port: 9999 } }, base).server.port).toBe(4870);
    expect(() => parseSettings({ ...base, labs: { ...base.labs, regions: [] } }, base)).toThrow(SettingsError);
    expect(() => parseSettings({ ...base, labs: { ...base.labs, defaultRegion: "westus3" } }, base)).toThrow(/not enabled/);
    expect(() => parseSettings({ ...base, subscriptions: [base.subscriptions[0], base.subscriptions[0]] }, base)).toThrow(/twice/);
    expect(() => parseSettings({ ...base, tenantId: "not-a-guid" }, base)).toThrow(z.ZodError);
  });

  it("flags changes that widen Gaia's reach or remove a safety net", () => {
    const before = structuredClone(config);
    const after = structuredClone(config);
    after.subscriptions.push({ id: OTHER_SUB, name: "Second" });
    after.excludedResourceGroups = ["NetworkWatcherRG"];
    after.budget.monthlyUsd = 400;
    after.labs.sweepEnabled = false;
    const d = diffSettings(before, after);
    expect(d.sensitive).toEqual(['Gaia may change resources in subscription "Second"', 'Resource group "GovernanceRG" is no longer protected', "Auto-clean of expired labs turned off"]);
    expect(d.summary).toContain("Budget $600 → $400");
  });

  it("first-run choices are never 'sensitive' (nothing was allowed before)", () => {
    expect(diffSettings(blankConfig(), config).sensitive).toEqual([]);
  });

  it("applies in place so existing references see the change", () => {
    const live = structuredClone(config);
    const ref = live;
    const next = structuredClone(config);
    next.budget.monthlyUsd = 123;
    next.server.port = 1;
    applyInPlace(live, next);
    expect(ref.budget.monthlyUsd).toBe(123);
    expect(ref.server.port).toBe(4870);
  });

  it("suggests governance, Azure-managed and service-managed groups", () => {
    const names = suggestProtectedGroups([{ name: "GovernanceRG" }, { name: "NetworkWatcherRG" }, { name: "MC_rg_aks_eastus" }, { name: "cloud-shell-storage-westus" }, { name: "my-lab" }]).map((g) => g.name);
    expect([...names].sort()).toEqual(["GovernanceRG", "MC_rg_aks_eastus", "NetworkWatcherRG", "cloud-shell-storage-westus"]);
  });
});

describe("Azure CLI discovery", () => {
  const fakeAz = (map: Record<string, { code?: number; stdout?: string; stderr?: string }>): AzRunner & { calls: string[][] } => {
    const calls: string[][] = [];
    const fn = (async (args: string[]) => {
      calls.push(args);
      const hit = map[args.slice(0, 2).join(" ")] ?? { code: 1, stderr: "unknown" };
      return { code: hit.code ?? 0, stdout: hit.stdout ?? "", stderr: hit.stderr ?? "" };
    }) as AzRunner & { calls: string[][] };
    fn.calls = calls;
    return fn;
  };

  it("reports a missing CLI, a signed-out CLI and a signed-in user", async () => {
    expect(await azStatus(fakeAz({ "version --output": { code: 1 } }))).toMatchObject({ installed: false, signedIn: false });
    expect(await azStatus(fakeAz({ "version --output": { stdout: '{"azure-cli":"2.87.0"}' }, "account show": { code: 1, stderr: "Please run 'az login' to setup account." } }))).toMatchObject({
      installed: true,
      version: "2.87.0",
      signedIn: false,
      error: "Please run 'az login' to setup account.",
    });
    expect(await azStatus(fakeAz({ "version --output": { stdout: "{}" }, "account show": { stdout: JSON.stringify({ tenantId: TENANT, user: { name: "me@example.com" } }) } }))).toMatchObject({ signedIn: true, user: "me@example.com", defaultTenantId: TENANT });
  });

  it("parses az account list across tenants", () => {
    const subs = parseAccountList(JSON.stringify([{ id: SUB, name: "Lab", tenantId: TENANT, state: "Enabled", isDefault: true, user: { name: "me@example.com" } }, { id: "", name: "broken", tenantId: TENANT }]));
    expect(subs).toEqual([{ id: SUB, name: "Lab", tenantId: TENANT, state: "Enabled", isDefault: true, user: "me@example.com" }]);
  });

  it("only passes a tenant ID or domain to az login", async () => {
    expect(TENANT_INPUT.test("contoso.onmicrosoft.com")).toBe(true);
    expect(TENANT_INPUT.test(TENANT)).toBe(true);
    expect(TENANT_INPUT.test("x; rm -rf /")).toBe(false);
    const az = fakeAz({ "login --tenant": {}, "login --output": {} });
    await expect(azLogin("bad tenant", az)).rejects.toThrow(/tenant ID or domain/);
    expect(await azLogin("contoso.onmicrosoft.com", az)).toBe("Signed in to contoso.onmicrosoft.com");
    expect(az.calls).toEqual([["login", "--tenant", "contoso.onmicrosoft.com", "--output", "none"]]);
  });
});

describe("labs per subscription", () => {
  const twoSubs = { ...structuredClone(config), subscriptions: [config.subscriptions[0]!, { id: OTHER_SUB, name: "Second" }] };
  const req = { blueprint: "apim-v2-quickstart", region: "centralus", params: {}, ttlHours: 8 };

  it("deploys into the requested allow-listed subscription, defaulting to the first", () => {
    expect(prepareLab(twoSubs, req, now).subscriptionId).toBe(SUB);
    expect(prepareLab(twoSubs, { ...req, subscriptionId: OTHER_SUB }, now).subscriptionId).toBe(OTHER_SUB);
    expect(() => prepareLab(config, { ...req, subscriptionId: OTHER_SUB }, now)).toThrow(/not enabled/);
    expect(() => prepareLab(blankConfig(), { ...req, region: "centralus" }, now)).toThrow(/finish setup/);
  });

  it("retries in the lab's own subscription", () => {
    const row = { name: "lab-apimqs-ab12", blueprint: "apim-v2-quickstart", region: "centralus", params_json: "{}", purpose: null, subscription_id: OTHER_SUB };
    expect(prepareRetry(twoSubs, row, {}).subscriptionId).toBe(OTHER_SUB);
  });
});

describe("setup and settings API", () => {
  const dir = mkdtempSync(join(tmpdir(), "gaia-setup-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const accountList = JSON.stringify([
    { id: SUB, name: "Lab Sandbox", tenantId: TENANT, state: "Enabled", isDefault: true, user: { name: "me@example.com" } },
    { id: OTHER_SUB, name: "Second", tenantId: TENANT, state: "Enabled", isDefault: false, user: { name: "me@example.com" } },
    { id: "55555555-5555-5555-5555-555555555555", name: "Elsewhere", tenantId: OTHER_TENANT, state: "Enabled" },
  ]);
  const az: AzRunner = async (args) => {
    const k = args.slice(0, 2).join(" ");
    if (k === "account list") return { code: 0, stdout: accountList, stderr: "" };
    if (k === "version --output") return { code: 0, stdout: '{"azure-cli":"2.87.0"}', stderr: "" };
    if (k === "account show") return { code: 0, stdout: JSON.stringify({ tenantId: TENANT, user: { name: "me@example.com" } }), stderr: "" };
    return { code: 1, stdout: "", stderr: "nope" };
  };

  async function build() {
    const live = blankConfig();
    const runtime = { configured: false };
    const tenants: (string | undefined)[] = [];
    const db = openDb(":memory:");
    const calls = { configured: 0, changed: 0 };
    const app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof SetupConflict) return reply.code(409).send(err.body);
      if (err instanceof SettingsError) return reply.code(400).send({ error: err.message });
      if (err instanceof z.ZodError) return reply.code(400).send({ error: "invalid" });
      return reply.code(500).send({ error: (err as Error).message });
    });
    const fakeArm = { setTenant: (t: string | undefined) => tenants.push(t) } as unknown as ArmClient;
    const armFor = () =>
      ({
        get: async () => ({ value: [{ tenantId: TENANT, displayName: "Lab Tenant", defaultDomain: "lab.example.com" }] }),
        post: async () => ({ data: [{ id: "/subscriptions/x/resourceGroups/GovernanceRG", name: "GovernanceRG", subscriptionId: SUB }, { name: "my-lab", subscriptionId: SUB }] }),
      }) as unknown as ArmClient;
    registerSetupRoutes(app, {
      config: live,
      runtime,
      configPath: join(dir, `cfg-${Math.random().toString(36).slice(2)}.json`),
      arm: fakeArm,
      db,
      jobs: new JobRunner(db),
      onConfigured: () => calls.configured++,
      onChanged: () => calls.changed++,
      az,
      armFor,
    });
    return { app, live, runtime, tenants, db, calls };
  }

  const settingsFor = (subs: { id: string; name: string }[], tenantId = TENANT) => ({ ...blankConfig(), tenantId, subscriptions: subs, owner: "me@example.com", excludedResourceGroups: ["GovernanceRG"] });

  it("lists subscriptions grouped by tenant and suggests protected groups", async () => {
    const { app } = await build();
    const s = (await app.inject({ method: "GET", url: "/api/setup/subscriptions" })).json();
    expect(s.subscriptions).toHaveLength(3);
    expect(s.tenants.find((t: { tenantId: string }) => t.tenantId === TENANT)).toMatchObject({ name: "Lab Tenant", count: 2 });
    const g = (await app.inject({ method: "GET", url: `/api/setup/suggestions?tenantId=${TENANT}&subscriptionId=${SUB}` })).json();
    expect(g.suggested).toEqual([{ name: "GovernanceRG", reason: "governance / security" }]);
    expect(g.groups.map((x: { name: string }) => x.name)).toEqual(["GovernanceRG", "my-lab"]);
  });

  it("completes setup: verifies subscriptions, writes the file, applies in place, switches tenant", async () => {
    const { app, live, runtime, tenants, calls, db } = await build();
    const wrongTenant = await app.inject({ method: "POST", url: "/api/setup", payload: settingsFor([{ id: "55555555-5555-5555-5555-555555555555", name: "x" }]) });
    expect(wrongTenant.statusCode).toBe(400);
    expect(wrongTenant.json().error).toMatch(/another tenant/);
    const unknown = await app.inject({ method: "POST", url: "/api/setup", payload: settingsFor([{ id: "66666666-6666-6666-6666-666666666666", name: "x" }]) });
    expect(unknown.json().error).toMatch(/can't see subscription/);

    const ok = await app.inject({ method: "POST", url: "/api/setup", payload: settingsFor([{ id: SUB, name: "renamed in browser" }]) });
    expect(ok.statusCode).toBe(200);
    expect(runtime.configured).toBe(true);
    expect(live.subscriptions).toEqual([{ id: SUB, name: "Lab Sandbox" }]);
    expect(tenants).toEqual([TENANT]);
    expect(calls.configured).toBe(1);
    expect(recentActions(db, 5)[0]).toMatchObject({ action: "setup.complete" });
    const again = await app.inject({ method: "POST", url: "/api/setup", payload: settingsFor([{ id: SUB, name: "x" }]) });
    expect(again.statusCode).toBe(409);
  });

  it("settings: plain changes save directly; sensitive ones need confirmation", async () => {
    const { app, live, calls } = await build();
    await app.inject({ method: "POST", url: "/api/setup", payload: settingsFor([{ id: SUB, name: "Lab Sandbox" }]) });
    const cur = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    const path = cur.configPath as string;

    const cheaper = { ...cur.settings, budget: { ...cur.settings.budget, monthlyUsd: 150 } };
    const r1 = await app.inject({ method: "PUT", url: "/api/settings", payload: { settings: cheaper } });
    expect(r1.json().summary).toEqual(["Budget $300 → $150"]);
    expect(live.budget.monthlyUsd).toBe(150);
    expect(JSON.parse(readFileSync(path, "utf8")).budget.monthlyUsd).toBe(150);

    const wider = { ...cheaper, subscriptions: [...cheaper.subscriptions, { id: OTHER_SUB, name: "Second" }], excludedResourceGroups: [] };
    const r2 = await app.inject({ method: "PUT", url: "/api/settings", payload: { settings: wider } });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().needsConfirmation).toEqual(['Gaia may change resources in subscription "Second"', 'Resource group "GovernanceRG" is no longer protected']);
    expect(live.subscriptions).toHaveLength(1);

    const r3 = await app.inject({ method: "PUT", url: "/api/settings", payload: { settings: wider, confirm: true } });
    expect(r3.statusCode).toBe(200);
    expect(live.subscriptions.map((s) => s.id)).toEqual([SUB, OTHER_SUB]);
    expect(calls.changed).toBe(2);
  });

  it("never writes this process's env overrides (port, sweep) into the saved file", async () => {
    const { app, live } = await build();
    live.server.port = 4999;
    live.labs.sweepEnabled = false;
    await app.inject({ method: "POST", url: "/api/setup", payload: settingsFor([{ id: SUB, name: "x" }]) });
    const cur = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(cur.settings.server.port).toBe(4870);
    expect(cur.settings.labs.sweepEnabled).toBe(true);
    await app.inject({ method: "PUT", url: "/api/settings", payload: { settings: { ...cur.settings, owner: "other@example.com" } } });
    const file = JSON.parse(readFileSync(cur.configPath, "utf8"));
    expect(file.server.port).toBe(4870);
    expect(file.owner).toBe("other@example.com");
    expect(live.server.port).toBe(4999);
  });

  it("refuses settings before setup and bad login input", async () => {
    const { app } = await build();
    expect((await app.inject({ method: "GET", url: "/api/settings" })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/setup/login", payload: { tenant: "a b" } })).statusCode).toBe(400);
  });
});
