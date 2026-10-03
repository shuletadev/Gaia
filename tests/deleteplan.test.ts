import { describe, expect, it } from "vitest";
import { classify, planDeletion, type PlanTarget } from "../server/actions/deletePlan.ts";
import { buildPreview, executePlan, withDeleteRetry } from "../server/actions/deletion.ts";
import { ArmError, type ArmClient } from "../server/azure/arm.ts";
import { openDb } from "../server/db.ts";
import { JobRunner } from "../server/jobs.ts";
import type { GraphResource } from "../server/azure/resourceGraph.ts";
import { config, group, res, rgId } from "./helpers.ts";

const id = (rg: string, type: string, name: string) => `${rgId(rg)}/providers/${type}/${name}`;
const VNET = "Microsoft.Network/virtualNetworks";
const NIC = "Microsoft.Network/networkInterfaces";

/** net RG: vnet (s1 has NSG + route table), nic1 in s1 with pip1; app RG: nic2 also in s1. */
function world() {
  const vnetId = id("net", VNET, "vnet");
  const s1 = `${vnetId}/subnets/s1`;
  const nsgId = id("net", "Microsoft.Network/networkSecurityGroups", "nsg");
  const rtId = id("net", "Microsoft.Network/routeTables", "rt");
  const nic1Id = id("net", NIC, "nic1");
  const nic2Id = id("app", NIC, "nic2");
  const pipId = id("net", "Microsoft.Network/publicIPAddresses", "pip1");
  const vnet = res("net", VNET, "vnet", {
    subnets: [{ id: s1, properties: { networkSecurityGroup: { id: nsgId }, routeTable: { id: rtId }, ipConfigurations: [{ id: `${nic1Id}/ipConfigurations/ip1` }, { id: `${nic2Id}/ipConfigurations/ip1` }] } }],
  });
  const nsg = res("net", "Microsoft.Network/networkSecurityGroups", "nsg", { subnets: [{ id: s1 }] });
  const rt = res("net", "Microsoft.Network/routeTables", "rt", { subnets: [{ id: s1 }] });
  const nic1 = res("net", NIC, "nic1", { ipConfigurations: [{ id: `${nic1Id}/ipConfigurations/ip1`, properties: { subnet: { id: s1 }, publicIPAddress: { id: pipId } } }] });
  const nic2 = res("app", NIC, "nic2", { ipConfigurations: [{ id: `${nic2Id}/ipConfigurations/ip1`, properties: { subnet: { id: s1 } } }] });
  const pip = res("net", "Microsoft.Network/publicIPAddresses", "pip1", { ipConfiguration: { id: `${nic1Id}/ipConfigurations/ip1` } });
  return { vnet, nsg, rt, nic1, nic2, pip, s1, all: [vnet, nsg, rt, nic1, nic2, pip] };
}

const t = (r: GraphResource): PlanTarget => ({ id: r.id, name: r.name, type: r.type, isGroup: false });
const g = (name: string): PlanTarget => ({ id: rgId(name), name, type: "Microsoft.Resources/resourceGroups", isGroup: true });

