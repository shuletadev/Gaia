import { X509Certificate } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../server/labs/compile.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/labs/compile.ts")>()),
  compileBlueprint: async () => ({ $schema: "test" }),
}));

import { BLUEPRINTS, getBlueprint, stagesFor } from "../server/labs/blueprints.ts";
import { deployLab, prepareLab } from "../server/labs/engine.ts";
import { budgetTtl, describeChanges, isViable } from "../server/labs/alternatives.ts";
import { evaluateFeasibility, type AzureFacts } from "../server/labs/feasibility.ts";
import { runGate } from "../server/labs/gates.ts";
import { generateLabCerts, labCerts } from "../server/labs/hooks.ts";
import { backfillTimings, etaMinutes, learnedRange, recordTiming, samplesFor } from "../server/labs/timing.ts";
import { getLab, insertLab, openDb } from "../server/db.ts";
import { ArmError, type ArmClient } from "../server/azure/arm.ts";
import type { Probes } from "../server/validate.ts";
import { config, SUB } from "./helpers.ts";

const now = new Date("2026-10-02T18:00:00Z");

describe("phase 6 blueprints", () => {
  it("registers the new scenarios with hooks where they need generated values", () => {
    expect(getBlueprint("apim-selfhosted").paramHooks?.find((h) => h.hook === "apim-gateway-token")).toMatchObject({ fromStage: 2, hook: "apim-gateway-token", validateWith: { gatewayToken: expect.stringMatching(/^GatewayKey /) } });
    expect(getBlueprint("appgw-mtls").paramHooks?.[0]?.hook).toBe("mtls-certs");
    for (const id of ["apim-workspaces", "dns-resolver-hybrid"]) expect(stagesFor(getBlueprint(id), getBlueprint(id).schema.parse({}))).toHaveLength(2);
  });

  it("every blueprint's timingKey and alternatives work on its defaults, and alternatives obey its rules", () => {
    for (const b of BLUEPRINTS) {
      const d = b.schema.parse({});
      expect(typeof (b.timingKey?.(d) ?? "")).toBe("string");
      for (const a of b.alternatives?.(d) ?? []) expect(b.rules?.(b.schema.parse({ ...d, ...a.params })) ?? []).toEqual([]);
    }
  });

  it("apim-classic second region: Premium only, no VNet, doubles units, extra feasibility region", () => {
    const b = getBlueprint("apim-classic");
    const rules = (p: object) => b.rules!(b.schema.parse(p));
    expect(rules({ sku: "Premium", secondRegion: "eastus2" })).toEqual([]);
    expect(rules({ sku: "Developer", secondRegion: "eastus2" })).toEqual(["A second region needs Premium"]);
    expect(rules({ sku: "Premium", networkMode: "External", secondRegion: "eastus2" })[0]).toMatch(/VNet per region/);
    const p = b.schema.parse({ sku: "Premium", units: 2, secondRegion: "eastus2" });
    expect(b.meters(p)[0]).toMatchObject({ meterName: "Premium Unit", unitsPerHour: 4 });
    expect(b.apimSku!(p)).toEqual({ sku: "Premium", units: 2, extraRegions: ["eastus2"] });
    expect(b.deployTime!(p)[0]).toBeGreaterThan(b.deployTime!(b.schema.parse({ sku: "Premium" }))[0]);
    expect(b.alternatives!(p).map((a) => a.loses)).toContain("the second region");
    expect(() => b.schema.parse({ secondRegion: "east us; rm" })).toThrow();
  });

  it("feasibility checks the additional region and rejects a duplicate", () => {
    const facts: AzureFacts = {
      providers: {},
      apimSkus: [{ name: "Premium", locations: ["centralus", "eastus2"], capacity: { maximum: 12 } }],
      permissions: [{ actions: ["*"], notActions: [] }],
      errors: {},
    };
    const input = (extra: string[]) => ({
      region: "centralus",
      enabledRegions: ["centralus", "eastus2", "westeurope"],
      ttlHours: 8,
      hourly: 7.66,
      resourceTypes: [],
      apimSku: { sku: "Premium", units: 1, extraRegions: extra },
      rules: [],
      deployMinutes: [60, 110] as [number, number],
      budget: { monthlyUsd: 600 },
    });
    const pick = (extra: string[]) => evaluateFeasibility(input(extra), facts).filter((c) => c.id.startsWith("apim-sku-"));
    expect(pick(["eastus2"])[0]!.status).toBe("pass");
    expect(pick(["westeurope"])[0]!.detail).toBe("Not offered in westeurope");
    expect(pick(["centralus"])[0]!.detail).toMatch(/same as the primary/);
  });
});

