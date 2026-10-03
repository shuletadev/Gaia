import { describe, expect, it, vi } from "vitest";

vi.mock("../server/labs/compile.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/labs/compile.ts")>()),
  compileBlueprint: async () => ({ $schema: "test" }),
}));

import { BLUEPRINTS, getBlueprint } from "../server/labs/blueprints.ts";
import { deployLab, prepareLab } from "../server/labs/engine.ts";
import { budgetTtl, describeChanges, isViable } from "../server/labs/alternatives.ts";
import { evaluateFeasibility, type AzureFacts } from "../server/labs/feasibility.ts";
import { vmPassword } from "../server/labs/hooks.ts";
import { backfillTimings, etaMinutes, learnedRange, recordTiming, samplesFor } from "../server/labs/timing.ts";
import { getLab, insertLab, openDb } from "../server/db.ts";
import { ArmError, type ArmClient } from "../server/azure/arm.ts";
import type { Probes } from "../server/validate.ts";
import { config, FIXTURE_ID, registerFixtureBlueprint, SUB } from "./helpers.ts";

registerFixtureBlueprint();

const now = new Date("2026-10-02T18:00:00Z");

describe("blueprint variants", () => {
  it("every blueprint's timingKey and alternatives work on its defaults, and alternatives obey its rules", () => {
    for (const b of BLUEPRINTS) {
      const d = b.schema.parse({});
      expect(typeof (b.timingKey?.(d) ?? "")).toBe("string");
      for (const a of b.alternatives?.(d) ?? []) expect(b.rules?.(b.schema.parse({ ...d, ...a.params })) ?? []).toEqual([]);
    }
  });

  it("declares the hook a stage needs, with a placeholder for pre-launch validation", () => {
    expect(getBlueprint(FIXTURE_ID).paramHooks?.[0]).toMatchObject({ fromStage: 2, hook: "vm-password", validateWith: { adminPassword: expect.any(String) } });
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
  it("a failed VM check blocks the launch", () => {
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
    insertLab(db, { name: "lab-fxweb-aaaa", blueprint: FIXTURE_ID, subscription_id: SUB, region: "centralus", params_json: JSON.stringify({ sku: "Standard" }), purpose: null, est_hourly: 0.1, created_at: "2026-10-02T00:16:12Z", status: "ready" });
    db.prepare("UPDATE labs SET ready_at = ? WHERE name = ?").run("2026-10-02T00:43:32Z", "lab-fxweb-aaaa");
    expect(backfillTimings(db, (id) => BLUEPRINTS.find((b) => b.id === id))).toBe(1);
    expect(backfillTimings(db, (id) => BLUEPRINTS.find((b) => b.id === id))).toBe(0);
    const [t] = samplesFor(db, FIXTURE_ID, "Standard");
    expect(Math.round(t!.seconds / 60)).toBe(27);
  });

  it("ETA adds the remaining stages to what is left of the current one", () => {
    const db = openDb(":memory:");
    const b = getBlueprint(FIXTURE_ID);
    const p = b.schema.parse({});
    const rec = (kind: "stage" | "gate", stage: number, sec: number, lab: string) =>
      recordTiming(db, { lab, blueprint: b.id, variant: "Basic", region: "centralus", kind, stage, seconds: sec, at: now.toISOString() });
    for (const lab of ["a", "b"]) {
      rec("stage", 0, 60, lab);
      rec("stage", 1, 360, lab);
      rec("gate", 1, 60, lab);
    }
    const started = new Date(now.getTime() - 120_000).toISOString();
    // In stage 2 of 2 for 2 minutes: 360 + 60 - 120 = 300 s -> 5 min.
    expect(etaMinutes(db, b, p, { index: 1, total: 2, stageStartedAt: started }, started, now.getTime())).toBe(5);
    // Nothing learned for another variant.
    expect(etaMinutes(db, b, b.schema.parse({ sku: "Standard" }), undefined, started, now.getTime())).toBeUndefined();
  });
});

describe("alternatives", () => {
  it("describes changes with field and option labels", () => {
    const b = getBlueprint(FIXTURE_ID);
    expect(describeChanges(b, b.schema.parse({ sku: "Standard", count: 2 }), b.schema.parse({ sku: "Basic" }))).toEqual(["Tier: Basic (was Standard)", "Instances: 1 (was 2)"]);
  });

  it("budget lifetime: only when the forecast would pass the budget and a shorter one helps", () => {
    expect(budgetTtl(3.83, 24, 600, 520)).toBe(20);
    expect(budgetTtl(3.83, 8, 600, 520)).toBeUndefined();
    expect(budgetTtl(3.83, 8, 600, 599)).toBeUndefined();
    expect(budgetTtl(3.83, 8, 600, undefined)).toBeUndefined();
  });

  it("viability ignores cost and naming checks", () => {
    expect(isViable([{ id: "budget", label: "", status: "warn", detail: "" }, { id: "names", label: "", status: "fail", detail: "" }])).toBe(true);
    expect(isViable([{ id: "quota", label: "", status: "fail", detail: "" }])).toBe(false);
  });
});

describe("hooks", () => {
  it("generates an admin password that meets Azure complexity rules", () => {
    const pw = vmPassword();
    expect(pw.length).toBeGreaterThanOrEqual(12);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/\d/);
    expect(pw).toMatch(/[^A-Za-z0-9]/);
    expect(vmPassword()).not.toBe(pw);
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
        if (u.includes("deploymentStacks")) return { properties: { provisioningState: "Succeeded", outputs: { url: { value: "https://app" } } } };
        throw new ArmError("nf", 404, "NotFound");
      },
    } as unknown as ArmClient;
    let calls = 0;
    const hooks = {
      "vm-password": async () => {
        calls++;
        return { adminPassword: "P@ss-test-1" };
      },
    };
    const p = prepareLab(config, { blueprint: FIXTURE_ID, region: "centralus", params: {}, ttlHours: 8, labName: "lab-fxweb-ab12" }, now);
    const pr: Probes = { arm, http: async () => ({ status: 200, ms: 1 }), dns: async () => [] };
    expect(await deployLab(arm, db, p, 0.1, { probes: pr, gateOpts: { pollMs: 0, sleep: async () => undefined }, hooks })).toBe("Ready");
    expect(calls).toBe(1);
    expect(bodies.map((b) => [b.stage?.value, b.adminPassword?.value])).toEqual([
      [1, undefined],
      [2, "P@ss-test-1"],
    ]);
    // Timings were recorded for each stage and the total.
    expect(samplesFor(db, FIXTURE_ID, "Basic", "stage", 0)).toHaveLength(1);
    expect(samplesFor(db, FIXTURE_ID, "Basic")).toHaveLength(1);
    expect(JSON.parse(getLab(db, p.labName)!.stage_json!).phase).toBe("done");
  });
});
