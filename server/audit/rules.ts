import type { LabctlConfig } from "../config.ts";
import { expiresAt, getTag, isExcludedResourceGroup, isLabManaged, isPersistent } from "../guard.ts";
import { buildRelations } from "./relations.ts";
import type { GraphResource, GraphResourceGroup } from "../azure/resourceGraph.ts";

export type Severity = "high" | "medium" | "low" | "info";
export type SuggestedAction = "delete" | "park" | "review" | "tag";

export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  action: SuggestedAction;
  resourceId: string;
  name: string;
  type: string;
  resourceGroup: string;
  detail: string;
  /** Actual cost over the last 30 days, attached after evaluation when cost data is available. */
  cost30dUsd?: number;
  /** Another resource the finding relates to (e.g. the APIM an unbound IP appears reserved for). */
  relatedId?: string;
}

export interface AuditInput {
  config: LabctlConfig;
  resources: GraphResource[];
  resourceGroups: GraphResourceGroup[];
  now?: Date;
}

const t = (r: GraphResource) => r.type.toLowerCase();
const prop = <T = unknown>(r: GraphResource, path: string): T | undefined => {
  let cur: unknown = r.properties;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur as T | undefined;
};
const isEmpty = (v: unknown) => v === undefined || v === null || (Array.isArray(v) && v.length === 0);

function finding(
  r: GraphResource,
  ruleId: string,
  severity: Severity,
  action: SuggestedAction,
  title: string,
  detail: string,
): Finding {
  return { ruleId, severity, action, title, detail, resourceId: r.id, name: r.name, type: r.type, resourceGroup: r.resourceGroup };
}

/** Some resource types (e.g. Azure Firewall) keep their SKU under properties.sku instead of the top-level sku. */
function skuOf(r: GraphResource): { name?: string; tier?: string } {
  return r.sku ?? (r.properties?.sku as { name?: string; tier?: string } | undefined) ?? {};
}

const COSTLY_ALWAYS_ON = new Set([
  "microsoft.network/azurefirewalls",
  "microsoft.apimanagement/service",
  "microsoft.network/virtualnetworkgateways",
  "microsoft.network/bastionhosts",
  "microsoft.network/applicationgateways",
  "microsoft.network/frontdoors",
  "microsoft.cdn/profiles",
  "microsoft.network/expressroutegateways",
  "microsoft.network/vpngateways",
]);

