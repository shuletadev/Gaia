import { describe, expect, it } from "vitest";
import { buildTopology } from "../server/topology.ts";
import { breakPeeringCycles, metersFromTemplate, nameExpression, transformExport } from "../server/labs/exportTransform.ts";
import { shortPath } from "../server/azure/arm.ts";
import { guessMinutes, pickIcons } from "../server/labs/export.ts";
import { prepareLab } from "../server/labs/engine.ts";
import { config, res, rgId } from "./helpers.ts";

const net = `${rgId("lab")}/providers/Microsoft.Network`;

describe("buildTopology", () => {
  const pip = res("lab", "Microsoft.Network/publicIPAddresses", "fw-pip", { ipAddress: "192.0.2.1", ipConfiguration: { id: `${net}/azureFirewalls/fw/azureFirewallIpConfigurations/c` } });
  const fw = res("lab", "Microsoft.Network/azureFirewalls", "fw", {
    ipConfigurations: [{ properties: { privateIPAddress: "10.0.1.4", subnet: { id: `${net}/virtualNetworks/hub/subnets/AzureFirewallSubnet` }, publicIPAddress: { id: pip.id } } }],
    firewallPolicy: { id: `${net}/firewallPolicies/pol` },
  });
  const pol = res("lab", "Microsoft.Network/firewallPolicies", "pol", { firewalls: [{ id: fw.id }] });
  const rt = res("lab", "Microsoft.Network/routeTables", "rt", {
    routes: [{ name: "d", properties: { addressPrefix: "0.0.0.0/0", nextHopType: "VirtualAppliance", nextHopIpAddress: "10.0.1.4" } }],
    subnets: [{ id: `${net}/virtualNetworks/spoke/subnets/workload` }],
  });
  const hub = res("lab", "Microsoft.Network/virtualNetworks", "hub", {
    addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
    subnets: [{ id: `${net}/virtualNetworks/hub/subnets/AzureFirewallSubnet`, name: "AzureFirewallSubnet", properties: { addressPrefix: "10.0.1.0/26" } }],
    virtualNetworkPeerings: [{ properties: { remoteVirtualNetwork: { id: `${net}/virtualNetworks/spoke` }, peeringState: "Connected" } }],
  });
  const spoke = res("lab", "Microsoft.Network/virtualNetworks", "spoke", {
    addressSpace: { addressPrefixes: ["10.1.0.0/16"] },
    subnets: [{ id: `${net}/virtualNetworks/spoke/subnets/workload`, name: "workload", properties: { addressPrefix: "10.1.1.0/24", routeTable: { id: rt.id } } }],
    virtualNetworkPeerings: [{ properties: { remoteVirtualNetwork: { id: hub.id }, peeringState: "Connected" } }],
  });
  const zone = res("lab", "Microsoft.Network/privateDnsZones", "azure-api.net");
  const link = res("lab", "Microsoft.Network/privateDnsZones/virtualNetworkLinks", "l", { virtualNetwork: { id: hub.id } }, { id: `${zone.id}/virtualNetworkLinks/l` });
  const other = res("elsewhere", "Microsoft.Network/publicIPAddresses", "unrelated");
  const t = buildTopology("lab", [pip, fw, pol, rt, hub, spoke, zone, link, other]);
  const id = (r: { id: string }) => r.id.toLowerCase();

  it("nests resources in the subnet they are injected into and folds public IPs onto their owner", () => {
    const fwNode = t.nodes.find((n) => n.name === "fw")!;
    expect(fwNode.parent).toBe(`${net}/virtualNetworks/hub/subnets/AzureFirewallSubnet`.toLowerCase());
    expect(fwNode.badges.map((b) => b.label)).toEqual(["192.0.2.1"]);
    expect(t.nodes.some((n) => n.name === "fw-pip")).toBe(false);
    expect(t.nodes.some((n) => n.name === "unrelated")).toBe(false);
  });

  it("shows route tables as subnet badges and draws routes to the next hop", () => {
    expect(t.nodes.some((n) => n.name === "rt")).toBe(false);
    const workload = t.vnets.find((v) => v.name === "spoke")!.subnets[0]!;
    expect(workload.badges).toEqual([{ type: "Microsoft.Network/routeTables", label: "rt" }]);
    expect(t.edges).toContainEqual(expect.objectContaining({ kind: "route", from: workload.id, to: id(fw), label: "0.0.0.0/0" }));
  });

  it("draws one peering edge per VNet pair, DNS links, and policy usage", () => {
    expect(t.edges.filter((e) => e.kind === "peering")).toHaveLength(1);
    expect(t.edges).toContainEqual(expect.objectContaining({ kind: "dns-link", from: id(zone), to: id(hub) }));
    expect(t.edges).toContainEqual(expect.objectContaining({ kind: "uses", from: id(fw), to: id(pol) }));
    expect(t.edges.some((e) => e.kind === "uses" && e.to === id(hub))).toBe(false);
  });
});

