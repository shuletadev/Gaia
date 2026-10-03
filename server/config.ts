import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const guid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a GUID");

export const configSchema = z.object({
  tenantId: guid,
  subscriptions: z.array(z.object({ id: guid, name: z.string().min(1) })).min(1),
  excludedResourceGroups: z.array(z.string()).default([]),
  budget: z.object({
    monthlyUsd: z.number().positive(),
    alertThresholds: z.array(z.number().positive().max(2)).default([0.5, 0.8, 1.0]),
  }),
  ttlHours: z.object({
    default: z.number().positive(),
    byBlueprint: z.record(z.string(), z.number().positive()).default({}),
  }),
  owner: z.string().min(1),
  server: z.object({ port: z.number().int().min(1024).max(65535) }).default({ port: 4870 }),
  labs: z
    .object({
      defaultRegion: z.string().default("centralus"),
      regions: z.array(z.string()).default(["centralus", "eastus", "eastus2", "westus2", "westus3", "northeurope", "westeurope", "canadacentral"]),
      sweepIntervalMinutes: z.number().int().min(5).default(15),
      sweepEnabled: z.boolean().default(true),
    })
    .default({ defaultRegion: "centralus", regions: ["centralus", "eastus", "eastus2", "westus2", "westus3", "northeurope", "westeurope", "canadacentral"], sweepIntervalMinutes: 15, sweepEnabled: true }),
});

export type LabctlConfig = z.infer<typeof configSchema>;

export const PROJECT_ROOT = resolve(import.meta.dirname, "..");
/** Overridable so a second instance (or a test) can run with its own database and settings. */
export const DATA_DIR = process.env.LABCTL_DATA_DIR ? resolve(process.env.LABCTL_DATA_DIR) : resolve(PROJECT_ROOT, "data");
export const CONFIG_PATH = process.env.LABCTL_CONFIG ? resolve(process.env.LABCTL_CONFIG) : resolve(PROJECT_ROOT, "labctl.config.json");

/** Thrown when there is no configuration yet (first run): the app starts in setup mode instead. */
export class ConfigMissingError extends Error {}

/** The config as saved on disk, without environment overrides (what Settings shows and edits). */
export function readConfigFile(path = CONFIG_PATH): LabctlConfig {
  if (!existsSync(path)) {
    throw new ConfigMissingError(`Gaia isn't set up yet: no ${path}. Open the app (npm start) to run setup, or copy labctl.config.example.json.`);
  }
  const parsed = configSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`Invalid labctl.config.json:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function loadConfig(path = CONFIG_PATH): LabctlConfig {
  return withEnvOverrides(readConfigFile(path));
}

/** Environment overrides let a second instance run side by side (e.g. for testing). */
export function withEnvOverrides(config: LabctlConfig): LabctlConfig {
  const port = Number(process.env.LABCTL_PORT);
  if (Number.isInteger(port) && port > 1023) config.server.port = port;
  if (process.env.LABCTL_SWEEP === "0") config.labs.sweepEnabled = false;
  return config;
}

export function ttlForBlueprint(config: LabctlConfig, blueprint: string): number {
  return config.ttlHours.byBlueprint[blueprint] ?? config.ttlHours.default;
}