describe("planDeletion", () => {
  it("detaches an NSG from the subnets that keep it, then deletes it", () => {
    const w = world();
    const plan = planDeletion([t(w.nsg)], w.all);
    expect(plan.blockers).toEqual([]);
    expect(plan.steps.map((s) => [s.kind, s.target.name, s.wave])).toEqual([
      ["fix", "vnet", 0],
      ["delete", "nsg", 1],
    ]);
    expect(plan.steps[0]!.fixes[0]!.action).toEqual({ op: "subnet-unset", subnetId: w.s1, property: "networkSecurityGroup" });
    expect(plan.steps[1]!.after).toEqual([plan.steps[0]!.key]);
  });

  it("groups several detaches on the same resource into one step", () => {
    const w = world();
    const plan = planDeletion([t(w.nsg), t(w.rt)], w.all);
    const fix = plan.steps.filter((s) => s.kind === "fix");
    expect(fix).toHaveLength(1);
    expect(fix[0]!.fixes.map((f) => (f.action as { property: string }).property).sort()).toEqual(["networkSecurityGroup", "routeTable"]);
  });

  it("detaches a public IP from a NIC but refuses one on a firewall", () => {
    const w = world();
    expect(planDeletion([t(w.pip)], w.all).steps[0]!.fixes[0]!.action).toMatchObject({ op: "nic-unset-pip", nicId: w.nic1.id });
    const fwPip = res("net", "Microsoft.Network/publicIPAddresses", "fwpip", { ipConfiguration: { id: `${id("net", "Microsoft.Network/azureFirewalls", "fw")}/azureFirewallIpConfigurations/c` } });
    const fw = res("net", "Microsoft.Network/azureFirewalls", "fw", {});
    const plan = planDeletion([t(fwPip)], [fwPip, fw]);
    expect(plan.blockers[0]).toMatchObject({ consumer: { name: "fw" }, detail: "fwpip is attached to firewall fw" });
    expect(plan.steps).toEqual([]);
  });

  it("deletes consumers before what they use, and blocks on dependents that stay", () => {
    const w = world();
    const blocked = planDeletion([t(w.vnet), t(w.nic1)], w.all);
    expect(blocked.blockers.map((b) => [b.target.name, b.consumer.name])).toEqual([["vnet", "nic2"]]);
    expect(blocked.steps.map((s) => s.target.name)).toEqual(["nic1"]);

    const ok = planDeletion([t(w.vnet), t(w.nic1), t(w.nic2), t(w.pip), t(w.nsg), t(w.rt)], w.all);
    expect(ok.blockers).toEqual([]);
    const wave = (n: string) => ok.steps.find((s) => s.target.name === n)!.wave;
    expect(wave("nic1")).toBeLessThan(wave("vnet"));
    expect(wave("nic2")).toBeLessThan(wave("vnet"));
    expect(wave("nic1")).toBeLessThan(wave("pip1"));
    expect(wave("vnet")).toBeLessThan(wave("nsg"));
    expect(ok.steps.some((s) => s.kind === "fix")).toBe(false);
  });

  it("re-plans when a blocked target stays: its references become detaches", () => {
    const w = world();
    const plan = planDeletion([t(w.vnet), t(w.nsg)], w.all);
    expect(plan.blockers.map((b) => b.target.name)).toEqual(["vnet", "vnet"]);
    expect(plan.steps.map((s) => [s.kind, s.target.name])).toEqual([
      ["fix", "vnet"],
      ["delete", "nsg"],
    ]);
  });

  it("orders resource groups by cross-group references", () => {
    const w = world();
    const plan = planDeletion([g("net"), g("app")], w.all);
    expect(plan.blockers).toEqual([]);
    expect(plan.steps.map((s) => [s.target.name, s.wave])).toEqual([
      ["app", 0],
      ["net", 1],
    ]);
    expect(plan.steps[0]!.label).toBe("Delete group app (1 resource)");
    expect(planDeletion([g("net")], w.all).blockers[0]).toMatchObject({ consumer: { name: "nic2" } });
  });

  it("removes peerings and DNS links that point at a deleted VNet", () => {
    const a = res("a", VNET, "vnet-a", { virtualNetworkPeerings: [{ id: `${id("a", VNET, "vnet-a")}/virtualNetworkPeerings/to-b`, name: "to-b", properties: { remoteVirtualNetwork: { id: id("b", VNET, "vnet-b") } } }] });
    const b = res("b", VNET, "vnet-b", { virtualNetworkPeerings: [{ id: `${id("b", VNET, "vnet-b")}/virtualNetworkPeerings/to-a`, name: "to-a", properties: { remoteVirtualNetwork: { id: a.id } } }] });
    const link = res("dns", "Microsoft.Network/privateDnsZones/virtualNetworkLinks", "link-a", { virtualNetwork: { id: a.id } }, { id: `${id("dns", "Microsoft.Network/privateDnsZones", "z.internal")}/virtualNetworkLinks/link-a` });
    const plan = planDeletion([t(a)], [a, b, link]);
    expect(plan.blockers).toEqual([]);
    const actions = plan.steps.filter((s) => s.kind === "fix").flatMap((s) => s.fixes.map((f) => f.action));
    expect(actions).toEqual(
      expect.arrayContaining([
        { op: "delete-child", childId: `${b.id}/virtualNetworkPeerings/to-a`, apiVersion: "2024-05-01" },
        { op: "delete-child", childId: link.id, apiVersion: "2020-06-01" },
      ]),
    );
    // Peered VNets deleted together don't order each other.
    const both = planDeletion([t(a), t(b)], [a, b]);
    expect(both.steps.map((s) => s.wave)).toEqual([0, 0]);
  });

  it("blocks when the resource that needs a detach may not be changed", () => {
    const w = world();
    const plan = planDeletion([t(w.nsg)], w.all, { canTouch: (cid) => (cid.toLowerCase() === w.vnet.id.toLowerCase() ? "resource group is excluded" : undefined) });
    expect(plan.blockers[0]!.detail).toMatch(/can't be changed: resource group is excluded/);
    expect(plan.steps).toEqual([]);
  });

  it("warns about dangling references and soft delete", () => {
    const ai = res("x", "Microsoft.Insights/components", "ai", {});
    const site = res("x", "Microsoft.Web/sites", "app", { siteConfig: { appInsightsId: ai.id } });
    const apim = res("x", "Microsoft.ApiManagement/service", "gw", {});
    const plan = planDeletion([t(ai), t(apim)], [ai, site, apim]);
    expect(plan.blockers).toEqual([]);
    expect(plan.warnings.join(" ")).toMatch(/app app references ai/);
    expect(plan.warnings.join(" ")).toMatch(/gw: API Management is soft-deleted/);
  });

  it("classify: a NIC owned by a private endpoint points at the endpoint", () => {
    const nic = res("x", NIC, "pe-nic", {});
    const pe = res("x", "Microsoft.Network/privateEndpoints", "pe", {});
    expect(classify(nic, pe)).toEqual({ kind: "block", detail: "pe-nic belongs to private endpoint pe (delete the endpoint instead)" });
  });
});

describe("buildPreview with a plan", () => {
  it("marks held targets as not allowed, with blockers, and keeps them out of the phrase", () => {
    const w = world();
    const p = buildPreview(config, [w.vnet.id, w.nsg.id], w.all, [group("net"), group("app")]);
    expect(p.items.map((i) => [i.name, i.allowed])).toEqual([
      ["vnet", false],
      ["nsg", true],
    ]);
    expect(p.items[0]!.reason).toBe("held by nic1, nic2");
    expect(p.items[0]!.blockers).toHaveLength(2);
    expect(p.confirmPhrase).toBe("nsg");
    expect(p.plan.steps.map((s) => s.kind)).toEqual(["fix", "delete"]);
  });

  it("treats a lock on the group as a lock on its resources", () => {
    const w = world();
    const p = buildPreview(config, [w.nsg.id], w.all, [group("net")], undefined, new Map([[rgId("net").toLowerCase(), ["keep (CanNotDelete)"]]]));
    expect(p.items[0]).toMatchObject({ allowed: false, reason: "locked" });
  });
});

describe("execution", () => {
  it("retries in-use errors and gives up on others", async () => {
    let n = 0;
    const ok = await withDeleteRetry(
      async () => {
        if (++n < 3) throw new ArmError("in use", 400, "InUseSubnetCannotBeDeleted");
        return "done";
      },
      { sleep: async () => undefined },
    );
    expect([ok, n]).toEqual(["done", 3]);
    let m = 0;
    await expect(
      withDeleteRetry(
        async () => {
          m++;
          throw new ArmError("locked", 409, "ScopeLocked");
        },
        { sleep: async () => undefined },
      ),
    ).rejects.toThrow("locked");
    expect(m).toBe(1);
  });

  it("runs steps in order and skips dependents of a failed step", async () => {
    const w = world();
    const calls: string[] = [];
    const arm = {
      get: async (url: string) => {
        if (url.includes("/providers/Microsoft.Network?")) return { resourceTypes: [{ resourceType: "networkSecurityGroups", apiVersions: ["2024-05-01"] }, { resourceType: "routeTables", apiVersions: ["2024-05-01"] }] };
        if (url.includes("/subnets/s1")) return { properties: { addressPrefix: "10.0.0.0/24", networkSecurityGroup: { id: w.nsg.id }, routeTable: { id: w.rt.id } } };
        throw new ArmError("not found", 404, "NotFound");
      },
      lro: async (method: string, url: string) => {
        calls.push(`${method} ${url.split("/").slice(-2).join("/").split("?")[0]}`);
        if (method === "PUT") throw new ArmError("denied", 403, "AuthorizationFailed");
        return undefined;
      },
    } as unknown as ArmClient;
    const jobs = new JobRunner(openDb(":memory:"));
    const plan = planDeletion([t(w.nsg)], w.all);
    const started = executePlan(arm, jobs, plan, w.all);
    expect(started.map((j) => j.kind)).toEqual(["detach", "delete"]);
    await jobs.drain();
    expect(calls).toEqual(["PUT subnets/s1"]);
    const deleteJob = jobs.get(started[1]!.id)!;
    expect(deleteJob).toMatchObject({ status: "failed", error: "Skipped: vnet did not finish" });
  });

  it("refuses to start when a step's target already has a running job", () => {
    const w = world();
    const jobs = new JobRunner(openDb(":memory:"));
    jobs.start("park", w.vnet.id, "vnet", () => new Promise(() => undefined));
    expect(() => executePlan({} as ArmClient, jobs, planDeletion([t(w.nsg)], w.all), w.all)).toThrow(/already running on vnet/);
  });
});
