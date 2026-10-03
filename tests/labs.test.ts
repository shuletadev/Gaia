import { describe, expect, it } from "vitest";
import { BLUEPRINTS, LAB_NAME, getBlueprint, newLabName } from "../server/labs/blueprints.ts";
import { innermostErrors, mergeProgress, planReconcile, prepareLab, prepareRetry, stackBody, LabRequestError } from "../server/labs/engine.ts";
import { meterFilter, pickPrice } from "../server/labs/pricing.ts";
import { canAutoDelete } from "../server/guard.ts";
import { config, FIXTURE_ID, registerFixtureBlueprint, SUB } from "./helpers.ts";

registerFixtureBlueprint();

const now = new Date("2026-10-01T18:00:00Z");

describe("blueprints", () => {
  it("each has defaults, steps and meters", () => {
    for (const b of BLUEPRINTS) {
      const d = b.schema.parse({});
      expect(b.steps(d).length).toBeGreaterThan(0);
      expect(b.meters(d).length).toBeGreaterThan(0);
      for (const f of b.fields) expect(d).toHaveProperty(f.key, f.default);
    }
  });

  it("generates valid, prefixed lab names", () => {
    let i = 0;
    const seq = [0, 0.5, 0.99, 0.1];
    const name = newLabName("fxweb", () => seq[i++ % 4]!);
    expect(name).toMatch(LAB_NAME);
    expect(name.startsWith("lab-fxweb-")).toBe(true);
  });

  it("adds one step per instance", () => {
    const b = getBlueprint(FIXTURE_ID);
    expect(b.steps(b.schema.parse({ count: 3 })).filter((s) => /^app-\d+$/.test(s.name))).toHaveLength(3);
  });
});

describe("prepareLab", () => {
  const req = { blueprint: FIXTURE_ID, region: "centralus", params: { sku: "Standard" }, ttlHours: 8, purpose: "repro <case> 123" };

  it("builds tags, expiry and ARM parameters", () => {
    const p = prepareLab(config, { ...req, labName: "lab-fxweb-ab12" }, now);
    expect(p.expiresOn).toBe("2026-10-02T02:00:00Z");
    expect(p.tags).toMatchObject({ managedBy: "labctl", expiresOn: "2026-10-02T02:00:00Z", blueprint: FIXTURE_ID, purpose: "repro case 123", labctlStack: "labctl-lab-fxweb-ab12" });
    expect(p.armParameters).toMatchObject({ labName: { value: "lab-fxweb-ab12" }, location: { value: "centralus" }, sku: { value: "Standard" }, contactEmail: { value: config.owner } });
    expect(p.subscriptionId).toBe(SUB);
  });

  it("produces a lab the sweeper will delete once expired, and not before", () => {
    const p = prepareLab(config, { ...req, labName: "lab-fxweb-ab12" }, now);
    const rg = { id: `/subscriptions/${SUB}/resourceGroups/${p.labName}`, name: p.labName, tags: p.tags };
    expect(canAutoDelete(config, rg, now).allowed).toBe(false);
    expect(canAutoDelete(config, rg, new Date("2026-10-02T02:00:01Z")).allowed).toBe(true);
  });

  it.each([
    [{ region: "japaneast" }, "Region"],
    [{ ttlHours: 0 }, "Lifetime"],
    [{ ttlHours: 100 }, "Lifetime"],
    [{ params: { sku: "Premium" } }, "Invalid parameters"],
    [{ labName: "SharedEnv" }, "Invalid lab name"],
    [{ labName: "lab-other-ab12" }, "Invalid lab name"],
    [{ blueprint: "nope" }, "Unknown blueprint"],
  ])("rejects %o", (patch, msg) => {
    expect(() => prepareLab(config, { ...req, ...patch } as typeof req, now)).toThrow(msg);
  });

  it("raises LabRequestError for user input problems", () => {
    expect(() => prepareLab(config, { ...req, ttlHours: -1 }, now)).toThrow(LabRequestError);
  });

  it("builds a stack that deletes everything it stops managing", () => {
    const body = stackBody(prepareLab(config, req, now), { $schema: "x" });
    expect(body.properties.actionOnUnmanage).toEqual({ resources: "delete", resourceGroups: "delete", managementGroups: "detach" });
    expect(body.properties.denySettings).toEqual({ mode: "none" });
    expect(body.location).toBe("centralus");
  });
});

