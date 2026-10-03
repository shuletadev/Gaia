import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { ArmClient } from "../azure/arm.ts";
import { parseResourceId } from "../guard.ts";
import { BLUEPRINT_DIR, bicepPath } from "./compile.ts";
import type { Blueprint, PriceMeter } from "./blueprints.ts";
import { metersFromTemplate, slugify, transformExport, WRAPPER } from "./exportTransform.ts";

const run = promisify(execFile);
const bicep = bicepPath;

export interface CustomMeta {
  id: string;
  title: string;
  tagline: string;
  code: string;
  module: "lab.bicep" | "lab.json";
  source: { resourceGroup: string; subscriptionId: string; location: string; exportedAt: string };
  resourceTypes: string[];
  resourceCount: number;
  icons: string[];
  meters: PriceMeter[];
  deployMinutes: [number, number];
  warnings: string[];
  decompile: { ok: boolean; diagnostics: string[] };
}

const ICON_PRIORITY = [
  "microsoft.network/applicationgateways",
  "microsoft.apimanagement/service",
  "microsoft.network/azurefirewalls",
  "microsoft.network/frontdoors",
  "microsoft.cdn/profiles",
  "microsoft.network/virtualnetworkgateways",
  "microsoft.network/bastionhosts",
  "microsoft.compute/virtualmachines",
  "microsoft.containerservice/managedclusters",
  "microsoft.web/sites",
  "microsoft.network/loadbalancers",
  "microsoft.network/privatednszones",
  "microsoft.network/virtualnetworks",
  "microsoft.network/routetables",
  "microsoft.network/networksecuritygroups",
];

export function pickIcons(types: string[]): string[] {
  const lower = new Map(types.map((t) => [t.toLowerCase(), t]));
  const picked = ICON_PRIORITY.filter((t) => lower.has(t)).map((t) => lower.get(t)!);
  return (picked.length ? picked : types.filter((t) => t.split("/").length === 2)).slice(0, 3);
}

export function guessMinutes(types: string[]): [number, number] {
  const t = types.map((x) => x.toLowerCase());
  if (t.includes("microsoft.apimanagement/service")) return [10, 75];
  if (t.some((x) => ["microsoft.network/virtualnetworkgateways", "microsoft.network/azurefirewalls", "microsoft.network/applicationgateways"].includes(x))) return [10, 30];
  return [3, 15];
}

function uniqueId(base: string): string {
  let id = `custom-${base}`;
  for (let i = 2; existsSync(resolve(BLUEPRINT_DIR, id)); i++) id = `custom-${base}-${i}`;
  return id;
}

function uniqueCode(slug: string, taken: Set<string>): string {
  const stem = `x${slug.replace(/[^a-z0-9]/g, "")}`.slice(0, 8) || "xlab";
  let code = stem;
  for (let i = 2; taken.has(code); i++) code = `${stem.slice(0, 8)}${i}`;
  return code;
}

