import type { ArmClient } from "../azure/arm.ts";
import { cached, type Db } from "../db.ts";

/**
 * Pre-launch feasibility: everything that would make a deployment fail (or surprise the bill) and
 * can be known before it starts. Facts are gathered from Azure (cached) and evaluated by a pure function.
 */

export type FeasibilityStatus = "pass" | "warn" | "fail" | "skip";

export interface FeasibilityCheck {
  id: string;
  label: string;
  status: FeasibilityStatus;
  detail: string;
  /** One-click remedy offered in the launch dialog. */
  fix?: { kind: "register-provider"; namespaces: string[] };
}

export interface ProviderInfo {
  registrationState: string;
  resourceTypes: { resourceType: string; locations: string[] }[];
}

export interface PermissionEntry {
  actions: string[];
  notActions: string[];
}

/** A VM size in one region: its quota family, vCPUs and any restriction for this subscription. */
export interface VmSkuInfo {
  name: string;
  family: string;
  vcpus: number;
  restricted?: string;
}

export interface AzureFacts {
  providers: Record<string, ProviderInfo | undefined>;
  vmSkus?: VmSkuInfo[];
  computeUsages?: { name: string; current: number; limit: number }[];
  usages?: { name: string; current: number; limit: number }[];
  permissions?: PermissionEntry[];
  errors: Record<string, string>;
}

export interface FeasibilityInput {
  region: string;
  enabledRegions: string[];
  ttlHours: number;
  hourly: number;
  resourceTypes: string[];
  quotas?: Record<string, number>;
  rules: string[];
  deployMinutes: [number, number];
  budget: { monthlyUsd: number; forecastMonth?: number };
  /** VM sizes the lab creates. */
  vmSizes?: string[];
  /** A capacity shortage this blueprint hit in this region within the last day. */
  capacity?: { detail: string; at: string };
}

export const normRegion = (s: string) => s.toLowerCase().replace(/\s+/g, "");

export function namespacesOf(types: string[]): string[] {
  return [...new Set(types.map((t) => t.split("/")[0]!).filter(Boolean).map((n) => n))].sort();
}

