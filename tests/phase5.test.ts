import { describe, expect, it, vi } from "vitest";

vi.mock("../server/labs/compile.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/labs/compile.ts")>()),
  compileBlueprint: async () => ({ $schema: "test" }),
}));

import { BLUEPRINTS, deployMinutesFor, getBlueprint, stagesFor } from "../server/labs/blueprints.ts";
import { deployLab, labResourceTypes, prepareLab, readStageState, resumeIndex, type StageState } from "../server/labs/engine.ts";
import { evaluateFeasibility, isPermitted, namespacesOf, normRegion, type AzureFacts, type FeasibilityInput } from "../server/labs/feasibility.ts";
import { runGate, type GateCtx } from "../server/labs/gates.ts";
import { getLab, openDb } from "../server/db.ts";
import { ArmError, type ArmClient } from "../server/azure/arm.ts";
import type { Probes } from "../server/validate.ts";
import { config, FIXTURE_ID, registerFixtureBlueprint, SUB } from "./helpers.ts";

registerFixtureBlueprint();

const now = new Date("2026-10-01T18:00:00Z");

// ---- Blueprints --------------------------------------------------------------------------------

describe("blueprint contract", () => {
  it("every blueprint has defaults, meters and stages", () => {
    for (const b of BLUEPRINTS) {
      const d = b.schema.parse({});
      expect(b.meters(d).length).toBeGreaterThan(0);
      expect(stagesFor(b, d).length).toBeGreaterThan(0);
      for (const f of b.fields) expect(d).toHaveProperty(f.key, f.default);
    }
  });

  it("stage values increase and gates have positive timeouts", () => {
    for (const b of BLUEPRINTS) {
      const s = stagesFor(b, b.schema.parse({}));
      const values = s.map((x) => x.value).filter((v): v is number => v !== undefined);
      expect([...values].sort((a, c) => a - c)).toEqual(values);
      for (const st of s) if (st.gate) expect(st.gate.timeoutMin).toBeGreaterThan(0);
    }
  });

  it("rules block invalid combinations; presets pass them", () => {
    const b = getBlueprint(FIXTURE_ID);
    expect(b.rules!(b.schema.parse({ sku: "Basic", count: 3 }))[0]).toMatch(/at most 2/);
    expect(b.rules!(b.schema.parse({ sku: "Standard", count: 3 }))).toEqual([]);
    for (const p of b.presets!) expect(b.rules!(b.schema.parse(p.params))).toEqual([]);
    expect(deployMinutesFor(b, b.schema.parse({}))).toEqual([3, 10]);
  });

  it("prepareLab rejects rule violations unless asked to skip them", () => {
    const req = { blueprint: FIXTURE_ID, region: "centralus", params: { sku: "Basic", count: 3 }, ttlHours: 8 };
    expect(() => prepareLab(config, req, now)).toThrow(/at most 2/);
    expect(prepareLab(config, req, now, { skipRules: true }).params).toMatchObject({ sku: "Basic" });
  });

  it("resource types include steps and icon types", () => {
    const b = getBlueprint(FIXTURE_ID);
    const types = labResourceTypes(b, b.schema.parse({}));
    expect(types).toContain("Microsoft.Web/serverfarms");
    expect(types).toContain("Microsoft.Web/sites");
  });
});

// ---- Feasibility -------------------------------------------------------------------------------

const provider = (types: Record<string, string[]>, state = "Registered") => ({
  registrationState: state,
  resourceTypes: Object.entries(types).map(([resourceType, locations]) => ({ resourceType, locations })),
});

const facts = (over: Partial<AzureFacts> = {}): AzureFacts => ({
  providers: {
    "Microsoft.Web": provider({ sites: ["Central US", "East US"], serverfarms: ["Central US", "East US"] }),
    "Microsoft.Network": provider({ virtualNetworks: ["Central US", "East US"], privateDnsZones: ["global"] }),
    "Microsoft.Resources": provider({ deploymentStacks: ["Central US", "East US"] }),
  },
  usages: [
    { name: "VirtualNetworks", current: 1, limit: 1000 },
    { name: "IPv4StandardSkuPublicIpAddresses", current: 9, limit: 10 },
  ],
  permissions: [{ actions: ["*"], notActions: ["Microsoft.Authorization/*/Delete"] }],
  errors: {},
  ...over,
});

const input = (over: Partial<FeasibilityInput> = {}): FeasibilityInput => ({
  region: "centralus",
  enabledRegions: ["centralus", "eastus"],
  ttlHours: 8,
  hourly: 0.07,
  resourceTypes: ["Microsoft.Web/sites", "Microsoft.Network/virtualNetworks", "Microsoft.Network/privateDnsZones"],
  quotas: { VirtualNetworks: 1 },
  rules: [],
  deployMinutes: [30, 50],
  budget: { monthlyUsd: 600, forecastMonth: 300 },
  ...over,
});

const byId = (checks: ReturnType<typeof evaluateFeasibility>) => Object.fromEntries(checks.map((c) => [c.id, c]));