describe("export transform", () => {
  const exported = {
    $schema: "x",
    contentVersion: "1.0.0.0",
    parameters: {
      azureFirewalls_lab_x_fw_name: { type: "String", defaultValue: "lab-x-fw" },
      service_contoso_apim_name: { type: "String", defaultValue: "contoso-apim" },
      storageAccounts_logs_name: { type: "String", defaultValue: "logs123" },
      orphan: { type: "String" },
    },
    variables: {},
    resources: [
      { type: "Microsoft.Network/azureFirewalls", apiVersion: "2024-05-01", name: "[parameters('azureFirewalls_lab_x_fw_name')]", location: "centralus", tags: { managedBy: "labctl" }, properties: { sku: { tier: "Basic" }, hubIPAddresses: {} } },
      { type: "Microsoft.ApiManagement/service", apiVersion: "2024-05-01", name: "[parameters('service_contoso_apim_name')]", location: "Central US", sku: { name: "Developer", capacity: 1 }, properties: { gatewayUrl: "x" } },
      { type: "Microsoft.ApiManagement/service/apis", apiVersion: "2024-05-01", name: "[concat(parameters('service_contoso_apim_name'), '/echo')]", properties: {} },
      { type: "Microsoft.Storage/storageAccounts", apiVersion: "2023-01-01", name: "[parameters('storageAccounts_logs_name')]", location: "centralus", properties: {} },
      { type: "Microsoft.Network/publicIPAddresses", apiVersion: "2024-05-01", name: "pip", location: "centralus", sku: { name: "Standard" }, properties: { dnsSettings: { domainNameLabel: "contoso", fqdn: "contoso.centralus.cloudapp.azure.com" } } },
      { type: "Microsoft.Network/privateDnsZones", apiVersion: "2020-06-01", name: "azure-api.net", location: "global", properties: { x: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/other-rg/providers/Microsoft.Network/virtualNetworks/hub" } },
    ],
  };
  const r = transformExport(exported, "lab-x", "centralus", "11111111-1111-1111-1111-111111111111");
  const res_ = r.template.resources as Record<string, unknown>[];
  const vars = r.template.variables as Record<string, string>;

  it("derives names from labName and makes global names unique", () => {
    expect(vars.azureFirewalls_lab_x_fw_name).toBe("[concat(parameters('labName'), '-fw')]");
    expect(vars.service_contoso_apim_name).toBe("[take(toLower(concat(parameters('labName'), '-', 'contoso-apim')), 50)]");
    expect(vars.storageAccounts_logs_name).toBe("[take(toLower(replace(concat(parameters('labName'), 'logs123'), '-', '')), 24)]");
    expect(res_[0]!.name).toBe("[variables('azureFirewalls_lab_x_fw_name')]");
    expect(res_[2]!.name).toBe("[concat(variables('service_contoso_apim_name'), '/echo')]");
  });

  it("parameterises location and tags on top-level resources only, and keeps global", () => {
    expect(res_[0]).toMatchObject({ location: "[parameters('location')]", tags: "[parameters('tags')]" });
    expect(res_[1]).toMatchObject({ location: "[parameters('location')]", tags: "[parameters('tags')]" });
    expect(res_[2]!.tags).toBeUndefined();
    expect(res_[5]!.location).toBe("global");
  });

  it("prefixes DNS labels, drops read-only fqdn, and warns about outside references and missing defaults", () => {
    expect((res_[4]!.properties as { dnsSettings: Record<string, string> }).dnsSettings).toEqual({ domainNameLabel: "[toLower(concat(parameters('labName'), '-', 'contoso'))]" });
    expect(r.warnings).toContain("References /subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/other-rg/providers/Microsoft.Network/virtualNetworks/hub — it must exist before deploying");
    expect(r.warnings).toContain("Parameter orphan has no default — set one before launching");
    expect(Object.keys(r.template.parameters as object)).toEqual(["labName", "location", "tags", "orphan"]);
  });

  it("prices recognised SKUs", () => {
    expect(metersFromTemplate(r.template).map((m) => `${m.label}x${m.unitsPerHour}`)).toEqual(["Firewall Basicx1", "APIM Developerx1", "Public IPsx1"]);
  });

  it("keeps names that are neither source-derived nor global", () => {
    expect(nameExpression("hub-vnet", "lab-x", "Microsoft.Network/virtualNetworks")).toBe("hub-vnet");
  });

  it("breaks the inline-peering dependency cycle but keeps real dependencies", () => {
    const vnet = (name: string, peer: string, extraDeps: string[] = []) => ({
      type: "Microsoft.Network/virtualNetworks",
      name: `[variables('${name}')]`,
      dependsOn: [`[resourceId('Microsoft.Network/virtualNetworks', variables('${peer}'))]`, ...extraDeps],
      properties: {
        subnets: [{ properties: { routeTable: { id: "[resourceId('Microsoft.Network/routeTables', variables('rt'))]" } } }],
        virtualNetworkPeerings: [{ properties: { remoteVirtualNetwork: { id: `[resourceId('Microsoft.Network/virtualNetworks', variables('${peer}'))]` } } }],
      },
    });
    const hub = vnet("hub", "spoke");
    const spoke = vnet("spoke", "hub", ["[resourceId('Microsoft.Network/routeTables', variables('rt'))]"]);
    const peering = { type: "Microsoft.Network/virtualNetworks/virtualNetworkPeerings", dependsOn: ["[resourceId('Microsoft.Network/virtualNetworks', variables('hub'))]", "[resourceId('Microsoft.Network/virtualNetworks', variables('spoke'))]"] };
    expect(breakPeeringCycles([hub, spoke, peering])).toBe(2);
    expect(hub.dependsOn).toEqual([]);
    expect(spoke.dependsOn).toEqual(["[resourceId('Microsoft.Network/routeTables', variables('rt'))]"]);
    expect(hub.properties.virtualNetworkPeerings).toBeUndefined();
    expect(peering.dependsOn).toHaveLength(2);
  });

  it("shortens ARM paths in error messages", () => {
    expect(shortPath("https://management.azure.com/subscriptions/s/providers/Microsoft.Resources/locations/eastus2/deploymentStackOperationResults/eyJqb2JJZCI6IlByZWZsaWdodFN0YWNrSm9iOmJmMDZhMTQzOjJEYTI3YzoyRDRmNGY6?api-version=2024-03-01&c=MIIH"))
      .toBe("/subscriptions/s/providers/Microsoft.Resources/locations/eastus2/deploymentStackOperationResults/eyJqb2JJZCI6…");
  });

  it("picks icons and deploy time from resource types", () => {
    expect(pickIcons(["Microsoft.Network/virtualNetworks", "Microsoft.ApiManagement/service", "Microsoft.Network/applicationGateways", "Microsoft.Network/azureFirewalls"])).toEqual([
      "Microsoft.Network/applicationGateways",
      "Microsoft.ApiManagement/service",
      "Microsoft.Network/azureFirewalls",
    ]);
    expect(guessMinutes(["Microsoft.ApiManagement/service"])).toEqual([10, 75]);
  });
});
