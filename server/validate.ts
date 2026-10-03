import type { ArmClient } from "./azure/arm.ts";
import type { GraphResource } from "./azure/resourceGraph.ts";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  target?: { id: string; name: string; type: string };
  ms?: number;
}

export interface ValidateReport {
  scope: string;
  ranAt: string;
  durationMs: number;
  checks: CheckResult[];
  summary: Record<CheckStatus, number>;
}

/** Side effects are injected so the checks can be unit-tested with fakes. */
export interface Probes {
  arm: Pick<ArmClient, "get" | "lro">;
  http: (url: string) => Promise<{ status: number; ms: number; error?: string }>;
  dns: (host: string) => Promise<string[]>;
  /** HTTPS with an optional client certificate and private CA; returns the body for header checks. */
  tls?: (url: string, o: { cert?: string; key?: string; ca?: string }) => Promise<{ status: number; ms: number; error?: string; body?: string }>;
}

const T = (r: GraphResource) => r.type.toLowerCase();
const p = <V = unknown>(r: GraphResource, path: string): V | undefined =>
  path.split(".").reduce<unknown>((c, k) => (c && typeof c === "object" ? (c as Record<string, unknown>)[k] : undefined), r.properties) as V | undefined;
const target = (r: GraphResource) => ({ id: r.id, name: r.name, type: r.type });
const result = (r: GraphResource | undefined, id: string, title: string, status: CheckStatus, detail: string): CheckResult => ({ id, title, status, detail, target: r ? target(r) : undefined });

export interface PublicIpOwner {
  /** The public IP resource, or the PaaS service presenting the address. */
  label: string;
  /** The resource actually using it (e.g. the firewall a public IP is attached to). */
  consumer?: GraphResource;
  /** The consumer's private IP — the correct next hop. */
  privateIp?: string;
}

/** Public address -> what it belongs to, so a UDR pointing at one can be explained. */
export function publicIpOwners(resources: GraphResource[]): Map<string, PublicIpOwner> {
  const map = new Map<string, PublicIpOwner>();
  const fwByPip = new Map<string, GraphResource>();
  for (const r of resources) {
    if (T(r) !== "microsoft.network/azurefirewalls") continue;
    for (const c of p<{ properties?: { publicIPAddress?: { id?: string } } }[]>(r, "ipConfigurations") ?? []) {
      const id = c.properties?.publicIPAddress?.id;
      if (id) fwByPip.set(id.toLowerCase(), r);
    }
  }
  for (const r of resources) {
    if (T(r) === "microsoft.network/publicipaddresses") {
      const ip = p<string>(r, "ipAddress");
      if (!ip) continue;
      const fw = fwByPip.get(r.id.toLowerCase());
      const priv = fw ? p<{ properties?: { privateIPAddress?: string } }[]>(fw, "ipConfigurations")?.[0]?.properties?.privateIPAddress : undefined;
      map.set(ip, { label: fw ? `${r.name}, ${fw.name}'s public IP` : r.name, consumer: fw, privateIp: priv });
    } else if (T(r) === "microsoft.apimanagement/service") {
      for (const ip of p<string[]>(r, "publicIPAddresses") ?? []) map.set(ip, { label: `${r.name}'s gateway address`, consumer: r, privateIp: p<string[]>(r, "privateIPAddresses")?.[0] });
    }
  }
  return map;
}

const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip);

/** Private IP -> every resource that owns it (private ranges legitimately overlap across VNets). */
export function privateIpCandidates(resources: GraphResource[]): Map<string, GraphResource[]> {
  const owners = new Map<string, GraphResource[]>();
  const walk = (node: unknown, r: GraphResource, key = "") => {
    if (typeof node === "string") {
      if ((key === "privateipaddress" || key === "privateipaddresses") && /^\d+\.\d+\.\d+\.\d+$/.test(node)) {
        const list = owners.get(node) ?? [];
        if (!list.some((x) => x.id === r.id)) owners.set(node, [...list, r]);
      }
    } else if (Array.isArray(node)) node.forEach((v) => walk(v, r, key));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, r, ["properties", "id"].includes(k.toLowerCase()) ? key : k.toLowerCase());
  };
  for (const r of resources) walk(r.properties, r);
  return owners;
}

