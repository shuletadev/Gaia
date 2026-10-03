import { describe, expect, it } from "vitest";
import { buildPreview, confirmPhraseFor } from "../server/actions/deletion.ts";
import { config, group, res, rgId, OTHER_SUB } from "./helpers.ts";

const ip = res("SharedEnv", "Microsoft.Network/publicIPAddresses", "NorthwindIP");
const fwIp = res("SharedEnv", "Microsoft.Network/publicIPAddresses", "FWhubIP");
const fw = res("SharedEnv", "Microsoft.Network/azureFirewalls", "HubFW", { ipConfigurations: [{ properties: { publicIPAddress: { id: fwIp.id } } }] });
const groups = [group("SharedEnv"), group("GovernanceRG"), group("TeamLab")];

describe("confirmPhraseFor", () => {
  it("uses the name for one target and a count for many", () => {
    expect(confirmPhraseFor(["NorthwindIP"])).toBe("NorthwindIP");
    expect(confirmPhraseFor(["a", "b", "c"])).toBe("delete 3");
  });
});

describe("buildPreview", () => {
  it("allows an unreferenced resource and shows its cost", () => {
    const p = buildPreview(config, [ip.id], [ip, fw, fwIp], groups, new Map([[ip.id.toLowerCase(), 3.55]]));
    expect(p.items[0]).toMatchObject({ name: "NorthwindIP", allowed: true, cost30dUsd: 3.55, referencedBy: [] });
    expect(p.confirmPhrase).toBe("NorthwindIP");
  });

  it("reports resources that depend on the target", () => {
    const p = buildPreview(config, [fwIp.id], [ip, fw, fwIp], groups);
    expect(p.items[0]?.referencedBy.map((r) => r.name)).toEqual(["HubFW"]);
  });

  it("warns when an unbound IP looks reserved for another resource", () => {
    const apim = res("SharedEnv", "Microsoft.ApiManagement/service", "Northwind");
    const p = buildPreview(config, [ip.id], [ip, apim], groups);
    expect(p.items[0]).toMatchObject({ allowed: true, reservedFor: { name: "Northwind" } });
  });

  it("lists outside consumers when deleting a group", () => {
    const shared = res("TeamLab", "Microsoft.Network/publicIPAddresses", "shared-ip");
    const consumer = res("SharedEnv", "Microsoft.Network/applicationGateways", "agw", { frontendIPConfigurations: [{ properties: { publicIPAddress: { id: shared.id } } }] });
    const p = buildPreview(config, [rgId("TeamLab")], [shared, consumer], groups);
    expect(p.items[0]?.referencedBy.map((r) => r.name)).toEqual(["agw"]);
  });

  it("lists contents of a resource group", () => {
    const p = buildPreview(config, [rgId("SharedEnv")], [ip, fw, fwIp], groups);
    expect(p.items[0]?.contains).toHaveLength(3);
  });

  it("blocks excluded groups, other subscriptions, missing and locked targets", () => {
    const p = buildPreview(
      config,
      [rgId("GovernanceRG"), `${rgId("SharedEnv", OTHER_SUB)}/providers/Microsoft.Network/publicIPAddresses/x`, `${rgId("SharedEnv")}/providers/Microsoft.Network/publicIPAddresses/gone`, rgId("TeamLab")],
      [ip],
      groups,
      undefined,
      new Map([[rgId("TeamLab").toLowerCase(), ["keep (CanNotDelete)"]]]),
    );
    expect(p.items.map((i) => [i.allowed, i.reason])).toEqual([
      [false, "resource group is excluded"],
      [false, "subscription not allow-listed"],
      [false, "resource not found"],
      [false, "locked"],
    ]);
  });

  it("deduplicates targets and builds the phrase only from deletable items", () => {
    const p = buildPreview(config, [ip.id, ip.id.toUpperCase(), rgId("GovernanceRG")], [ip], groups);
    expect(p.items).toHaveLength(2);
    expect(p.confirmPhrase).toBe("NorthwindIP");
  });
});
