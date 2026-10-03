import { describe, expect, it } from "vitest";
import { baseNameOfIp, buildRelations, topLevelId } from "../server/audit/relations.ts";
import { res, rgId } from "./helpers.ts";

const net = `${rgId("SharedEnv")}/providers/Microsoft.Network`;
const lc = (s: string) => s.toLowerCase();
const names = (links: { id: string }[] | undefined, all: { id: string; name: string }[]) =>
  (links ?? []).map((l) => all.find((r) => lc(r.id) === l.id)?.name).sort();

describe("helpers", () => {
  it("truncates child IDs to their top-level resource", () => {
    expect(topLevelId(`${net}/azureFirewalls/HubFW/azureFirewallIpConfigurations/FWhubIP`)).toBe(lc(`${net}/azureFirewalls/HubFW`));
    expect(topLevelId(`${net}/virtualNetworks/Dota/subnets/AzureFirewallSubnet`)).toBe(lc(`${net}/virtualNetworks/Dota`));
    expect(topLevelId(rgId("SharedEnv"))).toBeUndefined();
  });

  it("strips IP naming noise", () => {
    expect(baseNameOfIp("NorthwindIP")).toBe("northwind");
    expect(baseNameOfIp("agw-pip-01")).toBe("agw");
    expect(baseNameOfIp("FWhubMIP")).toBe("fwhub");
    expect(baseNameOfIp("hub-fw-publicip")).toBe("hub-fw");
  });
});

