import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ArmError } from "../azure/arm.ts";
import { probeUrls, summarizeBackendHealth, type Probes } from "../validate.ts";
import type { GateDef, GateKind } from "./blueprints.ts";
import { labDataDir, mtlsCommands } from "./hooks.ts";

/**
 * Readiness gates: checks polled between deployment stages. A stage's ARM deployment can report
 * Succeeded while the service behind it is still settling (APIM dependencies initializing, Front Door
 * propagating, a firewall IP not yet allocated). Gates wait for the real signal before moving on.
 */

export interface GateCtx {
  x: Probes;
  sub: string;
  labName: string;
  params: Record<string, unknown>;
  outputs: Record<string, unknown>;
  /** mTLS labs: client certificate material (read from the lab's data folder when absent). */
  clientCert?: ClientCert;
}

/** One poll. `done: false` means "not yet" and the gate keeps polling until its timeout. */
export interface GateTick {
  done: boolean;
  ok: boolean;
  detail: string;
  outputs?: Record<string, unknown>;
}

export interface GateResult {
  ok: boolean;
  timedOut: boolean;
  detail: string;
  outputs: Record<string, unknown>;
  polls: number;
}

const RES_API = "2021-04-01";
const NET_API = "2024-05-01";
const APIM_API = "2024-05-01";
const DNS_API = "2020-06-01";

const rgId = (c: GateCtx) => `/subscriptions/${c.sub}/resourceGroups/${c.labName}`;
const waiting = (detail: string): GateTick => ({ done: false, ok: false, detail });
const passed = (detail: string, outputs?: Record<string, unknown>): GateTick => ({ done: true, ok: true, detail, outputs });
const failed = (detail: string): GateTick => ({ done: true, ok: false, detail });

type Res<P = Record<string, any>> = { id: string; name: string; properties: P };

async function ofType(c: GateCtx, type: string): Promise<{ id: string; name: string }[]> {
  const filter = encodeURIComponent(`resourceType eq '${type}'`);
  const res = await c.x.arm.get<{ value: { id: string; name: string }[] }>(`${rgId(c)}/resources?$filter=${filter}&api-version=${RES_API}`);
  return res.value;
}

async function getOrUndefined<T>(c: GateCtx, path: string): Promise<T | undefined> {
  try {
    return await c.x.arm.get<T>(path);
  } catch (e) {
    if (e instanceof ArmError && e.status === 404) return undefined;
    throw e;
  }
}

interface Dep {
  name: string;
  status: string;
  isOptional?: boolean;
  error?: string;
}

/** Required dependencies failing or still initializing keep the gate waiting; optional ones only warn. */
export function apimDependencies(items: { networkStatus?: { connectivityStatus?: Dep[] } }[]): { ready: boolean; detail: string } {
  const deps = items.flatMap((i) => i.networkStatus?.connectivityStatus ?? []);
  if (!deps.length) return { ready: false, detail: "No dependency status reported yet" };
  const required = deps.filter((d) => !d.isOptional);
  const bad = required.filter((d) => d.status.toLowerCase() !== "success");
  if (bad.length) return { ready: false, detail: bad.map((d) => `${d.name}: ${d.status}${d.error ? ` (${d.error})` : ""}`).slice(0, 4).join("; ") };
  const optional = deps.filter((d) => d.isOptional && d.status.toLowerCase() === "failure");
  return { ready: true, detail: `${required.length} required dependencies reachable${optional.length ? `; optional failing: ${optional.map((d) => d.name).join(", ")}` : ""}` };
}

async function apimReady(c: GateCtx): Promise<GateTick> {
  const name = String(c.outputs.apimName || `${c.labName}-apim`);
  const s = await getOrUndefined<Res>(c, `${rgId(c)}/providers/Microsoft.ApiManagement/service/${name}?api-version=${APIM_API}`);
  if (!s) return waiting("Waiting for the service to appear");
  const ps = String(s.properties.provisioningState ?? "");
  if (ps === "Failed") return failed("Provisioning failed");
  if (ps !== "Succeeded") return waiting(`Provisioning: ${ps || "unknown"}`);
  const vnet = String(s.properties.virtualNetworkType ?? "None");
  const extra: Record<string, unknown> = {};
  const notes: string[] = [];
  if (vnet !== "None") {
    const ip = (s.properties.privateIPAddresses as string[] | undefined)?.[0];
    if (!ip) return waiting("Waiting for a private IP");
    extra.privateIp = ip;
    const ns = await c.x.arm.get<unknown>(`${s.id}/networkstatus?api-version=${APIM_API}`);
    const deps = apimDependencies(Array.isArray(ns) ? (ns as never[]) : []);
    if (!deps.ready) return waiting(deps.detail);
    notes.push(deps.detail);
  }
  const publicOff = String(s.properties.publicNetworkAccess ?? "Enabled") === "Disabled";
  const gw = String(s.properties.gatewayUrl ?? "");
  if (vnet !== "Internal" && !publicOff && gw) {
    const r = await c.x.http(`${gw}/status-0123456789abcdef`);
    if (r.status !== 200) return waiting(`Gateway ${r.error ?? `HTTP ${r.status}`}`);
    notes.unshift(`Gateway 200 in ${r.ms} ms`);
  }
  return passed(notes.join("; ") || "Succeeded", extra);
}

