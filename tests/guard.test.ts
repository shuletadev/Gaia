import { describe, expect, it } from "vitest";
import { canAutoDelete, canManualDelete, getTag, isExcludedResourceGroup, parseResourceId } from "../server/guard.ts";
import { ttlForBlueprint } from "../server/config.ts";
import { config, OTHER_SUB, rgId, SUB } from "./helpers.ts";

const now = new Date("2026-10-01T12:00:00Z");
const lab = (name: string, tags: Record<string, string> | null, sub = SUB) => ({ id: rgId(name, sub), name, tags });

describe("canAutoDelete", () => {
  it("allows an expired labctl-managed group", () => {
    expect(canAutoDelete(config, lab("lab-1", { managedBy: "labctl", expiresOn: "2026-10-01T11:00:00Z" }), now)).toEqual({ allowed: true });
  });

  it("matches tag names and values case-insensitively", () => {
    expect(canAutoDelete(config, lab("lab-1", { MANAGEDBY: "LabCtl", ExpiresOn: "2026-09-30T00:00:00Z" }), now).allowed).toBe(true);
  });

  it.each([
    ["not expired", lab("lab-1", { managedBy: "labctl", expiresOn: "2026-10-01T13:00:00Z" }), "not expired yet"],
    ["unmanaged", lab("SharedEnv", { expiresOn: "2026-01-01T00:00:00Z" }), "not managed by labctl"],
    ["no tags", lab("SharedEnv", null), "not managed by labctl"],
    ["bad expiry", lab("lab-1", { managedBy: "labctl", expiresOn: "soon" }), "no valid expiresOn tag"],
    ["excluded even if tagged", lab("governancerg", { managedBy: "labctl", expiresOn: "2020-01-01" }), "resource group is excluded"],
    ["other subscription", lab("lab-1", { managedBy: "labctl", expiresOn: "2020-01-01" }, OTHER_SUB), "subscription not allow-listed"],
  ])("refuses %s", (_label, rg, reason) => {
    expect(canAutoDelete(config, rg, now)).toEqual({ allowed: false, reason });
  });
});

describe("canManualDelete", () => {
  it("allows in-scope resources", () => {
    expect(canManualDelete(config, `${rgId("SharedEnv")}/providers/Microsoft.Network/publicIPAddresses/ip1`).allowed).toBe(true);
  });
  it("refuses excluded groups, other subscriptions and subscription-level IDs", () => {
    expect(canManualDelete(config, `${rgId("NetworkWatcherRG")}/providers/x/y/z`).allowed).toBe(false);
    expect(canManualDelete(config, `${rgId("SharedEnv", OTHER_SUB)}/providers/x/y/z`).allowed).toBe(false);
    expect(canManualDelete(config, `/subscriptions/${SUB}`).allowed).toBe(false);
  });
});

describe("helpers", () => {
  it("parses resource IDs", () => {
    expect(parseResourceId(`${rgId("SharedEnv")}/providers/a/b/c`)).toEqual({ subscriptionId: SUB, resourceGroup: "SharedEnv" });
    expect(() => parseResourceId("not-an-id")).toThrow();
  });
  it("excludes resource groups case-insensitively", () => {
    expect(isExcludedResourceGroup(config, "networkwatcherrg")).toBe(true);
    expect(isExcludedResourceGroup(config, "SharedEnv")).toBe(false);
  });
  it("reads tags case-insensitively", () => {
    expect(getTag({ Owner: "me" }, "owner")).toBe("me");
    expect(getTag(null, "owner")).toBeUndefined();
  });
  it("resolves per-blueprint TTLs", () => {
    expect(ttlForBlueprint(config, "fixture-web")).toBe(12);
    expect(ttlForBlueprint(config, "unknown")).toBe(8);
  });
});
