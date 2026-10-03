import type { Db } from "../db.ts";
import { cached } from "../db.ts";
import type { PriceMeter } from "./blueprints.ts";

const API = "https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview";

interface RetailItem {
  retailPrice: number;
  unitOfMeasure: string;
  productName: string;
  skuName: string;
  meterName: string;
  tierMinimumUnits: number;
  type: string;
  effectiveStartDate: string;
}

export interface EstimateLine {
  label: string;
  hourly?: number;
}

export interface Estimate {
  region: string;
  hourly: number;
  lines: EstimateLine[];
  /** Meters with no published price for the region. */
  missing: string[];
  notes: string[];
}

const esc = (s: string) => s.replace(/'/g, "''");

export function meterFilter(region: string, m: PriceMeter): string {
  const parts = [
    `serviceName eq '${esc(m.serviceName)}'`,
    `armRegionName eq '${esc(region)}'`,
    `priceType eq 'Consumption'`,
    `skuName eq '${esc(m.skuName)}'`,
    `meterName eq '${esc(m.meterName)}'`,
  ];
  if (m.productName) parts.push(`productName eq '${esc(m.productName)}'`);
  return parts.join(" and ");
}

/** Picks the base (tier 0, most recent) hourly price. Discounted/dev-test products are excluded by the filter. */
export function pickPrice(items: RetailItem[]): number | undefined {
  const base = items
    .filter((i) => i.type === "Consumption" && (i.tierMinimumUnits ?? 0) === 0 && !/discount/i.test(i.productName))
    .sort((a, b) => b.effectiveStartDate.localeCompare(a.effectiveStartDate));
  return base[0]?.retailPrice;
}

async function fetchMeter(region: string, m: PriceMeter): Promise<number | undefined> {
  const url = `${API}&$filter=${encodeURIComponent(meterFilter(region, m))}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Retail Prices API ${res.status}`);
  const body = (await res.json()) as { Items: RetailItem[] };
  return pickPrice(body.Items);
}

export async function estimate(db: Db, region: string, meters: PriceMeter[], notes: string[]): Promise<Estimate> {
  const lines: EstimateLine[] = [];
  const missing: string[] = [];
  for (const m of meters) {
    const priceRegion = m.armRegion ?? region;
    const key = `price:${priceRegion}:${meterFilter(priceRegion, m)}`;
    let unit: number | undefined = m.fixedHourly;
    if (unit === undefined) {
      try {
        unit = (await cached(db, key, 24 * 3_600_000, false, () => fetchMeter(priceRegion, m))).value ?? undefined;
      } catch {
        unit = undefined;
      }
    }
    if (unit === undefined) missing.push(m.label);
    const multiple = Number.isInteger(m.unitsPerHour) && m.unitsPerHour > 1;
    lines.push({ label: multiple ? `${m.label} ×${m.unitsPerHour}` : m.label, hourly: unit === undefined ? undefined : unit * m.unitsPerHour });
  }
  const hourly = lines.reduce((s, l) => s + (l.hourly ?? 0), 0);
  return { region, hourly, lines, missing, notes };
}
