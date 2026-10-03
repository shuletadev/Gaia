import { describe, expect, it } from "vitest";
import { decodeParkTag, encodeParkTag, firewallSpecFrom, powerInfo } from "../server/actions/power.ts";
import { rgId } from "./helpers.ts";

const fwId = `${rgId("SharedEnv")}/providers/Microsoft.Network/azureFirewalls/HubFW`;
const net = `${rgId("SharedEnv")}/providers/Microsoft.Network`;
const ipc = (name: string, subnet: string, pip: string) => ({
  name,
  properties: { subnet: { id: `${net}/virtualNetworks/Dota/subnets/${subnet}` }, publicIPAddress: { id: `${net}/publicIPAddresses/${pip}` } },
});

describe("powerInfo", () => {
  const fw = (properties: Record<string, unknown>, tags: Record<string, string> | null = null) => ({ type: "Microsoft.Network/azureFirewalls", properties, tags });

  it("treats a firewall with IP configurations as running and parkable", () => {
    expect(powerInfo(fw({ ipConfigurations: [ipc("a", "AzureFirewallSubnet", "pip")] }), false)).toMatchObject({ state: "running", canPark: true, canResume: false });
  });

  it("only allows resuming a parked firewall when the original config is known", () => {
    expect(powerInfo(fw({ ipConfigurations: [] }), false)).toMatchObject({ state: "parked", canResume: false });
    expect(powerInfo(fw({ ipConfigurations: [] }), true)).toMatchObject({ state: "parked", canResume: true });
    expect(powerInfo(fw({ ipConfigurations: [] }, { labctlparked: "{}" }), false)).toMatchObject({ canResume: true });
  });

  it("refuses virtual hub firewalls", () => {
    expect(powerInfo(fw({ virtualHub: { id: "x" } }), false)).toMatchObject({ canPark: false, canResume: false });
  });

  it("maps App Gateway, VM and AKS states", () => {
    expect(powerInfo({ type: "Microsoft.Network/applicationGateways", properties: { operationalState: "Stopped" } }, false)).toMatchObject({ state: "parked", canResume: true });
    expect(powerInfo({ type: "Microsoft.Compute/virtualMachines", properties: { extended: { instanceView: { powerState: { code: "PowerState/stopped" } } } } }, false)).toMatchObject({ state: "stopped-billing", canPark: true });
    expect(powerInfo({ type: "Microsoft.ContainerService/managedClusters", properties: { powerState: { code: "Running" } } }, false)).toMatchObject({ state: "running", canPark: true });
    expect(powerInfo({ type: "Microsoft.ApiManagement/service", properties: {} }, false)).toBeUndefined();
  });
});

describe("firewall park tag", () => {
  const spec = firewallSpecFrom({
    ipConfigurations: [ipc("FWhubIP", "AzureFirewallSubnet", "FWhubIP")],
    managementIpConfiguration: ipc("FWhubMIP", "AzureFirewallManagementSubnet", "FWhubMIP"),
  });

  it("round-trips through the compact tag within the 256-char limit", () => {
    const tag = encodeParkTag(fwId, spec)!;
    expect(tag.length).toBeLessThanOrEqual(256);
    expect(decodeParkTag(fwId, tag)).toEqual(spec);
  });

  it("declines to encode references to other resource groups", () => {
    const foreign = { ...spec, ipConfigurations: [{ ...spec.ipConfigurations[0]!, publicIpId: `${rgId("Other")}/providers/Microsoft.Network/publicIPAddresses/x` }] };
    expect(encodeParkTag(fwId, foreign)).toBeUndefined();
  });

  it("returns undefined for a corrupt tag", () => {
    expect(decodeParkTag(fwId, "not json")).toBeUndefined();
  });
});
