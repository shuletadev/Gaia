import type { GraphResource } from "../azure/resourceGraph.ts";

export type LinkVia = "id" | "ip" | "fqdn";

export interface Link {
  id: string;
  via: LinkVia;
}

export interface Relations {
  /** Lowercased resource ID -> resources it depends on. */
  uses: Map<string, Link[]>;
  /** Lowercased resource ID -> resources that depend on it. */
  usedBy: Map<string, Link[]>;
  /** Lowercased resource ID of an unbound resource -> the resource it appears to be reserved for (name/DNS affinity). */
  likelyFor: Map<string, string>;
}

const ARM_ID = /^\/subscriptions\/[^/]+\/resourcegroups\/[^/]+\/providers\/[^/]+\/[^/]+\/[^/]+/i;

/** Truncates a child resource ID (e.g. .../azureFirewalls/HubFW/azureFirewallIpConfigurations/x) to its top-level resource. */
export function topLevelId(id: string): string | undefined {
  const m = ARM_ID.exec(id);
  return m ? m[0].toLowerCase() : undefined;
}

/**
 * Properties that point *back* at whoever consumes the resource. A public IP's `ipConfiguration` names the
 * firewall/NIC/gateway using it, an NSG's `subnets` lists the VNets applying it, and so on. References under
 * these keys produce "used by" links; every other reference means "uses".
 */
const BACK_REFERENCE_KEYS: Record<string, Set<string>> = {
  "microsoft.network/publicipaddresses": new Set(["ipconfiguration", "natgateway", "linkedpublicipaddress", "servicepublicipaddress"]),
  "microsoft.network/networkinterfaces": new Set(["virtualmachine", "privateendpoint", "privatelinkservice", "hostedworkloads", "dscpconfiguration"]),
  "microsoft.network/networksecuritygroups": new Set(["subnets", "networkinterfaces", "flowlogs"]),
  "microsoft.network/routetables": new Set(["subnets"]),
  "microsoft.network/natgateways": new Set(["subnets"]),
  "microsoft.network/virtualnetworks": new Set(["ipconfigurations", "privateendpoints", "serviceassociationlinks", "resourcenavigationlinks", "applicationgatewayipconfigurations", "ipconfigurationprofiles"]),
  "microsoft.network/applicationsecuritygroups": new Set(["ipconfigurations"]),
  "microsoft.network/ddosprotectionplans": new Set(["virtualnetworks", "publicipaddresses"]),
  "microsoft.network/firewallpolicies": new Set(["firewalls", "childpolicies"]),
  "microsoft.network/applicationgatewaywebapplicationfirewallpolicies": new Set(["applicationgateways", "httplisteners", "pathbasedrules"]),
  "microsoft.network/serviceendpointpolicies": new Set(["subnets"]),
};

const GENERIC_KEYS = new Set(["id", "properties", "value", "values"]);

interface StringHit {
  value: string;
  key: string;
}

/** Collects every string in a property bag together with the nearest meaningful property name above it. */
function strings(node: unknown, key = "", out: StringHit[] = []): StringHit[] {
  if (typeof node === "string") out.push({ value: node, key });
  else if (Array.isArray(node)) for (const v of node) strings(v, key, out);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) strings(v, GENERIC_KEYS.has(k.toLowerCase()) ? key : k.toLowerCase(), out);
  }
  return out;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}(\/32)?$/;

/** Consumers that bind a dedicated public IP in their own configuration (one-way reference). */
const IP_CONSUMERS = new Set([
  "microsoft.apimanagement/service",
  "microsoft.network/applicationgateways",
  "microsoft.network/azurefirewalls",
  "microsoft.network/bastionhosts",
  "microsoft.network/virtualnetworkgateways",
  "microsoft.network/loadbalancers",
  "microsoft.network/natgateways",
  "microsoft.network/networkinterfaces",
  "microsoft.compute/virtualmachines",
]);

const IP_NAME_NOISE = /[-_.]?(public)?[-_.]?(m)?(ip|pip|ipaddress|publicip|vip)[-_.]?\d*$/i;

/** "NorthwindIP" -> "northwind", "agw-pip-01" -> "agw", "fw-mip" -> "fw". */
export function baseNameOfIp(name: string): string {
  return name.replace(IP_NAME_NOISE, "").replace(/[-_.]+$/, "").toLowerCase();
}