export function evaluateRules({ config, resources: rawResources, resourceGroups, now = new Date() }: AuditInput): Finding[] {
  // Resource Graph lowercases resourceGroup on resources; restore the real casing from the groups list.
  const rgByName = new Map(resourceGroups.map((g) => [g.name.toLowerCase(), g]));
  const resources = rawResources.map((r) => ({ ...r, resourceGroup: rgByName.get(r.resourceGroup.toLowerCase())?.name ?? r.resourceGroup }));
  const inScope = resources.filter((r) => !isExcludedResourceGroup(config, r.resourceGroup));
  const findings: Finding[] = [];

  // Built over every resource (including excluded groups) so cross-group consumers still count.
  const relations = buildRelations(resources);
  const byId = new Map(resources.map((r) => [r.id.toLowerCase(), r]));
  const inUse = (r: GraphResource) => (relations.usedBy.get(r.id.toLowerCase())?.length ?? 0) > 0;

  const labExpiry = (r: GraphResource) => expiresAt(r.tags) ?? expiresAt(rgByName.get(r.resourceGroup.toLowerCase())?.tags);
  const persistent = (r: GraphResource) => isPersistent(r.tags) || isPersistent(rgByName.get(r.resourceGroup.toLowerCase())?.tags);

  for (const r of inScope) {
    switch (t(r)) {
      case "microsoft.compute/disks":
        if (String(prop(r, "diskState") ?? "").toLowerCase() === "unattached") {
          findings.push(finding(r, "unattached-disk", "medium", "delete", "Unattached managed disk", `${prop(r, "diskSizeGB") ?? "?"} GB, not attached to any VM`));
        }
        break;

      case "microsoft.network/publicipaddresses": {
        if (!isEmpty(prop(r, "ipConfiguration")) || !isEmpty(prop(r, "natGateway")) || inUse(r)) break;
        const sku = `${skuOf(r).name ?? "Unknown"} ${String(prop(r, "publicIPAllocationMethod") ?? "").toLowerCase()}`.trim();
        const address = String(prop(r, "ipAddress") ?? "no address");
        const ownerId = relations.likelyFor.get(r.id.toLowerCase());
        const owner = ownerId ? byId.get(ownerId) : undefined;
        if (owner) {
          // PaaS consumers (APIM, App Gateway, Firewall…) reference their IP one way, so an IP created for one
          // shows no ipConfiguration even while it is earmarked. Treat it as reserved, never as a bulk orphan.
          const label = (prop<{ domainNameLabel?: string }>(r, "dnsSettings")?.domainNameLabel ?? "").trim();
          const vnet = String(prop(owner, "virtualNetworkType") ?? "");
          const ownerNote = t(owner) === "microsoft.apimanagement/service" && vnet.toLowerCase() === "none" ? `; ${owner.name} is not VNet-injected and uses a platform-managed IP` : "";
          findings.push({
            ...finding(r, "reserved-public-ip", "low", "review", `Unbound — reserved for ${owner.name}?`, `${sku}, ${address}${label ? `, DNS label "${label}"` : ""}. Not bound to ${owner.name}${ownerNote}. Keep if you will bind it; otherwise delete.`),
            relatedId: owner.id,
          });
        } else {
          findings.push(finding(r, "unattached-public-ip", "medium", "delete", "Unattached public IP", `${sku}, ${address}, not bound to or referenced by anything`));
        }
        break;
      }

      case "microsoft.network/networkinterfaces":
        if (isEmpty(prop(r, "virtualMachine")) && isEmpty(prop(r, "privateEndpoint")) && isEmpty(prop(r, "privateLinkService")) && isEmpty(prop(r, "hostedWorkloads")) && !inUse(r)) {
          findings.push(finding(r, "orphan-nic", "low", "delete", "Orphaned network interface", "Not attached to a VM, private endpoint or private link service"));
        }
        break;

      case "microsoft.network/networksecuritygroups":
        if (isEmpty(prop(r, "subnets")) && isEmpty(prop(r, "networkInterfaces")) && !inUse(r)) {
          findings.push(finding(r, "unassociated-nsg", "low", "delete", "Unassociated NSG", "Not associated with any subnet or NIC"));
        }
        break;

      case "microsoft.network/routetables":
        if (isEmpty(prop(r, "subnets")) && !inUse(r)) {
          findings.push(finding(r, "unassociated-route-table", "low", "delete", "Unassociated route table", "Not associated with any subnet"));
        }
        break;

      case "microsoft.network/natgateways":
        if (isEmpty(prop(r, "subnets"))) {
          findings.push(finding(r, "idle-nat-gateway", "medium", "delete", "NAT gateway with no subnets", "Billed hourly while attached to nothing"));
        }
        break;

      case "microsoft.web/serverfarms": {
        const sites = Number(prop(r, "numberOfSites") ?? 0);
        if (sites === 0) {
          const free = ["y1", "f1", "d1"].includes(String(r.sku?.name ?? "").toLowerCase()) || String(r.sku?.tier ?? "").toLowerCase() === "dynamic";
          findings.push(finding(r, "empty-app-service-plan", free ? "low" : "medium", "delete", "App Service plan with no apps", `${r.sku?.name ?? "?"} plan hosting 0 apps${free ? " (no-cost SKU)" : ""}`));
        }
        break;
      }

      case "microsoft.network/privatednszones":
        if (Number(prop(r, "numberOfVirtualNetworkLinks") ?? 0) === 0) {
          findings.push(finding(r, "unlinked-private-dns-zone", "low", "delete", "Private DNS zone with no VNet links", "Not resolvable from any VNet"));
        }
        break;

      case "microsoft.network/loadbalancers": {
        const pools = prop<Record<string, unknown>[]>(r, "backendAddressPools") ?? [];
        const anyBackend = pools.some((p) => {
          const pp = (p.properties ?? {}) as Record<string, unknown>;
          return !isEmpty(pp.backendIPConfigurations) || !isEmpty(pp.loadBalancerBackendAddresses);
        });
        if (!anyBackend) {
          findings.push(finding(r, "lb-no-backends", "medium", "delete", "Load balancer with no backends", `${r.sku?.name ?? "?"} SKU with empty backend pools`));
        }
        break;
      }

      case "microsoft.compute/virtualmachines": {
        const code = String(prop(r, "extended.instanceView.powerState.code") ?? "").toLowerCase();
        if (code === "powerstate/stopped") {
          findings.push(finding(r, "vm-stopped-not-deallocated", "high", "park", "VM stopped but still billed", "Stopped from inside the OS; compute is billed until deallocated"));
        }
        break;
      }

      case "microsoft.compute/snapshots": {
        const created = new Date(String(prop(r, "timeCreated") ?? ""));
        const ageDays = (now.getTime() - created.getTime()) / 86_400_000;
        if (Number.isFinite(ageDays) && ageDays > 90) {
          findings.push(finding(r, "old-snapshot", "low", "delete", "Snapshot older than 90 days", `${Math.floor(ageDays)} days old, ${prop(r, "diskSizeGB") ?? "?"} GB`));
        }
        break;
      }
    }

    if (t(r) === "microsoft.network/applicationgateways") {
      const pools = prop<Record<string, unknown>[]>(r, "backendAddressPools") ?? [];
      const anyBackend = pools.some((p) => {
        const pp = (p.properties ?? {}) as Record<string, unknown>;
        return !isEmpty(pp.backendAddresses) || !isEmpty(pp.backendIPConfigurations);
      });
      if (!anyBackend) {
        findings.push(finding(r, "appgw-no-backends", "medium", "review", "Application Gateway with no backends", "All backend pools are empty"));
      }
    }

    if (COSTLY_ALWAYS_ON.has(t(r))) {
      const apimConsumption = t(r) === "microsoft.apimanagement/service" && String(skuOf(r).name ?? "").toLowerCase() === "consumption";
      const appGwStopped = t(r) === "microsoft.network/applicationgateways" && String(prop(r, "operationalState") ?? "").toLowerCase() === "stopped";
      if (!apimConsumption && !appGwStopped && !labExpiry(r) && !persistent(r)) {
        const sku = [skuOf(r).name, skuOf(r).tier].filter(Boolean).join(" / ") || "unknown SKU";
        const parkable = ["microsoft.network/azurefirewalls", "microsoft.network/applicationgateways"].includes(t(r));
        findings.push(finding(r, "always-on-costly", "high", parkable ? "park" : "review", "Costly resource running with no expiry", `${sku}; billed every hour with no expiresOn tag on it or its resource group`));
      }
    }
  }

  // Resource-group level rules.
  const rgsWithResources = new Set(resources.map((r) => r.resourceGroup.toLowerCase()));
  for (const g of resourceGroups) {
    if (isExcludedResourceGroup(config, g.name)) continue;
    const rgFinding = (ruleId: string, severity: Severity, action: SuggestedAction, title: string, detail: string): Finding => ({
      ruleId, severity, action, title, detail, resourceId: g.id, name: g.name, type: "Microsoft.Resources/resourceGroups", resourceGroup: g.name,
    });
    if (!rgsWithResources.has(g.name.toLowerCase()) && !isPersistent(g.tags)) {
      findings.push(rgFinding("empty-resource-group", "info", "delete", "Empty resource group", "Contains no resources"));
    }
    if (isLabManaged(g.tags)) {
      const exp = expiresAt(g.tags);
      if (!exp) {
        findings.push(rgFinding("lab-missing-expiry", "medium", "tag", "Lab without a valid expiry", `expiresOn tag is ${getTag(g.tags, "expiresOn") ? "invalid" : "missing"}`));
      } else if (exp.getTime() <= now.getTime()) {
        findings.push(rgFinding("expired-lab", "high", "delete", "Lab past its expiry", `Expired ${exp.toISOString()}`));
      }
    }
  }

  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  // "Keep" (lifecycle=persistent) on a resource is an explicit decision: stop flagging it.
  const kept = new Set(resources.filter((r) => isPersistent(r.tags)).map((r) => r.id.toLowerCase()));
  return findings
    .filter((f) => !kept.has(f.resourceId.toLowerCase()))
    .sort((a, b) => order[a.severity] - order[b.severity] || a.resourceGroup.localeCompare(b.resourceGroup) || a.name.localeCompare(b.name));
}