async function firewallIp(c: GateCtx): Promise<GateTick> {
  const [fw] = await ofType(c, "Microsoft.Network/azureFirewalls");
  if (!fw) return waiting("Waiting for the firewall");
  const r = await c.x.arm.get<Res>(`${fw.id}?api-version=${NET_API}`);
  const ps = String(r.properties.provisioningState ?? "");
  if (ps === "Failed") return failed("Firewall provisioning failed");
  const ip = r.properties.ipConfigurations?.[0]?.properties?.privateIPAddress as string | undefined;
  if (ps !== "Succeeded" || !ip) return waiting(`Provisioning: ${ps}${ip ? "" : ", no private IP yet"}`);
  return passed(`${fw.name} at ${ip}`, { firewallPrivateIp: ip });
}

async function peerings(c: GateCtx): Promise<GateTick> {
  const vnets = await ofType(c, "Microsoft.Network/virtualNetworks");
  const states: { name: string; state: string; sync: string }[] = [];
  for (const v of vnets) {
    const r = await c.x.arm.get<Res>(`${v.id}?api-version=${NET_API}`);
    for (const p of (r.properties.virtualNetworkPeerings ?? []) as Res[]) {
      states.push({ name: `${v.name}/${p.name}`, state: String(p.properties.peeringState ?? ""), sync: String(p.properties.peeringSyncLevel ?? "") });
    }
  }
  if (!states.length) return waiting("No peerings yet");
  const broken = states.filter((s) => s.state === "Disconnected");
  if (broken.length) return failed(`Disconnected: ${broken.map((s) => s.name).join(", ")}`);
  const pending = states.filter((s) => s.state !== "Connected" || (s.sync && s.sync !== "FullyInSync"));
  if (pending.length) return waiting(`${pending.length} of ${states.length} peerings settling`);
  return passed(`${states.length} peerings connected`);
}

async function appGatewayEndToEnd(c: GateCtx): Promise<GateTick> {
  const [agw] = await ofType(c, "Microsoft.Network/applicationGateways");
  if (!agw) return waiting("Waiting for the gateway");
  const h = await c.x.arm.lro<Parameters<typeof summarizeBackendHealth>[0]>("POST", `${agw.id}/backendhealth?api-version=${NET_API}`, undefined, { timeoutMs: 3 * 60_000, pollMs: 3000 });
  const s = summarizeBackendHealth(h ?? {});
  if (s.status !== "pass") return waiting(`Backend: ${s.detail}`);
  const urls = probeUrls(c.outputs);
  if (!urls.length) return passed(`Backend healthy (${s.detail})`);
  const results = await Promise.all(urls.map(async (u) => ({ ...u, r: await c.x.http(u.url) })));
  const good = results.find((x) => x.r.status === 200);
  if (!good) return waiting(results.map((x) => `${x.url} → ${x.r.error ?? `HTTP ${x.r.status}`}`).join("; "));
  return passed(`Backend healthy; ${good.url} → 200 in ${good.r.ms} ms`);
}

