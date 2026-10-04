import { z } from "zod";
import { CATALOG } from "./catalog/index.ts";
import { loadCustomBlueprints } from "./export.ts";

export interface ParamField {
  key: string;
  label: string;
  kind: "select" | "int" | "toggle";
  options?: { value: string; label: string }[];
  /** Options come from the enabled lab regions, with an empty choice labelled by `emptyLabel`. */
  optionsFrom?: "regions";
  emptyLabel?: string;
  min?: number;
  max?: number;
  default: string | number | boolean;
}

/** A nested deployment (Bicep module name) shown as a step in the live progress view. */
export interface DeployStep {
  name: string;
  label: string;
  type: string;
}

/** A Retail Prices API meter and how many units the lab consumes per hour. */
export interface PriceMeter {
  label: string;
  serviceName: string;
  productName?: string;
  skuName: string;
  meterName: string;
  unitsPerHour: number;
  /** Price region when it is not the lab's region (e.g. Front Door bills per zone). */
  armRegion?: string;
  /** Published list price for meters missing from the Retail Prices API. */
  fixedHourly?: number;
}

/** An app deployed to a service the template created, after the stack update and before the stage's gate. */
export type ContentDef = StaticWebAppContent | StorageSiteContent | BlobUploadContent | SqlSeedContent;

interface ContentBase {
  label: string;
  /** Runs at the first stage whose value is at least this (default: the first stage). */
  fromStage?: number;
  /** Skipped when this returns false for the lab's parameters (e.g. a "seed sample data" toggle). */
  when?: (params: any) => boolean;
}

/** Where the files come from: a folder under blueprints/<id>/, or a generator of synthetic sample data (server/labs/samples.ts). */
export type SampleSource = { dir: string } | { generator: string };

/** An app published to a Static Web App with the SWA CLI. */
export interface StaticWebAppContent extends ContentBase {
  kind: "static-web-app";
  /** Folder under blueprints/<id>/ holding the files (must contain index.html). */
  dir: string;
  /** Stack output holding the Static Web App's name. */
  siteOutput: string;
}

/** A static website on a Storage account: turns the feature on (a data-plane setting) and uploads the files to $web. */
export interface StorageSiteContent extends ContentBase {
  kind: "storage-static-site";
  accountOutput: string;
  source: SampleSource;
}

/** Sample files uploaded to a blob container the template created. */
export interface BlobUploadContent extends ContentBase {
  kind: "blob-upload";
  accountOutput: string;
  container: string;
  source: SampleSource;
}

/** A T-SQL script (batches separated by GO) run against an Azure SQL database as its admin. */
export interface SqlSeedContent extends ContentBase {
  kind: "sql-seed";
  serverOutput: string;
  database: string;
  /** Script under blueprints/<id>/. */
  script: string;
  adminUser: string;
  /** Name of the generated hook value holding the admin password. */
  passwordParam: string;
}

