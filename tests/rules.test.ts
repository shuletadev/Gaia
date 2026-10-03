import { describe, expect, it } from "vitest";
import { evaluateRules } from "../server/audit/rules.ts";
import { config, group, res } from "./helpers.ts";

const now = new Date("2026-10-01T12:00:00Z");
const ids = (rule: string, findings: ReturnType<typeof evaluateRules>) => findings.filter((f) => f.ruleId === rule).map((f) => f.name);

describe("evaluateRules", () => {
  it("flags unattached public IPs but not ones in use or referenced by APIM", () => {
    const ipFree = res("SharedEnv", "Microsoft.Network/publicIPAddresses", "free-ip", {}, { sku: { name: "Standard" } });
    const ipUsed = res("SharedEnv", "Microsoft.Network/publicIPAddresses", "fw-ip", { ipConfiguration: { id: "x" } });
    const ipApim = res("SharedEnv", "Microsoft.Network/publicIPAddresses", "apim-ip");
    const apim = res("SharedEnv", "Microsoft.ApiManagement/service", "apim", { publicIpAddressId: ipApim.id.toUpperCase() }, { sku: { name: "Developer" } });
    const f = evaluateRules({ config, resources: [ipFree, ipUsed, ipApim, apim], resourceGroups: [group("SharedEnv")], now });
    expect(ids("unattached-public-ip", f)).toEqual(["free-ip"]);
  });

  it("treats an unbound IP named for an APIM as reserved, not a deletable orphan", () => {
    const ip = res("SharedEnv", "Microsoft.Network/publicIPAddresses", "NorthwindIP", { ipAddress: "203.0.113.151", publicIPAllocationMethod: "Static", dnsSettings: { domainNameLabel: "northwind" } }, { sku: { name: "Standard" } });
    const apim = res("SharedEnv", "Microsoft.ApiManagement/service", "Northwind", { virtualNetworkType: "None" }, { sku: { name: "Developer" }, tags: { lifecycle: "persistent" } });
    const f = evaluateRules({ config, resources: [ip, apim], resourceGroups: [group("SharedEnv")], now });
    expect(ids("unattached-public-ip", f)).toEqual([]);
    const reserved = f.find((x) => x.ruleId === "reserved-public-ip");
    expect(reserved).toMatchObject({ name: "NorthwindIP", action: "review", severity: "low", relatedId: apim.id });
    expect(reserved?.detail).toContain("not VNet-injected");
  });

  it("does not flag NSGs that are only linked through the relation graph", () => {
    const nsg = res("rg", "Microsoft.Network/networkSecurityGroups", "nsg");
    const vnet = res("rg", "Microsoft.Network/virtualNetworks", "v", { subnets: [{ properties: { networkSecurityGroup: { id: nsg.id } } }] });
    expect(ids("unassociated-nsg", evaluateRules({ config, resources: [nsg, vnet], resourceGroups: [group("rg")], now }))).toEqual([]);
  });

  it("flags costly always-on resources without an expiry, but not stopped App Gateways or labs with expiry", () => {
    const fw = res("SharedEnv", "Microsoft.Network/azureFirewalls", "fw", {}, { sku: { name: "AZFW_VNet", tier: "Basic" } });
    const apim = res("SharedEnv", "Microsoft.ApiManagement/service", "apim", {}, { sku: { name: "Developer" } });
    const apimConsumption = res("SharedEnv", "Microsoft.ApiManagement/service", "apim-c", {}, { sku: { name: "Consumption" } });
    const agwStopped = res("SharedEnv", "Microsoft.Network/applicationGateways", "agw", { operationalState: "Stopped", backendAddressPools: [{ properties: { backendAddresses: [{ fqdn: "a" }] } }] });
    const labFw = res("lab-1", "Microsoft.Network/azureFirewalls", "lab-fw");
    const f = evaluateRules({
      config,
      resources: [fw, apim, apimConsumption, agwStopped, labFw],
      resourceGroups: [group("SharedEnv"), group("lab-1", { managedBy: "labctl", expiresOn: "2026-10-02T00:00:00Z" })],
      now,
    });
    expect(ids("always-on-costly", f).sort()).toEqual(["apim", "fw"]);
    expect(f.find((x) => x.name === "fw")?.action).toBe("park");
    expect(f.find((x) => x.name === "apim")?.action).toBe("review");
  });

  it("flags orphaned network plumbing", () => {
    const f = evaluateRules({
      config,
      resources: [
        res("rg", "Microsoft.Network/networkInterfaces", "nic-orphan"),
        res("rg", "Microsoft.Network/networkInterfaces", "nic-pe", { privateEndpoint: { id: "pe" } }),
        res("rg", "Microsoft.Network/networkSecurityGroups", "nsg-free", { subnets: [] }),
        res("rg", "Microsoft.Network/networkSecurityGroups", "nsg-used", { subnets: [{ id: "s" }] }),
        res("rg", "Microsoft.Network/routeTables", "rt-free"),
        res("rg", "Microsoft.Network/natGateways", "nat-free"),
        res("rg", "Microsoft.Network/privateDnsZones", "zone-free", { numberOfVirtualNetworkLinks: 0 }),
        res("rg", "Microsoft.Network/privateDnsZones", "zone-linked", { numberOfVirtualNetworkLinks: 1 }),
      ],
      resourceGroups: [group("rg")],
      now,
    });
    expect(ids("orphan-nic", f)).toEqual(["nic-orphan"]);
    expect(ids("unassociated-nsg", f)).toEqual(["nsg-free"]);
    expect(ids("unassociated-route-table", f)).toEqual(["rt-free"]);
    expect(ids("idle-nat-gateway", f)).toEqual(["nat-free"]);
    expect(ids("unlinked-private-dns-zone", f)).toEqual(["zone-free"]);
  });

  it("flags compute waste", () => {
    const f = evaluateRules({
      config,
      resources: [
        res("rg", "Microsoft.Compute/disks", "disk-free", { diskState: "Unattached", diskSizeGB: 128 }),
        res("rg", "Microsoft.Compute/disks", "disk-used", { diskState: "Attached" }),
        res("rg", "Microsoft.Compute/virtualMachines", "vm-stopped", { extended: { instanceView: { powerState: { code: "PowerState/stopped" } } } }),
        res("rg", "Microsoft.Compute/virtualMachines", "vm-dealloc", { extended: { instanceView: { powerState: { code: "PowerState/deallocated" } } } }),
        res("rg", "Microsoft.Compute/snapshots", "snap-old", { timeCreated: "2026-01-01T00:00:00Z" }),
        res("rg", "Microsoft.Compute/snapshots", "snap-new", { timeCreated: "2026-09-20T00:00:00Z" }),
        res("rg", "Microsoft.Web/serverFarms", "plan-y1", { numberOfSites: 0 }, { sku: { name: "Y1", tier: "Dynamic" } }),
        res("rg", "Microsoft.Web/serverFarms", "plan-p1", { numberOfSites: 0 }, { sku: { name: "P1v3" } }),
      ],
      resourceGroups: [group("rg")],
      now,
    });
    expect(ids("unattached-disk", f)).toEqual(["disk-free"]);
    expect(ids("vm-stopped-not-deallocated", f)).toEqual(["vm-stopped"]);
    expect(ids("old-snapshot", f)).toEqual(["snap-old"]);
    expect(f.find((x) => x.name === "plan-y1")?.severity).toBe("low");
    expect(f.find((x) => x.name === "plan-p1")?.severity).toBe("medium");
  });

  it("flags App Gateways and load balancers with empty backends", () => {
    const f = evaluateRules({
      config,
      resources: [
        res("rg", "Microsoft.Network/applicationGateways", "agw-empty", { operationalState: "Stopped", backendAddressPools: [{ properties: { backendAddresses: [] } }] }),
        res("rg", "Microsoft.Network/loadBalancers", "lb-empty", { backendAddressPools: [] }),
        res("rg", "Microsoft.Network/loadBalancers", "lb-used", { backendAddressPools: [{ properties: { backendIPConfigurations: [{ id: "x" }] } }] }),
      ],
      resourceGroups: [group("rg")],
      now,
    });
    expect(ids("appgw-no-backends", f)).toEqual(["agw-empty"]);
    expect(ids("lb-no-backends", f)).toEqual(["lb-empty"]);
  });

  it("handles resource-group rules and never reports excluded groups", () => {
    const f = evaluateRules({
      config,
      resources: [res("GovernanceRG", "Microsoft.Network/publicIPAddresses", "gov-ip")],
      resourceGroups: [
        group("empty-rg"),
        group("GovernanceRG"),
        group("NetworkWatcherRG"),
        group("lab-old", { managedBy: "labctl", expiresOn: "2026-09-30T00:00:00Z" }),
        group("lab-notag", { managedBy: "labctl" }),
      ],
      now,
    });
    expect(f.some((x) => x.resourceGroup.toLowerCase() === "governancerg" || x.resourceGroup === "NetworkWatcherRG")).toBe(false);
    expect(ids("empty-resource-group", f).sort()).toEqual(["empty-rg", "lab-notag", "lab-old"]);
    expect(ids("expired-lab", f)).toEqual(["lab-old"]);
    expect(ids("lab-missing-expiry", f)).toEqual(["lab-notag"]);
  });

  it("does not flag always-on cost for resources or groups marked persistent", () => {
    const f = evaluateRules({
      config,
      resources: [
        res("SharedEnv", "Microsoft.ApiManagement/service", "Northwind", {}, { sku: { name: "Developer" }, tags: { Lifecycle: "Persistent" } }),
        res("Core", "Microsoft.Network/azureFirewalls", "fw"),
        res("SharedEnv", "Microsoft.Network/azureFirewalls", "HubFW"),
      ],
      resourceGroups: [group("SharedEnv"), group("Core", { lifecycle: "persistent" })],
      now,
    });
    expect(ids("always-on-costly", f)).toEqual(["HubFW"]);
  });

  it("stops flagging resources and empty groups the user chose to keep", () => {
    const f = evaluateRules({
      config,
      resources: [res("rg", "Microsoft.Network/routeTables", "rt", {}, { tags: { lifecycle: "persistent" } }), res("rg", "Microsoft.Network/routeTables", "rt2")],
      resourceGroups: [group("rg"), group("kept-empty", { lifecycle: "persistent" })],
      now,
    });
    expect(f.map((x) => x.name)).toEqual(["rt2"]);
  });

  it("restores resource group casing and reads SKUs stored under properties", () => {
    const fw = res("sharedenv", "Microsoft.Network/azureFirewalls", "HubFW", { sku: { name: "AZFW_VNet", tier: "Basic" } });
    const f = evaluateRules({ config, resources: [fw], resourceGroups: [group("SharedEnv")], now });
    expect(f[0]).toMatchObject({ resourceGroup: "SharedEnv", ruleId: "always-on-costly" });
    expect(f[0]?.detail).toContain("AZFW_VNet / Basic");
  });

  it("sorts by severity", () => {
    const f = evaluateRules({
      config,
      resources: [res("rg", "Microsoft.Network/routeTables", "rt"), res("rg", "Microsoft.Network/azureFirewalls", "fw")],
      resourceGroups: [group("rg"), group("empty")],
      now,
    });
    expect(f.map((x) => x.severity)).toEqual(["high", "low", "info"]);
  });
});
