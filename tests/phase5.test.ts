import { describe, expect, it, vi } from "vitest";

vi.mock("../server/labs/compile.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/labs/compile.ts")>()),
  compileBlueprint: async () => ({ $schema: "test" }),
}));

import { BLUEPRINTS, deployMinutesFor, getBlueprint, stagesFor } from "../server/labs/blueprints.ts";
import { deployLab, labResourceTypes, prepareLab, readStageState, resumeIndex, type StageState } from "../server/labs/engine.ts";
import { evaluateFeasibility, isPermitted, namespacesOf, normRegion, type AzureFacts, type FeasibilityInput } from "../server/labs/feasibility.ts";
import { apimDependencies, runGate, type GateCtx } from "../server/labs/gates.ts";
import { getLab, openDb } from "../server/db.ts";
import { ArmError, type ArmClient } from "../server/azure/arm.ts";
import type { Probes } from "../server/validate.ts";
import { config, SUB } from "./helpers.ts";

const now = new Date("2026-10-01T18:00:00Z");

// ---- Blueprints --------------------------------------------------------------------------------

describe("phase 5 blueprints", () => {
  it("registers the new scenarios with icons, meters and stages", () => {
    for (const id of ["apim-classic", "apim-private-endpoint", "frontdoor-apim"]) {
      const b = getBlueprint(id);
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

  it("apim-classic: VNet only on Developer/Premium, units within tier limits", () => {
    const b = getBlueprint("apim-classic");
    const rules = (p: object) => b.rules!(b.schema.parse(p));
    expect(rules({ sku: "Developer" })).toEqual([]);
    expect(rules({ sku: "Premium", units: 3, networkMode: "Internal" })).toEqual([]);
    expect(rules({ sku: "Standard", networkMode: "External" })[0]).toMatch(/Developer or Premium/);
    expect(rules({ sku: "Developer", units: 2 })[0]).toMatch(/at most 1 unit per region/);
    expect(rules({ sku: "Basic", units: 3 })[0]).toMatch(/at most 2 units/);
  });

  it("apim-classic: network stage only when injected; meters scale with units", () => {
    const b = getBlueprint("apim-classic");
    expect(stagesFor(b, b.schema.parse({})).map((s) => s.value)).toEqual([2]);
    expect(stagesFor(b, b.schema.parse({ networkMode: "Internal" })).map((s) => s.value)).toEqual([1, 2]);
    const m = b.meters(b.schema.parse({ sku: "Premium", units: 2, networkMode: "External" }));
    expect(m[0]).toMatchObject({ skuName: "Premium", meterName: "Premium Unit", unitsPerHour: 2 });
    expect(m).toHaveLength(2);
    expect(deployMinutesFor(b, b.schema.parse({ sku: "Premium" }))[1]).toBeGreaterThan(deployMinutesFor(b, b.schema.parse({}))[1]);
  });

  it("apim-classic presets parse and pass the rules", () => {
    const b = getBlueprint("apim-classic");
    expect(b.presets?.length).toBeGreaterThanOrEqual(2);
    for (const p of b.presets!) expect(b.rules!(b.schema.parse(p.params))).toEqual([]);
  });

  it("private endpoint: disabling public access adds a final stage", () => {
    const b = getBlueprint("apim-private-endpoint");
    expect(stagesFor(b, b.schema.parse({})).map((s) => s.value)).toEqual([1, 2, 3, 4]);
    expect(stagesFor(b, b.schema.parse({ disablePublicAccess: "false" })).map((s) => s.value)).toEqual([1, 2, 3]);
  });

  it("prepareLab rejects rule violations unless asked to skip them", () => {
    const req = { blueprint: "apim-classic", region: "centralus", params: { sku: "Basic", networkMode: "Internal" }, ttlHours: 8 };
    expect(() => prepareLab(config, req, now)).toThrow(/Developer or Premium/);
    expect(prepareLab(config, req, now, { skipRules: true }).params).toMatchObject({ sku: "Basic" });
  });

  it("resource types include steps and icon types", () => {
    const b = getBlueprint("frontdoor-apim");
    const types = labResourceTypes(b, b.schema.parse({}));
    expect(types).toContain("Microsoft.Cdn/profiles");
    expect(types).toContain("Microsoft.ApiManagement/service");
  });
});

// ---- Feasibility -------------------------------------------------------------------------------

const provider = (types: Record<string, string[]>, state = "Registered") => ({
  registrationState: state,
  resourceTypes: Object.entries(types).map(([resourceType, locations]) => ({ resourceType, locations })),
});

const facts = (over: Partial<AzureFacts> = {}): AzureFacts => ({
  providers: {
    "Microsoft.ApiManagement": provider({ service: ["Central US", "East US"] }),
    "Microsoft.Network": provider({ virtualNetworks: ["Central US", "East US"], privateDnsZones: ["global"] }),
    "Microsoft.Resources": provider({ deploymentStacks: ["Central US", "East US"] }),
  },
  apimSkus: [
    { name: "Developer", locations: ["centralus"], capacity: { minimum: 1, maximum: 1 }, restrictions: [] },
    { name: "Premium", locations: ["centralus"], capacity: { minimum: 1, maximum: 12 }, restrictions: [] },
    { name: "PremiumV2", locations: ["eastus"], capacity: { minimum: 1, maximum: 30 }, restrictions: [] },
  ],
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
  resourceTypes: ["Microsoft.ApiManagement/service", "Microsoft.Network/virtualNetworks", "Microsoft.Network/privateDnsZones"],
  apimSku: { sku: "Developer", units: 1 },
  quotas: { VirtualNetworks: 1 },
  rules: [],
  deployMinutes: [30, 50],
  budget: { monthlyUsd: 600, forecastMonth: 300 },
  ...over,
});

const byId = (checks: ReturnType<typeof evaluateFeasibility>) => Object.fromEntries(checks.map((c) => [c.id, c]));

describe("feasibility", () => {
  it("passes a feasible Developer lab", () => {
    const c = byId(evaluateFeasibility(input(), facts()));
    for (const id of ["config", "providers", "region", "apim-sku", "quota", "rbac", "ttl", "budget"]) expect(c[id]?.status, id).toBe("pass");
  });

  it("blocks a tier not offered in the region and suggests where it is", () => {
    const c = byId(evaluateFeasibility(input({ apimSku: { sku: "PremiumV2", units: 1 } }), facts()));
    expect(c["apim-sku"]).toMatchObject({ status: "fail" });
    expect(c["apim-sku"]!.detail).toMatch(/try eastus/);
  });

  it("blocks units above the region's capacity and restricted SKUs", () => {
    expect(byId(evaluateFeasibility(input({ apimSku: { sku: "Developer", units: 2 } }), facts()))["apim-sku"]!.status).toBe("fail");
    const restricted = facts({ apimSkus: [{ name: "Developer", locations: ["centralus"], restrictions: [{ type: "Location", values: ["centralus"], reasonCode: "NotAvailableForSubscription" }] }] });
    expect(byId(evaluateFeasibility(input(), restricted))["apim-sku"]!.detail).toMatch(/NotAvailableForSubscription/);
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
    expect(isPermitted("Microsoft.ApiManagement/service/write", entries)).toBe(false);
    const c = byId(evaluateFeasibility(input(), facts({ permissions: entries })));
    expect(c.rbac!.detail).toMatch(/Microsoft.ApiManagement\/service\/write/);
  });

  it("warns on budget pressure and high burn, fails a lifetime shorter than the deploy", () => {
    expect(byId(evaluateFeasibility(input({ hourly: 4, budget: { monthlyUsd: 600, forecastMonth: 580 } }), facts())).budget!.status).toBe("warn");
    expect(byId(evaluateFeasibility(input({ hourly: 3.83 }), facts())).budget!.detail).toMatch(/\$3.83\/h/);
    expect(byId(evaluateFeasibility(input({ ttlHours: 1, deployMinutes: [60, 90] }), facts())).ttl!.status).toBe("fail");
    expect(byId(evaluateFeasibility(input({ ttlHours: 1, deployMinutes: [20, 40] }), facts())).ttl!.status).toBe("warn");
  });

  it("reports configuration rules as a failing check", () => {
    expect(byId(evaluateFeasibility(input({ rules: ["VNet injection needs Developer or Premium"] }), facts())).config!.status).toBe("fail");
  });

  it("normalizes regions and namespaces", () => {
    expect(normRegion("East US 2")).toBe("eastus2");
    expect(namespacesOf(["Microsoft.Network/a", "Microsoft.Network/b/c", "Microsoft.Cdn/profiles"])).toEqual(["Microsoft.Cdn", "Microsoft.Network"]);
  });
});

// ---- Gates -------------------------------------------------------------------------------------

function fakeProbes(routes: Record<string, unknown | ((n: number) => unknown)>, http: (url: string) => number = () => 200): Probes & { calls: string[] } {
  const calls: string[] = [];
  const count: Record<string, number> = {};
  const lookup = (path: string) => {
    calls.push(path);
    const key = Object.keys(routes).find((k) => path.includes(k));
    if (!key) throw new ArmError(`no route ${path}`, 404, "NotFound");
    count[key] = (count[key] ?? 0) + 1;
    const v = routes[key];
    return typeof v === "function" ? (v as (n: number) => unknown)(count[key]!) : v;
  };
  return {
    calls,
    arm: { get: async (p: string) => lookup(p), lro: async (_m: string, p: string) => lookup(p) } as unknown as Probes["arm"],
    http: async (url) => ({ status: http(url), ms: 5 }),
    dns: async () => [],
  };
}

const ctx = (x: Probes, outputs: Record<string, unknown> = {}, params: Record<string, unknown> = {}): GateCtx => ({ x, sub: SUB, labName: "lab-apim-ab12", params, outputs });
const fast = { pollMs: 0, sleep: async () => undefined };

describe("gates", () => {
  it("apim-ready waits for activation, private IP and required dependencies", async () => {
    const x = fakeProbes({
      "/networkstatus": (n: number) => [{ networkStatus: { connectivityStatus: [{ name: "Storage", status: n < 2 ? "Initializing" : "Success" }, { name: "Smtp", status: "Failure", isOptional: true }] } }],
      "/service/lab-apim-ab12-apim": (n: number) => ({
        id: "/x/service/lab-apim-ab12-apim",
        name: "lab-apim-ab12-apim",
        properties: { provisioningState: n < 2 ? "Activating" : "Succeeded", virtualNetworkType: "Internal", privateIPAddresses: n < 3 ? [] : ["10.30.1.5"], gatewayUrl: "https://g" },
      }),
    });
    const ticks: string[] = [];
    const r = await runGate({ kind: "apim-ready", label: "APIM", timeoutMin: 5, blocking: true }, ctx(x), { ...fast, onTick: (t) => ticks.push(t.detail) });
    expect(r.ok).toBe(true);
    expect(r.outputs).toEqual({ privateIp: "10.30.1.5" });
    expect(ticks[0]).toMatch(/Activating/);
    expect(ticks).toContain("Waiting for a private IP");
    expect(r.detail).toMatch(/optional failing: Smtp/);
  });

  it("apim-ready probes the public gateway and times out with the last reason", async () => {
    const x = fakeProbes({ "/service/": { id: "s", name: "s", properties: { provisioningState: "Succeeded", virtualNetworkType: "None", gatewayUrl: "https://g" } } }, () => 503);
    let t = 0;
    const r = await runGate({ kind: "apim-ready", label: "APIM", timeoutMin: 1, blocking: false }, ctx(x), { ...fast, now: () => (t += 30_000) });
    expect(r).toMatchObject({ ok: false, timedOut: true });
    expect(r.detail).toMatch(/Timed out after 1 min — Gateway HTTP 503/);
  });

  it("apim-ready fails fast on a failed service", async () => {
    const x = fakeProbes({ "/service/": { id: "s", name: "s", properties: { provisioningState: "Failed" } } });
    const r = await runGate({ kind: "apim-ready", label: "APIM", timeoutMin: 10, blocking: true }, ctx(x), fast);
    expect(r).toMatchObject({ ok: false, timedOut: false, polls: 1 });
  });

  it("firewall-ip returns the private IP", async () => {
    const x = fakeProbes({
      "/resources?": { value: [{ id: "/fw/hub-fw", name: "hub-fw" }] },
      "/fw/hub-fw": { id: "/fw/hub-fw", name: "hub-fw", properties: { provisioningState: "Succeeded", ipConfigurations: [{ properties: { privateIPAddress: "10.0.1.4" } }] } },
    });
    const r = await runGate({ kind: "firewall-ip", label: "FW", timeoutMin: 5, blocking: true }, ctx(x), fast);
    expect(r).toMatchObject({ ok: true, outputs: { firewallPrivateIp: "10.0.1.4" } });
  });

  it("peerings fail on Disconnected and pass when connected", async () => {
    const vnet = (state: string) => ({ "/resources?": { value: [{ id: "/v/hub", name: "hub" }] }, "/v/hub": { id: "/v/hub", name: "hub", properties: { virtualNetworkPeerings: [{ name: "to-spoke", properties: { peeringState: state, peeringSyncLevel: "FullyInSync" } }] } } });
    expect((await runGate({ kind: "peerings", label: "P", timeoutMin: 1, blocking: false }, ctx(fakeProbes(vnet("Disconnected"))), fast)).ok).toBe(false);
    expect((await runGate({ kind: "peerings", label: "P", timeoutMin: 1, blocking: false }, ctx(fakeProbes(vnet("Connected"))), fast)).ok).toBe(true);
  });

  it("pe-approved checks approval, NIC IP and the privatelink A record", async () => {
    const x = fakeProbes({
      "/resources?": { value: [{ id: "/pe/apim-pe", name: "apim-pe" }] },
      "/pe/apim-pe": { id: "/pe/apim-pe", name: "apim-pe", properties: { privateLinkServiceConnections: [{ properties: { privateLinkServiceConnectionState: { status: "Approved" } } }], networkInterfaces: [{ id: "/nic/1" }] } },
      "/nic/1": { properties: { ipConfigurations: [{ properties: { privateIPAddress: "10.40.1.4" } }] } },
      "/A/lab-apim-ab12-apim": (n: number) => ({ properties: { aRecords: n < 2 ? [] : [{ ipv4Address: "10.40.1.4" }] } }),
    });
    const r = await runGate({ kind: "pe-approved", label: "PE", timeoutMin: 5, blocking: true }, ctx(x), fast);
    expect(r).toMatchObject({ ok: true, outputs: { privateEndpointIp: "10.40.1.4" }, polls: 2 });
  });

  it("afd-e2e polls the edge until 200 and reports the origin lock", async () => {
    let edge = 0;
    const x = fakeProbes({}, (url) => (url.startsWith("https://edge") ? (++edge < 3 ? 404 : 200) : 403));
    const r = await runGate({ kind: "afd-e2e", label: "AFD", timeoutMin: 20, blocking: false }, ctx(x, { frontDoorUrl: "https://edge", gatewayUrl: "https://gw" }, { lockToFrontDoor: true }), fast);
    expect(r.ok).toBe(true);
    expect(r.polls).toBe(3);
    expect(r.detail).toMatch(/blocked \(403\)/);
  });

  it("apim-public-off waits until public API calls are rejected", async () => {
    let calls = 0;
    const x = fakeProbes(
      { "/service/": (n: number) => ({ id: "s", name: "s", properties: { provisioningState: n < 2 ? "Updating" : "Succeeded", publicNetworkAccess: "Disabled", gatewayUrl: "https://g" } }) },
      (url) => (url.endsWith("/httpbin/get") && ++calls >= 2 ? 403 : 200),
    );
    const r = await runGate({ kind: "apim-public-off", label: "Closed", timeoutMin: 5, blocking: false }, ctx(x), fast);
    expect(r).toMatchObject({ ok: true, polls: 3 });
    expect(r.detail).toMatch(/rejected \(403\)/);
  });

  it("dependency summary ignores optional failures", () => {
    expect(apimDependencies([{ networkStatus: { connectivityStatus: [{ name: "a", status: "Success" }, { name: "b", status: "Failure", isOptional: true }] } }]).ready).toBe(true);
    expect(apimDependencies([{ networkStatus: { connectivityStatus: [{ name: "a", status: "Failure" }] } }]).ready).toBe(false);
    expect(apimDependencies([]).ready).toBe(false);
  });
});

// ---- Staged engine -----------------------------------------------------------------------------

function fakeEngineArm(opts: { failPutAtStage?: number; apim?: () => Record<string, unknown> }) {
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
      if (url.includes("deploymentStacks")) return { properties: { provisioningState: "Succeeded", outputs: { apimName: { value: "lab-apim-ab12-apim" } }, error: { message: "boom" } } };
      if (url.includes("/deployments?")) return { value: [] };
      if (url.includes("/networkstatus")) return [{ networkStatus: { connectivityStatus: [{ name: "Storage", status: "Success" }] } }];
      if (url.includes("Microsoft.ApiManagement/service/")) return { id: "s", name: "s", properties: opts.apim?.() ?? { provisioningState: "Succeeded", virtualNetworkType: "Internal", privateIPAddresses: ["10.30.1.4"] } };
      throw new ArmError(url, 404, "NotFound");
    },
  } as unknown as ArmClient;
  return { arm, puts };
}

const probesFor = (arm: ArmClient): Probes => ({ arm, http: async () => ({ status: 200, ms: 1 }), dns: async () => [] });

describe("staged deployLab", () => {
  const req = { blueprint: "apim-classic", region: "centralus", params: { networkMode: "Internal" }, ttlHours: 8, labName: "lab-apim-ab12" };

  it("applies stages in order, runs the gate and records outputs", async () => {
    const db = openDb(":memory:");
    const { arm, puts } = fakeEngineArm({});
    const p = prepareLab(config, req, now);
    const msg = await deployLab(arm, db, p, 0.08, { probes: probesFor(arm), gateOpts: fast });
    expect(msg).toBe("Ready");
    expect(puts).toEqual([1, 2]);
    const row = getLab(db, p.labName)!;
    expect(row.status).toBe("ready");
    expect(JSON.parse(row.outputs_json!)).toMatchObject({ apimName: "lab-apim-ab12-apim", privateIp: "10.30.1.4" });
    expect(readStageState(row)).toMatchObject({ phase: "done", total: 2, warnings: [] });
  });

  it("a non-blocking gate failure leaves the lab ready with a warning", async () => {
    const db = openDb(":memory:");
    const { arm } = fakeEngineArm({ apim: () => ({ provisioningState: "Activating", virtualNetworkType: "Internal" }) });
    const p = prepareLab(config, req, now);
    let t = 0;
    const msg = await deployLab(arm, db, p, 0.08, { probes: probesFor(arm), gateOpts: { ...fast, now: () => (t += 60_000) } });
    expect(msg).toMatch(/Ready with warnings: .*Timed out/);
    expect(readStageState(getLab(db, p.labName))!.warnings).toHaveLength(1);
  });

  it("a blocking gate failure fails the lab at that stage; resume restarts there", async () => {
    const db = openDb(":memory:");
    let apimState = "Failed";
    const { arm, puts } = fakeEngineArm({ apim: () => ({ provisioningState: apimState, virtualNetworkType: "None", publicNetworkAccess: "Disabled" }) });
    const p = prepareLab(config, { ...req, blueprint: "apim-private-endpoint", params: {}, labName: "lab-apimpe-ab12" }, now);
    await expect(deployLab(arm, db, p, 0.08, { probes: probesFor(arm), gateOpts: fast })).rejects.toThrow(/^Stage 2\/4 \(API Management Developer\): Gateway answers: Provisioning failed/);
    expect(puts).toEqual([1, 2]);
    const failed = getLab(db, p.labName)!;
    expect(failed.status).toBe("failed");
    expect(readStageState(failed)).toMatchObject({ index: 1, phase: "failed" });

    // Retry resumes at stage 2; the PE gate then needs resources this fake does not serve, so stop there.
    apimState = "Succeeded";
    puts.length = 0;
    await expect(deployLab(arm, db, p, 0.08, { resume: true, probes: probesFor(arm), gateOpts: { ...fast, now: (() => { let t = 0; return () => (t += 60_000); })() } })).rejects.toThrow(/Stage 3\/4/);
    expect(puts).toEqual([2, 3]);
  });

  it("a failed stack update reports the stage", async () => {
    const db = openDb(":memory:");
    const { arm, puts } = fakeEngineArm({ failPutAtStage: 1 });
    const p = prepareLab(config, req, now);
    await expect(deployLab(arm, db, p, 0.08, { probes: probesFor(arm), gateOpts: fast })).rejects.toThrow(/^Stage 1\/2 \(Network\): boom/);
    expect(puts).toEqual([1]);
  });

  it("resumeIndex: saved stage, else the last stage for labs deployed in one pass", () => {
    const s = (index: number): StageState => ({ index, total: 3, labels: [], phase: "failed", warnings: [], updatedAt: "" });
    expect(resumeIndex(s(1), 3)).toBe(1);
    expect(resumeIndex(s(7), 3)).toBe(2);
    expect(resumeIndex(undefined, 3)).toBe(2);
  });
});
