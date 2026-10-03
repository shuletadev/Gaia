import { describe, expect, it } from "vitest";
import { checkRouteTable, checkVnetPeerings, privateIpCandidates, privateIpOwners, probeUrls, publicIpOwners, resolveNextHop, summarizeApimNetworkStatus, summarizeBackendHealth, validateScope, type Probes } from "../server/validate.ts";
import { res, rgId } from "./helpers.ts";

const net = `${rgId("lab")}/providers/Microsoft.Network`;
const fw = res("lab", "Microsoft.Network/azureFirewalls", "fw", {
  provisioningState: "Succeeded",
  ipConfigurations: [{ properties: { privateIPAddress: "10.0.1.4" } }],
  firewallPolicy: { id: `${net}/firewallPolicies/pol` },
});
const parkedFw = res("lab", "Microsoft.Network/azureFirewalls", "fw2", { ipConfigurations: [] });
const rt = (hop: string, subnets = [{ id: "s" }]) =>
  res("lab", "Microsoft.Network/routeTables", "rt", { subnets, routes: [{ name: "default", properties: { addressPrefix: "0.0.0.0/0", nextHopType: "VirtualAppliance", nextHopIpAddress: hop } }] });

describe("route table checks", () => {
  it("passes when the next hop is a live firewall", () => {
    const c = checkRouteTable(rt("10.0.1.4"), privateIpOwners([fw]));
    expect(c.map((x) => [x.id, x.status, x.detail])).toEqual([
      ["rt-assoc", "pass", "1 subnet(s)"],
      ["rt-hop-default", "pass", "10.0.1.4 → fw"],
    ]);
  });

  it("fails on black-holed or parked next hops, but only warns while the table is unassociated", () => {
    expect(checkRouteTable(rt("10.9.9.9"), privateIpOwners([fw])).map((x) => x.status)).toEqual(["pass", "fail"]);
    expect(checkRouteTable(rt("10.9.9.9", []), privateIpOwners([fw])).map((x) => x.status)).toEqual(["warn", "warn"]);
    const parkedOwner = new Map([["10.0.1.4", parkedFw]]);
    expect(checkRouteTable(rt("10.0.1.4"), parkedOwner)[1]).toMatchObject({ status: "fail", detail: "10.0.1.4 is fw2, which is parked" });
  });

  it("explains a public next hop and suggests the firewall's private IP", () => {
    const pip = res("lab", "Microsoft.Network/publicIPAddresses", "FWhubIP", { ipAddress: "198.51.100.207" });
    const hubfw = res("lab", "Microsoft.Network/azureFirewalls", "HubFW", { ipConfigurations: [{ properties: { privateIPAddress: "10.80.1.4", publicIPAddress: { id: pip.id } } }] });
    const apim = res("lab", "Microsoft.ApiManagement/service", "Northwind", { publicIPAddresses: ["203.0.113.46"] });
    const owners = publicIpOwners([pip, hubfw, apim]);
    const [, toFw] = checkRouteTable(rt("198.51.100.207", []), privateIpOwners([hubfw]), owners);
    expect(toFw).toMatchObject({ status: "warn" });
    expect(toFw?.detail).toBe("198.51.100.207 is a public address (FWhubIP, HubFW's public IP) — a virtual appliance next hop must be a private IP. Use HubFW private IP 10.80.1.4. (latent: table not associated)");
    const [, toApim] = checkRouteTable(rt("203.0.113.46"), new Map(), owners);
    expect(toApim).toMatchObject({ status: "fail" });
    expect(toApim?.detail).toContain("Northwind's gateway address");
  });

  it("says when a peering's remote VNet no longer exists", () => {
    const v = res("lab", "Microsoft.Network/virtualNetworks", "SpokeA", {
      virtualNetworkPeerings: [{ name: "p", properties: { peeringState: "Disconnected", remoteVirtualNetwork: { id: `${net}/virtualNetworks/SpokeB` } } }],
    });
    expect(checkVnetPeerings(v, new Set([v.id.toLowerCase()]))[0]?.detail).toBe("Disconnected — remote VNet SpokeB no longer exists; delete this peering");
  });

  it("ignores private IPs with more than one owner", () => {
    const a = res("a", "Microsoft.Network/networkInterfaces", "a", { ipConfigurations: [{ properties: { privateIPAddress: "10.0.0.4" } }] });
    const b = res("b", "Microsoft.Network/networkInterfaces", "b", { ipConfigurations: [{ properties: { privateIPAddress: "10.0.0.4" } }] });
    expect(privateIpOwners([a, b]).has("10.0.0.4")).toBe(false);
  });

  it("resolves an overlapping next hop to the firewall in the VNet the table's subnets peer with", () => {
    const mk = (rg: string) => {
      const n = `${rgId(rg)}/providers/Microsoft.Network`;
      const fw = res(rg, "Microsoft.Network/azureFirewalls", `${rg}-fw`, { ipConfigurations: [{ properties: { privateIPAddress: "10.0.1.4", subnet: { id: `${n}/virtualNetworks/hub/subnets/AzureFirewallSubnet` } } }] });
      const spoke = res(rg, "Microsoft.Network/virtualNetworks", "spoke", { virtualNetworkPeerings: [{ properties: { remoteVirtualNetwork: { id: `${n}/virtualNetworks/hub` } } }] });
      const table = res(rg, "Microsoft.Network/routeTables", `${rg}-rt`, {
        subnets: [{ id: `${n}/virtualNetworks/spoke/subnets/workload` }],
        routes: [{ name: "default", properties: { addressPrefix: "0.0.0.0/0", nextHopType: "VirtualAppliance", nextHopIpAddress: "10.0.1.4" } }],
      });
      return { fw, spoke, table };
    };
    const a = mk("lab-a");
    const b = mk("lab-b");
    const all = [a.fw, a.spoke, a.table, b.fw, b.spoke, b.table];
    const [, hop] = checkRouteTable(a.table, privateIpCandidates(all), new Map(), all);
    expect(hop).toMatchObject({ status: "pass", detail: "10.0.1.4 → lab-a-fw" });
    expect(resolveNextHop("10.0.1.4", b.table, all, privateIpCandidates(all)).owner?.name).toBe("lab-b-fw");
  });

  it("reports a genuinely ambiguous next hop instead of calling it black-holed", () => {
    const x = res("x", "Microsoft.Network/azureFirewalls", "fw-x", { ipConfigurations: [{ properties: { privateIPAddress: "10.0.1.4" } }] });
    const y = res("y", "Microsoft.Network/azureFirewalls", "fw-y", { ipConfigurations: [{ properties: { privateIPAddress: "10.0.1.4" } }] });
    const table = rt("10.0.1.4");
    const [, hop] = checkRouteTable(table, privateIpCandidates([x, y]), new Map(), [x, y, table]);
    expect(hop).toMatchObject({ status: "warn" });
    expect(hop?.detail).toContain("cannot tell which one");
  });
});