describe("VM size feasibility", () => {
  const base = { region: "eastus", enabledRegions: ["eastus", "centralus"], ttlHours: 4, hourly: 0.1, resourceTypes: [], rules: [], deployMinutes: [30, 55] as [number, number], budget: { monthlyUsd: 600 }, vmSizes: ["Standard_B2s"] };
  const facts = (vmSkus: AzureFacts["vmSkus"], current = 0): AzureFacts => ({
    providers: {},
    permissions: [{ actions: ["*"], notActions: [] }],
    vmSkus,
    computeUsages: [
      { name: "cores", current, limit: 100 },
      { name: "standardBSFamily", current, limit: 10 },
    ],
    errors: {},
  });
  const vm = (f: AzureFacts) => evaluateFeasibility(base, f).find((c) => c.id === "vm-Standard_B2s")!;
  it("fails a size restricted for the subscription, missing, or over quota", () => {
    expect(vm(facts([{ name: "Standard_B2s", family: "standardBSFamily", vcpus: 2, restricted: "NotAvailableForSubscription" }]))).toMatchObject({ status: "fail", detail: "NotAvailableForSubscription in eastus" });
    expect(vm(facts([])).detail).toBe("Not offered in eastus");
    expect(vm(facts([{ name: "Standard_B2s", family: "standardBSFamily", vcpus: 2 }], 9)).detail).toBe("vCPU quota: standardBSFamily 9+2/10");
    expect(vm(facts([{ name: "Standard_B2s", family: "standardBSFamily", vcpus: 2 }])).status).toBe("pass");
  });
  it("self-hosted gateway checks a VM only when it runs on one", () => {
    const b = getBlueprint("apim-selfhosted");
    expect(b.vmSizes!(b.schema.parse({}))).toEqual(["Standard_B2s"]);
    expect(b.vmSizes!(b.schema.parse({ gatewayHost: "containerapps" }))).toEqual([]);
    expect(isViable([{ id: "vm-Standard_B2s", label: "", status: "fail", detail: "" }])).toBe(false);
  });
});

describe("deploy-time learning", () => {
  it("prefers same-region samples and widens a single sample", () => {
    const s = (min: number, region = "centralus") => ({ seconds: min * 60, region });
    expect(learnedRange([], "centralus", [30, 50])).toEqual({ minutes: [30, 50], source: "static", samples: 0 });
    expect(learnedRange([s(28)], "centralus", [30, 50])).toMatchObject({ minutes: [19, 37], source: "learned", samples: 1, typical: 28 });
    const mixed = [s(25), s(31), s(60, "eastus2")];
    expect(learnedRange(mixed, "centralus", [1, 2])).toMatchObject({ minutes: [21, 38], samples: 2 });
    expect(learnedRange(mixed, "westeurope", [1, 2]).samples).toBe(3);
  });

  it("backfills totals from finished labs by variant", () => {
    const db = openDb(":memory:");
    insertLab(db, { name: "lab-apim-aaaa", blueprint: "apim-classic", subscription_id: SUB, region: "centralus", params_json: JSON.stringify({ sku: "Premium" }), purpose: null, est_hourly: 3.8, created_at: "2026-10-02T00:16:12Z", status: "ready" });
    db.prepare("UPDATE labs SET ready_at = ? WHERE name = ?").run("2026-10-02T00:43:32Z", "lab-apim-aaaa");
    expect(backfillTimings(db, (id) => BLUEPRINTS.find((b) => b.id === id))).toBe(1);
    expect(backfillTimings(db, (id) => BLUEPRINTS.find((b) => b.id === id))).toBe(0);
    const [t] = samplesFor(db, "apim-classic", "Premium/None");
    expect(Math.round(t!.seconds / 60)).toBe(27);
  });

  it("ETA adds the remaining stages to what is left of the current one", () => {
    const db = openDb(":memory:");
    const b = getBlueprint("hub-spoke-firewall");
    const p = b.schema.parse({});
    const rec = (kind: "stage" | "gate", stage: number, sec: number, lab: string) =>
      recordTiming(db, { lab, blueprint: b.id, variant: "", region: "centralus", kind, stage, seconds: sec, at: now.toISOString() });
    for (const lab of ["a", "b"]) {
      rec("stage", 0, 60, lab);
      rec("stage", 1, 360, lab);
      rec("gate", 1, 60, lab);
      rec("stage", 2, 120, lab);
    }
    const started = new Date(now.getTime() - 120_000).toISOString();
    // In stage 2 of 3 for 2 minutes: (360 + 60 - 120) + 120 = 420 s → 7 min.
    expect(etaMinutes(db, b, p, { index: 1, total: 3, stageStartedAt: started }, started, now.getTime())).toBe(7);
    expect(etaMinutes(db, getBlueprint("apim-classic"), {}, undefined, started, now.getTime())).toBeUndefined();
  });
});

