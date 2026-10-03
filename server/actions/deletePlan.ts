import type { GraphResource } from "../azure/resourceGraph.ts";
import { buildRelations, topLevelId } from "../audit/relations.ts";

/**
 * Plans a deletion so nothing is held hostage by a prerequisite:
 *  - consumers being deleted too go first (waves, topologically ordered);
 *  - associations Azure refuses to delete through (NSG/route table/NAT gateway on a subnet, public IP or
 *    NSG on a NIC, peerings and private DNS links pointing at a VNet) are detached on the resources that stay;
 *  - real dependents that cannot be detached safely (a NIC or private endpoint in a subnet, a public IP on a
 *    firewall…) block that target up front instead of failing minutes into the delete.
 * Pure: the caller supplies resources and a guard for resources it may modify.
 */

export interface Brief {
  id: string;
  name: string;
  type: string;
}

export type FixAction =
  | { op: "subnet-unset"; subnetId: string; property: "networkSecurityGroup" | "routeTable" | "natGateway" }
  | { op: "nic-unset-nsg"; nicId: string }
  | { op: "nic-unset-pip"; nicId: string; ipConfigId: string }
  | { op: "delete-child"; childId: string; apiVersion: string };

export interface Fix {
  /** The resource being deleted that this change frees. */
  frees: Brief;
  label: string;
  action: FixAction;
}

export interface Blocker {
  /** Target (resource or group) that cannot be deleted while this dependent exists. */
  target: Brief;
  /** The dependent, which the user may add to the selection. */
  consumer: Brief;
  detail: string;
}

export interface PlanStep {
  key: string;
  kind: "fix" | "delete";
  /** For a fix: the resource that is modified (and kept). For a delete: the target. */
  target: Brief;
  label: string;
  fixes: Fix[];
  /** Keys of steps that must finish first. */
  after: string[];
  wave: number;
}

export interface DeletePlan {
  steps: PlanStep[];
  blockers: Blocker[];
  warnings: string[];
}

export interface PlanTarget extends Brief {
  isGroup: boolean;
}

const NET_API = "2024-05-01";
const T = {
  pip: "microsoft.network/publicipaddresses",
  nsg: "microsoft.network/networksecuritygroups",
  rt: "microsoft.network/routetables",
  nat: "microsoft.network/natgateways",
  vnet: "microsoft.network/virtualnetworks",
  nic: "microsoft.network/networkinterfaces",
  dnsLink: "microsoft.network/privatednszones/virtualnetworklinks",
  rulesetLink: "microsoft.network/dnsforwardingrulesets/virtualnetworklinks",
};

/** Providers Azure refuses to delete while something still references them (InUse… errors). */
const REFUSED_WHILE_USED = new Set([
  T.pip,
  T.nsg,
  T.rt,
  T.nat,
  T.vnet,
  T.nic,
  "microsoft.compute/disks",
  "microsoft.network/applicationsecuritygroups",
  "microsoft.network/ddosprotectionplans",
  "microsoft.network/firewallpolicies",
  "microsoft.network/applicationgatewaywebapplicationfirewallpolicies",
  "microsoft.network/loadbalancers",
  "microsoft.network/serviceendpointpolicies",
  "microsoft.network/publicipprefixes",
]);

const SOFT_DELETED: Record<string, string> = {
  "microsoft.apimanagement/service": "API Management is soft-deleted for 48 h and keeps its name reserved (purge it to reuse the name)",
  "microsoft.keyvault/vaults": "Key Vault is soft-deleted and keeps its name reserved for the retention period",
  "microsoft.cognitiveservices/accounts": "Cognitive Services accounts are soft-deleted for 48 h",
};

