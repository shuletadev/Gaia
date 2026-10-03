import { describe, expect, it } from "vitest";
import { project, type DailyCost } from "../server/azure/cost.ts";
import { typeFromId } from "../server/guard.ts";
import { expiryFromNow, isResourceGroupId } from "../server/actions/tags.ts";
import { cached, openDb } from "../server/db.ts";
import { JobRunner, JobConflictError } from "../server/jobs.ts";
import { rgId } from "./helpers.ts";

describe("project", () => {
  const days = (from: string, n: number, cost: number): DailyCost[] =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(`${from}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return { date: d.toISOString().slice(0, 10), cost };
    });

  it("uses the last 7 complete days and ignores today's partial data", () => {
    const daily = [...days("2026-09-01", 30, 14), { date: "2026-10-01", cost: 2 }];
    const p = project(daily, new Date("2026-10-01T17:00:00Z"));
    expect(p.dailyRunRate).toBe(14);
    expect(p.hourlyBurn).toBeCloseTo(14 / 24);
    expect(p.forecastMonth).toBe(14 * 31);
  });

  it("adds completed days this month to the projection", () => {
    const daily = days("2026-09-16", 20, 10); // through 2026-10-05
    const p = project(daily, new Date("2026-10-06T08:00:00Z"));
    expect(p.forecastMonth).toBe(5 * 10 + 10 * 26);
  });
});

describe("id helpers", () => {
  it("derives resource types, including nested ones", () => {
    expect(typeFromId(`${rgId("rg")}/providers/Microsoft.Network/publicIPAddresses/ip`)).toBe("Microsoft.Network/publicIPAddresses");
    expect(typeFromId(`${rgId("rg")}/providers/Microsoft.Network/virtualNetworks/v/subnets/s`)).toBe("Microsoft.Network/virtualNetworks/subnets");
    expect(typeFromId(rgId("rg"))).toBeUndefined();
  });
  it("recognises resource group IDs", () => {
    expect(isResourceGroupId(rgId("rg"))).toBe(true);
    expect(isResourceGroupId(`${rgId("rg")}/providers/a/b/c`)).toBe(false);
  });
  it("formats expiry without milliseconds", () => {
    expect(expiryFromNow(8, new Date("2026-10-01T10:00:00.123Z"))).toBe("2026-10-01T18:00:00Z");
  });
});

describe("cached", () => {
  it("serves fresh cache, refetches on refresh and falls back to stale data on failure", async () => {
    const db = openDb(":memory:");
    let n = 0;
    const fetch = async () => ++n;
    expect((await cached(db, "k", 60_000, false, fetch)).value).toBe(1);
    expect((await cached(db, "k", 60_000, false, fetch)).value).toBe(1);
    expect((await cached(db, "k", 60_000, true, fetch)).value).toBe(2);
    expect((await cached(db, "k", 60_000, true, async () => Promise.reject(new Error("429")))).value).toBe(2);
    await expect(cached(db, "other", 60_000, false, async () => Promise.reject(new Error("429")))).rejects.toThrow("429");
  });
});

describe("JobRunner", () => {
  it("records success and failure, and rejects concurrent jobs on one target", async () => {
    const db = openDb(":memory:");
    const runner = new JobRunner(db);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    runner.start("power.park", "/x/HubFW", "HubFW", async () => {
      await gate;
      return "done";
    });
    expect(() => runner.start("power.park", "/X/hubfw", "HubFW", async () => undefined)).toThrow(JobConflictError);
    runner.start("delete", "/x/ip", "ip", async () => {
      throw new Error("boom");
    });
    release();
    await new Promise((r) => setTimeout(r, 10));
    const jobs = runner.recent();
    expect(jobs.map((j) => [j.target_name, j.status]).sort()).toEqual([["HubFW", "succeeded"], ["ip", "failed"]]);
    expect(jobs.find((j) => j.target_name === "ip")?.error).toBe("boom");
  });
});