describe("summaries", () => {
  it("reports unhealthy backends with the probe log", () => {
    const s = summarizeBackendHealth({
      backendAddressPools: [
        {
          backendAddressPool: { id: "/x/backendAddressPools/apim" },
          backendHttpSettingsCollection: [{ servers: [{ address: "10.20.2.4", health: "Unhealthy", healthProbeLog: "Received invalid status code: 404 " }] }],
        },
      ],
    });
    expect(s).toEqual({ status: "fail", detail: "apim/10.20.2.4: Unhealthy — Received invalid status code: 404" });
    expect(summarizeBackendHealth({}).status).toBe("warn");
  });

  it("separates required and optional APIM dependency failures", () => {
    const deps = (list: { name: string; status: string; isOptional?: boolean }[]) => [{ networkStatus: { connectivityStatus: list } }];
    expect(summarizeApimNetworkStatus(deps([{ name: "Storage", status: "success" }])).status).toBe("pass");
    expect(summarizeApimNetworkStatus(deps([{ name: "SMTP", status: "failure", isOptional: true }])).status).toBe("warn");
    expect(summarizeApimNetworkStatus(deps([{ name: "Azure SQL", status: "failure" }]))).toMatchObject({ status: "fail", detail: "Azure SQL" });
    expect(summarizeApimNetworkStatus([]).status).toBe("skip");
  });

  it("flags peerings that are not connected or not in sync", () => {
    const v = res("lab", "Microsoft.Network/virtualNetworks", "hub", {
      virtualNetworkPeerings: [
        { name: "a", properties: { peeringState: "Connected", peeringSyncLevel: "FullyInSync", remoteVirtualNetwork: { id: "/x/spoke1" } } },
        { name: "b", properties: { peeringState: "Connected", peeringSyncLevel: "LocalNotInSync", remoteVirtualNetwork: { id: "/x/spoke2" } } },
        { name: "c", properties: { peeringState: "Disconnected", remoteVirtualNetwork: { id: "/x/spoke3" } } },
      ],
    });
    expect(checkVnetPeerings(v).map((x) => [x.title, x.status])).toEqual([
      ["Peering → spoke1", "pass"],
      ["Peering → spoke2", "warn"],
      ["Peering → spoke3", "fail"],
    ]);
  });

  it("extracts probe URLs from lab outputs", () => {
    expect(probeUrls({ sampleRequest: "curl http://1.2.3.4/httpbin/get", healthCheck: "curl http://1.2.3.4/status-0123456789abcdef", apimName: "x", gatewayUrl: "https://x.azure-api.net" })).toEqual([
      { key: "sampleRequest", url: "http://1.2.3.4/httpbin/get" },
      { key: "healthCheck", url: "http://1.2.3.4/status-0123456789abcdef" },
    ]);
  });
});