/** Private IP -> owning resource, only where exactly one resource owns the address. */
export function privateIpOwners(resources: GraphResource[]): Map<string, GraphResource> {
  return new Map([...privateIpCandidates(resources)].filter(([, rs]) => rs.length === 1).map(([ip, rs]) => [ip, rs[0]!]));
}

const SUBNET_IN = /\/subscriptions\/[^/]+\/resourcegroups\/[^/]+\/providers\/microsoft\.network\/virtualnetworks\/[^/"]+(?=\/subnets\/)/gi;

/** VNets a resource is attached to, from the subnet IDs in its configuration. */
function vnetsOf(r: GraphResource): Set<string> {
  return new Set((JSON.stringify(r.properties ?? {}).match(SUBNET_IN) ?? []).map((s) => s.toLowerCase()));
}

export interface NextHop {
  owner?: GraphResource;
  ambiguous?: GraphResource[];
}

/**
 * Resolves a UDR next hop the way the data plane would: among resources owning the address, the one in a
 * VNet the route table's subnets belong to (or are peered with). Falls back to the route table's group.
 */
export function resolveNextHop(ip: string, rt: GraphResource, all: GraphResource[], candidates: Map<string, GraphResource[]>): NextHop {
  const c = candidates.get(ip) ?? [];
  if (c.length <= 1) return { owner: c[0] };
  const byId = new Map(all.map((r) => [r.id.toLowerCase(), r]));
  const reach = new Set<string>();
  for (const s of p<{ id?: string }[]>(rt, "subnets") ?? []) {
    const v = s.id?.toLowerCase().replace(/\/subnets\/[^/]+$/, "");
    if (!v) continue;
    reach.add(v);
    for (const pe of p<{ properties?: { remoteVirtualNetwork?: { id?: string } } }[]>(byId.get(v) ?? ({ properties: {} } as GraphResource), "virtualNetworkPeerings") ?? []) {
      const remote = pe.properties?.remoteVirtualNetwork?.id?.toLowerCase();
      if (remote) reach.add(remote);
    }
  }
  const reachable = c.filter((o) => [...vnetsOf(o)].some((v) => reach.has(v)));
  if (reachable.length === 1) return { owner: reachable[0] };
  const sameRg = c.filter((o) => o.resourceGroup.toLowerCase() === rt.resourceGroup.toLowerCase());
  if (sameRg.length === 1) return { owner: sameRg[0] };
  return { ambiguous: reachable.length ? reachable : c };
}

// ---- Per-type checks ---------------------------------------------------------------------------

interface BackendHealth {
  backendAddressPools?: {
    backendAddressPool?: { id?: string };
    backendHttpSettingsCollection?: { backendHttpSettings?: { id?: string }; servers?: { address?: string; health?: string; healthProbeLog?: string }[] }[];
  }[];
}

export function summarizeBackendHealth(h: BackendHealth): { status: CheckStatus; detail: string } {
  const servers = (h.backendAddressPools ?? []).flatMap((pool) =>
    (pool.backendHttpSettingsCollection ?? []).flatMap((s) =>
      (s.servers ?? []).map((sv) => ({ pool: pool.backendAddressPool?.id?.split("/").pop() ?? "?", address: sv.address ?? "?", health: sv.health ?? "Unknown", log: sv.healthProbeLog })),
    ),
  );
  if (!servers.length) return { status: "warn", detail: "No backend servers configured" };
  const bad = servers.filter((s) => s.health !== "Healthy");
  if (!bad.length) return { status: "pass", detail: servers.map((s) => `${s.address} healthy`).join("; ") };
  return { status: "fail", detail: bad.map((s) => `${s.pool}/${s.address}: ${s.health}${s.log ? ` — ${s.log.trim()}` : ""}`).join("; ") };
}

async function checkAppGateway(r: GraphResource, x: Probes): Promise<CheckResult[]> {
  const state = String(p(r, "operationalState") ?? "");
  if (state.toLowerCase() === "stopped") return [result(r, "agw-backend", "Backend health", "skip", "Gateway is stopped (parked)")];
  const out = [result(r, "agw-state", "Operational state", state === "Running" ? "pass" : "warn", state || "unknown")];
  try {
    const h = await x.arm.lro<BackendHealth>("POST", `${r.id}/backendhealth?api-version=2024-05-01`, undefined, { timeoutMs: 3 * 60_000, pollMs: 3000 });
    const s = summarizeBackendHealth(h ?? {});
    out.push(result(r, "agw-backend", "Backend health", s.status, s.detail));
  } catch (e) {
    out.push(result(r, "agw-backend", "Backend health", "fail", (e as Error).message));
  }
  return out;
}

interface NetworkStatus {
  location?: string;
  networkStatus?: { connectivityStatus?: { name: string; status: string; error?: string; isOptional?: boolean; resourceType?: string }[] };
}

export function summarizeApimNetworkStatus(items: NetworkStatus[]): { status: CheckStatus; detail: string } {
  const deps = items.flatMap((i) => i.networkStatus?.connectivityStatus ?? []);
  if (!deps.length) return { status: "skip", detail: "No dependency status reported" };
  const failing = deps.filter((d) => d.status.toLowerCase() === "failure");
  const required = failing.filter((d) => !d.isOptional);
  const pending = deps.filter((d) => d.status.toLowerCase() === "initializing");
  if (required.length) return { status: "fail", detail: required.map((d) => `${d.name}${d.error ? `: ${d.error}` : ""}`).join("; ") };
  if (failing.length) return { status: "warn", detail: `Optional dependencies failing: ${failing.map((d) => d.name).join(", ")}` };
  if (pending.length) return { status: "warn", detail: `${pending.length} dependencies still initializing` };
  return { status: "pass", detail: `${deps.length} dependencies reachable` };
}

async function checkApim(r: GraphResource, x: Probes): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const ps = String(p(r, "provisioningState") ?? "");
  out.push(result(r, "apim-state", "Provisioning", ps === "Succeeded" ? "pass" : ps === "Activating" || ps === "Updating" ? "warn" : "fail", ps || "unknown"));
  const vnet = String(p(r, "virtualNetworkType") ?? "None");
  const gw = String(p(r, "gatewayUrl") ?? "");
  if (vnet === "Internal") {
    out.push(result(r, "apim-gateway", "Gateway probe", "skip", "Internal mode: not reachable from this PC (see App Gateway / end-to-end checks)"));
  } else if (gw) {
    const res = await x.http(`${gw}/status-0123456789abcdef`);
    out.push(result(r, "apim-gateway", "Gateway probe", res.status === 200 ? "pass" : "fail", res.error ?? `HTTP ${res.status} in ${res.ms} ms`));
  }
  if (vnet !== "None") {
    try {
      const ns = await x.arm.get<NetworkStatus[]>(`${r.id}/networkstatus?api-version=2024-05-01`);
      const s = summarizeApimNetworkStatus(Array.isArray(ns) ? ns : []);
      out.push(result(r, "apim-network", "VNet dependencies", s.status, s.detail));
    } catch (e) {
      out.push(result(r, "apim-network", "VNet dependencies", "warn", (e as Error).message));
    }
  }
  return out;
}

