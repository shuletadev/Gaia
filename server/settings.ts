import { renameSync, writeFileSync } from "node:fs";
import { configSchema, withEnvOverrides, type LabctlConfig } from "./config.ts";

/**
 * Settings as the app edits them. The live config object is shared by every route, the sweeper and the
 * engine, so changes are applied by mutating it in place (no restart); the Azure client switches tenant.
 */

/** Azure regions offered in setup/settings (labs can only be launched in the ones enabled). */
export const AZURE_REGIONS = [
  "eastus", "eastus2", "centralus", "northcentralus", "southcentralus", "westcentralus", "westus", "westus2", "westus3",
  "canadacentral", "canadaeast", "brazilsouth", "mexicocentral",
  "northeurope", "westeurope", "uksouth", "ukwest", "francecentral", "germanywestcentral", "swedencentral", "switzerlandnorth", "norwayeast", "italynorth", "polandcentral", "spaincentral",
  "eastasia", "southeastasia", "japaneast", "japanwest", "koreacentral", "australiaeast", "australiasoutheast", "centralindia", "southindia",
  "uaenorth", "southafricanorth", "qatarcentral", "israelcentral",
];

export const DEFAULT_REGIONS = ["centralus", "eastus", "eastus2", "westus2", "westus3", "northeurope", "westeurope", "canadacentral"];

/** Placeholder used until setup completes; never written to disk and never used to call Azure. */
export function blankConfig(): LabctlConfig {
  return {
    tenantId: "",
    subscriptions: [],
    excludedResourceGroups: [],
    budget: { monthlyUsd: 300, alertThresholds: [0.5, 0.8, 1] },
    ttlHours: { default: 8, byBlueprint: { "apim-internal-appgw": 12 } },
    owner: "",
    server: { port: 4870 },
    labs: { defaultRegion: "centralus", regions: [...DEFAULT_REGIONS], sweepIntervalMinutes: 15, sweepEnabled: true },
  };
}

export function isConfigured(c: LabctlConfig): boolean {
  return Boolean(c.tenantId && c.subscriptions.length);
}

