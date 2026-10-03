import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { ArmClient } from "../azure/arm.ts";
import { DATA_DIR } from "../config.ts";
import type { HookKind } from "./blueprints.ts";

/** Context a hook gets before a stage: who/where the lab is and the outputs of earlier stages. */
export interface HookCtx {
  arm: Pick<ArmClient, "post">;
  labName: string;
  subscriptionId: string;
  region: string;
  params: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

/** Returns extra template parameters for this and later stages. */
export type ParamHook = (ctx: HookCtx) => Promise<Record<string, unknown>>;

/** Lab-local files (generated material) live here and are deleted with the lab. */
export const labDataDir = (labName: string) => resolve(DATA_DIR, "labs", labName);

/** Random admin password meeting Azure complexity rules; nothing listens for it (no SSH port is opened). */
export function vmPassword(): string {
  return `Lc${randomBytes(18).toString("base64url")}!7a`;
}

export const PARAM_HOOKS: Record<HookKind, ParamHook> = {
  "vm-password": async () => ({ adminPassword: vmPassword() }),
};
