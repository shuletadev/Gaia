import { describe, expect, it } from "vitest";
import { liveProject, project } from "../server/azure/cost.ts";
import { BLUEPRINTS, CATEGORIES, categoryOf } from "../server/labs/blueprints.ts";
import { buildWeekly } from "../server/labs/weekly.ts";

const now = new Date("2026-10-03T01:00:00Z");
const daily = [
  ...["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"].map((date) => ({ date, cost: 12 })),
  { date: "2026-10-01", cost: 43.76 },
  { date: "2026-10-02", cost: 16.6 },
  { date: "2026-10-03", cost: 0 },
];
const fw = "/subscriptions/s/resourcegroups/sharedenv/providers/microsoft.network/azurefirewalls/hubfw";
const apim = "/subscriptions/s/resourcegroups/sharedenv/providers/microsoft.apimanagement/service/northwind";
const agw = "/subscriptions/s/resourcegroups/sharedenv/providers/microsoft.network/applicationgateways/gw";
const byResource = ["2026-09-30", "2026-10-01", "2026-10-02"].flatMap((date) => [
  { key: fw, date, cost: 9.48 },
  { key: apim, date, cost: 1.68 },
  { key: agw, date, cost: 5 },
  { key: "", date, cost: 0.3 },
]);

describe("live forecast", () => {
  it("drops deleted and parked resources immediately; the trend still counts them", () => {
    const live = liveProject(daily, byResource, (id) => id !== fw, (id) => id === agw, now);
    expect(live.window).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(live.removedDailyRate).toBeCloseTo(9.48);
    expect(live.parkedDailyRate).toBeCloseTo(5);
    expect(live.liveDailyRate).toBeCloseTo(1.98);
    // Oct 1-2 actual (60.36) + 1.98/day × 29 days (Oct 3-31).
    expect(live.liveForecastMonth).toBeCloseTo(60.36 + 1.98 * 29, 1);
    expect(project(daily, now).forecastMonth).toBeGreaterThan(live.liveForecastMonth * 3);
  });

  it("uses the median day so a one-off spike does not set the rate", () => {
    const spiky = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"].map((date, i) => ({ key: apim, date, cost: [1.6, 1.58, 5.34, 63.37, 1.18][i]! }));
    expect(liveProject(daily, spiky, () => true, () => false, now).liveDailyRate).toBeCloseTo(1.6);
  });

  it("counts a new resource from its first day, not as zero before it", () => {
    const fresh = [{ key: agw, date: "2026-10-01", cost: 6 }, { key: agw, date: "2026-10-02", cost: 6 }];
    expect(liveProject(daily, fresh, () => true, () => false, now).liveDailyRate).toBeCloseTo(6);
  });

  it("averages only complete days and ignores today", () => {
    const withToday = [...byResource, { key: apim, date: "2026-10-03", cost: 100 }];
    expect(liveProject(daily, withToday, () => true, () => false, now).window).not.toContain("2026-10-03");
  });

  it("weekly report uses the live forecast and says how much of the trend is deleted resources", () => {
    const live = liveProject(daily, byResource, (id) => id !== fw, () => false, now);
    const text = buildWeekly({
      now,
      report: { subscription: { id: "s", name: "Sub" }, totals: { budgetUsd: 600, costMtdUsd: 60, flaggedCost30dUsd: 0 }, findings: [], topResources: [] } as never,
      daily,
      projection: project(daily, now),
      live,
      labs: [],
      running: [],
      appUrl: "http://x",
    });
    expect(text).toMatch(/^🌍 Project Gaia weekly/);
    expect(text).toContain(`forecast $${Math.round(live.liveForecastMonth)}`);
    expect(text).toMatch(/still counts \$9\.48\/day of deleted resources/);
  });
});

describe("categories", () => {
  it("every built-in blueprint has a catalog category", () => {
    for (const b of BLUEPRINTS) expect(CATEGORIES).toContain(categoryOf(b));
    expect(categoryOf({ custom: {} as never })).toBe("Exported");
  });
});