async function privateEndpointApproved(c: GateCtx): Promise<GateTick> {
  const [pe] = await ofType(c, "Microsoft.Network/privateEndpoints");
  if (!pe) return waiting("Waiting for the private endpoint");
  const r = await c.x.arm.get<Res>(`${pe.id}?api-version=${NET_API}`);
  const conn = [...(r.properties.privateLinkServiceConnections ?? []), ...(r.properties.manualPrivateLinkServiceConnections ?? [])][0] as Res | undefined;
  const status = String(conn?.properties?.privateLinkServiceConnectionState?.status ?? "");
  if (status === "Rejected" || status === "Disconnected") return failed(`Connection ${status}`);
  if (status !== "Approved") return waiting(`Connection ${status || "pending"}`);
  const nicId = (r.properties.networkInterfaces as { id: string }[] | undefined)?.[0]?.id;
  const nic = nicId ? await c.x.arm.get<Res>(`${nicId}?api-version=${NET_API}`) : undefined;
  const ip = nic?.properties.ipConfigurations?.[0]?.properties?.privateIPAddress as string | undefined;
  if (!ip) return waiting("Waiting for the endpoint IP");
  const apimName = String(c.outputs.apimName || `${c.labName}-apim`);
  const rec = await getOrUndefined<Res<{ aRecords?: { ipv4Address: string }[] }>>(
    c,
    `${rgId(c)}/providers/Microsoft.Network/privateDnsZones/privatelink.azure-api.net/A/${apimName}?api-version=${DNS_API}`,
  );
  const addrs = rec?.properties.aRecords?.map((a) => a.ipv4Address) ?? [];
  if (!addrs.includes(ip)) return waiting(addrs.length ? `DNS points to ${addrs.join(", ")}, endpoint is ${ip}` : "Waiting for the DNS record");
  return passed(`Approved; ${apimName}.privatelink.azure-api.net → ${ip}`, { privateEndpointIp: ip });
}

async function frontDoorEndToEnd(c: GateCtx): Promise<GateTick> {
  const base = String(c.outputs.frontDoorUrl ?? "");
  if (!base) return failed("No Front Door endpoint in the outputs");
  const r = await c.x.http(`${base}/httpbin/get`);
  if (r.status !== 200) return waiting(`Edge ${r.error ?? `HTTP ${r.status}`} (propagation can take 10–20 min)`);
  const notes = [`Edge 200 in ${r.ms} ms`];
  const gw = String(c.outputs.gatewayUrl ?? "");
  if (c.params.lockToFrontDoor !== false && gw) {
    const direct = await c.x.http(`${gw}/httpbin/get`);
    notes.push(direct.status === 403 ? "direct gateway call blocked (403)" : `direct gateway call returned ${direct.error ?? direct.status} — lock not enforced yet`);
  }
  return passed(notes.join("; "));
}

async function apimPublicOff(c: GateCtx): Promise<GateTick> {
  const name = String(c.outputs.apimName || `${c.labName}-apim`);
  const s = await getOrUndefined<Res>(c, `${rgId(c)}/providers/Microsoft.ApiManagement/service/${name}?api-version=${APIM_API}`);
  if (!s) return failed("Service not found");
  const ps = String(s.properties.provisioningState ?? "");
  if (ps !== "Succeeded") return waiting(`Provisioning: ${ps}`);
  if (String(s.properties.publicNetworkAccess) !== "Disabled") return waiting("Public network access still enabled");
  // The health endpoint keeps answering 200 by design; API calls are what public-access-off rejects (403).
  const r = await c.x.http(`${String(s.properties.gatewayUrl)}/httpbin/get`);
  if (r.status === 200) return waiting("Public API calls still answered (change propagating)");
  if (r.status !== 403) return waiting(`Public API call returned ${r.error ?? `HTTP ${r.status}`}`);
  return passed("Public API calls rejected (403); reach the gateway via the private endpoint");
}

async function selfHostedGateway(c: GateCtx): Promise<GateTick> {
  const base = String(c.outputs.selfHostedUrl ?? "");
  if (!base) return failed("No self-hosted gateway URL in the outputs");
  const r = await c.x.http(`${base}/httpbin/get`);
  if (r.status !== 200) return waiting(`Container ${r.error ?? `HTTP ${r.status}`} (pulling image and configuration)`);
  return passed(`${base}/httpbin/get → 200 in ${r.ms} ms`);
}

async function workspaceGateway(c: GateCtx): Promise<GateTick> {
  const base = String(c.outputs.workspaceGatewayUrl ?? "");
  if (!base || base === "https://") return waiting("Waiting for the gateway hostname");
  const r = await c.x.http(`${base}/httpbin/get`);
  if (r.status !== 200) return waiting(`Workspace gateway ${r.error ?? `HTTP ${r.status}`}`);
  return passed(`${base}/httpbin/get → 200 in ${r.ms} ms`);
}