const lower = (s: string) => s.toLowerCase();
const FRIENDLY: Record<string, string> = {
  "microsoft.network/networkinterfaces": "NIC",
  "microsoft.network/privateendpoints": "private endpoint",
  "microsoft.network/azurefirewalls": "firewall",
  "microsoft.network/applicationgateways": "application gateway",
  "microsoft.network/loadbalancers": "load balancer",
  "microsoft.network/bastionhosts": "Bastion",
  "microsoft.network/virtualnetworkgateways": "VPN/ER gateway",
  "microsoft.network/natgateways": "NAT gateway",
  "microsoft.network/virtualnetworks": "VNet",
  "microsoft.apimanagement/service": "API Management",
  "microsoft.compute/virtualmachines": "VM",
  "microsoft.web/sites": "app",
  "microsoft.web/serverfarms": "App Service plan",
  "microsoft.network/dnsresolvers": "DNS resolver",
};
const shortType = (t: string) => FRIENDLY[lower(t)] ?? t.split("/").pop() ?? t;
const brief = (r: GraphResource): Brief => ({ id: r.id, name: r.name, type: r.type });
const rgKeyOf = (id: string) => {
  const m = /^\/subscriptions\/[^/]+\/resourcegroups\/[^/]+/i.exec(id);
  return m ? lower(m[0]) : "";
};
const idOf = (v: unknown) => (v && typeof v === "object" ? String((v as { id?: unknown }).id ?? "") : "");
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(idOf).filter(Boolean) : []);
const leaf = (id: string) => id.split("/").pop() ?? id;

type Verdict = { kind: "fix"; fixes: Fix[] } | { kind: "block"; detail: string } | { kind: "dangling"; detail: string };

/** How a resource `x` that is going away relates to a consumer `c` that stays. */
export function classify(x: GraphResource, c: GraphResource): Verdict {
  const xt = lower(x.type);
  const ct = lower(c.type);
  const cid = lower(c.id);
  const p = x.properties ?? {};
  const under = (id: string) => lower(id).startsWith(`${cid}/`);

  if (xt === T.pip) {
    const ipConf = idOf(p.ipConfiguration);
    if (ipConf && ct === T.nic && under(ipConf)) {
      return { kind: "fix", fixes: [{ frees: brief(x), label: `remove public IP ${x.name} from ${leaf(ipConf)}`, action: { op: "nic-unset-pip", nicId: c.id, ipConfigId: ipConf } }] };
    }
    return { kind: "block", detail: `${x.name} is attached to ${shortType(c.type)} ${c.name}` };
  }

  if (xt === T.nsg || xt === T.rt || xt === T.nat) {
    const property = xt === T.nsg ? "networkSecurityGroup" : xt === T.rt ? "routeTable" : "natGateway";
    const what = xt === T.nsg ? "NSG" : xt === T.rt ? "route table" : "NAT gateway";
    const fixes: Fix[] = ids(p.subnets)
      .filter(under)
      .map((subnetId) => ({ frees: brief(x), label: `remove ${what} ${x.name} from subnet ${leaf(subnetId)}`, action: { op: "subnet-unset", subnetId, property } }));
    if (xt === T.nsg && ct === T.nic && ids(p.networkInterfaces).some((n) => lower(n) === cid || under(n))) {
      fixes.push({ frees: brief(x), label: `remove NSG ${x.name} from the NIC`, action: { op: "nic-unset-nsg", nicId: c.id } });
    }
    if (fixes.length) return { kind: "fix", fixes };
    if (ct.startsWith("microsoft.network/networkwatchers/flowlogs")) return { kind: "dangling", detail: `flow log ${c.name} targets ${x.name}; it will be left orphaned` };
    return { kind: "block", detail: `${x.name} is used by ${shortType(c.type)} ${c.name}` };
  }

  if (xt === T.vnet) {
    if (ct === T.vnet) {
      const peering = ((c.properties?.virtualNetworkPeerings as { id?: string; name?: string; properties?: { remoteVirtualNetwork?: { id?: string } } }[] | undefined) ?? []).filter(
        (pe) => lower(idOf(pe.properties?.remoteVirtualNetwork)) === lower(x.id),
      );
      if (peering.length) {
        return {
          kind: "fix",
          fixes: peering.map((pe) => ({
            frees: brief(x),
            label: `delete peering ${pe.name ?? leaf(pe.id ?? "")} (points at ${x.name})`,
            action: { op: "delete-child", childId: pe.id ?? `${c.id}/virtualNetworkPeerings/${pe.name}`, apiVersion: NET_API },
          })),
        };
      }
      return { kind: "dangling", detail: `${c.name} references ${x.name}` };
    }
    if (ct === T.dnsLink || ct === T.rulesetLink) {
      return {
        kind: "fix",
        fixes: [{ frees: brief(x), label: `delete DNS link ${c.name} to ${x.name}`, action: { op: "delete-child", childId: c.id, apiVersion: ct === T.dnsLink ? "2020-06-01" : "2022-07-01" } }],
      };
    }
    return { kind: "block", detail: `${shortType(c.type)} ${c.name} is in a subnet of ${x.name}` };
  }

  if (xt === T.nic) {
    if (ct === "microsoft.network/privateendpoints") return { kind: "block", detail: `${x.name} belongs to private endpoint ${c.name} (delete the endpoint instead)` };
    return { kind: "block", detail: `${x.name} is attached to ${shortType(c.type)} ${c.name}` };
  }

  if (REFUSED_WHILE_USED.has(xt)) return { kind: "block", detail: `${x.name} is in use by ${shortType(c.type)} ${c.name}` };
  return { kind: "dangling", detail: `${shortType(c.type)} ${c.name} references ${x.name}; it will keep a broken reference` };
}

