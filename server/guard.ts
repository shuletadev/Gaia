import type { LabctlConfig } from "./config.ts";

export const MANAGED_BY_TAG = "managedBy";
export const MANAGED_BY_VALUE = "labctl";
export const EXPIRES_TAG = "expiresOn";
export const LIFECYCLE_TAG = "lifecycle";
export const PERSISTENT_VALUE = "persistent";

export type Tags = Record<string, string> | null | undefined;

export class ScopeError extends Error {}

/** Case-insensitive tag lookup (Azure tag names are case-insensitive). */
export function getTag(tags: Tags, name: string): string | undefined {
  if (!tags) return undefined;
  const key = Object.keys(tags).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : tags[key];
}

export function isAllowedSubscription(config: LabctlConfig, subscriptionId: string): boolean {
  return config.subscriptions.some((s) => s.id.toLowerCase() === subscriptionId.toLowerCase());
}

export function assertAllowedSubscription(config: LabctlConfig, subscriptionId: string): void {
  if (!isAllowedSubscription(config, subscriptionId)) {
    throw new ScopeError(`Subscription ${subscriptionId} is not in the labctl allow-list`);
  }
}

export function isExcludedResourceGroup(config: LabctlConfig, resourceGroup: string): boolean {
  return config.excludedResourceGroups.some((rg) => rg.toLowerCase() === resourceGroup.toLowerCase());
}

/** Extracts subscription and resource group from an ARM resource ID. */
export function parseResourceId(id: string): { subscriptionId: string; resourceGroup?: string } {
  const m = /^\/subscriptions\/([^/]+)(?:\/resourceGroups\/([^/]+))?/i.exec(id);
  if (!m?.[1]) throw new ScopeError(`Not an ARM resource ID: ${id}`);
  return { subscriptionId: m[1], resourceGroup: m[2] };
}

/** Resource type from an ARM ID, e.g. Microsoft.Network/virtualNetworks/subnets. Undefined for subscriptions and groups. */
export function typeFromId(id: string): string | undefined {
  const m = /\/providers\/([^/]+)\/(.+)$/i.exec(id);
  if (!m?.[1] || !m[2]) return undefined;
  const parts = m[2].split("/");
  const types = parts.filter((_, i) => i % 2 === 0);
  return [m[1], ...types].join("/");
}

export function isLabManaged(tags: Tags): boolean {
  return getTag(tags, MANAGED_BY_TAG)?.toLowerCase() === MANAGED_BY_VALUE;
}

/** Marked as intentionally long-lived: always-on cost is acknowledged rather than flagged. */
export function isPersistent(tags: Tags): boolean {
  return getTag(tags, LIFECYCLE_TAG)?.toLowerCase() === PERSISTENT_VALUE;
}

/** Any change (tag, park, resume, delete) must target something in an allow-listed subscription and a non-excluded group. */
export function canModify(config: LabctlConfig, targetId: string): DeleteVerdict {
  return canManualDelete(config, targetId);
}

export function expiresAt(tags: Tags): Date | undefined {
  const raw = getTag(tags, EXPIRES_TAG);
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export type DeleteVerdict = { allowed: true } | { allowed: false; reason: string };

/**
 * Automatic (unattended) deletion is only allowed for resource groups that labctl created,
 * that are past their expiry, inside the allow-listed subscription and not excluded.
 */
export function canAutoDelete(
  config: LabctlConfig,
  rg: { id: string; name: string; tags: Tags },
  now = new Date(),
): DeleteVerdict {
  const { subscriptionId } = parseResourceId(rg.id);
  if (!isAllowedSubscription(config, subscriptionId)) return { allowed: false, reason: "subscription not allow-listed" };
  if (isExcludedResourceGroup(config, rg.name)) return { allowed: false, reason: "resource group is excluded" };
  if (!isLabManaged(rg.tags)) return { allowed: false, reason: "not managed by labctl" };
  const exp = expiresAt(rg.tags);
  if (!exp) return { allowed: false, reason: "no valid expiresOn tag" };
  if (exp.getTime() > now.getTime()) return { allowed: false, reason: "not expired yet" };
  return { allowed: true };
}

/**
 * Manual (user-confirmed) deletion of an individual resource: anything in scope that is not in an
 * excluded resource group. The caller must also require typed confirmation.
 */
export function canManualDelete(config: LabctlConfig, resourceId: string): DeleteVerdict {
  const { subscriptionId, resourceGroup } = parseResourceId(resourceId);
  if (!isAllowedSubscription(config, subscriptionId)) return { allowed: false, reason: "subscription not allow-listed" };
  if (!resourceGroup) return { allowed: false, reason: "subscription-level resources cannot be deleted from labctl" };
  if (isExcludedResourceGroup(config, resourceGroup)) return { allowed: false, reason: "resource group is excluded" };
  return { allowed: true };
}