describe("buildRelations", () => {
  // Shapes modelled on real Azure resources.
  const fwIp = res("SharedEnv", "Microsoft.Network/publicIPAddresses", "FWhubIP", {
    ipAddress: "192.0.2.1",
    ipConfiguration: { id: `${net}/azureFirewalls/HubFW/azureFirewallIpConfigurations/FWhubIP` },
  });
  const vnet = res("SharedEnv", "Microsoft.Network/virtualNetworks", "Dota", {
    subnets: [
      {
        id: `${net}/virtualNetworks/Dota/subnets/AzureFirewallSubnet`,
        properties: {
          networkSecurityGroup: { id: `${net}/networkSecurityGroups/RDPaccess` },
          ipConfigurations: [{ id: `${net}/azureFirewalls/HubFW/azureFirewallIpConfigurations/FWhubIP` }],
        },
      },
    ],
  });
  const nsg = res("SharedEnv", "Microsoft.Network/networkSecurityGroups", "RDPaccess", {
    subnets: [{ id: `${net}/virtualNetworks/Dota/subnets/AzureFirewallSubnet` }],
    securityRules: [{ properties: { destinationAddressPrefix: "203.0.113.151" } }],
  });
  const fw = res("SharedEnv", "Microsoft.Network/azureFirewalls", "HubFW", {
    ipConfigurations: [
      {
        id: `${net}/azureFirewalls/HubFW/azureFirewallIpConfigurations/FWhubIP`,
        properties: { publicIPAddress: { id: fwIp.id }, subnet: { id: `${net}/virtualNetworks/Dota/subnets/AzureFirewallSubnet` } },
      },
    ],
    firewallPolicy: { id: `${net}/firewallPolicies/HubFWpolicy` },
  });
  const policy = res("SharedEnv", "Microsoft.Network/firewallPolicies", "HubFWpolicy", { firewalls: [{ id: fw.id }] });
  const northwindIp = res("SharedEnv", "Microsoft.Network/publicIPAddresses", "NorthwindIP", {
    ipAddress: "203.0.113.151",
    dnsSettings: { domainNameLabel: "northwind", fqdn: "northwind.centralus.cloudapp.azure.com" },
  });
  const northwind = res("SharedEnv", "Microsoft.ApiManagement/service", "Northwind", { virtualNetworkType: "None", publicIPAddresses: ["203.0.113.46"] });
  const all = [fwIp, vnet, nsg, fw, policy, northwindIp, northwind];
  const rel = buildRelations(all);

  it("follows forward references and back-references in the right direction", () => {
    expect(names(rel.uses.get(lc(fw.id)), all)).toEqual(["Dota", "FWhubIP", "HubFWpolicy"]);
    expect(names(rel.usedBy.get(lc(fwIp.id)), all)).toEqual(["HubFW"]);
    expect(names(rel.usedBy.get(lc(policy.id)), all)).toEqual(["HubFW"]);
    expect(names(rel.uses.get(lc(vnet.id)), all)).toEqual(["RDPaccess"]);
    // The VNet's subnet ipConfigurations list the firewall as a consumer of the VNet, not the reverse.
    expect(names(rel.usedBy.get(lc(vnet.id)), all)).toEqual(["HubFW"]);
  });

  it("links by IP address value", () => {
    expect(rel.usedBy.get(lc(northwindIp.id))).toEqual([{ id: lc(nsg.id), via: "ip" }]);
  });

  it("links by FQDN", () => {
    const agw = res("SharedEnv", "Microsoft.Network/applicationGateways", "edge", {
      backendAddressPools: [{ properties: { backendAddresses: [{ fqdn: "northwind.centralus.cloudapp.azure.com" }] } }],
    });
    const r = buildRelations([northwindIp, agw]);
    expect(r.usedBy.get(lc(northwindIp.id))).toEqual([{ id: lc(agw.id), via: "fqdn" }]);
  });

  it("links an App Gateway to the APIM behind it by gateway hostname, and only on whole hostnames", () => {
    const apim = res("lab", "Microsoft.ApiManagement/service", "lab-apim", { gatewayUrl: "https://lab-apim.azure-api.net", hostnameConfigurations: [{ type: "Proxy", hostName: "api.contoso.com" }] });
    const agw = res("lab", "Microsoft.Network/applicationGateways", "agw", { backendAddressPools: [{ properties: { backendAddresses: [{ fqdn: "lab-apim.azure-api.net" }] } }] });
    const fd = res("lab", "Microsoft.Cdn/profiles", "fd", { origins: ["https://api.contoso.com/"] });
    const other = res("lab", "Microsoft.Network/applicationGateways", "other", { backendAddressPools: [{ properties: { backendAddresses: [{ fqdn: "mylab-apim.azure-api.net" }] } }] });
    const r = buildRelations([apim, agw, fd, other]);
    expect(names(r.usedBy.get(lc(apim.id)), [apim, agw, fd, other])).toEqual(["agw", "fd"]);
  });

  it("prefers an ID reference over an address match for the same pair", () => {
    const pip = res("lab", "Microsoft.Network/publicIPAddresses", "apim-pip", { ipAddress: "198.51.100.217" });
    const apim = res("lab", "Microsoft.ApiManagement/service", "apim", { publicIPAddresses: ["198.51.100.217"], publicIpAddressId: pip.id });
    expect(buildRelations([pip, apim]).usedBy.get(lc(pip.id))).toEqual([{ id: lc(apim.id), via: "id" }]);
  });

  it("infers the owner of an unbound IP from its name or DNS label, but not for bound IPs", () => {
    const r = buildRelations([northwindIp, northwind, fwIp, fw]);
    expect(r.likelyFor.get(lc(northwindIp.id))).toBe(lc(northwind.id));
    expect(r.likelyFor.has(lc(fwIp.id))).toBe(false);
  });

  it("recognises a VNet-injected APIM that references its IP one way", () => {
    const injected = res("SharedEnv", "Microsoft.ApiManagement/service", "Northwind", { virtualNetworkType: "External", publicIpAddressId: northwindIp.id });
    const r = buildRelations([northwindIp, injected]);
    expect(r.usedBy.get(lc(northwindIp.id))).toEqual([{ id: lc(injected.id), via: "id" }]);
    expect(r.likelyFor.size).toBe(0);
  });

  it("resolves UDR next hops to the unique owner of a private IP", () => {
    const fwPriv = res("SharedEnv", "Microsoft.Network/azureFirewalls", "HubFW", { ipConfigurations: [{ properties: { privateIPAddress: "10.80.1.4" } }] });
    const rt = res("SharedEnv", "Microsoft.Network/routeTables", "SpokeRT", { routes: [{ properties: { nextHopType: "VirtualAppliance", nextHopIpAddress: "10.80.1.4" } }] });
    expect(buildRelations([fwPriv, rt]).usedBy.get(lc(fwPriv.id))).toEqual([{ id: lc(rt.id), via: "ip" }]);
  });

  it("ignores private IPs that more than one resource owns", () => {
    const nicA = res("a", "Microsoft.Network/networkInterfaces", "nicA", { ipConfigurations: [{ properties: { privateIPAddress: "10.0.0.4" } }] });
    const nicB = res("b", "Microsoft.Network/networkInterfaces", "nicB", { ipConfigurations: [{ properties: { privateIPAddress: "10.0.0.4" } }] });
    const rt = res("a", "Microsoft.Network/routeTables", "rt", { routes: [{ properties: { nextHopIpAddress: "10.0.0.4" } }] });
    expect(buildRelations([nicA, nicB, rt]).uses.has(lc(rt.id))).toBe(false);
  });

  it("matches by DNS label when the name does not", () => {
    const ip = res("SharedEnv", "Microsoft.Network/publicIPAddresses", "pip-01", { dnsSettings: { domainNameLabel: "northwind" } });
    expect(buildRelations([ip, northwind]).likelyFor.get(lc(ip.id))).toBe(lc(northwind.id));
  });
});
