import { z } from "zod";
import { BLUEPRINTS, flag } from "../server/labs/blueprints.ts";
import type { LabctlConfig } from "../server/config.ts";
import type { GraphResource, GraphResourceGroup } from "../server/azure/resourceGraph.ts";

export const SUB = "11111111-1111-1111-1111-111111111111";
export const OTHER_SUB = "22222222-2222-2222-2222-222222222222";

export const config: LabctlConfig = {
  tenantId: "33333333-3333-3333-3333-333333333333",
  subscriptions: [{ id: SUB, name: "Test sub" }],
  excludedResourceGroups: ["GovernanceRG", "NetworkWatcherRG"],
  budget: { monthlyUsd: 600, alertThresholds: [0.5, 0.8, 1] },
  ttlHours: { default: 8, byBlueprint: { "fixture-web": 12 } },
  owner: "me@example.com",
  server: { port: 4870 },
  labs: { defaultRegion: "centralus", regions: ["centralus", "eastus"], sweepIntervalMinutes: 15, sweepEnabled: true },
};

export const rgId = (rg: string, sub = SUB) => `/subscriptions/${sub}/resourceGroups/${rg}`;

export function res(
  rg: string,
  type: string,
  name: string,
  properties: Record<string, unknown> = {},
  extra: Partial<GraphResource> = {},
): GraphResource {
  return {
    id: `${rgId(rg)}/providers/${type}/${name}`,
    name,
    type,
    location: "eastus",
    resourceGroup: rg,
    subscriptionId: SUB,
    properties,
    ...extra,
  };
}

export function group(name: string, tags: Record<string, string> | null = null): GraphResourceGroup {
  return { id: rgId(name), name, location: "eastus", subscriptionId: SUB, tags };
}

/** Minimal two-stage blueprint so engine behaviour (params, stages, gates, timing) is testable without real labs. */
const fixtureSchema = z.object({
  sku: z.enum(["Basic", "Standard"]).default("Basic"),
  count: z.coerce.number().int().min(1).max(3).default(1),
  strictGate: flag(true),
});

export const FIXTURE_ID = "fixture-web";

export function registerFixtureBlueprint() {
  if (BLUEPRINTS.some((b) => b.id === FIXTURE_ID)) return;
  BLUEPRINTS.push({
    id: FIXTURE_ID,
    title: "Fixture web app",
    tagline: "Test-only blueprint",
    code: "fxweb",
    deployMinutes: [3, 10],
    icons: ["Microsoft.Web/sites"],
    fields: [
      { key: "sku", label: "Tier", kind: "select", options: [{ value: "Basic", label: "Basic" }, { value: "Standard", label: "Standard" }], default: "Basic" },
      { key: "count", label: "Instances", kind: "int", min: 1, max: 3, default: 1 },
      { key: "strictGate", label: "Block on readiness check", kind: "toggle", default: true },
    ],
    schema: fixtureSchema,
    steps: (p: z.infer<typeof fixtureSchema>) => [
      { name: "plan", label: "App Service plan", type: "Microsoft.Web/serverfarms" },
      ...Array.from({ length: p.count }, (_, i) => ({ name: `app-${i + 1}`, label: `Web app ${i + 1}`, type: "Microsoft.Web/sites" })),
    ],
    meters: (p: z.infer<typeof fixtureSchema>) => [{ label: `App Service ${p.sku}`, serviceName: "Azure App Service", skuName: p.sku === "Basic" ? "B1" : "S1", meterName: "B1", unitsPerHour: p.count }],
    notes: ["Outbound bandwidth"],
    armParams: (p: z.infer<typeof fixtureSchema>, ctx) => ({ sku: p.sku, count: p.count, contactEmail: ctx.owner }),
    vmSizes: () => [],
    timingKey: (p: z.infer<typeof fixtureSchema>) => p.sku,
    rules: (p: z.infer<typeof fixtureSchema>) => (p.sku === "Basic" && p.count > 2 ? ["Basic supports at most 2 instances"] : []),
    stages: (p: z.infer<typeof fixtureSchema>) => [
      { value: 1, label: "Plan" },
      { value: 2, label: "Apps", gate: { kind: "http-ok", label: "Site answers", timeoutMin: 10, blocking: p.strictGate } },
    ],
    alternatives: (p: z.infer<typeof fixtureSchema>) => (p.sku === "Standard" ? [{ params: { sku: "Basic" }, loses: "Scale-out and slots" }] : []),
    paramHooks: [{ fromStage: 2, hook: "vm-password", label: "admin password", validateWith: { adminPassword: "Validation-Placeholder-1!" } }],
    presets: [{ label: "Standard x2", params: { sku: "Standard", count: 2 } }],
  });
}