describe("alternatives", () => {
  it("describes changes with field and option labels", () => {
    const b = getBlueprint("apim-classic");
    expect(describeChanges(b, b.schema.parse({ sku: "Premium", secondRegion: "eastus2" }), b.schema.parse({ sku: "Developer" }))).toEqual(["Tier: Developer (was Premium)", "2nd region: None (was eastus2)"]);
  });

  it("budget lifetime: only when the forecast would pass the budget and a shorter one helps", () => {
    expect(budgetTtl(3.83, 24, 600, 520)).toBe(20);
    expect(budgetTtl(3.83, 8, 600, 520)).toBeUndefined();
    expect(budgetTtl(3.83, 8, 600, 599)).toBeUndefined();
    expect(budgetTtl(3.83, 8, 600, undefined)).toBeUndefined();
  });

  it("viability ignores cost and naming checks", () => {
    expect(isViable([{ id: "budget", label: "", status: "warn", detail: "" }, { id: "names", label: "", status: "fail", detail: "" }])).toBe(true);
    expect(isViable([{ id: "apim-sku-eastus2", label: "", status: "fail", detail: "" }])).toBe(false);
  });
});

describe("hooks and new gates", () => {
  it("generates a CA, a server certificate for the host and a client certificate it signed", () => {
    const c = generateLabCerts("lab-x.centralus.cloudapp.azure.com");
    const ca = new X509Certificate(c.caPem);
    const client = new X509Certificate(c.clientCertPem);
    expect(ca.ca).toBe(true);
    expect(client.verify(ca.publicKey)).toBe(true);
    expect(client.checkIssued(ca)).toBe(true);
    expect(c.serverPfxBase64.length).toBeGreaterThan(1000);
    expect(c.serverPfxPassword.length).toBeGreaterThanOrEqual(20);
    expect(c.clientPfxBase64.length).toBeGreaterThan(1000);
  }, 30_000);

  it("keeps certificates for a lab so retries reuse them", () => {
    const dir = mkdtempSync(join(tmpdir(), "labctl-"));
    try {
      const a = labCerts("lab-x", "h.example", dir);
      const b = labCerts("lab-x", "h.example", dir);
      expect(b.caPem).toBe(a.caPem);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  const fast = { pollMs: 0, sleep: async () => undefined };
  const probes = (http: (u: string) => number, tls?: Probes["tls"], get: (u: string) => unknown = () => ({})): Probes => ({
    arm: { get: async (u: string) => get(u), lro: async () => undefined } as unknown as Probes["arm"],
    http: async (u) => ({ status: http(u), ms: 3 }),
    dns: async () => [],
    tls,
  });

  it("self-hosted gateway gate waits for the container to serve the API", async () => {
    let n = 0;
    const r = await runGate({ kind: "shgw-e2e", label: "x", timeoutMin: 5, blocking: false }, { x: probes(() => (++n < 3 ? 0 : 200)), sub: SUB, labName: "l", params: {}, outputs: { selfHostedUrl: "http://h:8080" } }, fast);
    expect(r).toMatchObject({ ok: true, polls: 3, detail: "http://h:8080/httpbin/get → 200 in 3 ms" });
  });

  it("mTLS gate: cert accepted, no cert refused, headers forwarded", async () => {
    const tls: Probes["tls"] = async (_u, o) => (o.cert ? { status: 200, ms: 9, body: '{"headers":{"X-Client-Cert-Subject":"CN=labctl client"}}' } : { status: 400, ms: 5 });
    const ctx = { x: probes(() => 0, tls), sub: SUB, labName: "l", params: { forwardCertHeaders: true }, outputs: { gatewayHost: "h" }, clientCert: { cert: "c", key: "k", ca: "a" } };
    const r = await runGate({ kind: "mtls-e2e", label: "x", timeoutMin: 5, blocking: false }, ctx, fast);
    expect(r.detail).toBe("client cert → 200 in 9 ms; no cert → HTTP 400; cert headers reached the backend");
    expect(String(r.outputs.windowsRequest)).toMatch(/--tls-max 1.2 --ssl-no-revoke --cert-type P12 .*https:\/\/h\/headers/);
    const open: Probes["tls"] = async () => ({ status: 200, ms: 1 });
    expect((await runGate({ kind: "mtls-e2e", label: "x", timeoutMin: 5, blocking: false }, { ...ctx, x: probes(() => 0, open) }, fast)).detail).toMatch(/without a client certificate was accepted/);
  });

  it("DNS resolver gate reports the inbound endpoint IP", async () => {
    const get = (u: string) => {
      if (u.includes("/inboundEndpoints?")) return { value: [{ properties: { provisioningState: "Succeeded", ipConfigurations: [{ privateIpAddress: "10.95.0.4" }] } }] };
      if (u.includes("/outboundEndpoints?")) return { value: [{ properties: { provisioningState: "Succeeded" } }] };
      if (u.includes("/dnsResolvers/")) return { properties: { provisioningState: "Succeeded", dnsResolverState: "Connected" } };
      throw new ArmError("nf", 404, "NotFound");
    };
    const r = await runGate({ kind: "dns-resolver", label: "x", timeoutMin: 5, blocking: false }, { x: probes(() => 0, undefined, get), sub: SUB, labName: "l", params: {}, outputs: { resolverName: "l-resolver" } }, fast);
    expect(r).toMatchObject({ ok: true, outputs: { inboundIp: "10.95.0.4" } });
  });
});

describe("parameter hooks in staged deploys", () => {
  it("runs the hook before the stage that needs it and passes its values", async () => {
    const db = openDb(":memory:");
    const bodies: Record<string, { value: unknown }>[] = [];
    const arm = {
      lro: async (_m: string, _u: string, body?: { properties: { parameters: Record<string, { value: unknown }> } }) => {
        bodies.push(body!.properties.parameters);
        return {};
      },
      get: async (u: string) => {
        if (u.includes("deploymentStacks")) return { properties: { provisioningState: "Succeeded", outputs: { apimName: { value: "lab-apimshgw-ab12-apim" }, selfHostedUrl: { value: "http://h:8080" } } } };
        if (u.includes("Microsoft.ApiManagement/service/")) return { id: "s", name: "s", properties: { provisioningState: "Succeeded", virtualNetworkType: "None", gatewayUrl: "https://g" } };
        throw new ArmError("nf", 404, "NotFound");
      },
    } as unknown as ArmClient;
    const calls: string[] = [];
    const hooks = {
      "apim-gateway-token": async (c: { outputs: Record<string, unknown> }) => {
        calls.push(String(c.outputs.apimName));
        return { gatewayToken: "GatewayKey t0k" };
      },
      "mtls-certs": async () => ({}),
      "vm-password": async () => ({ adminPassword: "P@ss-test-1" }),
    };
    const p = prepareLab(config, { blueprint: "apim-selfhosted", region: "centralus", params: {}, ttlHours: 8, labName: "lab-apimshgw-ab12" }, now);
    const pr: Probes = { arm, http: async () => ({ status: 200, ms: 1 }), dns: async () => [] };
    expect(await deployLab(arm, db, p, 0.1, { probes: pr, gateOpts: { pollMs: 0, sleep: async () => undefined }, hooks })).toBe("Ready");
    expect(calls).toEqual(["lab-apimshgw-ab12-apim"]);
    expect(bodies.map((b) => [b.stage?.value, b.gatewayToken?.value])).toEqual([
      [1, undefined],
      [2, "GatewayKey t0k"],
    ]);
    // Timings were recorded for each stage and the total.
    expect(samplesFor(db, "apim-selfhosted", "Developer/vm", "stage", 0)).toHaveLength(1);
    expect(samplesFor(db, "apim-selfhosted", "Developer/vm")).toHaveLength(1);
    expect(JSON.parse(getLab(db, p.labName)!.stage_json!).phase).toBe("done");
  });
});
