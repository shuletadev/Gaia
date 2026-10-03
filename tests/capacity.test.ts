import { describe, expect, it } from "vitest";
import { CAPACITY_ERROR, recentCapacityEvent, recordCapacityEvent, tidyError } from "../server/labs/capacity.ts";
import { openDb } from "../server/db.ts";

describe("capacity memory", () => {
  it("recognises regional capacity errors", () => {
    expect(CAPACITY_ERROR.test("ManagedEnvironmentCapacityHeavyUsageError: Creating a new cluster is unavailable")).toBe(true);
    expect(CAPACITY_ERROR.test("AllocationFailed: The VM size is not available")).toBe(true);
    expect(CAPACITY_ERROR.test("InvalidTemplate: bad")).toBe(false);
  });

  it("remembers a shortage for a day per blueprint and region", () => {
    const db = openDb(":memory:");
    const t = new Date("2026-10-02T23:21:00Z");
    recordCapacityEvent(db, "fixture-web", "Standard/slots", "centralus", "AKSCapacityHeavyUsage", t);
    expect(recentCapacityEvent(db, "fixture-web", "Standard/slots", "centralus", t.getTime() + 3_600_000)?.detail).toBe("AKSCapacityHeavyUsage");
    expect(recentCapacityEvent(db, "fixture-web", "Standard/slots", "eastus2", t.getTime())).toBeUndefined();
    expect(recentCapacityEvent(db, "fixture-web", "Standard/vm", "centralus", t.getTime())).toBeUndefined();
    expect(recentCapacityEvent(db, "fixture-web", "Standard/slots", "centralus", t.getTime() + 25 * 3_600_000)).toBeUndefined();
  });

  it("strips SDK response dumps from messages", () => {
    expect(tidyError("X: Creating a new cluster is unavailable.\nStatus: 400 (Bad Request)\nErrorCode: AKS\n\nContent:\n{}")).toBe("X: Creating a new cluster is unavailable.");
    expect(tidyError("plain")).toBe("plain");
  });
});