/** Azure RBAC action matching: '*' wildcards, case-insensitive; notActions subtract per entry. */
export function isPermitted(action: string, entries: PermissionEntry[]): boolean {
  const re = (pattern: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
  return entries.some((e) => e.actions.some((a) => re(a).test(action)) && !e.notActions.some((n) => re(n).test(action)));
}

const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString("en-US")}`;
const pretty = (type: string) => type.split("/").slice(1).join("/");

export function evaluateFeasibility(i: FeasibilityInput, f: AzureFacts): FeasibilityCheck[] {
  const out: FeasibilityCheck[] = [];
  const region = normRegion(i.region);

  out.push(
    i.rules.length
      ? { id: "config", label: "Configuration", status: "fail", detail: i.rules.join("; ") }
      : { id: "config", label: "Configuration", status: "pass", detail: "Supported combination" },
  );

  // Providers registered.
  const namespaces = namespacesOf([...i.resourceTypes, "Microsoft.Resources/deploymentStacks"]);
  const unregistered = namespaces.filter((n) => f.providers[n] && f.providers[n]!.registrationState !== "Registered");
  const unknownNs = namespaces.filter((n) => !f.providers[n]);
  if (unregistered.length) {
    out.push({
      id: "providers",
      label: "Resource providers",
      status: "fail",
      detail: unregistered.map((n) => `${n} is ${f.providers[n]!.registrationState}`).join("; "),
      fix: { kind: "register-provider", namespaces: unregistered },
    });
  } else if (unknownNs.length) {
    out.push({ id: "providers", label: "Resource providers", status: "warn", detail: `Could not read ${unknownNs.join(", ")}` });
  } else {
    out.push({ id: "providers", label: "Resource providers", status: "pass", detail: `${namespaces.length} registered` });
  }

  // Every resource type offered in the region (global types pass).
  const missing: string[] = [];
  for (const t of i.resourceTypes) {
    const [ns, ...rest] = t.split("/");
    const p = f.providers[ns!];
    if (!p) continue;
    const rt = p.resourceTypes.find((x) => x.resourceType.toLowerCase() === rest.join("/").toLowerCase());
    if (!rt) continue;
    const locs = rt.locations.map(normRegion);
    if (!locs.includes(region) && !locs.includes("global")) missing.push(pretty(t));
  }
  out.push(
    missing.length
      ? { id: "region", label: `Available in ${i.region}`, status: "fail", detail: `Not offered here: ${missing.join(", ")}` }
      : { id: "region", label: `Available in ${i.region}`, status: "pass", detail: `${i.resourceTypes.length} resource types` },
  );

  // Regional network quotas.
  const needs = Object.entries(i.quotas ?? {}).filter(([, n]) => n > 0);
  if (needs.length) {
    if (!f.usages) {
      out.push({ id: "quota", label: "Network quotas", status: "warn", detail: f.errors.usages ?? "Usage data unavailable" });
    } else {
      const lines: { status: FeasibilityStatus; text: string }[] = [];
      for (const [name, need] of needs) {
        const u = f.usages.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (!u) continue;
        const after = u.current + need;
        const status: FeasibilityStatus = after > u.limit ? "fail" : after > u.limit * 0.8 ? "warn" : "pass";
        lines.push({ status, text: `${name} ${u.current}+${need}/${u.limit}` });
      }
      const worst: FeasibilityStatus = lines.some((l) => l.status === "fail") ? "fail" : lines.some((l) => l.status === "warn") ? "warn" : "pass";
      const shown = worst === "pass" ? lines : lines.filter((l) => l.status !== "pass");
      out.push({ id: "quota", label: "Network quotas", status: lines.length ? worst : "skip", detail: shown.map((l) => l.text).join("; ") || "Not reported" });
    }
  }

  // Permissions to create everything.
  if (!f.permissions) {
    out.push({ id: "rbac", label: "Permissions", status: "warn", detail: f.errors.permissions ?? "Could not read effective permissions" });
  } else {
    const actions = ["Microsoft.Resources/deploymentStacks/write", "Microsoft.Resources/subscriptions/resourceGroups/write", ...new Set(i.resourceTypes.map((t) => `${t}/write`))];
    const denied = actions.filter((a) => !isPermitted(a, f.permissions!));
    out.push(
      denied.length
        ? { id: "rbac", label: "Permissions", status: "fail", detail: `Missing ${denied.join(", ")}` }
        : { id: "rbac", label: "Permissions", status: "pass", detail: `${actions.length} write actions allowed` },
    );
  }

  // VM sizes: offered and unrestricted for this subscription here, and room in the family and regional vCPU quota.
  for (const size of i.vmSizes ?? []) {
    const label = `VM ${size.replace(/^Standard_/, "")}`;
    if (!f.vmSkus) {
      out.push({ id: `vm-${size}`, label, status: "warn", detail: f.errors.vmSkus ?? "Compute SKU list unavailable" });
      continue;
    }
    const s = f.vmSkus.find((x) => x.name.toLowerCase() === size.toLowerCase());
    if (!s) out.push({ id: `vm-${size}`, label, status: "fail", detail: `Not offered in ${i.region}` });
    else if (s.restricted) out.push({ id: `vm-${size}`, label, status: "fail", detail: `${s.restricted} in ${i.region}` });
    else {
      const need = (name: string) => f.computeUsages?.find((u) => u.name.toLowerCase() === name.toLowerCase());
      const fam = need(s.family);
      const cores = need("cores");
      const short = [fam, cores].filter((u): u is NonNullable<typeof u> => Boolean(u) && u!.current + s.vcpus > u!.limit);
      out.push(
        short.length
          ? { id: `vm-${size}`, label, status: "fail", detail: `vCPU quota: ${short.map((u) => `${u.name} ${u.current}+${s.vcpus}/${u.limit}`).join(", ")}` }
          : { id: `vm-${size}`, label, status: "pass", detail: `${s.vcpus} vCPU${fam ? `; ${s.family} ${fam.current}+${s.vcpus}/${fam.limit}` : ""}` },
      );
    }
  }

  if (i.capacity) {
    const hours = Math.max(1, Math.round((Date.now() - Date.parse(i.capacity.at)) / 3_600_000));
    out.push({ id: "capacity", label: `Capacity in ${i.region}`, status: "warn", detail: `A deployment here hit a capacity limit ${hours} h ago: ${i.capacity.detail.slice(0, 160)}` });
  }

  // Lifetime long enough to be useful.
  const [minMin, maxMin] = i.deployMinutes;
  const ttlMin = i.ttlHours * 60;
  if (minMin >= ttlMin) out.push({ id: "ttl", label: "Lifetime", status: "fail", detail: `Deploy takes ${minMin}+ min; lifetime is ${i.ttlHours} h` });
  else if (maxMin > ttlMin / 2) out.push({ id: "ttl", label: "Lifetime", status: "warn", detail: `Deploy can take ${maxMin} min of the ${i.ttlHours} h lifetime` });
  else out.push({ id: "ttl", label: "Lifetime", status: "pass", detail: `${minMin}â€“${maxMin} min to deploy, ${i.ttlHours} h to use` });

  // Budget impact.
  const labCost = i.hourly * i.ttlHours;
  const B = i.budget.monthlyUsd;
  const forecast = i.budget.forecastMonth;
  const high = i.hourly >= 1;
  if (forecast === undefined) {
    out.push({ id: "budget", label: "Budget", status: high ? "warn" : "skip", detail: `~${usd(labCost)} for ${i.ttlHours} h${high ? ` at ${usd(i.hourly)}/h` : ""}; no forecast yet` });
  } else if (forecast + labCost > B) {
    out.push({ id: "budget", label: "Budget", status: "warn", detail: `Forecast ${usd(forecast)} + ~${usd(labCost)} passes ${usd(B)}` });
  } else if (high || labCost > B * 0.2) {
    out.push({ id: "budget", label: "Budget", status: "warn", detail: `${usd(i.hourly)}/h â€” ~${usd(labCost)} for ${i.ttlHours} h (forecast ${usd(forecast)} of ${usd(B)})` });
  } else {
    out.push({ id: "budget", label: "Budget", status: "pass", detail: `~${usd(labCost)} for ${i.ttlHours} h; forecast ${usd(forecast)} of ${usd(B)}` });
  }
  return out;
}

const HOUR = 3_600_000;

/** Drops a cached provider so the next check sees a fresh registration state. */
export function forgetProvider(db: Db, sub: string, ns: string) {
  db.prepare("DELETE FROM cost_cache WHERE key = ?").run(`feas:${sub}:provider:${ns}`);
}

async function tryFact<T>(errors: Record<string, string>, key: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    errors[key] = (e as Error).message.slice(0, 200);
    return undefined;
  }
}

export async function gatherFacts(
  arm: ArmClient,
  db: Db,
  sub: string,
  region: string,
  opts: { namespaces: string[]; quotas: boolean; vms?: boolean },
): Promise<AzureFacts> {
  const errors: Record<string, string> = {};
  const providers: Record<string, ProviderInfo | undefined> = {};
  const providerTasks = opts.namespaces.map(async (ns) => {
    providers[ns] = await tryFact(errors, `provider:${ns}`, async () => {
      // Registration state changes when the user registers a provider, so only cache briefly.
      const v = await cached<ProviderInfo>(db, `feas:${sub}:provider:${ns}`, 10 * 60_000, false, async () => {
        const p = await arm.get<ProviderInfo>(`/subscriptions/${sub}/providers/${ns}?api-version=2021-04-01`);
        return { registrationState: p.registrationState, resourceTypes: p.resourceTypes.map((t) => ({ resourceType: t.resourceType, locations: t.locations })) };
      });
      return v.value;
    });
  });
  const usages = opts.quotas
    ? tryFact(errors, "usages", async () =>
        (
          await cached(db, `feas:${sub}:usages:${region}`, 10 * 60_000, false, async () => {
            const r = await arm.get<{ value: { name: { value: string }; currentValue: number; limit: number }[] }>(
              `/subscriptions/${sub}/providers/Microsoft.Network/locations/${region}/usages?api-version=2024-05-01`,
            );
            return r.value.map((u) => ({ name: u.name.value, current: u.currentValue, limit: u.limit }));
          })
        ).value,
      )
    : Promise.resolve(undefined);
  const permissions = tryFact(errors, "permissions", async () =>
    (
      await cached<PermissionEntry[]>(db, `feas:${sub}:permissions`, HOUR, false, async () => {
        const r = await arm.get<{ value: { actions?: string[]; notActions?: string[] }[] }>(`/subscriptions/${sub}/providers/Microsoft.Authorization/permissions?api-version=2022-04-01`);
        return r.value.map((e) => ({ actions: e.actions ?? [], notActions: e.notActions ?? [] }));
      })
    ).value,
  );
  const vmSkus = opts.vms
    ? tryFact(errors, "vmSkus", async () =>
        (
          await cached<VmSkuInfo[]>(db, `feas:${sub}:vmSkus:${region}`, 6 * HOUR, false, async () => {
            const r = await arm.get<{
              value: { resourceType: string; name: string; family?: string; locations: string[]; capabilities?: { name: string; value: string }[]; restrictions?: { type: string; reasonCode?: string }[] }[];
            }>(`/subscriptions/${sub}/providers/Microsoft.Compute/skus?api-version=2021-07-01&$filter=${encodeURIComponent(`location eq \u0027${region}\u0027`)}`);
            return r.value
              .filter((x) => x.resourceType === "virtualMachines")
              .map((x) => {
                const loc = (x.restrictions ?? []).find((rr) => rr.type === "Location");
                return { name: x.name, family: x.family ?? "", vcpus: Number(x.capabilities?.find((c) => c.name === "vCPUs")?.value ?? 0), restricted: loc ? (loc.reasonCode ?? "Restricted") : undefined };
              });
          })
        ).value,
      )
    : Promise.resolve(undefined);
  const computeUsages = opts.vms
    ? tryFact(errors, "computeUsages", async () =>
        (
          await cached(db, `feas:${sub}:computeUsages:${region}`, 10 * 60_000, false, async () => {
            const r = await arm.get<{ value: { name: { value: string }; currentValue: number; limit: number }[] }>(`/subscriptions/${sub}/providers/Microsoft.Compute/locations/${region}/usages?api-version=2023-07-01`);
            return r.value.map((x) => ({ name: x.name.value, current: x.currentValue, limit: x.limit }));
          })
        ).value,
      )
    : Promise.resolve(undefined);
  const [u, p, vs, cu] = await Promise.all([usages, permissions, vmSkus, computeUsages, ...providerTasks]);
  return {
    providers,
    usages: u as AzureFacts["usages"],
    permissions: p as PermissionEntry[] | undefined,
    vmSkus: vs as VmSkuInfo[] | undefined,
    computeUsages: cu as AzureFacts["computeUsages"],
    errors,
  };
}


