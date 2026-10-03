import type { Estimate } from "../../server/labs/pricing.ts";

export type { Snapshot, InventoryGroup, InventoryResource, ResourceRef } from "../../server/snapshot.ts";
export type { Finding, Severity } from "../../server/audit/rules.ts";
export type { DeletePreview, DeletePreviewItem } from "../../server/actions/deletion.ts";
export type { Job } from "../../server/jobs.ts";
export type { ActionLogEntry } from "../../server/db.ts";
export type { PowerInfo } from "../../server/actions/power.ts";
export type { ParamField, DeployStep } from "../../server/labs/blueprints.ts";
export type { Estimate } from "../../server/labs/pricing.ts";
export type { StepProgress, ValidationResult, StageState } from "../../server/labs/engine.ts";
export type { FeasibilityCheck } from "../../server/labs/feasibility.ts";
export type { SweepResult } from "../../server/labs/sweeper.ts";

export interface StagePlan {
  label: string;
  gate?: string;
}

/** /api/labs/estimate: price plus everything that depends on the chosen parameters. */
export interface Timing {
  source: "learned" | "static";
  samples: number;
  typical?: number;
}

export type { AlternativesResult, Alternative } from "../../server/labs/alternatives.ts";

export interface LabEstimate extends Estimate {
  rules: string[];
  deployMinutes: [number, number];
  timing?: Timing;
  steps: import("../../server/labs/blueprints.ts").DeployStep[];
  stages: StagePlan[];
}

export interface BlueprintInfo {
  id: string;
  title: string;
  category: string;
  tagline: string;
  scenario?: { story: string; objectives: string[]; exams: string[] };
  deployMinutes: [number, number];
  icons: string[];
  fields: import("../../server/labs/blueprints.ts").ParamField[];
  notes: string[];
  ttlHours: number;
  steps: import("../../server/labs/blueprints.ts").DeployStep[];
  stages: StagePlan[];
  presets: { label: string; params: Record<string, unknown> }[];
  timing?: Timing;
  custom?: { source: { resourceGroup: string; exportedAt: string }; warnings: string[]; module: string; decompileOk: boolean };
}

export type { CustomMeta } from "../../server/labs/export.ts";

export interface Catalog {
  categories: string[];
  regions: string[];
  defaultRegion: string;
  blueprints: BlueprintInfo[];
}

export interface Lab {
  name: string;
  blueprint: string;
  region: string;
  status: "deploying" | "ready" | "failed" | "destroying" | "destroyed";
  purpose: string | null;
  params: Record<string, unknown>;
  estHourly: number | null;
  createdAt: string | null;
  readyAt: string | null;
  destroyedAt: string | null;
  expiresOn?: string;
  outputs: Record<string, unknown>;
  error: string | null;
  stage: import("../../server/labs/engine.ts").StageState | null;
  etaMinutes?: number;
  exists: boolean;
  resourceGroupId: string;
}

export interface LabsResponse {
  labs: Lab[];
  sweep: { last?: import("../../server/labs/sweeper.ts").SweepResult; nextAt?: string; enabled: boolean };
}

export interface Status {
  configured: boolean;
  tenantId: string;
  subscriptions: { id: string; name: string }[];
  budget: { monthlyUsd: number; alertThresholds: number[] };
  ttlHours: { default: number; byBlueprint: Record<string, number> };
  owner: string;
  identity: { ok: boolean; error?: string };
}

export type Settings = import("../../server/config.ts").LabctlConfig;
export type { AzStatus, AzSubscription } from "../../server/setup/azcli.ts";

export interface SetupState {
  configured: boolean;
  configPath: string;
  az: import("../../server/setup/azcli.ts").AzStatus;
  icons: { installed: boolean; terms: string };
  regions: string[];
  defaults: Settings;
}

export interface TenantInfo {
  tenantId: string;
  name?: string;
  domain?: string;
  count: number;
}

export interface SubscriptionList {
  subscriptions: import("../../server/setup/azcli.ts").AzSubscription[];
  tenants: TenantInfo[];
}

export interface GroupSuggestions {
  groups: { name: string; subscriptionId: string }[];
  suggested: { name: string; reason: string }[];
}