describe("validateScope", () => {
  const probes = (over: Partial<Probes> = {}): Probes => ({
    arm: { get: async () => [] as never, lro: async () => ({}) as never },
    http: async (url) => ({ status: url.includes("bad") ? 502 : 200, ms: 12 }),
    dns: async () => ["192.0.2.1"],
    ...over,
  });

  it("checks APIM gateway, public IP DNS and end-to-end outputs, failures first", async () => {
    const apim = res("lab", "Microsoft.ApiManagement/service", "apim", { provisioningState: "Succeeded", virtualNetworkType: "None", gatewayUrl: "https://apim.azure-api.net" });
    const pip = res("lab", "Microsoft.Network/publicIPAddresses", "pip", { ipAddress: "192.0.2.1", dnsSettings: { fqdn: "pip.centralus.cloudapp.azure.com" } });
    const r = await validateScope(rgId("lab"), [apim, pip], [apim, pip], probes(), { sampleRequest: "curl https://bad.example/get" });
    expect(r.checks[0]).toMatchObject({ id: "e2e-sampleRequest", status: "fail" });
    expect(r.checks.find((c) => c.id === "apim-gateway")).toMatchObject({ status: "pass", detail: "HTTP 200 in 12 ms" });
    expect(r.checks.find((c) => c.id === "pip-dns")?.status).toBe("pass");
    expect(r.summary).toEqual({ pass: 3, warn: 0, fail: 1, skip: 0 });
  });

  it("skips backend health for a parked App Gateway and probes internal APIM through other checks", async () => {
    const agw = res("lab", "Microsoft.Network/applicationGateways", "agw", { operationalState: "Stopped" });
    const apim = res("lab", "Microsoft.ApiManagement/service", "apim", { provisioningState: "Succeeded", virtualNetworkType: "Internal" });
    let calledNetworkStatus = false;
    const r = await validateScope(rgId("lab"), [agw, apim], [agw, apim], probes({ arm: { get: async () => ((calledNetworkStatus = true), [{ networkStatus: { connectivityStatus: [{ name: "Storage", status: "success" }] } }]) as never, lro: async () => ({}) as never } }));
    expect(r.checks.find((c) => c.id === "agw-backend")?.status).toBe("skip");
    expect(r.checks.find((c) => c.id === "apim-gateway")?.status).toBe("skip");
    expect(r.checks.find((c) => c.id === "apim-network")?.status).toBe("pass");
    expect(calledNetworkStatus).toBe(true);
  });
});
