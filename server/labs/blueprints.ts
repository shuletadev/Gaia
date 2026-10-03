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
  /** Resources created with names that must be globally unique (checked before deploy). */
  apimName?: (labName: string) => string;
  /** The API Management tier and unit count, checked against the region's SKU catalog. */
  apimSku?: (p: P) => { sku: string; units: number; extraRegions?: string[] };
  /** Resource types created but not shown as steps or icons (checked for region support). */
  extraTypes?: string[] | ((p: P) => string[]);
  /** VM sizes the lab creates (checked for regional availability and vCPU quota). */
  vmSizes?: (p: P) => string[];
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
export const CATEGORIES = ["API Management", "Gateways & edge", "Networking", "Exported"] as const;
export type Category = (typeof CATEGORIES)[number];

export const categoryOf = (b: Pick<Blueprint, "category" | "custom">): Category => b.category ?? (b.custom ? "Exported" : "Networking");

export type GateKind = "apim-ready" | "apim-public-off" | "firewall-ip" | "peerings" | "appgw-e2e" | "pe-approved" | "afd-e2e" | "shgw-e2e" | "mtls-e2e" | "dns-resolver" | "apim-workspace";

export type HookKind = "apim-gateway-token" | "mtls-certs" | "vm-password";

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

const T = {
  apim: "Microsoft.ApiManagement/service",
  agw: "Microsoft.Network/applicationGateways",
  waf: "Microsoft.Network/applicationGatewayWebApplicationFirewallPolicies",
  fw: "Microsoft.Network/azureFirewalls",
  fwp: "Microsoft.Network/firewallPolicies",
  vnet: "Microsoft.Network/virtualNetworks",
  nsg: "Microsoft.Network/networkSecurityGroups",
  rt: "Microsoft.Network/routeTables",
  pip: "Microsoft.Network/publicIPAddresses",
  dns: "Microsoft.Network/privateDnsZones",
  pe: "Microsoft.Network/privateEndpoints",
  aca: "Microsoft.App/containerApps",
  vm: "Microsoft.Compute/virtualMachines",
  resolver: "Microsoft.Network/dnsResolvers",
  afd: "Microsoft.Cdn/profiles",
};

/** Zod boolean that also accepts the strings a form or query might send. */
const flag = (d: boolean) => z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).default(d);

const classicSkus = ["Developer", "Basic", "Standard", "Premium"] as const;
const classicSchema = z.object({
  sku: z.enum(classicSkus).default("Developer"),
  units: z.coerce.number().int().min(1).max(12).default(1),
  networkMode: z.enum(["None", "External", "Internal"]).default("None"),
  sampleApi: flag(true),
  secondRegion: z.string().regex(/^[a-z0-9]*$/).default(""),
});
type Classic = z.infer<typeof classicSchema>;
/** Max units per tier for a single region (Developer has no scale-out). */
const CLASSIC_MAX_UNITS: Record<Classic["sku"], number> = { Developer: 1, Basic: 2, Standard: 4, Premium: 12 };
const CLASSIC_MINUTES: Record<Classic["networkMode"], [number, number]> = { None: [25, 45], External: [35, 70], Internal: [35, 70] };

const peSchema = z.object({ sku: z.enum(classicSkus).default("Developer"), disablePublicAccess: flag(true) });
type Pe = z.infer<typeof peSchema>;

const afdSchema = z.object({
  apimSku: z.enum(["BasicV2", "StandardV2"]).default("BasicV2"),
  frontDoorSku: z.enum(["Standard_AzureFrontDoor", "Premium_AzureFrontDoor"]).default("Standard_AzureFrontDoor"),
  lockToFrontDoor: flag(true),
});
type Afd = z.infer<typeof afdSchema>;

const shgwSchema = z.object({ sku: z.enum(["Developer", "Premium"]).default("Developer"), gatewayHost: z.enum(["vm", "containerapps"]).default("vm") });
type Shgw = z.infer<typeof shgwSchema>;
const wsSchema = z.object({ gatewaySku: z.enum(["WorkspaceGatewayStandard", "WorkspaceGatewayPremium"]).default("WorkspaceGatewayStandard") });
type Ws = z.infer<typeof wsSchema>;
const mtlsSchema = z.object({ verifyIssuerDn: flag(false), forwardCertHeaders: flag(true) });
type Mtls = z.infer<typeof mtlsSchema>;
const resolverSchema = z.object({ spoke: flag(true) });

