import type { ArmClient } from "./arm.ts";

interface GraphResponse<T> {
  totalRecords: number;
  count: number;
  data: T[];
  $skipToken?: string;
}

/** Runs a Resource Graph query scoped to the given subscriptions, following skip tokens. */
export async function queryGraph<T>(arm: ArmClient, subscriptions: string[], query: string): Promise<T[]> {
  const rows: T[] = [];
  let skipToken: string | undefined;
  do {
    const res = await arm.post<GraphResponse<T>>(
      "/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01",
      {
        subscriptions,
        query,
        options: { resultFormat: "objectArray", $top: 1000, ...(skipToken ? { $skipToken: skipToken } : {}) },
      },
    );
    rows.push(...res.data);
    skipToken = res.$skipToken;
  } while (skipToken);
  return rows;
}

export interface GraphResource {
  id: string;
  name: string;
  type: string;
  kind?: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  sku?: { name?: string; tier?: string; capacity?: number } | null;
  tags?: Record<string, string> | null;
  properties: Record<string, unknown>;
}

export interface GraphResourceGroup {
  id: string;
  name: string;
  location: string;
  subscriptionId: string;
  tags?: Record<string, string> | null;
}

export function listResources(arm: ArmClient, subscriptions: string[]) {
  return queryGraph<GraphResource>(
    arm,
    subscriptions,
    "resources | project id, name, type, kind, location, resourceGroup, subscriptionId, sku, tags, properties",
  );
}

export function listResourceGroups(arm: ArmClient, subscriptions: string[]) {
  return queryGraph<GraphResourceGroup>(
    arm,
    subscriptions,
    "resourcecontainers | where type =~ 'microsoft.resources/subscriptions/resourcegroups' | project id, name, location, subscriptionId, tags",
  );
}
