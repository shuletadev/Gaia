import type { ArmClient } from "../azure/arm.ts";
import type { LabctlConfig } from "../config.ts";
import { EXPIRES_TAG, getTag, LIFECYCLE_TAG, MANAGED_BY_TAG, MANAGED_BY_VALUE, PERSISTENT_VALUE, parseResourceId } from "../guard.ts";

const TAGS_API = "2021-04-01";

interface TagsResource {
  properties: { tags?: Record<string, string> };
}

export async function readTags(arm: ArmClient, scopeId: string): Promise<Record<string, string>> {
  const res = await arm.get<TagsResource>(`${scopeId}/providers/Microsoft.Resources/tags/default?api-version=${TAGS_API}`);
  return res.properties.tags ?? {};
}

async function patchTags(arm: ArmClient, scopeId: string, operation: "Merge" | "Delete", tags: Record<string, string>) {
  if (Object.keys(tags).length === 0) return;
  await arm.request("PATCH", `${scopeId}/providers/Microsoft.Resources/tags/default?api-version=${TAGS_API}`, { operation, properties: { tags } });
}

/** Removes the named tags whatever their current key casing/value (the Delete operation needs exact key and value). */
async function removeTags(arm: ArmClient, scopeId: string, names: string[]) {
  const current = await readTags(arm, scopeId);
  const toDelete: Record<string, string> = {};
  for (const [k, v] of Object.entries(current)) {
    if (names.some((n) => n.toLowerCase() === k.toLowerCase())) toDelete[k] = v;
  }
  await patchTags(arm, scopeId, "Delete", toDelete);
}

export function isResourceGroupId(id: string): boolean {
  return /^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+$/i.test(id);
}

export function expiryFromNow(hours: number, now = new Date()): string {
  return new Date(now.getTime() + hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Adopting a resource group makes labctl own it: it gets an expiry and becomes eligible for the expiry sweep. */
export async function adoptResourceGroup(arm: ArmClient, config: LabctlConfig, rgId: string, opts: { ttlHours: number; purpose?: string }) {
  if (!isResourceGroupId(rgId)) throw new Error("Only resource groups can be adopted as labs");
  if (!(opts.ttlHours > 0 && opts.ttlHours <= 24 * 30)) throw new Error("Lifetime must be between 1 hour and 30 days");
  parseResourceId(rgId);
  const expires = expiryFromNow(opts.ttlHours);
  await patchTags(arm, rgId, "Merge", {
    [MANAGED_BY_TAG]: MANAGED_BY_VALUE,
    [EXPIRES_TAG]: expires,
    owner: config.owner,
    purpose: opts.purpose?.trim() || "adopted",
  });
  await removeTags(arm, rgId, [LIFECYCLE_TAG]);
  return `Adopted; expires ${expires}`;
}

export async function releaseResourceGroup(arm: ArmClient, rgId: string) {
  if (!isResourceGroupId(rgId)) throw new Error("Only resource groups can be released");
  await removeTags(arm, rgId, [MANAGED_BY_TAG, EXPIRES_TAG]);
  return "Released; no longer managed by labctl";
}

export async function extendLab(arm: ArmClient, rgId: string, hours: number) {
  if (!isResourceGroupId(rgId)) throw new Error("Only labs (resource groups) can be extended");
  if (!(hours > 0 && hours <= 24 * 7)) throw new Error("Extension must be between 1 hour and 7 days");
  const tags = await readTags(arm, rgId);
  if (getTag(tags, MANAGED_BY_TAG)?.toLowerCase() !== MANAGED_BY_VALUE) throw new Error("Not a labctl lab");
  const current = new Date(getTag(tags, EXPIRES_TAG) ?? "");
  const base = Number.isNaN(current.getTime()) || current.getTime() < Date.now() ? new Date() : current;
  const expires = expiryFromNow(hours, base);
  await patchTags(arm, rgId, "Merge", { [EXPIRES_TAG]: expires });
  return `Extended to ${expires}`;
}

export async function setPersistent(arm: ArmClient, targetId: string, persistent: boolean) {
  if (persistent) {
    if (isResourceGroupId(targetId)) {
      const tags = await readTags(arm, targetId);
      if (getTag(tags, MANAGED_BY_TAG)?.toLowerCase() === MANAGED_BY_VALUE) throw new Error("Release this lab before marking it persistent");
    }
    await patchTags(arm, targetId, "Merge", { [LIFECYCLE_TAG]: PERSISTENT_VALUE });
    return "Marked persistent";
  }
  await removeTags(arm, targetId, [LIFECYCLE_TAG]);
  return "Persistent mark removed";
}