export function buildRelations(resources: GraphResource[]): Relations {
  const ids = new Set(resources.map((r) => r.id.toLowerCase()));
  const uses = new Map<string, Link[]>();
  const usedBy = new Map<string, Link[]>();
  const seen = new Set<string>();

  const add = (consumer: string, provider: string, via: LinkVia) => {
    if (consumer === provider || !ids.has(consumer) || !ids.has(provider)) return;
    const k = `${consumer}>${provider}`;
    if (seen.has(k)) {
      // A direct ID reference is stronger evidence than an address or hostname match.
      if (via === "id") {
        for (const l of uses.get(consumer) ?? []) if (l.id === provider) l.via = "id";
        for (const l of usedBy.get(provider) ?? []) if (l.id === consumer) l.via = "id";
      }
      return;
    }
    seen.add(k);
    uses.set(consumer, [...(uses.get(consumer) ?? []), { id: provider, via }]);
    usedBy.set(provider, [...(usedBy.get(provider) ?? []), { id: consumer, via }]);
  };

  const ipOwners = new Map<string, string>();
  const fqdnOwners = new Map<string, string>();
  const hostOf = (v: unknown) => (typeof v === "string" ? v.replace(/^https?:\/\//i, "").split(/[/:]/)[0]!.toLowerCase() : "");
  for (const r of resources) {
    const type = r.type.toLowerCase();
    if (type === "microsoft.network/publicipaddresses") {
      const ip = r.properties?.ipAddress;
      const fqdn = (r.properties?.dnsSettings as { fqdn?: string } | undefined)?.fqdn;
      if (typeof ip === "string" && ip) ipOwners.set(ip, r.id.toLowerCase());
      if (typeof fqdn === "string" && fqdn) fqdnOwners.set(fqdn.toLowerCase(), r.id.toLowerCase());
    } else if (type === "microsoft.apimanagement/service") {
      // Gateways are addressed by hostname (App Gateway / Front Door backends), not by resource ID.
      const hosts = [hostOf(r.properties?.gatewayUrl), ...((r.properties?.hostnameConfigurations as { hostName?: string; type?: string }[] | undefined) ?? []).filter((h) => (h.type ?? "Proxy") === "Proxy").map((h) => hostOf(h.hostName))];
      for (const h of hosts.filter(Boolean)) fqdnOwners.set(h, r.id.toLowerCase());
    } else if (type === "microsoft.web/sites") {
      for (const h of [r.properties?.defaultHostName, ...((r.properties?.hostNames as string[] | undefined) ?? [])].map(hostOf).filter(Boolean)) fqdnOwners.set(h, r.id.toLowerCase());
    }
  }

  // Private IPs owned by firewalls, load balancers, NICs, gateways… so UDR next hops resolve to their target.
  // Private ranges repeat across VNets, so only addresses with exactly one owner are used.
  const privateOwners = new Map<string, Set<string>>();
  for (const r of resources) {
    for (const hit of strings(r.properties ?? {})) {
      if ((hit.key === "privateipaddress" || hit.key === "privateipaddresses") && IPV4.test(hit.value)) {
        const set = privateOwners.get(hit.value) ?? new Set<string>();
        set.add(r.id.toLowerCase());
        privateOwners.set(hit.value, set);
      }
    }
  }
  const privateOwner = (ip: string) => {
    const set = privateOwners.get(ip);
    return set && set.size === 1 ? [...set][0] : undefined;
  };

  for (const r of resources) {
    const self = r.id.toLowerCase();
    const back = BACK_REFERENCE_KEYS[r.type.toLowerCase()];
    for (const hit of strings(r.properties ?? {})) {
      const target = topLevelId(hit.value);
      if (target) {
        if (back?.has(hit.key)) add(target, self, "id");
        else add(self, target, "id");
        continue;
      }
      const v = hit.value.trim();
      if (IPV4.test(v)) {
        if (hit.key === "privateipaddress" || hit.key === "privateipaddresses") continue;
        const addr = v.replace("/32", "");
        const owner = ipOwners.get(addr) ?? privateOwner(addr);
        if (owner) add(self, owner, "ip");
      } else if (fqdnOwners.size && v.includes(".")) {
        // Whole-hostname matches only, so "mynorthwind.azure-api.net" never matches "northwind.azure-api.net".
        for (const host of v.toLowerCase().match(/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/g) ?? []) {
          const owner = fqdnOwners.get(host);
          if (owner) add(self, owner, "fqdn");
        }
      }
    }
  }

  // Unbound public IPs: infer which consumer they were created for from the name or DNS label.
  const likelyFor = new Map<string, string>();
  const consumers = resources.filter((r) => IP_CONSUMERS.has(r.type.toLowerCase()));
  for (const r of resources) {
    const key = r.id.toLowerCase();
    if (r.type.toLowerCase() !== "microsoft.network/publicipaddresses" || usedBy.has(key)) continue;
    const label = String((r.properties?.dnsSettings as { domainNameLabel?: string } | undefined)?.domainNameLabel ?? "").toLowerCase();
    const base = baseNameOfIp(r.name);
    const candidates = [base, label].filter((c) => c.length >= 3);
    const owner =
      consumers.find((c) => candidates.includes(c.name.toLowerCase()) && c.resourceGroup.toLowerCase() === r.resourceGroup.toLowerCase()) ??
      consumers.find((c) => candidates.includes(c.name.toLowerCase()));
    if (owner) likelyFor.set(key, owner.id.toLowerCase());
  }

  return { uses, usedBy, likelyFor };
}