async function dnsResolver(c: GateCtx): Promise<GateTick> {
  const name = String(c.outputs.resolverName ?? "");
  if (!name) return failed("No resolver in the outputs");
  const base = `${rgId(c)}/providers/Microsoft.Network/dnsResolvers/${name}`;
  const r = await getOrUndefined<Res>(c, `${base}?api-version=2022-07-01`);
  if (!r) return waiting("Waiting for the resolver");
  if (r.properties.provisioningState === "Failed") return failed("Resolver provisioning failed");
  if (r.properties.provisioningState !== "Succeeded" || r.properties.dnsResolverState !== "Connected") return waiting(`Resolver ${r.properties.provisioningState}/${r.properties.dnsResolverState ?? "?"}`);
  const inbound = await c.x.arm.get<{ value: Res[] }>(`${base}/inboundEndpoints?api-version=2022-07-01`);
  const outbound = await c.x.arm.get<{ value: Res[] }>(`${base}/outboundEndpoints?api-version=2022-07-01`);
  const ips = inbound.value.flatMap((e) => ((e.properties.ipConfigurations ?? []) as { privateIpAddress?: string }[]).map((i) => i.privateIpAddress)).filter(Boolean);
  const pending = [...inbound.value, ...outbound.value].filter((e) => e.properties.provisioningState !== "Succeeded");
  if (pending.length || !ips.length) return waiting(`${pending.length} endpoint(s) provisioning`);
  return passed(`Inbound ${ips.join(", ")}; ${outbound.value.length} outbound endpoint(s)`, { inboundIp: ips[0] });
}

export interface ClientCert {
  cert: string;
  key: string;
  ca: string;
}

/** Client certificate material for an mTLS lab, written by the certificate hook. */
export function readClientCert(labName: string): ClientCert | undefined {
  const dir = labDataDir(labName);
  try {
    return { cert: readFileSync(resolve(dir, "client.pem"), "utf8"), key: readFileSync(resolve(dir, "client.key"), "utf8"), ca: readFileSync(resolve(dir, "ca.pem"), "utf8") };
  } catch {
    return undefined;
  }
}

async function mtlsEndToEnd(c: GateCtx): Promise<GateTick> {
  const host = String(c.outputs.gatewayHost ?? "");
  const certs = c.clientCert ?? readClientCert(c.labName);
  if (!host || !certs) return failed("No gateway host or client certificate");
  if (!c.x.tls) return failed("TLS probe unavailable");
  const url = `https://${host}/headers`;
  const withCert = await c.x.tls(url, certs);
  if (withCert.status !== 200) return waiting(`With client cert: ${withCert.error ?? `HTTP ${withCert.status}`}`);
  const without = await c.x.tls(url, { ca: certs.ca });
  if (without.status === 200) return failed("A request without a client certificate was accepted");
  const forwarded = /X-Client-Cert-Subject/i.test(withCert.body ?? "");
  const notes = [`client cert → 200 in ${withCert.ms} ms`, `no cert → ${without.error ?? `HTTP ${without.status}`}`];
  if (c.params.forwardCertHeaders !== false) notes.push(forwarded ? "cert headers reached the backend" : "cert headers missing at the backend");
  return passed(notes.join("; "), mtlsCommands(labDataDir(c.labName), host));
}

const CHECKS: Record<GateKind, (c: GateCtx) => Promise<GateTick>> = {
  "shgw-e2e": selfHostedGateway,
  "apim-workspace": workspaceGateway,
  "dns-resolver": dnsResolver,
  "mtls-e2e": mtlsEndToEnd,
  "apim-ready": apimReady,
  "apim-public-off": apimPublicOff,
  "firewall-ip": firewallIp,
  peerings,
  "appgw-e2e": appGatewayEndToEnd,
  "pe-approved": privateEndpointApproved,
  "afd-e2e": frontDoorEndToEnd,
};

export async function runGate(
  def: GateDef,
  ctx: GateCtx,
  opts: { pollMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number; onTick?: (t: GateTick) => void } = {},
): Promise<GateResult> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? (def.kind === "afd-e2e" ? 30_000 : 20_000);
  const deadline = now() + def.timeoutMin * 60_000;
  let last: GateTick = waiting("Not checked yet");
  let polls = 0;
  for (;;) {
    polls++;
    try {
      last = await CHECKS[def.kind](ctx);
    } catch (e) {
      // Transient read errors (throttling, a resource mid-update) are retried until the timeout.
      last = waiting((e as Error).message.slice(0, 300));
    }
    opts.onTick?.(last);
    if (last.done) return { ok: last.ok, timedOut: false, detail: last.detail, outputs: last.outputs ?? {}, polls };
    if (now() >= deadline) return { ok: false, timedOut: true, detail: `Timed out after ${def.timeoutMin} min — ${last.detail}`, outputs: {}, polls };
    await sleep(pollMs);
  }
}
