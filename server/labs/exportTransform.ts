import type { PriceMeter } from "./blueprints.ts";

type Json = Record<string, unknown>;
type Resource = Json & { type: string; name: string; location?: string; tags?: unknown; sku?: { name?: string; tier?: string; capacity?: number }; properties?: Json; resources?: Resource[] };

export interface TransformResult {
  template: Json;
  warnings: string[];
  resourceTypes: string[];
}

const GLOBAL_NAME_TYPES: Record<string, { max: number; hyphens: boolean }> = {
  "microsoft.apimanagement/service": { max: 50, hyphens: true },
  "microsoft.storage/storageaccounts": { max: 24, hyphens: false },
  "microsoft.keyvault/vaults": { max: 24, hyphens: true },
  "microsoft.web/sites": { max: 60, hyphens: true },
  "microsoft.cdn/profiles": { max: 260, hyphens: true },
  "microsoft.documentdb/databaseaccounts": { max: 44, hyphens: true },
  "microsoft.cognitiveservices/accounts": { max: 64, hyphens: true },
  "microsoft.containerregistry/registries": { max: 50, hyphens: false },
};

const normLoc = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const esc = (s: string) => s.replace(/'/g, "''");

/** Turns a name the source used into an expression unique to the new lab. */
export function nameExpression(original: string, sourceRg: string, type: string): string {
  const lower = original.toLowerCase();
  const src = sourceRg.toLowerCase();
  const g = GLOBAL_NAME_TYPES[type.toLowerCase()];
  // Names built from the source group's name (labs) keep their suffix: lab-hubfw-tfxh-fw -> <labName>-fw.
  if (lower.startsWith(src) && original.length > sourceRg.length) {
    const suffix = original.slice(sourceRg.length);
    return g && !g.hyphens
      ? `[take(toLower(replace(concat(parameters('labName'), '${esc(suffix)}'), '-', '')), ${g.max})]`
      : `[concat(parameters('labName'), '${esc(suffix)}')]`;
  }
  if (!g) return original;
  return g.hyphens
    ? `[take(toLower(concat(parameters('labName'), '-', '${esc(original)}')), ${g.max})]`
    : `[take(toLower(replace(concat(parameters('labName'), '${esc(original)}'), '-', '')), ${g.max})]`;
}

/**
 * Makes an exported resource-group template re-deployable as a lab: labName/location/tags parameters,
 * lab-unique names (name parameters become variables), lab tags on every top-level resource,
 * and DNS labels prefixed so they do not collide with the source.
 */
export function transformExport(exported: Json, sourceRg: string, sourceLocation: string, sourceSubscription: string): TransformResult {
  const t = structuredClone(exported) as Json & { parameters?: Record<string, Json>; variables?: Json; resources?: Resource[] };
  const warnings: string[] = [];
  const params = (t.parameters ?? {}) as Record<string, Json & { defaultValue?: unknown; type?: string }>;
  const resources = (t.resources ?? []) as Resource[];

  // Which resource type each generated "<type>_<name>_name" parameter names.
  const typeOfParam = new Map<string, string>();
  for (const r of resources) {
    const m = /^\[parameters\('([^']+)'\)\]$/.exec(r.name) ?? /^\[concat\(parameters\('([^']+)'\)/.exec(r.name);
    if (m && !typeOfParam.has(m[1]!)) typeOfParam.set(m[1]!, r.type.split("/").slice(0, 2).join("/"));
  }

  const variables: Json = { ...((t.variables as Json) ?? {}) };
  const renamed: string[] = [];
  for (const [name, def] of Object.entries(params)) {
    if (typeof def.defaultValue !== "string" || !typeOfParam.has(name)) continue;
    variables[name] = nameExpression(def.defaultValue, sourceRg, typeOfParam.get(name)!);
    delete params[name];
    renamed.push(name);
  }

  let text = JSON.stringify(resources);
  for (const name of renamed) text = text.split(`parameters('${name}')`).join(`variables('${name}')`);
  const out = JSON.parse(text) as Resource[];

  const walk = (node: unknown, key: string, visit: (obj: Json, key: string) => void) => {
    if (Array.isArray(node)) node.forEach((v) => walk(v, key, visit));
    else if (node && typeof node === "object") {
      visit(node as Json, key);
      for (const [k, v] of Object.entries(node)) walk(v, k, visit);
    }
  };

  for (const r of out) {
    const top = r.type.split("/").length === 2;
    if (typeof r.location === "string" && normLoc(r.location) === normLoc(sourceLocation)) r.location = "[parameters('location')]";
    if (top && "location" in r && r.location !== "global") r.tags = "[parameters('tags')]";
    else if ("tags" in r && top) r.tags = "[parameters('tags')]";
    walk(r.properties, "properties", (obj) => {
      if (typeof obj.domainNameLabel === "string" && !obj.domainNameLabel.startsWith("[")) {
        obj.domainNameLabel = `[toLower(concat(parameters('labName'), '-', '${esc(obj.domainNameLabel)}'))]`;
      }
      delete obj.fqdn;
    });
  }
  const fixedCycles = breakPeeringCycles(out);
  if (fixedCycles) warnings.push(`Removed ${fixedCycles} inline peering(s) duplicated by peering resources (avoids a VNet dependency cycle)`);

  // Literal IDs that point outside the exported group cannot be recreated by it.
  const ext = new Set<string>();
  const literalIds = JSON.stringify(out).match(/\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[^/"]+\/providers\/[^"]+/gi) ?? [];
  for (const id of literalIds) {
    const rg = /\/resourceGroups\/([^/]+)/i.exec(id)?.[1] ?? "";
    if (rg.toLowerCase() !== sourceRg.toLowerCase()) ext.add(id.split("/").slice(0, 9).join("/"));
    else if (id.toLowerCase().includes(sourceSubscription.toLowerCase())) ext.add(`${id.split("/").slice(0, 9).join("/")} (hard-coded to the source group)`);
  }
  for (const id of ext) warnings.push(`References ${id} — it must exist before deploying`);

  const types = [...new Set(out.map((r) => r.type))];
  t.parameters = {
    labName: { type: "string" },
    location: { type: "string" },
    tags: { type: "object", defaultValue: {} },
    ...params,
  };
  for (const [name, def] of Object.entries(params)) if (def.defaultValue === undefined) warnings.push(`Parameter ${name} has no default — set one before launching`);
  t.variables = variables;
  t.resources = out;
  return { template: t, warnings, resourceTypes: types };
}

/**
 * Exported VNets carry their peerings both inline and as virtualNetworkPeerings child resources. The
 * inline copies make each VNet depend on its peers, which is a cycle for any two-way peering. The child
 * resources are kept (they depend on both VNets, which is correct); the inline copies and the VNet->VNet
 * dependsOn entries that existed only because of them are removed. Returns how many were removed.
 */
export function breakPeeringCycles(resources: { type: string; dependsOn?: unknown; properties?: Json }[]): number {
  let removed = 0;
  for (const r of resources) {
    if (r.type.toLowerCase() !== "microsoft.network/virtualnetworks" || !r.properties) continue;
    if (Array.isArray(r.properties.virtualNetworkPeerings) && r.properties.virtualNetworkPeerings.length) {
      removed += r.properties.virtualNetworkPeerings.length;
      delete r.properties.virtualNetworkPeerings;
    }
    if (!Array.isArray(r.dependsOn)) continue;
    const body = JSON.stringify(r.properties).toLowerCase();
    r.dependsOn = (r.dependsOn as string[]).filter((d) => {
      if (!/resourceId\('Microsoft\.Network\/virtualNetworks',/i.test(d) || /\/subnets'/i.test(d)) return true;
      // Keep a VNet->VNet dependency only if something other than peering still references that VNet.
      const inner = d.replace(/^\[|\]$/g, "").toLowerCase();
      return body.includes(inner);
    });
  }
  return removed;
}

// ---- Pricing from the template itself ----------------------------------------------------------

const APIM: Record<string, string> = { developer: "Developer", basic: "Basic", standard: "Standard", premium: "Premium", basicv2: "Basic v2", standardv2: "Standard v2", premiumv2: "Premium v2" };
const FW: Record<string, string> = { basic: "Basic", standard: "Standard", premium: "Premium" };

/** Hourly meters for the billable SKUs in a template (unknown types are simply not priced). */
export function metersFromTemplate(template: Json): PriceMeter[] {
  const meters: PriceMeter[] = [];
  let pips = 0;
  for (const r of ((template.resources as Resource[]) ?? [])) {
    const type = r.type.toLowerCase();
    const sku = r.sku ?? (r.properties?.sku as Resource["sku"]);
    if (type === "microsoft.apimanagement/service") {
      const s = APIM[(sku?.name ?? "").toLowerCase()];
      if (s && s !== "Consumption") meters.push({ label: `APIM ${s}`, serviceName: "API Management", skuName: s, meterName: `${s} Unit`, unitsPerHour: Math.max(1, Number(sku?.capacity ?? 1)) });
    } else if (type === "microsoft.network/azurefirewalls") {
      const s = FW[(sku?.tier ?? "").toLowerCase()];
      if (s) meters.push({ label: `Firewall ${s}`, serviceName: "Azure Firewall", skuName: s, meterName: `${s} Deployment`, unitsPerHour: 1 });
    } else if (type === "microsoft.network/applicationgateways") {
      const tier = String(sku?.tier ?? sku?.name ?? "");
      if (/waf_v2/i.test(tier)) meters.push({ label: "App Gateway WAF_v2", serviceName: "Application Gateway", productName: "Application Gateway WAF v2", skuName: "Standard", meterName: "Standard Fixed Cost", unitsPerHour: 1 });
      else if (/standard_v2/i.test(tier)) meters.push({ label: "App Gateway Standard_v2", serviceName: "Application Gateway", productName: "Application Gateway Standard v2", skuName: "Standard", meterName: "Standard Fixed Cost", unitsPerHour: 1 });
    } else if (type === "microsoft.network/publicipaddresses" && (sku?.name ?? "").toLowerCase() === "standard") {
      pips++;
    } else if (type === "microsoft.network/bastionhosts") {
      const s = (sku?.name ?? "Basic").replace(/^./, (c) => c.toUpperCase());
      if (s !== "Developer") meters.push({ label: `Bastion ${s}`, serviceName: "Azure Bastion", skuName: s, meterName: `${s} Gateway`, unitsPerHour: 1 });
    } else if (type === "microsoft.network/natgateways") {
      meters.push({ label: "NAT gateway", serviceName: "NAT Gateway", skuName: "Standard", meterName: "Standard Gateway", unitsPerHour: 1 });
    }
  }
  if (pips) meters.push({ label: "Public IPs", serviceName: "Virtual Network", productName: "IP Addresses", skuName: "Standard", meterName: "Standard IPv4 Static Public IP", unitsPerHour: pips });
  return meters;
}

export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "export";
}

export const WRAPPER = (module: string) => `// Generated by labctl from an exported resource group. Deploys ${module} into a fresh tagged lab group.
targetScope = 'subscription'

param labName string
param location string
param tags object

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: labName
  location: location
  tags: tags
}

module lab '${module}' = {
  scope: rg
  name: 'lab'
  params: {
    labName: labName
    location: location
    tags: tags
  }
}
`;
