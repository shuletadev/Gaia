import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLUEPRINTS, getBlueprint, stagesFor } from "../server/labs/blueprints.ts";
import { bicepPath, compileBlueprint } from "../server/labs/compile.ts";
import { evaluateFeasibility, type AzureFacts } from "../server/labs/feasibility.ts";
import { labResourceTypes } from "../server/labs/engine.ts";

const hasBicep = (() => {
  const p = bicepPath();
  return p !== "bicep" ? existsSync(p) : false;
})();

type Template = {
  parameters: Record<string, unknown>;
  outputs: Record<string, unknown>;
  resources: { type: string; name: string; properties?: { template?: { resources?: unknown[] } } }[];
};

describe("cr-farmacia-recibos", () => {
  const b = getBlueprint("cr-farmacia-recibos");

  it("is a showcase blueprint with its scenario filled in", () => {
    expect(b.category).toBe("Showcase");
    expect(b.scenario?.story.length).toBeGreaterThan(100);
    expect(b.scenario?.objectives.length).toBeGreaterThanOrEqual(3);
    expect(b.scenario?.exams.join(" ")).toMatch(/AZ-900/);
  });

  it("costs nothing while idle and gates on the front end without blocking", () => {
    expect(b.meters(b.schema.parse({})).every((m) => m.fixedHourly === 0)).toBe(true);
    const gate = stagesFor(b, b.schema.parse({}))[0]!.gate!;
    expect(gate).toMatchObject({ kind: "http-ok", blocking: false });
  });

  it("rejects an unsupported redundancy", () => {
    expect(() => b.schema.parse({ redundancy: "RA-GRS" })).toThrow();
    expect(b.armParams(b.schema.parse({ redundancy: "GRS" }), { owner: "x" })).toEqual({ redundancy: "GRS" });
  });

  it("does not fail the region check for Static Web Apps outside its few regions", () => {
    const facts: AzureFacts = {
      providers: { "Microsoft.Web": { registrationState: "Registered", resourceTypes: [{ resourceType: "staticSites", locations: ["Central US"] }] } },
      errors: {},
    };
    const input = (regionFree?: string[]) => ({
      region: "eastus",
      enabledRegions: ["eastus"],
      ttlHours: 8,
      hourly: 0,
      resourceTypes: ["Microsoft.Web/staticSites"],
      regionFree,
      rules: [],
      deployMinutes: [3, 8] as [number, number],
      budget: { monthlyUsd: 600 },
    });
    expect(evaluateFeasibility(input(), facts).find((c) => c.id === "region")!.status).toBe("fail");
    expect(evaluateFeasibility(input(b.regionFree), facts).find((c) => c.id === "region")!.status).toBe("pass");
    expect(labResourceTypes(b, b.schema.parse({}))).toContain("Microsoft.Web/staticSites");
  });

  it.skipIf(!hasBicep)("compiles, and its template matches the blueprint definition", async () => {
    const t = (await compileBlueprint(b.id)) as unknown as Template;
    // Every parameter the engine sends exists in the template (labName, location and tags are added by the engine).
    for (const key of ["labName", "location", "tags", ...Object.keys(b.armParams(b.schema.parse({}), { owner: "x" }))]) expect(t.parameters).toHaveProperty(key);
    // The gate reads `url`; the progress view looks for one nested deployment per step.
    expect(t.outputs).toHaveProperty("url");
    const nested = (t.resources.find((r) => r.name === "lab")?.properties?.template?.resources ?? []) as { type: string; name: string }[];
    const modules = nested.filter((r) => r.type === "Microsoft.Resources/deployments").map((r) => r.name);
    for (const s of b.steps(b.schema.parse({}))) expect(modules).toContain(s.name);
  }, 60_000);

  it("is registered exactly once", () => {
    expect(BLUEPRINTS.filter((x) => x.id === "cr-farmacia-recibos")).toHaveLength(1);
  });
});