export interface Blueprint<P extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  title: string;
  /** Catalog and history grouping. */
  category?: Category;
  tagline: string;
  /** Short code used in lab names: lab-<code>-<suffix>. */
  code: string;
  deployMinutes: [number, number];
  /** Resource types shown as the card's icon strip. */
  icons: string[];
  fields: ParamField[];
  schema: z.ZodType<P>;
  steps: (p: P) => DeployStep[];
  meters: (p: P) => PriceMeter[];
  /** Usage-based charges the hourly estimate leaves out. */
  notes: string[];
  /** Extra ARM template parameters beyond labName/location/tags. */
  armParams: (p: P, ctx: { owner: string }) => Record<string, unknown>;
  /** Resource types created but not shown as steps or icons (checked for region support). */
  extraTypes?: string[] | ((p: P) => string[]);
  /** VM sizes the lab creates (checked for regional availability and vCPU quota). */
  vmSizes?: (p: P) => string[];
  /** Apps to deploy once the template has created their host (see ContentDef). */
  content?: ContentDef[];
  /** Resource types that are not offered in every region (e.g. Static Web Apps); the template picks their location, so the region check skips them. */
  regionFree?: string[];
  /** Showcase context for classes: the business story, what students learn and which exams it supports. */
  scenario?: { story: string; objectives: string[]; exams: string[] };
  /** Cheaper or more available variants to offer when a launch is infeasible or expensive. */
  alternatives?: (p: P) => { params: Partial<P>; loses: string }[];
  /** Microsoft.Network regional usages the lab consumes (usage name -> count). */
  quotas?: (p: P) => Record<string, number>;
  /** Combinations Azure rejects late in a deployment; returned messages block the launch. */
  rules?: (p: P) => string[];
  /** Ordered deployment stages; without it the template is applied once. */
  stages?: (p: P) => StageDef[];
  /** Values labctl computes before a stage (tokens, certificates) and passes as template parameters. */
  paramHooks?: { fromStage: number; hook: HookKind; label: string; validateWith?: Record<string, unknown> }[];
  /** Parameters that change deploy time (e.g. tier, VNet mode); deploy times are learned per variant. */
  timingKey?: (p: P) => string;
  /** Deploy time when it depends on the parameters (defaults to deployMinutes). */
  deployTime?: (p: P) => [number, number];
  /** One-click parameter sets shown in the launch dialog. */
  presets?: { label: string; params: Partial<P> }[];
  /** Present for blueprints exported from an existing resource group. */
  custom?: { source: { resourceGroup: string; subscriptionId: string; location: string; exportedAt: string }; warnings: string[]; module: string; decompileOk: boolean };
}

/** Catalog sections, in display order. */
export const CATEGORIES = ["Showcase", "Exported"] as const;
export type Category = (typeof CATEGORIES)[number];

export const categoryOf = (b: Pick<Blueprint, "category" | "custom">): Category => b.category ?? (b.custom ? "Exported" : "Showcase");

/** `http-ok`: an output URL (`outputs.url`) answers 200. */
export type GateKind = "http-ok";

export type HookKind = "vm-password";

/** A readiness check polled after a stage, before the next one starts. */
export interface GateDef {
  kind: GateKind;
  label: string;
  timeoutMin: number;
  /** Blocking gates fail the lab (Retry resumes there); others only add a warning. */
  blocking: boolean;
}

export interface StageDef {
  /** Value passed as the template's `stage` parameter; omitted for single-pass templates. */
  value?: number;
  label: string;
  gate?: GateDef;
}

export const SINGLE_STAGE: StageDef[] = [{ label: "Deploy" }];

export function stagesFor(b: Blueprint<any>, params: Record<string, unknown>): StageDef[] {
  const s = b.stages?.(params);
  return s?.length ? s : SINGLE_STAGE;
}

export function deployMinutesFor(b: Blueprint<any>, params: Record<string, unknown>): [number, number] {
  return b.deployTime?.(params) ?? b.deployMinutes;
}


/** Zod boolean that also accepts the strings a form or query might send. */
export { flag } from "./kit.ts";

/** Built-in blueprints (one file each under catalog/). Tests may register fixtures by pushing onto this array. */
export const BLUEPRINTS: Blueprint<any>[] = [...CATALOG];

/** Built-in blueprints plus any exported into blueprints/custom-* (re-read so new exports appear immediately). */
export function allBlueprints(): Blueprint<any>[] {
  return [...BLUEPRINTS, ...loadCustomBlueprints()];
}

export function getBlueprint(id: string): Blueprint<any> {
  const b = allBlueprints().find((x) => x.id === id);
  if (!b) throw new Error(`Unknown blueprint ${id}`);
  return b;
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function newLabName(code: string, random: () => number = Math.random): string {
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `lab-${code}-${suffix}`;
}

export const LAB_NAME = /^lab-[a-z0-9]{2,10}-[a-z0-9]{4}$/;