function checkFirewall(r: GraphResource): CheckResult[] {
  const ipc = p<{ properties?: { privateIPAddress?: string } }[]>(r, "ipConfigurations") ?? [];
  if (!ipc.length && !p(r, "virtualHub")) return [result(r, "fw-alloc", "Allocation", "warn", "Deallocated (parked) — spokes routed to it have no egress")];
  const out = [result(r, "fw-state", "Provisioning", p(r, "provisioningState") === "Succeeded" ? "pass" : "fail", String(p(r, "provisioningState") ?? "unknown"))];
  const ip = ipc[0]?.properties?.privateIPAddress;
  out.push(result(r, "fw-ip", "Private IP", ip ? "pass" : "fail", ip ?? "none"));
  const policy = p<{ id?: string }>(r, "firewallPolicy")?.id;
  const classic = (p<unknown[]>(r, "networkRuleCollections")?.length ?? 0) + (p<unknown[]>(r, "applicationRuleCollections")?.length ?? 0);
  out.push(result(r, "fw-policy", "Rules", policy || classic ? "pass" : "warn", policy ? `Policy ${policy.split("/").pop()}` : classic ? `${classic} classic rule collections` : "No policy or rules — all traffic denied"));
  return out;
}

export function checkRouteTable(
  r: GraphResource,
  owners: Map<string, GraphResource> | Map<string, GraphResource[]>,
  publicOwners: Map<string, PublicIpOwner> = new Map(),
  all: GraphResource[] = [],
): CheckResult[] {
  // Accept either resolved owners (tests, simple callers) or all candidates (resolved in network context).
  const candidates = new Map<string, GraphResource[]>([...owners].map(([ip, v]) => [ip, Array.isArray(v) ? v : [v]]));
  const out: CheckResult[] = [];
  const subnets = p<unknown[]>(r, "subnets") ?? [];
  out.push(result(r, "rt-assoc", "Association", subnets.length ? "pass" : "warn", subnets.length ? `${subnets.length} subnet(s)` : "Not associated with any subnet — routes have no effect"));
  // A broken route on an unassociated table is latent: worth knowing, not yet an outage.
  const bad: CheckStatus = subnets.length ? "fail" : "warn";
  const latent = subnets.length ? "" : " (latent: table not associated)";
  for (const route of p<{ name: string; properties: { addressPrefix?: string; nextHopType?: string; nextHopIpAddress?: string } }[]>(r, "routes") ?? []) {
    if (route.properties.nextHopType !== "VirtualAppliance") continue;
    const ip = route.properties.nextHopIpAddress ?? "";
    const title = `Next hop ${route.properties.addressPrefix ?? ""}`;
    const id = `rt-hop-${route.name}`;
    if (!isPrivate(ip)) {
      const pub = publicOwners.get(ip);
      const fix = pub?.privateIp ? ` Use ${pub.consumer?.name ?? "its"} private IP ${pub.privateIp}.` : "";
      out.push(result(r, id, title, bad, `${ip} is a public address${pub ? ` (${pub.label})` : ""} — a virtual appliance next hop must be a private IP.${fix}${latent}`));
      continue;
    }
    const hop = resolveNextHop(ip, r, all.length ? all : [r], candidates);
    if (hop.ambiguous) {
      out.push(result(r, id, title, "warn", `${ip} is owned by ${hop.ambiguous.map((o) => `${o.name} (${o.resourceGroup})`).join(", ")} — cannot tell which one this table reaches${latent}`));
      continue;
    }
    const owner = hop.owner;
    const parked = owner && T(owner) === "microsoft.network/azurefirewalls" && !(p<unknown[]>(owner, "ipConfigurations")?.length ?? 0);
    out.push(
      result(
        r,
        id,
        title,
        !owner || parked ? bad : "pass",
        !owner ? `${ip} is not owned by any resource in scope — traffic is black-holed${latent}` : parked ? `${ip} is ${owner.name}, which is parked${latent}` : `${ip} → ${owner.name}`,
      ),
    );
  }
  return out;
}

