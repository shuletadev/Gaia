import { z } from "zod";
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
export interface ContentDef {
  kind: "static-web-app";
  label: string;
  /** Folder under blueprints/<id>/ holding the files (must contain index.html). */
  dir: string;
  /** Stack output holding the Static Web App's name. */
  siteOutput: string;
  /** Runs at the first stage whose value is at least this (default: the first stage). */
  fromStage?: number;
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
export const flag = (d: boolean) => z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).default(d);

/** Built-in blueprints. The student/showcase catalog is added here; exported blueprints are loaded separately. */
const farmaciaSchema = z.object({ redundancy: z.enum(["LRS", "GRS"]).default("LRS") });

const tallerSchema = z.object({
  vmSize: z.enum(["Standard_B1s", "Standard_B1ms", "Standard_B2s"]).default("Standard_B1s"),
  paasTier: z.enum(["F1", "B1"]).default("F1"),
  autoShutdown: flag(true),
});
type Taller = z.infer<typeof tallerSchema>;

export const BLUEPRINTS: Blueprint<any>[] = [
  {
    id: "cr-farmacia-recibos",
    category: "Showcase",
    title: "Farmacia Pura Vida: digital receipts",
    tagline: "A Costa Rican pharmacy replaces paper receipts with a web front end, a sales database and receipt storage",
    code: "cfarm",
    deployMinutes: [3, 8],
    icons: ["Microsoft.Web/staticSites", "Microsoft.DocumentDB/databaseAccounts", "Microsoft.Storage/storageAccounts"],
    fields: [
      {
        key: "redundancy",
        label: "Storage redundancy",
        kind: "select",
        options: [
          { value: "LRS", label: "LRS (one datacenter)" },
          { value: "GRS", label: "GRS (also a paired region)" },
        ],
        default: "LRS",
      },
    ],
    schema: farmaciaSchema,
    steps: () => [
      { name: "storage", label: "Receipt storage", type: "Microsoft.Storage/storageAccounts" },
      { name: "cosmos", label: "Sales database (Cosmos DB serverless)", type: "Microsoft.DocumentDB/databaseAccounts" },
      { name: "web", label: "Web front end (Static Web App)", type: "Microsoft.Web/staticSites" },
    ],
    // Every service here is free or usage-based, so an idle lab costs about nothing.
    meters: () => [
      { label: "Static Web App (Free)", serviceName: "Azure Static Web Apps", skuName: "Free", meterName: "Free", unitsPerHour: 1, fixedHourly: 0 },
      { label: "Cosmos DB serverless (idle)", serviceName: "Azure Cosmos DB", skuName: "Serverless", meterName: "Serverless", unitsPerHour: 1, fixedHourly: 0 },
      { label: "Storage (idle)", serviceName: "Storage", skuName: "Standard", meterName: "Standard", unitsPerHour: 1, fixedHourly: 0 },
    ],
    notes: ["Cosmos DB request units and storage used", "Blob storage capacity and operations", "GRS adds geo-replication charges"],
    armParams: (p: z.infer<typeof farmaciaSchema>) => ({ redundancy: p.redundancy }),
    regionFree: ["Microsoft.Web/staticSites"],
    content: [{ kind: "static-web-app", label: "Pharmacy cashier app", dir: "app", siteOutput: "staticSiteName" }],
    timingKey: (p: z.infer<typeof farmaciaSchema>) => p.redundancy,
    stages: () => [{ label: "Deploy", gate: { kind: "http-ok", label: "Front end answers", timeoutMin: 10, blocking: false } }],
    scenario: {
      story:
        "Farmacia Pura Vida is a family pharmacy in San José. Every sale used to end with a paper receipt and a notebook for the day's totals. The owners want digital receipts customers can keep, a record of every sale for the monthly accounts, and a screen the cashier can open from any computer, without buying or maintaining a server.",
      objectives: [
        "Choose PaaS and serverless services instead of virtual machines, and explain why",
        "Explain storage redundancy (LRS vs GRS) and when a business pays for it",
        "Compare a relational and a document database for sales records",
        "Find the resources, region and costs of a workload in the portal",
      ],
      exams: ["AZ-900: cloud concepts, core Azure services, cost management", "DP-900: non-relational data (Cosmos DB, Blob storage)"],
    },
  },
  {
    id: "cr-taller-servidores",
    category: "Showcase",
    title: "Taller Los Ángeles: servers (IaaS vs PaaS)",
    tagline: "The same appointment page on a virtual machine and on App Service, side by side",
    code: "ctall",
    deployMinutes: [4, 9],
    icons: ["Microsoft.Compute/virtualMachines", "Microsoft.Web/sites", "Microsoft.Network/networkSecurityGroups"],
    fields: [
      {
        key: "vmSize",
        label: "VM size",
        kind: "select",
        options: [
          { value: "Standard_B1s", label: "B1s (1 vCPU, 1 GB)" },
          { value: "Standard_B1ms", label: "B1ms (1 vCPU, 2 GB)" },
          { value: "Standard_B2s", label: "B2s (2 vCPU, 4 GB)" },
        ],
        default: "Standard_B1s",
      },
      {
        key: "paasTier",
        label: "App Service plan",
        kind: "select",
        options: [
          { value: "F1", label: "Free (F1)" },
          { value: "B1", label: "Basic (B1)" },
        ],
        default: "F1",
      },
      { key: "autoShutdown", label: "Shut the VM down every night", kind: "toggle", default: true },
    ],
    schema: tallerSchema,
    steps: () => [
      { name: "network", label: "Network, firewall rules and public IP", type: "Microsoft.Network/networkSecurityGroups" },
      { name: "vm", label: "Virtual machine (IaaS)", type: "Microsoft.Compute/virtualMachines" },
      { name: "paas", label: "App Service (PaaS)", type: "Microsoft.Web/sites" },
    ],
    meters: (p: Taller) => {
      const size = p.vmSize.replace("Standard_", "");
      return [
        { label: `VM ${size}`, serviceName: "Virtual Machines", productName: "Virtual Machines BS Series", skuName: size, meterName: size, unitsPerHour: 1 },
        // $2.40 per month (E4, 32 GiB): the Retail Prices API lists disks per month, not per hour.
        { label: "Standard SSD disk (30 GB)", serviceName: "Storage", skuName: "E4 LRS", meterName: "E4 LRS Disk", unitsPerHour: 1, fixedHourly: 2.4 / 730 },
        { label: "Public IP", serviceName: "Virtual Network", productName: "IP Addresses", skuName: "Standard", meterName: "Standard IPv4 Static Public IP", unitsPerHour: 1 },
        p.paasTier === "F1"
          ? { label: "App Service Free", serviceName: "Azure App Service", skuName: "F1", meterName: "F1", unitsPerHour: 1, fixedHourly: 0 }
          : { label: "App Service Basic B1", serviceName: "Azure App Service", productName: "Azure App Service Basic Plan - Linux", skuName: "B1", meterName: "B1", unitsPerHour: 1 },
      ];
    },
    notes: ["The estimate assumes the VM runs all the time; the nightly shutdown stops compute charges but not the disk and IP", "Outbound bandwidth beyond the free allowance"],
    armParams: (p: Taller) => ({ vmSize: p.vmSize, paasTier: p.paasTier, autoShutdown: p.autoShutdown }),
    quotas: () => ({ VirtualNetworks: 1, NetworkSecurityGroups: 1, IPv4StandardSkuPublicIpAddresses: 1 }),
    vmSizes: (p: Taller) => [p.vmSize],
    timingKey: (p: Taller) => `${p.vmSize}/${p.paasTier}`,
    paramHooks: [{ fromStage: 0, hook: "vm-password", label: "VM admin password", validateWith: { adminPassword: "Validation-Placeholder-1!" } }],
    // The VM is the slow part (it installs a web server on first boot), so it is what the gate waits for.
    stages: () => [{ label: "Deploy", gate: { kind: "http-ok", label: "VM web page answers", timeoutMin: 15, blocking: false } }],
    alternatives: (p: Taller) => [
      ...(p.vmSize !== "Standard_B1s" ? [{ params: { vmSize: "Standard_B1s" } as Partial<Taller>, loses: "Memory and CPU headroom on the VM" }] : []),
      ...(p.paasTier === "B1" ? [{ params: { paasTier: "F1" } as Partial<Taller>, loses: "Always-on and the Basic plan's capacity (Free sleeps and has a daily CPU quota)" }] : []),
    ],
    presets: [
      { label: "Cheapest", params: { vmSize: "Standard_B1s", paasTier: "F1" } },
      { label: "Roomier", params: { vmSize: "Standard_B2s", paasTier: "B1" } },
    ],
    scenario: {
      story:
        "Taller Los Ángeles is a car repair shop in Alajuela. Its appointment page runs on an old PC under the counter, and when the PC dies, so do the appointments. The owner's nephew says to put it on a server in the cloud. Here the same page runs on a virtual machine you manage and on App Service that Azure manages, so the class can compare them.",
      objectives: [
        "Place IaaS, PaaS and SaaS on a real example and draw the shared-responsibility line for each",
        "List everything a VM needs around it (disk, network interface, public IP, firewall rules) versus a PaaS host",
        "Read a bill by resource and see how tags and auto-shutdown change it",
        "Explain why a stopped VM still costs money",
      ],
      exams: ["AZ-900: cloud concepts (IaaS, PaaS, shared responsibility)", "AZ-900: cost management and tags"],
    },
  },
];

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