export function planDeletion(
  targets: PlanTarget[],
  resources: GraphResource[],
  opts: {
    /** Reason a resource that stays may not be modified (scope, locks); undefined when it may. */
    canTouch?: (id: string) => string | undefined;
  } = {},
): DeletePlan {
  const canTouch = opts.canTouch ?? (() => undefined);
  const byId = new Map(resources.map((r) => [lower(r.id), r]));
  const relations = buildRelations(resources);

  const groupUnits = new Map(targets.filter((t) => t.isGroup).map((t) => [lower(t.id), t]));
  // A resource inside a targeted group is deleted with the group.
  const resourceUnits = new Map(targets.filter((t) => !t.isGroup && !groupUnits.has(rgKeyOf(t.id))).map((t) => [lower(t.id), t]));

  const unitOf = (id: string): string | undefined => {
    const k = lower(id);
    const rg = rgKeyOf(k);
    if (groupUnits.has(rg)) return rg;
    if (resourceUnits.has(k)) return k;
    for (const u of resourceUnits.keys()) if (k.startsWith(`${u}/`)) return u;
    return undefined;
  };

  const blocked = new Map<string, Blocker[]>();
  let fixesByConsumer = new Map<string, { consumer: GraphResource; fixes: Fix[]; frees: Set<string> }>();
  let warnings: string[] = [];

  // Blocking a target shrinks what is deleted, which can turn other references into fixes or blockers.
  for (let round = 0; round < 10; round++) {
    const deleted = (id: string) => {
      const u = unitOf(id);
      return u !== undefined && !blocked.has(u);
    };
    fixesByConsumer = new Map();
    warnings = [];
    const newlyBlocked = new Map<string, Blocker[]>();
    for (const x of resources) {
      const ux = unitOf(x.id);
      if (!ux || blocked.has(ux)) continue;
      for (const link of relations.usedBy.get(lower(x.id)) ?? []) {
        if (link.via !== "id") continue;
        const c = byId.get(link.id);
        if (!c || deleted(c.id)) continue;
        const v = classify(x, c);
        const unit = groupUnits.get(ux) ?? resourceUnits.get(ux)!;
        if (v.kind === "dangling") {
          warnings.push(v.detail);
          continue;
        }
        if (v.kind === "fix") {
          const reason = canTouch(c.id);
          if (reason) {
            newlyBlocked.set(ux, [...(newlyBlocked.get(ux) ?? []), { target: unit, consumer: brief(c), detail: `${v.fixes.map((f) => f.label).join("; ")} — but ${c.name} can't be changed: ${reason}` }]);
            continue;
          }
          const key = lower(c.id);
          const entry = fixesByConsumer.get(key) ?? { consumer: c, fixes: [], frees: new Set<string>() };
          for (const f of v.fixes) if (!entry.fixes.some((e) => JSON.stringify(e.action) === JSON.stringify(f.action))) entry.fixes.push(f);
          entry.frees.add(ux);
          fixesByConsumer.set(key, entry);
          continue;
        }
        newlyBlocked.set(ux, [...(newlyBlocked.get(ux) ?? []), { target: unit, consumer: brief(c), detail: v.detail }]);
      }
    }
    if (!newlyBlocked.size) break;
    for (const [k, v] of newlyBlocked) blocked.set(k, v);
  }

  // ---- Ordering -------------------------------------------------------------------------------
  const live = [...groupUnits.keys(), ...resourceUnits.keys()].filter((u) => !blocked.has(u));
  const nodes = new Map<string, PlanStep>();
  for (const u of live) {
    const t = groupUnits.get(u) ?? resourceUnits.get(u)!;
    const count = t.isGroup ? resources.filter((r) => rgKeyOf(r.id) === u).length : 0;
    nodes.set(`delete:${u}`, { key: `delete:${u}`, kind: "delete", target: { id: t.id, name: t.name, type: t.type }, label: t.isGroup ? `Delete group ${t.name} (${count} resource${count === 1 ? "" : "s"})` : `Delete ${t.name}`, fixes: [], after: [], wave: 0 });
  }
  for (const [k, e] of fixesByConsumer) {
    nodes.set(`fix:${k}`, { key: `fix:${k}`, kind: "fix", target: brief(e.consumer), label: `Detach on ${e.consumer.name}: ${e.fixes.map((f) => f.label).join("; ")}`, fixes: e.fixes, after: [], wave: 0 });
  }
  const edges = new Set<string>();
  const edge = (before: string, after: string) => {
    if (before === after || !nodes.has(before) || !nodes.has(after)) return;
    const k = `${before}>${after}`;
    if (edges.has(k)) return;
    edges.add(k);
    const n = nodes.get(after)!;
    n.after.push(before);
  };
  for (const [k, e] of fixesByConsumer) for (const u of e.frees) edge(`fix:${k}`, `delete:${u}`);
  // A consumer goes before what it uses. VNet↔VNet peering references point both ways and are not
  // deletion prerequisites, so they don't order anything.
  for (const [consumer, links] of relations.uses) {
    const uc = unitOf(consumer);
    if (!uc || blocked.has(uc)) continue;
    const ct = lower(byId.get(consumer)?.type ?? "");
    for (const l of links) {
      if (l.via !== "id") continue;
      const up = unitOf(l.id);
      if (!up || up === uc || blocked.has(up)) continue;
      if (ct === T.vnet && lower(byId.get(l.id)?.type ?? "") === T.vnet) continue;
      edge(`delete:${uc}`, `delete:${up}`);
    }
  }

  // Kahn's algorithm into waves; anything left is a cycle and goes last, together.
  const remaining = new Set(nodes.keys());
  const done = new Set<string>();
  let wave = 0;
  while (remaining.size) {
    const ready = [...remaining].filter((k) => nodes.get(k)!.after.every((a) => done.has(a)));
    if (!ready.length) {
      const names = [...remaining].map((k) => nodes.get(k)!.target.name);
      warnings.push(`Circular references between ${names.join(", ")}; they are deleted together and retried while Azure releases them`);
      for (const k of remaining) {
        const n = nodes.get(k)!;
        n.wave = wave;
        n.after = n.after.filter((a) => done.has(a));
      }
      break;
    }
    for (const k of ready) {
      nodes.get(k)!.wave = wave;
      remaining.delete(k);
    }
    for (const k of ready) done.add(k);
    wave++;
  }

  for (const u of live) {
    const t = groupUnits.get(u) ?? resourceUnits.get(u)!;
    const types = t.isGroup ? resources.filter((r) => rgKeyOf(r.id) === u).map((r) => lower(r.type)) : [lower(t.type)];
    for (const [type, note] of Object.entries(SOFT_DELETED)) if (types.includes(type)) warnings.push(`${t.name}: ${note}`);
  }

  const order = { fix: 0, delete: 1 };
  const steps = [...nodes.values()].sort((a, b) => a.wave - b.wave || order[a.kind] - order[b.kind] || a.target.name.localeCompare(b.target.name));
  return { steps, blockers: [...blocked.values()].flat(), warnings: [...new Set(warnings)] };
}
