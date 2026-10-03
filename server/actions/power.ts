import type { ArmClient } from "../azure/arm.ts";
import type { GraphResource } from "../azure/resourceGraph.ts";
import { clearParkedState, getParkedState, saveParkedState, type Db } from "../db.ts";
import { parseResourceId } from "../guard.ts";

export type PowerKind = "firewall" | "appgw" | "vm" | "aks";
export type PowerState = "running" | "parked" | "stopped-billing" | "transitioning" | "unknown";

export interface PowerInfo {
  kind: PowerKind;
  state: PowerState;
  canPark: boolean;
  canResume: boolean;
  note?: string;
}

const API = {
  firewall: "2024-05-01",
  appgw: "2024-05-01",
  vm: "2024-07-01",
  aks: "2024-09-01",
} as const;

export const PARKED_TAG = "labctlParked";

const KIND_BY_TYPE: Record<string, PowerKind> = {
  "microsoft.network/azurefirewalls": "firewall",
  "microsoft.network/applicationgateways": "appgw",
  "microsoft.compute/virtualmachines": "vm",
  "microsoft.containerservice/managedclusters": "aks",
};

export function powerKind(type: string): PowerKind | undefined {
  return KIND_BY_TYPE[type.toLowerCase()];
}

const p = (r: Pick<GraphResource, "properties">, path: string): unknown =>
  path.split(".").reduce<unknown>((cur, k) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined), r.properties);

/** Derives park/resume state from Resource Graph properties. Pure, so it is unit-tested. */
export function powerInfo(r: Pick<GraphResource, "type" | "properties" | "tags">, hasParkedSpec: boolean): PowerInfo | undefined {
  const kind = powerKind(r.type);
  if (!kind) return undefined;
  switch (kind) {
    case "firewall": {
      if (p(r, "virtualHub")) return { kind, state: "unknown", canPark: false, canResume: false, note: "Secured virtual hub firewalls are not supported" };
      const ipc = p(r, "ipConfigurations");
      const parked = (!Array.isArray(ipc) || ipc.length === 0) && !p(r, "managementIpConfiguration");
      const tagSpec = Boolean(r.tags && Object.keys(r.tags).some((k) => k.toLowerCase() === PARKED_TAG.toLowerCase()));
      return parked
        ? { kind, state: "parked", canPark: false, canResume: hasParkedSpec || tagSpec, note: hasParkedSpec || tagSpec ? undefined : "Original IP configuration unknown — resume from the portal" }
        : { kind, state: "running", canPark: true, canResume: false };
    }
    case "appgw": {
      const s = String(p(r, "operationalState") ?? "").toLowerCase();
      if (s === "running") return { kind, state: "running", canPark: true, canResume: false };
      if (s === "stopped") return { kind, state: "parked", canPark: false, canResume: true };
      return { kind, state: s ? "transitioning" : "unknown", canPark: false, canResume: false };
    }
    case "vm": {
      const s = String(p(r, "extended.instanceView.powerState.code") ?? "").toLowerCase();
      if (s === "powerstate/running") return { kind, state: "running", canPark: true, canResume: false };
      if (s === "powerstate/deallocated") return { kind, state: "parked", canPark: false, canResume: true };
      if (s === "powerstate/stopped") return { kind, state: "stopped-billing", canPark: true, canResume: true };
      return { kind, state: s ? "transitioning" : "unknown", canPark: false, canResume: false };
    }
    case "aks": {
      const s = String(p(r, "powerState.code") ?? "").toLowerCase();
      if (s === "running") return { kind, state: "running", canPark: true, canResume: false };
      if (s === "stopped") return { kind, state: "parked", canPark: false, canResume: true };
      return { kind, state: "unknown", canPark: false, canResume: false };
    }
  }
}

// ---- Azure Firewall deallocate / allocate -------------------------------------------------------

export interface FirewallIpSpec {
  name: string;
  subnetId: string;
  publicIpId: string;
}

export interface FirewallParkSpec {
  ipConfigurations: FirewallIpSpec[];
  management: FirewallIpSpec | null;
}

type IpConfig = { name: string; properties: { subnet?: { id: string }; publicIPAddress?: { id: string } } };

function toSpec(c: IpConfig): FirewallIpSpec {
  return { name: c.name, subnetId: c.properties.subnet?.id ?? "", publicIpId: c.properties.publicIPAddress?.id ?? "" };
}

export function firewallSpecFrom(properties: Record<string, unknown>): FirewallParkSpec {
  const ipc = (properties.ipConfigurations as IpConfig[] | undefined) ?? [];
  const mgmt = properties.managementIpConfiguration as IpConfig | undefined;
  return { ipConfigurations: ipc.map(toSpec), management: mgmt ? toSpec(mgmt) : null };
}

/**
 * Compact tag form (fits the 256-char tag limit) so a parked firewall can be resumed even if the local
 * database is lost. Only possible when the VNet and public IPs live in the firewall's resource group.
 */