export function checkVnetPeerings(r: GraphResource, existingIds?: Set<string>): CheckResult[] {
  return (p<{ name: string; properties: { peeringState?: string; peeringSyncLevel?: string; remoteVirtualNetwork?: { id?: string } } }[]>(r, "virtualNetworkPeerings") ?? []).map((pe) => {
    const state = pe.properties.peeringState ?? "Unknown";
    const sync = pe.properties.peeringSyncLevel ?? "";
    const remoteId = pe.properties.remoteVirtualNetwork?.id ?? "";
    const remote = remoteId.split("/").pop() || "?";
    const gone = existingIds && remoteId && remoteId.toLowerCase().includes(r.subscriptionId.toLowerCase()) && !existingIds.has(remoteId.toLowerCase());
    const status: CheckStatus = state !== "Connected" ? "fail" : sync && sync !== "FullyInSync" ? "warn" : "pass";
    const detail = `${state}${sync ? ` · ${sync}` : ""}${gone ? ` — remote VNet ${remote} no longer exists; delete this peering` : ""}`;
    return result(r, `peer-${pe.name}`, `Peering → ${remote}`, status, detail);
  });
}

async function checkPrivateDnsZone(r: GraphResource, all: GraphResource[], x: Probes): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const links = all.filter((l) => T(l) === "microsoft.network/privatednszones/virtualnetworklinks" && l.id.toLowerCase().startsWith(`${r.id.toLowerCase()}/`));
  if (!links.length) out.push(result(r, "dns-links", "VNet links", "warn", "Zone is not linked to any VNet — nothing resolves it"));
  for (const l of links) {
    const st = String(p(l, "virtualNetworkLinkState") ?? p(l, "provisioningState") ?? "");
    out.push(result(r, `dns-link-${l.name}`, `Link ${l.name}`, st === "Completed" || st === "Succeeded" ? "pass" : "warn", `${st || "unknown"} → ${p<{ id?: string }>(l, "virtualNetwork")?.id?.split("/").pop() ?? "?"}`));
  }
  // azure-api.net zones: each A record named after an APIM must point at that APIM's private IP.
  if (r.name.toLowerCase() === "azure-api.net") {
    try {
      const sets = await x.arm.get<{ value: { name: string; properties: { aRecords?: { ipv4Address: string }[] } }[] }>(`${r.id}/A?api-version=2018-09-01`);
      const apims = new Map(all.filter((a) => T(a) === "microsoft.apimanagement/service").map((a) => [a.name.toLowerCase(), a]));
      for (const s of sets.value) {
        const apim = apims.get(s.name.split(".")[0]!.toLowerCase());
        if (!apim) continue;
        const want = p<string[]>(apim, "privateIPAddresses") ?? [];
        const have = (s.properties.aRecords ?? []).map((a) => a.ipv4Address);
        const ok = have.length > 0 && have.every((ip) => want.includes(ip));
        out.push(result(r, `dns-a-${s.name}`, `${s.name}.azure-api.net`, ok ? "pass" : "fail", ok ? `→ ${have.join(", ")}` : `→ ${have.join(", ") || "none"}, APIM private IP is ${want.join(", ") || "none"}`));
      }
    } catch (e) {
      out.push(result(r, "dns-records", "A records", "warn", (e as Error).message));
    }
  }
  return out;
}

