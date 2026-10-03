import type { GraphResource } from "./azure/resourceGraph.ts";
import { buildRelations, topLevelId } from "./audit/relations.ts";
import { privateIpCandidates, resolveNextHop } from "./validate.ts";

export interface TopoBadge {
  type: string;
  label: string;
}

export interface TopoSubnet {
  id: string;
  name: string;
  prefix: string;
  badges: TopoBadge[];
}

export interface TopoVnet {
  id: string;
  name: string;
  prefixes: string[];
  subnets: TopoSubnet[];
  external: boolean;
}

export interface TopoNode {
  id: string;
  name: string;
  type: string;
  /** Subnet id (lowercase) the resource is injected into, if any. */
  parent?: string;
  badges: TopoBadge[];
  external: boolean;
  sku?: string;
}

export type EdgeKind = "uses" | "peering" | "dns-link" | "route" | "reserved" | "ip";

export interface TopoEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
}

export interface Topology {
  scope: string;
  vnets: TopoVnet[];
  nodes: TopoNode[];
  edges: TopoEdge[];
}

const T = (r: GraphResource) => r.type.toLowerCase();
const lc = (s: string) => s.toLowerCase();
const p = <V = unknown>(r: GraphResource, path: string): V | undefined =>
  path.split(".").reduce<unknown>((c, k) => (c && typeof c === "object" ? (c as Record<string, unknown>)[k] : undefined), r.properties) as V | undefined;

/** Resources drawn as part of something else rather than as their own box. */
const FOLDED = new Set(["microsoft.network/privatednszones/virtualnetworklinks", "microsoft.network/networkwatchers", "microsoft.insights/autoscalesettings"]);
const SUBNET_REF = /\/subscriptions\/[^/]+\/resourcegroups\/[^/]+\/providers\/microsoft\.network\/virtualnetworks\/[^/]+\/subnets\/[^/"]+/i;

function strings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) node.forEach((v) => strings(v, out));
  else if (node && typeof node === "object") Object.values(node).forEach((v) => strings(v, out));
  return out;
}

function subnetOf(r: GraphResource): string | undefined {
  // A VNet's own subnets and a route table/NSG's subnet lists are associations, not placement.
  if (["microsoft.network/virtualnetworks", "microsoft.network/networksecuritygroups", "microsoft.network/routetables", "microsoft.network/natgateways"].includes(T(r))) return undefined;
  for (const s of strings(r.properties ?? {})) {
    const m = SUBNET_REF.exec(s);
    if (m) return lc(m[0]);
  }
  return undefined;
}