describe("progress and errors", () => {
  const steps = [
    { name: "hub", label: "Hub", type: "t" },
    { name: "firewall", label: "Firewall", type: "t" },
    { name: "spoke-1", label: "Spoke", type: "t" },
  ];

  it("maps nested deployment states onto steps", () => {
    const p = mergeProgress(steps, [
      { name: "hub", properties: { provisioningState: "Succeeded", duration: "PT20S" } },
      { name: "Firewall", properties: { provisioningState: "Running" } },
      { name: "pid-xyz", properties: { provisioningState: "Succeeded" } },
    ]);
    expect(p.map((s) => s.state)).toEqual(["succeeded", "running", "pending"]);
  });

  it("surfaces the most specific failure messages", () => {
    const err = {
      code: "DeploymentFailed",
      message: "At least one resource deployment operation failed.",
      details: [{ code: "ResourceDeploymentFailure", message: "x", details: [{ code: "InvalidParameter", message: "Subnet too small" }] }, { code: "Conflict", message: "Name in use" }],
    };
    expect(innermostErrors(err)).toEqual(["InvalidParameter: Subnet too small", "Conflict: Name in use"]);
    const p = mergeProgress(steps, [{ name: "hub", properties: { provisioningState: "Failed", error: err } }]);
    expect(p[0]).toMatchObject({ state: "failed", error: "InvalidParameter: Subnet too small | Conflict: Name in use" });
  });
});

describe("prepareRetry", () => {
  it("re-applies the same blueprint and keeps the lab's live tags", () => {
    const row = { name: "lab-fxweb-ab12", blueprint: FIXTURE_ID, region: "centralus", params_json: '{"sku":"Standard"}', purpose: "Class demo" };
    const live = { managedBy: "labctl", expiresOn: "2026-10-02T09:00:00Z", cohort: "az900-oct", purpose: "Class demo" };
    const p = prepareRetry(config, row, live);
    expect(p.labName).toBe("lab-fxweb-ab12");
    expect(p.expiresOn).toBe("2026-10-02T09:00:00Z");
    expect(p.armParameters.tags).toEqual({ value: expect.objectContaining({ expiresOn: "2026-10-02T09:00:00Z", cohort: "az900-oct", blueprint: FIXTURE_ID }) });
    expect(p.armParameters.sku).toEqual({ value: "Standard" });
  });
});

describe("planReconcile", () => {
  it.each([
    [{ status: "destroying" }, false, false, undefined, "destroyed"],
    [{ status: "destroying" }, false, true, undefined, "destroy"],
    [{ status: "destroying" }, false, false, "deleting", "destroy"],
    [{ status: "deploying" }, false, true, "deploying", "watch"],
    [{ status: "deploying" }, false, true, "failed", "watch"],
    [{ status: "deploying" }, false, false, undefined, "destroyed"],
    [{ status: "deploying" }, false, true, undefined, "failed"],
  ] as const)("%o job=%s rg=%s stack=%s -> %s", (row, job, rg, stack, action) => {
    expect(planReconcile({ name: "lab-x", ...row }, job, rg, stack)?.action).toBe(action);
  });

  it("leaves labs alone while a job is running or when settled", () => {
    expect(planReconcile({ name: "a", status: "deploying" }, true, true, "deploying")).toBeUndefined();
    expect(planReconcile({ name: "a", status: "ready" }, false, true, "succeeded")).toBeUndefined();
  });
});

describe("pricing", () => {
  it("builds an exact OData filter and escapes quotes", () => {
    const f = meterFilter("centralus", { label: "x", serviceName: "API Management", skuName: "Basic v2", meterName: "Basic v2 Unit", unitsPerHour: 1, productName: "O'Brien" });
    expect(f).toBe("serviceName eq 'API Management' and armRegionName eq 'centralus' and priceType eq 'Consumption' and skuName eq 'Basic v2' and meterName eq 'Basic v2 Unit' and productName eq 'O''Brien'");
  });

  it("takes the latest base-tier, non-discounted price", () => {
    const item = (retailPrice: number, extra: object = {}) => ({ retailPrice, unitOfMeasure: "1 Hour", productName: "Application Gateway WAF v2", skuName: "Standard", meterName: "m", tierMinimumUnits: 0, type: "Consumption", effectiveStartDate: "2024-01-01", ...extra });
    expect(pickPrice([item(0.3), item(0.443, { effectiveStartDate: "2025-06-01" }), item(0.25, { productName: "Application Gateway WAF v2 - Discounted" }), item(0.1, { tierMinimumUnits: 100 })])).toBe(0.443);
    expect(pickPrice([])).toBeUndefined();
  });
});