describe("feasibility", () => {
  it("passes a feasible lab", () => {
    const c = byId(evaluateFeasibility(input(), facts()));
    for (const id of ["config", "providers", "region", "quota", "rbac", "ttl", "budget"]) expect(c[id]?.status, id).toBe("pass");
  });

  it("flags unregistered providers with a fix and region gaps", () => {
    const f = facts();
    f.providers["Microsoft.Network"] = provider({ virtualNetworks: ["East US"], privateDnsZones: ["global"] }, "NotRegistered");
    const c = byId(evaluateFeasibility(input(), f));
    expect(c.providers).toMatchObject({ status: "fail", fix: { kind: "register-provider", namespaces: ["Microsoft.Network"] } });
    expect(c.region!.detail).toBe("Not offered here: virtualNetworks");
  });

  it("checks quotas against current usage", () => {
    expect(byId(evaluateFeasibility(input({ quotas: { IPv4StandardSkuPublicIpAddresses: 2 } }), facts())).quota!.status).toBe("fail");
    expect(byId(evaluateFeasibility(input({ quotas: { IPv4StandardSkuPublicIpAddresses: 0, VirtualNetworks: 1 } }), facts())).quota!.status).toBe("pass");
  });

  it("matches RBAC wildcards and notActions", () => {
    const entries = [{ actions: ["Microsoft.Network/*", "Microsoft.Resources/*"], notActions: ["Microsoft.Network/azureFirewalls/write"] }];
    expect(isPermitted("Microsoft.Network/virtualNetworks/write", entries)).toBe(true);
    expect(isPermitted("microsoft.network/AZUREFIREWALLS/write", entries)).toBe(false);
    expect(isPermitted("Microsoft.Web/sites/write", entries)).toBe(false);
    const c = byId(evaluateFeasibility(input(), facts({ permissions: entries })));
    expect(c.rbac!.detail).toMatch(/Microsoft.Web\/sites\/write/);
  });

  it("warns on budget pressure and high burn, fails a lifetime shorter than the deploy", () => {
    expect(byId(evaluateFeasibility(input({ hourly: 4, budget: { monthlyUsd: 600, forecastMonth: 580 } }), facts())).budget!.status).toBe("warn");
    expect(byId(evaluateFeasibility(input({ hourly: 3.83 }), facts())).budget!.detail).toMatch(/\$3.83\/h/);
    expect(byId(evaluateFeasibility(input({ ttlHours: 1, deployMinutes: [60, 90] }), facts())).ttl!.status).toBe("fail");
    expect(byId(evaluateFeasibility(input({ ttlHours: 1, deployMinutes: [20, 40] }), facts())).ttl!.status).toBe("warn");
  });

  it("reports configuration rules as a failing check", () => {
    expect(byId(evaluateFeasibility(input({ rules: ["Basic supports at most 2 instances"] }), facts())).config!.status).toBe("fail");
  });

  it("normalizes regions and namespaces", () => {
    expect(normRegion("East US 2")).toBe("eastus2");
    expect(namespacesOf(["Microsoft.Network/a", "Microsoft.Network/b/c", "Microsoft.Cdn/profiles"])).toEqual(["Microsoft.Cdn", "Microsoft.Network"]);
  });
});

// ---- Gates -------------------------------------------------------------------------------------

function fakeProbes(http: (url: string) => number = () => 200): Probes {
  return {
    arm: { get: async (p: string) => { throw new ArmError(`no route ${p}`, 404, "NotFound"); } } as unknown as Probes["arm"],
    http: async (url) => ({ status: http(url), ms: 5 }),
    dns: async () => [],
  };
}

const ctx = (x: Probes, outputs: Record<string, unknown> = {}, params: Record<string, unknown> = {}): GateCtx => ({ x, sub: SUB, labName: "lab-fxweb-ab12", params, outputs });
const fast = { pollMs: 0, sleep: async () => undefined };

describe("gates", () => {
  it("http-ok polls until the url answers 200", async () => {
    let n = 0;
    const x = fakeProbes(() => (++n < 3 ? 503 : 200));
    const ticks: string[] = [];
    const r = await runGate({ kind: "http-ok", label: "Site", timeoutMin: 5, blocking: true }, ctx(x, { url: "https://app" }), { ...fast, onTick: (t) => ticks.push(t.detail) });
    expect(r).toMatchObject({ ok: true, polls: 3 });
    expect(ticks[0]).toBe("https://app → HTTP 503");
    expect(r.detail).toMatch(/→ 200 in 5 ms/);
  });

  it("http-ok times out with the last reason", async () => {
    let t = 0;
    const r = await runGate({ kind: "http-ok", label: "Site", timeoutMin: 1, blocking: false }, ctx(fakeProbes(() => 503), { url: "https://app" }), { ...fast, now: () => (t += 30_000) });
    expect(r).toMatchObject({ ok: false, timedOut: true });
    expect(r.detail).toMatch(/Timed out after 1 min — https:\/\/app → HTTP 503/);
  });

  it("http-ok fails fast without a url in the outputs", async () => {
    const r = await runGate({ kind: "http-ok", label: "Site", timeoutMin: 10, blocking: true }, ctx(fakeProbes()), fast);
    expect(r).toMatchObject({ ok: false, timedOut: false, polls: 1 });
  });
});

