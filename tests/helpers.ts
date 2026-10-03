import type { LabctlConfig } from "../server/config.ts";
import type { GraphResource, GraphResourceGroup } from "../server/azure/resourceGraph.ts";

export const SUB = "11111111-1111-1111-1111-111111111111";
export const OTHER_SUB = "22222222-2222-2222-2222-222222222222";

export const config: LabctlConfig = {
  tenantId: "33333333-3333-3333-3333-333333333333",
  subscriptions: [{ id: SUB, name: "Test sub" }],
  excludedResourceGroups: ["GovernanceRG", "NetworkWatcherRG"],
  budget: { monthlyUsd: 600, alertThresholds: [0.5, 0.8, 1] },
  ttlHours: { default: 8, byBlueprint: { "apim-internal-appgw": 12 } },
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