async function checkPublicIp(r: GraphResource, x: Probes): Promise<CheckResult[]> {
  const fqdn = p<{ fqdn?: string }>(r, "dnsSettings")?.fqdn;
  const ip = p<string>(r, "ipAddress");
  if (!fqdn || !ip) return [];
  try {
    const got = await x.dns(fqdn);
    return [result(r, "pip-dns", "DNS name", got.includes(ip) ? "pass" : "fail", got.includes(ip) ? `${fqdn} → ${ip}` : `${fqdn} → ${got.join(", ") || "nothing"}, expected ${ip}`)];
  } catch (e) {
    return [result(r, "pip-dns", "DNS name", "fail", `${fqdn}: ${(e as Error).message}`)];
  }
}

/** Pulls URLs out of lab outputs such as "curl http://1.2.3.4/httpbin/get". */
export function probeUrls(outputs: Record<string, unknown>): { key: string; url: string }[] {
  const out: { key: string; url: string }[] = [];
  for (const [key, v] of Object.entries(outputs)) {
    if (typeof v !== "string") continue;
    const m = /(https?:\/\/[^\s"']+)/.exec(v);
    if (m && (/^curl\s/i.test(v) || /request|health|probe/i.test(key))) out.push({ key, url: m[1]! });
  }
  return out;
}

// ---- Runner ------------------------------------------------------------------------------------

export async function validateScope(scope: string, inScope: GraphResource[], subscriptionResources: GraphResource[], x: Probes, outputs: Record<string, unknown> = {}): Promise<ValidateReport> {
  const started = Date.now();
  const owners = privateIpCandidates(subscriptionResources);
  const publicOwners = publicIpOwners(subscriptionResources);
  const existing = new Set(subscriptionResources.map((r) => r.id.toLowerCase()));
  const tasks: Promise<CheckResult[]>[] = [];
  for (const r of inScope) {
    switch (T(r)) {
      case "microsoft.network/applicationgateways":
        tasks.push(checkAppGateway(r, x));
        break;
      case "microsoft.apimanagement/service":
        tasks.push(checkApim(r, x));
        break;
      case "microsoft.network/azurefirewalls":
        tasks.push(Promise.resolve(checkFirewall(r)));
        break;
      case "microsoft.network/routetables":
        tasks.push(Promise.resolve(checkRouteTable(r, owners, publicOwners, subscriptionResources)));
        break;
      case "microsoft.network/virtualnetworks":
        tasks.push(Promise.resolve(checkVnetPeerings(r, existing)));
        break;
      case "microsoft.network/privatednszones":
        tasks.push(checkPrivateDnsZone(r, subscriptionResources, x));
        break;
      case "microsoft.network/publicipaddresses":
        tasks.push(checkPublicIp(r, x));
        break;
    }
  }
  for (const { key, url } of probeUrls(outputs)) {
    tasks.push(
      x.http(url).then((res) => [
        {
          id: `e2e-${key}`,
          title: `End-to-end ${key.replace(/([A-Z])/g, " $1").toLowerCase()}`,
          status: res.status >= 200 && res.status < 400 ? "pass" : "fail",
          detail: res.error ? `${url}: ${res.error}` : `${url} → HTTP ${res.status} in ${res.ms} ms`,
        } satisfies CheckResult,
      ]),
    );
  }
  const checks = (await Promise.all(tasks)).flat();
  const order: Record<CheckStatus, number> = { fail: 0, warn: 1, pass: 2, skip: 3 };
  checks.sort((a, b) => order[a.status] - order[b.status]);
  const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of checks) summary[c.status]++;
  return { scope, ranAt: new Date(started).toISOString(), durationMs: Date.now() - started, checks, summary };
}

export function realProbes(arm: ArmClient): Probes {
  return {
    arm,
    http: async (url) => {
      const t = Date.now();
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "manual" });
        return { status: res.status, ms: Date.now() - t };
      } catch (e) {
        const err = e as Error & { cause?: { code?: string } };
        return { status: 0, ms: Date.now() - t, error: err.cause?.code ?? err.name ?? err.message };
      }
    },
    dns: async (host) => (await import("node:dns")).promises.resolve4(host),
    tls: async (url, o) => {
      const { request } = await import("node:https");
      const t = Date.now();
      return new Promise((resolveP) => {
        const req = request(url, { method: "GET", cert: o.cert, key: o.key, ca: o.ca, timeout: 15_000 }, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (d: string) => (body += d.length + body.length < 65_536 ? d : ""));
          res.on("end", () => resolveP({ status: res.statusCode ?? 0, ms: Date.now() - t, body }));
        });
        req.on("timeout", () => req.destroy(new Error("timeout")));
        req.on("error", (e: Error & { code?: string }) => resolveP({ status: 0, ms: Date.now() - t, error: e.code ?? e.message }));
        req.end();
      });
    },
  };
}