/** Validates settings coming from the UI; the port is not editable there (it needs a restart). */
export function parseSettings(input: unknown, current: LabctlConfig): LabctlConfig {
  const parsed = configSchema.parse({ ...(input as object), server: current.server });
  if (!parsed.labs.regions.length) throw new SettingsError("Enable at least one region");
  if (!parsed.labs.regions.includes(parsed.labs.defaultRegion)) throw new SettingsError(`Default region ${parsed.labs.defaultRegion} is not enabled`);
  const ids = parsed.subscriptions.map((s) => s.id.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new SettingsError("A subscription is listed twice");
  return parsed;
}

export class SettingsError extends Error {}

/** Writes atomically (temp file + rename) so a crash never leaves a half-written config. */
export function saveConfig(path: string, c: LabctlConfig) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

/** Replaces the live config's contents with `next` so existing references see the change. */
export function applyInPlace(live: LabctlConfig, next: LabctlConfig) {
  const port = live.server.port;
  // Every key is present in a validated config, so assigning replaces all of them.
  Object.assign(live, structuredClone(next));
  live.server = { ...live.server, port };
  withEnvOverrides(live);
}

export interface SettingsChange {
  summary: string[];
  /** Changes that widen what Gaia may modify or remove a safety net; the UI asks before applying them. */
  sensitive: string[];
}

export function diffSettings(before: LabctlConfig, after: LabctlConfig): SettingsChange {
  const summary: string[] = [];
  const sensitive: string[] = [];
  const subName = (c: LabctlConfig, id: string) => c.subscriptions.find((s) => s.id.toLowerCase() === id)?.name ?? id;
  if (before.tenantId.toLowerCase() !== after.tenantId.toLowerCase()) {
    const t = `Tenant changes to ${after.tenantId}`;
    summary.push(t);
    if (before.tenantId) sensitive.push(t);
  }
  const subsBefore = new Set(before.subscriptions.map((s) => s.id.toLowerCase()));
  const subsAfter = new Set(after.subscriptions.map((s) => s.id.toLowerCase()));
  for (const id of subsAfter) if (!subsBefore.has(id)) {
    const t = `Gaia may change resources in subscription "${subName(after, id)}"`;
    summary.push(t);
    if (before.subscriptions.length) sensitive.push(t);
  }
  for (const id of subsBefore) if (!subsAfter.has(id)) summary.push(`Subscription "${subName(before, id)}" removed`);
  const exBefore = new Set(before.excludedResourceGroups.map((g) => g.toLowerCase()));
  const exAfter = new Set(after.excludedResourceGroups.map((g) => g.toLowerCase()));
  for (const g of before.excludedResourceGroups) if (!exAfter.has(g.toLowerCase())) {
    const t = `Resource group "${g}" is no longer protected`;
    summary.push(t);
    sensitive.push(t);
  }
  for (const g of after.excludedResourceGroups) if (!exBefore.has(g.toLowerCase())) summary.push(`Resource group "${g}" protected`);
  if (before.budget.monthlyUsd !== after.budget.monthlyUsd) summary.push(`Budget $${before.budget.monthlyUsd} → $${after.budget.monthlyUsd}`);
  if (before.ttlHours.default !== after.ttlHours.default) summary.push(`Default lifetime ${before.ttlHours.default} h → ${after.ttlHours.default} h`);
  if (JSON.stringify(before.ttlHours.byBlueprint) !== JSON.stringify(after.ttlHours.byBlueprint)) summary.push("Per-lab lifetimes changed");
  if (before.owner !== after.owner) summary.push(`Owner tag ${before.owner || "(none)"} → ${after.owner}`);
  if (JSON.stringify([...before.labs.regions].sort()) !== JSON.stringify([...after.labs.regions].sort())) summary.push(`Regions: ${after.labs.regions.join(", ")}`);
  if (before.labs.defaultRegion !== after.labs.defaultRegion) summary.push(`Default region ${after.labs.defaultRegion}`);
  if (before.labs.sweepEnabled !== after.labs.sweepEnabled) {
    const t = after.labs.sweepEnabled ? "Auto-clean of expired labs turned on" : "Auto-clean of expired labs turned off";
    summary.push(t);
    if (!after.labs.sweepEnabled) sensitive.push(t);
  }
  if (before.labs.sweepIntervalMinutes !== after.labs.sweepIntervalMinutes) summary.push(`Auto-clean every ${after.labs.sweepIntervalMinutes} min`);
  return { summary, sensitive };
}

const GOVERNANCE: { rx: RegExp; reason: string }[] = [
  { rx: /mcaps|governance|policy|compliance|security(center)?|defender/i, reason: "governance / security" },
  { rx: /^NetworkWatcherRG$/i, reason: "Network Watcher (Azure-managed)" },
  { rx: /^cloud-shell-storage-/i, reason: "Cloud Shell storage" },
  { rx: /^(DefaultResourceGroup-|LogAnalyticsDefaultResources|Default-ActivityLogAlerts|AzureBackupRG_|DefaultResourceGroup$)/i, reason: "Azure default group" },
  { rx: /^MC_/i, reason: "AKS node resource group (managed by AKS)" },
  { rx: /^databricks-rg-|^synapseworkspace-managedrg-|^managed-rg-/i, reason: "service-managed group" },
];

/** Resource groups worth protecting by default: governance, Azure-managed and service-managed groups. */
export function suggestProtectedGroups(groups: { name: string; tags?: Record<string, string> | null }[]): { name: string; reason: string }[] {
  const out: { name: string; reason: string }[] = [];
  for (const g of groups) {
    const hit = GOVERNANCE.find((p) => p.rx.test(g.name));
    if (hit) out.push({ name: g.name, reason: hit.reason });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
