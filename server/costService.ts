import type { ArmClient } from "./azure/arm.ts";
import { costByDimension, dailyCost, dailyCostByResource, last30Days, lastNDays, monthToDate, previousMonth, type CostRow, type DailyCost, type ResourceDayCost } from "./azure/cost.ts";
import { cached, type Db } from "./db.ts";

const HOUR = 3_600_000;

/** Cost Management throttles hard, so every query goes through a SQLite cache (stale data is served on failure). */
export class CostService {
  constructor(
    private readonly arm: ArmClient,
    private readonly db: Db,
  ) {}

  private day(now = new Date()) {
    return now.toISOString().slice(0, 10);
  }

  byResource30d(sub: string, refresh = false) {
    return cached<CostRow[]>(this.db, `${sub}:resource30d:${this.day()}`, 3 * HOUR, refresh, () => costByDimension(this.arm, sub, "ResourceId", last30Days()));
  }

  byRgMonthToDate(sub: string, refresh = false) {
    return cached<CostRow[]>(this.db, `${sub}:rgMtd:${this.day()}`, 3 * HOUR, refresh, () => costByDimension(this.arm, sub, "ResourceGroupName", monthToDate()));
  }

  byRgPreviousMonth(sub: string, refresh = false) {
    const month = this.day().slice(0, 7);
    return cached<CostRow[]>(this.db, `${sub}:rgPrev:${month}`, 24 * HOUR, refresh, () => costByDimension(this.arm, sub, "ResourceGroupName", previousMonth()));
  }

  daily30(sub: string, refresh = false) {
    return cached<DailyCost[]>(this.db, `${sub}:daily30:${this.day()}`, 3 * HOUR, refresh, () => dailyCost(this.arm, sub, lastNDays(30)));
  }

  /** Per-resource daily cost for the last few days, for the live forecast. */
  resourceDaily(sub: string, refresh = false) {
    return cached<ResourceDayCost[]>(this.db, `${sub}:resourceDaily7:${this.day()}`, 3 * HOUR, refresh, () => dailyCostByResource(this.arm, sub, lastNDays(7)));
  }
}