export function encodeParkTag(firewallId: string, spec: FirewallParkSpec): string | undefined {
  const rgPrefix = firewallId.toLowerCase().split("/providers/")[0] + "/providers/";
  const rel = (s: FirewallIpSpec): [string, string, string] | undefined => {
    const subnet = /\/virtualnetworks\/([^/]+)\/subnets\/([^/]+)$/i.exec(s.subnetId);
    const pip = /\/publicipaddresses\/([^/]+)$/i.exec(s.publicIpId);
    if (!subnet || !pip || !s.subnetId.toLowerCase().startsWith(rgPrefix) || !s.publicIpId.toLowerCase().startsWith(rgPrefix)) return undefined;
    return [s.name, `${subnet[1]}/${subnet[2]}`, pip[1]!];
  };
  const i = spec.ipConfigurations.map(rel);
  const m = spec.management ? rel(spec.management) : null;
  if (i.some((x) => !x) || m === undefined) return undefined;
  const value = JSON.stringify({ i, m });
  return value.length <= 256 ? value : undefined;
}

export function decodeParkTag(firewallId: string, value: string): FirewallParkSpec | undefined {
  try {
    const { i, m } = JSON.parse(value) as { i: [string, string, string][]; m: [string, string, string] | null };
    const rgBase = firewallId.split("/providers/")[0];
    const abs = ([name, vnetSubnet, pip]: [string, string, string]): FirewallIpSpec => {
      const [vnet, subnet] = vnetSubnet.split("/");
      return {
        name,
        subnetId: `${rgBase}/providers/Microsoft.Network/virtualNetworks/${vnet}/subnets/${subnet}`,
        publicIpId: `${rgBase}/providers/Microsoft.Network/publicIPAddresses/${pip}`,
      };
    };
    return { ipConfigurations: i.map(abs), management: m ? abs(m) : null };
  } catch {
    return undefined;
  }
}

const toIpConfig = (s: FirewallIpSpec) => ({
  name: s.name,
  properties: { subnet: { id: s.subnetId }, ...(s.publicIpId ? { publicIPAddress: { id: s.publicIpId } } : {}) },
});

type ArmResource = { id: string; name: string; location: string; tags?: Record<string, string>; properties: Record<string, unknown>; [k: string]: unknown };

async function parkFirewall(arm: ArmClient, db: Db, id: string) {
  const url = `${id}?api-version=${API.firewall}`;
  const fw = await arm.get<ArmResource>(url);
  const spec = firewallSpecFrom(fw.properties);
  if (spec.ipConfigurations.length === 0) throw new Error("Firewall is already deallocated");
  saveParkedState(db, id, spec);
  const tag = encodeParkTag(id, spec);
  const body: ArmResource = {
    ...fw,
    tags: { ...(fw.tags ?? {}), ...(tag ? { [PARKED_TAG]: tag } : {}) },
    properties: { ...fw.properties, ipConfigurations: [] },
  };
  delete body.properties.managementIpConfiguration;
  await arm.lro("PUT", url, body);
  return `Deallocated; ${spec.ipConfigurations.length + (spec.management ? 1 : 0)} IP configuration(s) saved for resume`;
}

async function resumeFirewall(arm: ArmClient, db: Db, id: string) {
  const url = `${id}?api-version=${API.firewall}`;
  const fw = await arm.get<ArmResource>(url);
  const tagKey = Object.keys(fw.tags ?? {}).find((k) => k.toLowerCase() === PARKED_TAG.toLowerCase());
  const spec = getParkedState<FirewallParkSpec>(db, id) ?? (tagKey ? decodeParkTag(id, fw.tags![tagKey]!) : undefined);
  if (!spec) throw new Error("No saved IP configuration for this firewall; allocate it from the portal");
  const tags = { ...(fw.tags ?? {}) };
  if (tagKey) delete tags[tagKey];
  const body: ArmResource = {
    ...fw,
    tags,
    properties: {
      ...fw.properties,
      ipConfigurations: spec.ipConfigurations.map(toIpConfig),
      ...(spec.management ? { managementIpConfiguration: toIpConfig(spec.management) } : {}),
    },
  };
  await arm.lro("PUT", url, body);
  clearParkedState(db, id);
  return "Allocated and running";
}

export async function park(arm: ArmClient, db: Db, resource: { id: string; type: string }): Promise<string> {
  const kind = powerKind(resource.type);
  parseResourceId(resource.id);
  switch (kind) {
    case "firewall":
      return parkFirewall(arm, db, resource.id);
    case "appgw":
      await arm.lro("POST", `${resource.id}/stop?api-version=${API.appgw}`);
      return "Stopped";
    case "vm":
      await arm.lro("POST", `${resource.id}/deallocate?api-version=${API.vm}`);
      return "Deallocated";
    case "aks":
      await arm.lro("POST", `${resource.id}/stop?api-version=${API.aks}`);
      return "Stopped";
    default:
      throw new Error(`${resource.type} cannot be parked`);
  }
}

export async function resume(arm: ArmClient, db: Db, resource: { id: string; type: string }): Promise<string> {
  const kind = powerKind(resource.type);
  parseResourceId(resource.id);
  switch (kind) {
    case "firewall":
      return resumeFirewall(arm, db, resource.id);
    case "appgw":
      await arm.lro("POST", `${resource.id}/start?api-version=${API.appgw}`);
      return "Started";
    case "vm":
      await arm.lro("POST", `${resource.id}/start?api-version=${API.vm}`);
      return "Started";
    case "aks":
      await arm.lro("POST", `${resource.id}/start?api-version=${API.aks}`);
      return "Started";
    default:
      throw new Error(`${resource.type} cannot be resumed`);
  }
}