export function buildTopology(scopeRg: string, all: GraphResource[]): Topology {
  const byId = new Map(all.map((r) => [lc(r.id), r]));
  const rel = buildRelations(all);
  const inRg = all.filter((r) => lc(r.resourceGroup) === lc(scopeRg) && !FOLDED.has(T(r)));
  const shown = new Map(inRg.map((r) => [lc(r.id), r]));
  const external = new Set<string>();

  // Pull in one hop of out-of-group resources this group depends on (e.g. a hub VNet in another group).
  for (const r of inRg) {
    for (const l of rel.uses.get(lc(r.id)) ?? []) {
      const t = byId.get(l.id);
      if (t && !shown.has(l.id) && !FOLDED.has(T(t))) {
        shown.set(l.id, t);
        external.add(l.id);
      }
    }
  }

  // ---- Containers: VNets and subnets with their NSG / route table / NAT badges --------------------
  const badgeOwners = new Set<string>();
  const vnets: TopoVnet[] = [];
  for (const v of [...shown.values()].filter((r) => T(r) === "microsoft.network/virtualnetworks")) {
    const subnets = (p<{ id?: string; name: string; properties?: Record<string, unknown> }[]>(v, "subnets") ?? []).map((s) => {
      const props = (s.properties ?? {}) as Record<string, { id?: string } | string | string[] | undefined>;
      const badges: TopoBadge[] = [];
      for (const [key, type] of [["networkSecurityGroup", "Microsoft.Network/networkSecurityGroups"], ["routeTable", "Microsoft.Network/routeTables"], ["natGateway", "Microsoft.Network/natGateways"]] as const) {
        const id = (props[key] as { id?: string } | undefined)?.id;
        if (id) {
          badges.push({ type, label: id.split("/").pop()! });
          badgeOwners.add(lc(id));
        }
      }
      const prefix = (props.addressPrefix as string | undefined) ?? (props.addressPrefixes as string[] | undefined)?.join(", ") ?? "";
      return { id: lc(s.id ?? `${v.id}/subnets/${s.name}`), name: s.name, prefix, badges };
    });
    vnets.push({ id: lc(v.id), name: v.name, prefixes: p<{ addressPrefixes?: string[] }>(v, "addressSpace")?.addressPrefixes ?? [], subnets, external: external.has(lc(v.id)) });
  }
  const subnetIds = new Set(vnets.flatMap((v) => v.subnets.map((s) => s.id)));
  const vnetOfSubnet = (s: string) => s.replace(/\/subnets\/[^/]+$/, "");

  // ---- Folding: NICs into their VM / private endpoint, public IPs onto their single consumer --------
  const foldInto = new Map<string, string>();
  for (const r of shown.values()) {
    if (T(r) === "microsoft.network/networkinterfaces") {
      const owner = p<{ id?: string }>(r, "virtualMachine")?.id ?? p<{ id?: string }>(r, "privateEndpoint")?.id;
      if (owner && shown.has(lc(owner))) foldInto.set(lc(r.id), lc(owner));
    }
  }
  const nodeBadges = new Map<string, TopoBadge[]>();
  for (const r of shown.values()) {
    if (T(r) !== "microsoft.network/publicipaddresses") continue;
    const consumers = (rel.usedBy.get(lc(r.id)) ?? []).filter((l) => l.via === "id").map((l) => foldInto.get(l.id) ?? l.id).filter((id) => shown.has(id));
    const unique = [...new Set(consumers)];
    if (unique.length === 1) {
      foldInto.set(lc(r.id), unique[0]!);
      nodeBadges.set(unique[0]!, [...(nodeBadges.get(unique[0]!) ?? []), { type: r.type, label: String(p(r, "ipAddress") ?? r.name) }]);
    }
  }

  const nodes: TopoNode[] = [];
  for (const r of shown.values()) {
    const id = lc(r.id);
    if (T(r) === "microsoft.network/virtualnetworks" || foldInto.has(id) || badgeOwners.has(id)) continue;
    let parent = subnetOf(r);
    // A VM sits wherever its (folded) NIC sits.
    if (!parent && T(r) === "microsoft.compute/virtualmachines") {
      const nic = [...foldInto].find(([n, owner]) => owner === id && byId.get(n) && T(byId.get(n)!) === "microsoft.network/networkinterfaces");
      if (nic) parent = subnetOf(byId.get(nic[0])!);
    }
    const sku = r.sku?.name ?? (p<{ name?: string }>(r, "sku")?.name);
    nodes.push({ id, name: r.name, type: r.type, parent: parent && subnetIds.has(parent) ? parent : undefined, badges: nodeBadges.get(id) ?? [], external: external.has(id), sku });
  }
  const drawn = new Set([...nodes.map((n) => n.id), ...vnets.map((v) => v.id)]);
  const resolve = (id: string) => foldInto.get(id) ?? id;

  // ---- Edges ---------------------------------------------------------------------------------------
  const edges = new Map<string, TopoEdge>();
  const add = (from: string, to: string, kind: EdgeKind, label?: string) => {
    if (from === to) return;
    const key = kind === "peering" || kind === "dns-link" ? `${kind}:${[from, to].sort().join("|")}` : `${kind}:${from}>${to}`;
    if (!edges.has(key)) edges.set(key, { id: key, from, to, kind, label });
  };

  for (const n of nodes) {
    for (const l of rel.uses.get(n.id) ?? []) {
      const to = resolve(l.id);
      if (!drawn.has(to) || badgeOwners.has(to)) continue;
      // Containment already shows "this sits in that VNet".
      if (n.parent && to === vnetOfSubnet(n.parent)) continue;
      add(n.id, to, l.via === "id" ? "uses" : "ip", l.via === "id" ? undefined : l.via);
    }
  }
  for (const v of vnets) {
    const res = byId.get(v.id)!;
    for (const pe of p<{ properties: { remoteVirtualNetwork?: { id?: string }; peeringState?: string } }[]>(res, "virtualNetworkPeerings") ?? []) {
      const remote = lc(pe.properties.remoteVirtualNetwork?.id ?? "");
      if (drawn.has(remote)) add(v.id, remote, "peering", pe.properties.peeringState === "Connected" ? "peering" : `peering · ${pe.properties.peeringState ?? "?"}`);
    }
  }
  for (const link of all.filter((r) => T(r) === "microsoft.network/privatednszones/virtualnetworklinks")) {
    const zone = topLevelId(link.id);
    const vnet = lc(p<{ id?: string }>(link, "virtualNetwork")?.id ?? "");
    if (zone && drawn.has(zone) && drawn.has(vnet)) add(zone, vnet, "dns-link", "link");
  }
  // Route tables are badges on subnets; draw each virtual-appliance route from the subnet to its next hop.
  const candidates = privateIpCandidates(all);
  for (const v of vnets) {
    for (const s of v.subnets) {
      const rtBadge = s.badges.find((b) => b.type === "Microsoft.Network/routeTables");
      if (!rtBadge) continue;
      const rt = [...shown.values()].find((r) => T(r) === "microsoft.network/routetables" && r.name === rtBadge.label);
      for (const route of (rt && p<{ properties: { nextHopType?: string; nextHopIpAddress?: string; addressPrefix?: string } }[]>(rt, "routes")) || []) {
        if (route.properties.nextHopType !== "VirtualAppliance") continue;
        const owner = resolveNextHop(route.properties.nextHopIpAddress ?? "", rt!, all, candidates).owner;
        if (owner && drawn.has(lc(owner.id))) add(s.id, lc(owner.id), "route", route.properties.addressPrefix);
      }
    }
  }
  for (const [ip, owner] of rel.likelyFor) if (drawn.has(ip) && drawn.has(owner)) add(ip, owner, "reserved", "reserved for");

  return { scope: scopeRg, vnets, nodes, edges: [...edges.values()] };
}