// ---- Staged engine -----------------------------------------------------------------------------

function fakeEngineArm(opts: { failPutAtStage?: number }) {
  const puts: number[] = [];
  const arm = {
    lro: async (method: string, url: string, body?: { properties: { parameters: Record<string, { value: unknown }> } }) => {
      if (method === "PUT" && url.includes("deploymentStacks")) {
        const stage = body!.properties.parameters.stage?.value as number;
        puts.push(stage);
        if (stage === opts.failPutAtStage) throw new Error("DeploymentFailed");
        return {};
      }
      throw new Error(`unexpected ${method} ${url}`);
    },
    get: async (url: string) => {
      if (url.includes("deploymentStacks")) return { properties: { provisioningState: "Succeeded", outputs: { url: { value: "https://app" } }, error: { message: "boom" } } };
      if (url.includes("/deployments?")) return { value: [] };
      throw new ArmError(url, 404, "NotFound");
    },
  } as unknown as ArmClient;
  return { arm, puts };
}

const probesFor = (arm: ArmClient, http: () => number = () => 200): Probes => ({ arm, http: async () => ({ status: http(), ms: 1 }), dns: async () => [] });

describe("staged deployLab", () => {
  const req = { blueprint: FIXTURE_ID, region: "centralus", params: {}, ttlHours: 8, labName: "lab-fxweb-ab12" };

  it("applies stages in order, runs the gate and records outputs", async () => {
    const db = openDb(":memory:");
    const { arm, puts } = fakeEngineArm({});
    const p = prepareLab(config, req, now);
    const msg = await deployLab(arm, db, p, 0.08, { probes: probesFor(arm), gateOpts: fast });
    expect(msg).toBe("Ready");
    expect(puts).toEqual([1, 2]);
    const row = getLab(db, p.labName)!;
    expect(row.status).toBe("ready");
    expect(JSON.parse(row.outputs_json!)).toMatchObject({ url: "https://app" });
    expect(readStageState(row)).toMatchObject({ phase: "done", total: 2, warnings: [] });
  });

  it("a non-blocking gate failure leaves the lab ready with a warning", async () => {
    const db = openDb(":memory:");
    const { arm } = fakeEngineArm({});
    const p = prepareLab(config, { ...req, params: { strictGate: false } }, now);
    let t = 0;
    const msg = await deployLab(arm, db, p, 0.08, { probes: probesFor(arm, () => 503), gateOpts: { ...fast, now: () => (t += 60_000 * 11) } });
    expect(msg).toMatch(/Ready with warnings: .*Timed out/);
    expect(readStageState(getLab(db, p.labName))!.warnings).toHaveLength(1);
  });

  it("a blocking gate failure fails the lab at that stage; resume restarts there", async () => {
    const db = openDb(":memory:");
    const { arm, puts } = fakeEngineArm({});
    const p = prepareLab(config, req, now);
    const clock = () => { let t = 0; return () => (t += 60_000 * 11); };
    await expect(deployLab(arm, db, p, 0.08, { probes: probesFor(arm, () => 503), gateOpts: { ...fast, now: clock() } })).rejects.toThrow(/^Stage 2\/2 \(Apps\): Site answers: Timed out/);
    expect(puts).toEqual([1, 2]);
    const failed = getLab(db, p.labName)!;
    expect(failed.status).toBe("failed");
    expect(readStageState(failed)).toMatchObject({ index: 1, phase: "failed" });

    // Retry resumes at stage 2 (the site now answers) instead of starting over.
    puts.length = 0;
    await expect(deployLab(arm, db, p, 0.08, { resume: true, probes: probesFor(arm), gateOpts: fast })).resolves.toBe("Ready");
    expect(puts).toEqual([2]);
  });

  it("a failed stack update reports the stage", async () => {
    const db = openDb(":memory:");
    const { arm, puts } = fakeEngineArm({ failPutAtStage: 1 });
    const p = prepareLab(config, req, now);
    await expect(deployLab(arm, db, p, 0.08, { probes: probesFor(arm), gateOpts: fast })).rejects.toThrow(/^Stage 1\/2 \(Plan\): boom/);
    expect(puts).toEqual([1]);
  });

  it("resumeIndex: saved stage, else the last stage for labs deployed in one pass", () => {
    const s = (index: number): StageState => ({ index, total: 3, labels: [], phase: "failed", warnings: [], updatedAt: "" });
    expect(resumeIndex(s(1), 3)).toBe(1);
    expect(resumeIndex(s(7), 3)).toBe(2);
    expect(resumeIndex(undefined, 3)).toBe(2);
  });
});