export async function exportToBlueprint(
  arm: ArmClient,
  resourceGroupId: string,
  opts: { title: string; tagline?: string; takenCodes: Set<string> },
): Promise<CustomMeta> {
  const { subscriptionId, resourceGroup } = parseResourceId(resourceGroupId);
  const rg = await arm.get<{ name: string; location: string }>(`${resourceGroupId}?api-version=2021-04-01`);
  const res = await arm.lro<{ template: Record<string, unknown>; error?: { message?: string; details?: { message?: string; target?: string }[] } }>(
    "POST",
    `${resourceGroupId}/exportTemplate?api-version=2021-04-01`,
    { resources: ["*"], options: "IncludeParameterDefaultValue" },
    { timeoutMs: 10 * 60_000, pollMs: 3000 },
  );
  if (!res?.template) throw new Error("Export returned no template");

  const t = transformExport(res.template, rg.name, rg.location, subscriptionId);
  const warnings = [...t.warnings];
  for (const d of res.error?.details ?? []) warnings.push(`Not exported: ${d.target ? `${d.target} — ` : ""}${d.message ?? ""}`.trim());
  if (res.error?.message && !res.error.details?.length) warnings.push(`Export: ${res.error.message}`);

  const slug = slugify(opts.title);
  const id = uniqueId(slug);
  const dir = resolve(BLUEPRINT_DIR, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "lab.json"), JSON.stringify(t.template, null, 2));

  // Readable Bicep is kept only if it compiles; exported templates often decompile with cycles.
  const decompile = { ok: false, diagnostics: [] as string[] };
  const work = mkdtempSync(join(tmpdir(), "labctl-export-"));
  try {
    copyFileSync(join(dir, "lab.json"), join(work, "lab.json"));
    try {
      await run(bicep(), ["decompile", join(work, "lab.json"), "--force"], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      decompile.diagnostics.push(...String((e as { stderr?: string }).stderr ?? "").split(/\r?\n/).filter((l) => /Error|Warning/.test(l)));
    }
    if (existsSync(join(work, "lab.bicep"))) {
      try {
        await run(bicep(), ["build", join(work, "lab.bicep"), "--stdout"], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
        decompile.ok = true;
        copyFileSync(join(work, "lab.bicep"), join(dir, "lab.bicep"));
      } catch (e) {
        decompile.diagnostics.push(...String((e as { stderr?: string }).stderr ?? "").split(/\r?\n/).filter((l) => / Error /.test(l)));
        copyFileSync(join(work, "lab.bicep"), join(dir, "lab.decompiled.bicep"));
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const strip = (s: string) => s.replace(/^.*?\.bicep\((\d+),(\d+)\) : /, "line $1: ").replace(/ \[https:\/\/aka\.ms[^\]]*\]/, "");
  decompile.diagnostics = [...new Set(decompile.diagnostics.map(strip))].slice(0, 20);

  const module = decompile.ok ? "lab.bicep" : "lab.json";
  writeFileSync(join(dir, "main.bicep"), WRAPPER(module));
  const topTypes = t.resourceTypes.filter((x) => x.split("/").length === 2);
  const meta: CustomMeta = {
    id,
    title: opts.title.trim().slice(0, 60),
    tagline: (opts.tagline?.trim() || `Exported from ${rg.name}`).slice(0, 80),
    code: uniqueCode(slug, opts.takenCodes),
    module,
    source: { resourceGroup: resourceGroup!, subscriptionId, location: rg.location, exportedAt: new Date().toISOString() },
    resourceTypes: t.resourceTypes,
    resourceCount: ((t.template.resources as unknown[]) ?? []).length,
    icons: pickIcons(topTypes),
    meters: metersFromTemplate(t.template),
    deployMinutes: guessMinutes(topTypes),
    warnings,
    decompile,
  };
  writeFileSync(join(dir, "blueprint.json"), JSON.stringify(meta, null, 2));
  writeFileSync(
    join(dir, "README.md"),
    `# ${meta.title}\n\nExported by labctl from \`${rg.name}\` on ${meta.source.exportedAt.slice(0, 10)}.\n\n` +
      `- Deploys \`${module}\` (${meta.resourceCount} resources) into a new lab group via \`main.bicep\`.\n` +
      `- Names are derived from the lab name; locations and tags come from the launch.\n` +
      (decompile.ok ? "" : `- \`lab.decompiled.bicep\` is the decompiler's output for reference; it does not compile as-is.\n`) +
      (warnings.length ? `\n## Warnings\n\n${warnings.map((w) => `- ${w}`).join("\n")}\n` : ""),
  );
  return meta;
}

// ---- Registry ----------------------------------------------------------------------------------

const metaSchema = z.object({ id: z.string(), code: z.string(), title: z.string() }).passthrough();

export function loadCustomBlueprints(): Blueprint[] {
  if (!existsSync(BLUEPRINT_DIR)) return [];
  const out: Blueprint[] = [];
  for (const dir of readdirSync(BLUEPRINT_DIR).filter((d) => d.startsWith("custom-"))) {
    const file = resolve(BLUEPRINT_DIR, dir, "blueprint.json");
    if (!existsSync(file)) continue;
    try {
      const m = metaSchema.parse(JSON.parse(readFileSync(file, "utf8"))) as unknown as CustomMeta;
      out.push({
        id: m.id,
        title: m.title,
        tagline: m.tagline,
        code: m.code,
        deployMinutes: m.deployMinutes,
        icons: m.icons,
        fields: [],
        schema: z.object({}).passthrough() as never,
        steps: () => [{ name: "lab", label: `${m.resourceCount} exported resources`, type: "Microsoft.Resources/resourceGroups" }],
        meters: () => m.meters,
        notes: ["Estimate covers recognised SKUs only", ...(m.warnings.length ? [`${m.warnings.length} export warning(s)`] : [])],
        armParams: () => ({}),
        custom: { source: m.source, warnings: m.warnings, module: m.module, decompileOk: m.decompile.ok },
      });
    } catch {
      /* skip malformed metadata */
    }
  }
  return out;
}

export function removeCustomBlueprint(id: string) {
  if (!/^custom-[a-z0-9-]+$/.test(id)) throw new Error("Only exported (custom-*) blueprints can be removed");
  const dir = resolve(BLUEPRINT_DIR, id);
  if (!existsSync(dir)) throw new Error("Blueprint not found");
  rmSync(dir, { recursive: true, force: true });
}