const v2Label = (sku: string) => (sku === "StandardV2" ? "Standard v2" : "Basic v2");
const apimMeter = (sku: string, units = 1): PriceMeter => {
  const name = sku.endsWith("V2") ? v2Label(sku) : sku;
  return { label: `APIM ${name}`, serviceName: "API Management", skuName: name, meterName: `${name} Unit`, unitsPerHour: units };
};
const skuOptions = [
  { value: "Developer", label: "Developer" },
  { value: "Basic", label: "Basic" },
  { value: "Standard", label: "Standard" },
  { value: "Premium", label: "Premium" },
];

const pipMeter = (count: number, label = "Public IPs"): PriceMeter => ({
  label,
  serviceName: "Virtual Network",
  productName: "IP Addresses",
  skuName: "Standard",
  meterName: "Standard IPv4 Static Public IP",
  unitsPerHour: count,
});

const quickstartSchema = z.object({ sku: z.enum(["BasicV2", "StandardV2"]).default("BasicV2") });
const hubSpokeSchema = z.object({ spokeCount: z.coerce.number().int().min(1).max(3).default(1) });
const internalSchema = z.object({ wafMode: z.enum(["Detection", "Prevention"]).default("Prevention") });

export const BLUEPRINTS: Blueprint<any>[] = [
  {
    id: "apim-v2-quickstart",
    category: "API Management",
    title: "APIM v2 quick start",
    tagline: "Public v2 gateway + sample API",
    code: "apimqs",
    deployMinutes: [3, 10],
    icons: [T.apim],
    fields: [
      {
        key: "sku",
        label: "Tier",
        kind: "select",
        options: [
          { value: "BasicV2", label: "Basic v2" },
          { value: "StandardV2", label: "Standard v2" },
        ],
        default: "BasicV2",
      },
    ],
    schema: quickstartSchema,
    steps: () => [{ name: "apim", label: "API Management + httpbin API", type: T.apim }],
    meters: (p: z.infer<typeof quickstartSchema>) => {
      const sku = p.sku === "StandardV2" ? "Standard v2" : "Basic v2";
      return [{ label: `APIM ${sku}`, serviceName: "API Management", skuName: sku, meterName: `${sku} Unit`, unitsPerHour: 1 }];
    },
    notes: ["API calls beyond the included quota"],
    armParams: (p: z.infer<typeof quickstartSchema>, ctx) => ({ sku: p.sku, publisherEmail: ctx.owner }),
    apimName: (lab) => `${lab}-apim`,
    apimSku: (p: z.infer<typeof quickstartSchema>) => ({ sku: p.sku, units: 1 }),
    timingKey: (p: z.infer<typeof quickstartSchema>) => p.sku,
    alternatives: (p: z.infer<typeof quickstartSchema>) => (p.sku === "StandardV2" ? [{ params: { sku: "BasicV2" as const }, loses: "Standard v2 throughput and VNet integration" }] : []),
    stages: () => [{ label: "API Management", gate: { kind: "apim-ready", label: "Gateway answers", timeoutMin: 10, blocking: false } }],
  },
  {
    id: "hub-spoke-firewall",
    category: "Networking",
    title: "Hub-spoke + Firewall",
    tagline: "Firewall Basic hub, UDR-forced spokes",
    code: "hubfw",
    deployMinutes: [10, 20],
    icons: [T.vnet, T.fw, T.rt],
    fields: [{ key: "spokeCount", label: "Spokes", kind: "int", min: 1, max: 3, default: 1 }],
    schema: hubSpokeSchema,
    steps: (p: z.infer<typeof hubSpokeSchema>) => [
      { name: "hub", label: "Hub VNet", type: T.vnet },
      { name: "fw-policy", label: "Firewall policy", type: T.fwp },
      { name: "firewall", label: "Azure Firewall Basic", type: T.fw },
      { name: "spoke-routes", label: "Route table → firewall", type: T.rt },
      { name: "workload-nsg", label: "Workload NSG", type: T.nsg },
      ...Array.from({ length: p.spokeCount }, (_, i) => ({ name: `spoke-${i + 1}`, label: `Spoke ${i + 1} + peering`, type: T.vnet })),
    ],
    meters: () => [
      { label: "Firewall Basic", serviceName: "Azure Firewall", skuName: "Basic", meterName: "Basic Deployment", unitsPerHour: 1 },
      pipMeter(2),
    ],
    notes: ["Firewall data processed (per GB)", "VNet peering traffic (per GB)"],
    armParams: (p: z.infer<typeof hubSpokeSchema>) => ({ spokeCount: p.spokeCount }),
    quotas: (p: z.infer<typeof hubSpokeSchema>) => ({
      VirtualNetworks: 1 + p.spokeCount,
      IPv4StandardSkuPublicIpAddresses: 2,
      RouteTables: 1,
      NetworkSecurityGroups: 1,
    }),
    stages: () => [
      { value: 1, label: "Hub network + policy" },
      { value: 2, label: "Azure Firewall", gate: { kind: "firewall-ip", label: "Firewall has a private IP", timeoutMin: 10, blocking: true } },
      { value: 3, label: "Routes + spokes", gate: { kind: "peerings", label: "Peerings connected", timeoutMin: 5, blocking: false } },
    ],
  },
  {
    id: "apim-internal-appgw",
    category: "Gateways & edge",
    title: "APIM internal + App Gateway",
    tagline: "Developer APIM in VNet behind WAF_v2",
    code: "apimagw",
    deployMinutes: [40, 75],
    icons: [T.agw, T.apim, T.dns],
    fields: [
      {
        key: "wafMode",
        label: "WAF",
        kind: "select",
        options: [
          { value: "Prevention", label: "Prevention" },
          { value: "Detection", label: "Detection" },
        ],
        default: "Prevention",
      },
    ],
    schema: internalSchema,
    steps: () => [
      { name: "apim-nsg", label: "APIM subnet NSG", type: T.nsg },
      { name: "vnet", label: "VNet", type: T.vnet },
      { name: "apim-pip", label: "APIM management IP", type: T.pip },
      { name: "agw-pip", label: "Gateway public IP", type: T.pip },
      { name: "apim", label: "API Management (VNet injection)", type: T.apim },
      { name: "apim-dns", label: "azure-api.net private zone", type: T.dns },
      { name: "waf", label: "WAF policy", type: T.waf },
      { name: "agw", label: "Application Gateway WAF_v2", type: T.agw },
    ],
    meters: () => [
      { label: "APIM Developer", serviceName: "API Management", skuName: "Developer", meterName: "Developer Unit", unitsPerHour: 1 },
      { label: "App Gateway WAF_v2", serviceName: "Application Gateway", productName: "Application Gateway WAF v2", skuName: "Standard", meterName: "Standard Fixed Cost", unitsPerHour: 1 },
      pipMeter(2),
    ],
    notes: ["App Gateway capacity units (autoscale 0–2)"],
    armParams: (p: z.infer<typeof internalSchema>, ctx) => ({ wafMode: p.wafMode, publisherEmail: ctx.owner }),
    apimName: (lab) => `${lab}-apim`,
    apimSku: () => ({ sku: "Developer", units: 1 }),
    quotas: () => ({ VirtualNetworks: 1, IPv4StandardSkuPublicIpAddresses: 2, NetworkSecurityGroups: 1, ApplicationGateways: 1 }),
    stages: () => [
      { value: 1, label: "Network" },
      { value: 2, label: "API Management (VNet)", gate: { kind: "apim-ready", label: "APIM up, dependencies reachable", timeoutMin: 20, blocking: true } },
      { value: 3, label: "DNS + App Gateway", gate: { kind: "appgw-e2e", label: "Backend healthy, end-to-end 200", timeoutMin: 10, blocking: false } },
    ],
  },
  {
    id: "apim-classic",
    category: "API Management",
    title: "APIM classic",
    tagline: "Vanilla Developer / Premium, optional VNet",
    code: "apim",
    deployMinutes: [25, 70],
    icons: [T.apim, T.vnet],
    fields: [
      { key: "sku", label: "Tier", kind: "select", options: skuOptions, default: "Developer" },
      { key: "units", label: "Units", kind: "int", min: 1, max: 12, default: 1 },
      {
        key: "networkMode",
        label: "VNet",
        kind: "select",
        options: [
          { value: "None", label: "None" },
          { value: "External", label: "External" },
          { value: "Internal", label: "Internal" },
        ],
        default: "None",
      },
      { key: "sampleApi", label: "Sample API", kind: "toggle", default: true },
      { key: "secondRegion", label: "2nd region", kind: "select", optionsFrom: "regions", emptyLabel: "None", default: "" },
    ],
    schema: classicSchema,
    rules: (p: Classic) => {
      const out: string[] = [];
      if (p.networkMode !== "None" && p.sku !== "Developer" && p.sku !== "Premium") out.push(`VNet injection needs Developer or Premium (not ${p.sku})`);
      if (p.units > CLASSIC_MAX_UNITS[p.sku]) out.push(`${p.sku} allows at most ${CLASSIC_MAX_UNITS[p.sku]} unit${CLASSIC_MAX_UNITS[p.sku] > 1 ? "s" : ""} per region`);
      if (p.secondRegion && p.sku !== "Premium") out.push("A second region needs Premium");
      if (p.secondRegion && p.networkMode !== "None") out.push("A second region with VNet injection needs a VNet per region; use VNet None here");
      return out;
    },
    steps: (p: Classic) => [
      ...(p.networkMode !== "None"
        ? [
            { name: "apim-nsg", label: "APIM subnet NSG", type: T.nsg },
            { name: "vnet", label: "VNet", type: T.vnet },
            { name: "apim-pip", label: "APIM public IP", type: T.pip },
          ]
        : []),
      { name: "apim", label: `API Management ${p.sku}${p.networkMode !== "None" ? ` (${p.networkMode})` : ""}${p.secondRegion ? ` + ${p.secondRegion}` : ""}`, type: T.apim },
    ],
    meters: (p: Classic) => [apimMeter(p.sku, p.units * (p.secondRegion ? 2 : 1)), ...(p.networkMode !== "None" ? [pipMeter(1)] : [])],
    notes: ["API calls are included; self-hosted gateways are not", "A second region is billed at the primary region's unit price"],
    armParams: (p: Classic, ctx) => ({ sku: p.sku, units: p.units, networkMode: p.networkMode, sampleApi: p.sampleApi, secondRegion: p.secondRegion, publisherEmail: ctx.owner }),
    apimName: (lab) => `${lab}-apim`,
    apimSku: (p: Classic) => ({ sku: p.sku, units: p.units, extraRegions: p.secondRegion ? [p.secondRegion] : [] }),
    timingKey: (p: Classic) => `${p.sku}/${p.networkMode}${p.units > 1 ? "/multi" : ""}${p.secondRegion ? "/2r" : ""}`,
    deployTime: (p: Classic) => {
      const [lo, hi] = CLASSIC_MINUTES[p.networkMode];
      // Premium and multi-unit services take noticeably longer to activate; each extra region adds a full one.
      const base: [number, number] = p.sku === "Premium" || p.units > 1 ? [lo + 10, hi + 20] : [lo, hi];
      return p.secondRegion ? [base[0] + 25, base[1] + 45] : base;
    },
    alternatives: (p: Classic) => [
      ...(p.sku === "Premium" && !p.secondRegion ? [{ params: { sku: "Developer" as const, units: 1 }, loses: "SLA, scale units, zones and multi-region" }] : []),
      ...(p.secondRegion ? [{ params: { secondRegion: "" }, loses: "the second region" }] : []),
      ...(p.sku === "Standard" && p.networkMode === "None" ? [{ params: { sku: "Basic" as const, units: Math.min(p.units, 2) }, loses: "Standard throughput and units" }] : []),
      ...((p.sku === "Basic" || p.sku === "Standard") && p.networkMode === "None" ? [{ params: { sku: "Developer" as const, units: 1 }, loses: "SLA and scale units" }] : []),
      ...(p.units > 1 ? [{ params: { units: 1 }, loses: "extra units" }] : []),
    ],
    presets: [
      { label: "Developer", params: { sku: "Developer", units: 1, networkMode: "None", secondRegion: "" } },
      { label: "Developer · Internal VNet", params: { sku: "Developer", units: 1, networkMode: "Internal", secondRegion: "" } },
      { label: "Premium", params: { sku: "Premium", units: 1, networkMode: "None", secondRegion: "" } },
      { label: "Premium · External VNet", params: { sku: "Premium", units: 1, networkMode: "External", secondRegion: "" } },
      { label: "Premium · 2 regions", params: { sku: "Premium", units: 1, networkMode: "None", secondRegion: "eastus2" } },
    ],
    quotas: (p: Classic): Record<string, number> => (p.networkMode !== "None" ? { VirtualNetworks: 1, IPv4StandardSkuPublicIpAddresses: 1, NetworkSecurityGroups: 1 } : {}),
    stages: (p: Classic) => [
      ...(p.networkMode !== "None" ? [{ value: 1, label: "Network" }] : []),
      {
        value: 2,
        label: `API Management ${p.sku}`,
        gate: { kind: "apim-ready", label: p.networkMode === "Internal" ? "APIM up, dependencies reachable" : "Gateway answers", timeoutMin: 20, blocking: false },
      },
    ],
  },
  {
    id: "apim-private-endpoint",
    category: "API Management",
    title: "APIM + Private Endpoint",
    tagline: "Inbound private link, public access off",
    code: "apimpe",
    deployMinutes: [45, 90],
    icons: [T.apim, T.pe, T.dns],
    fields: [
      { key: "sku", label: "Tier", kind: "select", options: skuOptions, default: "Developer" },
      { key: "disablePublicAccess", label: "Public off", kind: "toggle", default: true },
    ],
    schema: peSchema,
    steps: () => [
      { name: "vnet", label: "Client VNet", type: T.vnet },
      { name: "apim", label: "API Management", type: T.apim },
      { name: "pe-dns", label: "privatelink.azure-api.net", type: T.dns },
      { name: "pe", label: "Private endpoint (Gateway)", type: T.pe },
    ],
    meters: (p: Pe) => [
      apimMeter(p.sku),
      { label: "Private endpoint", serviceName: "Virtual Network", skuName: "Standard", meterName: "Private Endpoint", unitsPerHour: 1, fixedHourly: 0.01 },
    ],
    notes: ["Private endpoint data processed (per GB)", "Private DNS zone (monthly) and queries"],
    armParams: (p: Pe, ctx) => ({ sku: p.sku, disablePublicAccess: p.disablePublicAccess, publisherEmail: ctx.owner }),
    apimName: (lab) => `${lab}-apim`,
    apimSku: (p: Pe) => ({ sku: p.sku, units: 1 }),
    timingKey: (p: Pe) => `${p.sku}/${p.disablePublicAccess ? "private" : "public"}`,
    alternatives: (p: Pe) => (p.sku !== "Developer" ? [{ params: { sku: "Developer" as const }, loses: `${p.sku} SLA and scale units` }] : []),
    quotas: () => ({ VirtualNetworks: 1, PrivateEndpoints: 1 }),
    stages: (p: Pe) => [
      { value: 1, label: "Network" },
      { value: 2, label: `API Management ${p.sku}`, gate: { kind: "apim-ready", label: "Gateway answers", timeoutMin: 20, blocking: true } },
      { value: 3, label: "Private endpoint + DNS", gate: { kind: "pe-approved", label: "Connection approved, DNS record", timeoutMin: 10, blocking: true } },
      ...(p.disablePublicAccess ? [{ value: 4, label: "Disable public access", gate: { kind: "apim-public-off" as const, label: "Public gateway closed", timeoutMin: 10, blocking: false } }] : []),
    ],
  },
  {
    id: "frontdoor-apim",
    category: "Gateways & edge",
    title: "Front Door → APIM",
    tagline: "AFD edge, origin locked to the profile",
    code: "afdapim",
    deployMinutes: [15, 40],
    icons: [T.afd, T.apim],
    fields: [
      {
        key: "apimSku",
        label: "APIM",
        kind: "select",
        options: [
          { value: "BasicV2", label: "Basic v2" },
          { value: "StandardV2", label: "Standard v2" },
        ],
        default: "BasicV2",
      },
      {
        key: "frontDoorSku",
        label: "Front Door",
        kind: "select",
        options: [
          { value: "Standard_AzureFrontDoor", label: "Standard" },
          { value: "Premium_AzureFrontDoor", label: "Premium" },
        ],
        default: "Standard_AzureFrontDoor",
      },
      { key: "lockToFrontDoor", label: "FDID lock", kind: "toggle", default: true },
    ],
    schema: afdSchema,
    steps: () => [{ name: "apim", label: "API Management v2", type: T.apim }],
    meters: (p: Afd) => {
      const premium = p.frontDoorSku === "Premium_AzureFrontDoor";
      return [
        apimMeter(p.apimSku),
        // Base fee is billed monthly; spread over ~730 hours.
        {
          label: `Front Door ${premium ? "Premium" : "Standard"} base`,
          serviceName: "Azure Front Door Service",
          skuName: premium ? "Premium" : "Standard",
          meterName: premium ? "Premium Base Fees" : "Standard Base Fees",
          unitsPerHour: 1 / 730,
          armRegion: "Zone 1",
        },
      ];
    },
    notes: ["Front Door requests and data transfer", "Front Door base fee is monthly"],
    armParams: (p: Afd, ctx) => ({ apimSku: p.apimSku, frontDoorSku: p.frontDoorSku, lockToFrontDoor: p.lockToFrontDoor, publisherEmail: ctx.owner }),
    apimName: (lab) => `${lab}-apim`,
    apimSku: (p: Afd) => ({ sku: p.apimSku, units: 1 }),
    timingKey: (p: Afd) => `${p.apimSku}/${p.frontDoorSku}`,
    alternatives: (p: Afd) => [
      ...(p.frontDoorSku === "Premium_AzureFrontDoor" ? [{ params: { frontDoorSku: "Standard_AzureFrontDoor" as const }, loses: "managed WAF rules, bot protection and Private Link origins" }] : []),
      ...(p.apimSku === "StandardV2" ? [{ params: { apimSku: "BasicV2" as const }, loses: "Standard v2 throughput and VNet integration" }] : []),
    ],
    stages: () => [
      { value: 1, label: "API Management v2", gate: { kind: "apim-ready", label: "Gateway answers", timeoutMin: 10, blocking: true } },
      { value: 2, label: "Front Door", gate: { kind: "afd-e2e", label: "Edge returns 200", timeoutMin: 25, blocking: false } },
    ],
  },
  {
    id: "apim-selfhosted",
    category: "API Management",
    title: "APIM self-hosted gateway",
    tagline: "v2 gateway on a VM or Container Apps, token wired in",
    code: "apimshgw",
    deployMinutes: [30, 55],
    icons: [T.apim, T.vm],
    fields: [
      {
        key: "sku",
        label: "Tier",
        kind: "select",
        options: [
          { value: "Developer", label: "Developer" },
          { value: "Premium", label: "Premium" },
        ],
        default: "Developer",
      },
      {
        key: "gatewayHost",
        label: "Gateway host",
        kind: "select",
        options: [
          { value: "vm", label: "VM (Docker)" },
          { value: "containerapps", label: "Container Apps" },
        ],
        default: "vm",
      },
    ],
    schema: shgwSchema,
    steps: () => [{ name: "apim", label: "API Management + gateway resource", type: T.apim }],
    meters: (p: Shgw) => [
      apimMeter(p.sku),
      ...(p.gatewayHost === "vm"
        ? [{ label: "VM B2s (Linux)", serviceName: "Virtual Machines", productName: "Virtual Machines BS Series", skuName: "B2s", meterName: "B2s", unitsPerHour: 1 }, pipMeter(1, "Public IP")]
        : [
            // 0.5 vCPU / 1 GiB, always on (billed per second; the monthly free grant is ignored).
            { label: "Container Apps 0.5 vCPU", serviceName: "Azure Container Apps", productName: "Azure Container Apps", skuName: "Standard", meterName: "Standard vCPU Active Usage", unitsPerHour: 1800 },
            { label: "Container Apps 1 GiB", serviceName: "Azure Container Apps", productName: "Azure Container Apps", skuName: "Standard", meterName: "Standard Memory Active Usage", unitsPerHour: 3600 },
          ]),
    ],
    notes: ["Premium bills self-hosted gateways per deployment; Developer includes one", "VM: OS disk (StandardSSD) and egress"],
    armParams: (p: Shgw, ctx) => ({ sku: p.sku, gatewayHost: p.gatewayHost, publisherEmail: ctx.owner }),
    apimName: (lab) => `${lab}-apim`,
    apimSku: (p: Shgw) => ({ sku: p.sku, units: 1 }),
    timingKey: (p: Shgw) => `${p.sku}/${p.gatewayHost}`,
    extraTypes: (p: Shgw) => (p.gatewayHost === "vm" ? [T.vm, T.vnet, T.nsg, T.pip, "Microsoft.Network/networkInterfaces"] : [T.aca, "Microsoft.App/managedEnvironments"]),
    vmSizes: (p: Shgw) => (p.gatewayHost === "vm" ? ["Standard_B2s"] : []),
    quotas: (p: Shgw): Record<string, number> => (p.gatewayHost === "vm" ? { VirtualNetworks: 1, IPv4StandardSkuPublicIpAddresses: 1, NetworkSecurityGroups: 1 } : {}),
    alternatives: (p: Shgw) => [
      ...(p.sku === "Premium" ? [{ params: { sku: "Developer" as const }, loses: "SLA" }] : []),
      p.gatewayHost === "vm" ? { params: { gatewayHost: "containerapps" as const }, loses: "nothing — a managed host instead of a VM" } : { params: { gatewayHost: "vm" as const }, loses: "a managed host (a VM instead)" },
    ],
    // Pre-launch validation runs before these values exist; Container Apps rejects an empty secret.
    paramHooks: [
      { fromStage: 2, hook: "vm-password", label: "VM password", validateWith: { adminPassword: "Validation-Placeholder-1!" } },{ fromStage: 2, hook: "apim-gateway-token", label: "gateway token", validateWith: { gatewayToken: "GatewayKey validation-placeholder" } }],
    stages: () => [
      { value: 1, label: "API Management + gateway", gate: { kind: "apim-ready", label: "Gateway answers", timeoutMin: 20, blocking: true } },
      { value: 2, label: "Gateway container", gate: { kind: "shgw-e2e", label: "Self-hosted gateway serves the API", timeoutMin: 10, blocking: false } },
    ],
  },
  {
    id: "apim-workspaces",
    category: "API Management",
    title: "APIM workspaces",
    tagline: "Premium, workspace + dedicated gateway",
    code: "apimws",
    deployMinutes: [45, 80],
    icons: [T.apim],
    fields: [
      {
        key: "gatewaySku",
        label: "Gateway",
        kind: "select",
        options: [
          { value: "WorkspaceGatewayStandard", label: "Standard" },
          { value: "WorkspaceGatewayPremium", label: "Premium" },
        ],
        default: "WorkspaceGatewayStandard",
      },
    ],
    schema: wsSchema,
    steps: () => [{ name: "apim", label: "API Management Premium", type: T.apim }],
    meters: (p: Ws) => [
      apimMeter("Premium"),
      {
        label: `Workspace gateway ${p.gatewaySku === "WorkspaceGatewayPremium" ? "Premium" : "Standard"}`,
        serviceName: "API Management",
        skuName: p.gatewaySku === "WorkspaceGatewayPremium" ? "Workspace Gateway Premium" : "Workspace Gateway Standard",
        meterName: p.gatewaySku === "WorkspaceGatewayPremium" ? "Workspace Gateway Premium Unit" : "Workspace Gateway Standard Unit",
        unitsPerHour: 1,
      },
    ],
    notes: ["Workspaces need Premium; the workspace gateway is billed on top"],
    armParams: (p: Ws, ctx) => ({ gatewaySku: p.gatewaySku, publisherEmail: ctx.owner }),
    apimName: (lab) => `${lab}-apim`,
    apimSku: () => ({ sku: "Premium", units: 1 }),
    timingKey: (p: Ws) => p.gatewaySku,
    alternatives: (p: Ws) => (p.gatewaySku === "WorkspaceGatewayPremium" ? [{ params: { gatewaySku: "WorkspaceGatewayStandard" as const }, loses: "gateway VNet injection and multiple workspaces per gateway" }] : []),
    extraTypes: ["Microsoft.ApiManagement/gateways"],
    stages: () => [
      { value: 1, label: "API Management Premium", gate: { kind: "apim-ready", label: "Gateway answers", timeoutMin: 20, blocking: true } },
      { value: 2, label: "Workspace + gateway", gate: { kind: "apim-workspace", label: "Workspace gateway serves the API", timeoutMin: 20, blocking: false } },
    ],
  },
  {
    id: "appgw-mtls",
    category: "Gateways & edge",
    title: "App Gateway mTLS",
    tagline: "Client certificates at the listener",
    code: "agwmtls",
    deployMinutes: [8, 20],
    icons: [T.agw, T.pip],
    fields: [
      { key: "verifyIssuerDn", label: "Verify issuer DN", kind: "toggle", default: false },
      { key: "forwardCertHeaders", label: "Cert headers", kind: "toggle", default: true },
    ],
    schema: mtlsSchema,
    steps: () => [
      { name: "vnet", label: "VNet", type: T.vnet },
      { name: "agw-pip", label: "Gateway public IP", type: T.pip },
    ],
    meters: () => [
      { label: "App Gateway Standard_v2", serviceName: "Application Gateway", productName: "Application Gateway Standard v2", skuName: "Standard", meterName: "Standard Fixed Cost", unitsPerHour: 1 },
      pipMeter(1),
    ],
    notes: ["Capacity units (autoscale 0–2)", "Certificates are generated locally and kept under data/labs/<lab>"],
    armParams: (p: Mtls) => ({ verifyIssuerDn: p.verifyIssuerDn, forwardCertHeaders: p.forwardCertHeaders }),
    extraTypes: [T.agw],
    quotas: () => ({ VirtualNetworks: 1, IPv4StandardSkuPublicIpAddresses: 1, ApplicationGateways: 1 }),
    paramHooks: [{ fromStage: 2, hook: "mtls-certs", label: "certificates" }],
    stages: () => [
      { value: 1, label: "Network + public IP" },
      { value: 2, label: "Application Gateway", gate: { kind: "mtls-e2e", label: "Client cert accepted, no cert refused", timeoutMin: 10, blocking: false } },
    ],
  },
  {
    id: "dns-resolver-hybrid",
    category: "Networking",
    title: "DNS Private Resolver",
    tagline: "Hybrid DNS: inbound, outbound, ruleset",
    code: "dnsres",
    deployMinutes: [5, 15],
    icons: [T.resolver, T.vnet, T.dns],
    fields: [{ key: "spoke", label: "Spoke VNet", kind: "toggle", default: true }],
    schema: resolverSchema,
    steps: () => [{ name: "lab", label: "Hub, spoke, zone, resolver", type: T.resolver }],
    meters: () => [
      { label: "Inbound endpoint", serviceName: "Azure DNS", skuName: "Private Resolver", meterName: "Private Resolver Inbound Endpoint", unitsPerHour: 1 / 730, armRegion: "Zone 1" },
      { label: "Outbound endpoint", serviceName: "Azure DNS", skuName: "Private Resolver", meterName: "Private Resolver Outbound Endpoint", unitsPerHour: 1 / 730, armRegion: "Zone 1" },
      { label: "Forwarding ruleset", serviceName: "Azure DNS", skuName: "Private Resolver", meterName: "Private Resolver DNS Forwarding Ruleset", unitsPerHour: 1 / 730, armRegion: "Zone 1" },
    ],
    notes: ["DNS queries", "Private DNS zone (monthly)", "Endpoints are billed monthly; shown per hour"],
    armParams: (p: z.infer<typeof resolverSchema>) => ({ spoke: p.spoke }),
    extraTypes: ["Microsoft.Network/dnsResolvers", "Microsoft.Network/dnsForwardingRulesets", T.vnet, T.dns],
    quotas: (p: z.infer<typeof resolverSchema>) => ({ VirtualNetworks: p.spoke ? 2 : 1 }),
    stages: () => [
      { value: 1, label: "Networks + private zone" },
      { value: 2, label: "Resolver + ruleset", gate: { kind: "dns-resolver", label: "Endpoints provisioned", timeoutMin: 10, blocking: false } },
    ],
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
