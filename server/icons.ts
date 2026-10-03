import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { ICON_SLUGS } from "../web/src/iconMap.ts";
import { PROJECT_ROOT } from "./config.ts";

/**
 * Downloads the official Azure architecture icon set and extracts the icons Gaia uses. The icons are
 * Microsoft's and are not committed to the repository; each user downloads them after accepting the terms.
 */

export const ICONS_ZIP_URL = process.env.AZURE_ICONS_URL ?? "https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V24.zip";
export const ICONS_TERMS = "https://learn.microsoft.com/azure/architecture/icons/#icon-terms";
/** Source folder (picked up by the next UI build) and the built UI (served right away). */
export const ICON_DIRS = [resolve(PROJECT_ROOT, "web", "public", "azure-icons"), resolve(PROJECT_ROOT, "dist", "web", "azure-icons")];

export function iconsInstalled(dirs = ICON_DIRS): boolean {
  return existsSync(join(dirs[0]!, "Resource-Groups.svg"));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.toLowerCase().endsWith(".svg")) out.push(p);
  }
  return out;
}

function extract(zip: string, dest: string) {
  try {
    execFileSync("tar", ["-xf", zip, "-C", dest], { stdio: "ignore" });
  } catch {
    // GNU tar cannot read zip; fall back to PowerShell on Windows or unzip elsewhere.
    if (process.platform === "win32") execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`]);
    else execFileSync("unzip", ["-q", zip, "-d", dest]);
  }
}

export async function downloadIcons(opts: { dirs?: string[]; log?: (s: string) => void } = {}): Promise<{ extracted: number; wanted: number; missing: string[] }> {
  const log = opts.log ?? (() => undefined);
  const dirs = opts.dirs ?? ICON_DIRS;
  const work = mkdtempSync(join(tmpdir(), "gaia-icons-"));
  try {
    log(`Downloading ${ICONS_ZIP_URL}`);
    const res = await fetch(ICONS_ZIP_URL);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    const zip = join(work, "icons.zip");
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    extract(zip, work);

    // Files are named like "10069-icon-service-Public-IP-Addresses.svg"; the numeric prefix changes between releases.
    const bySlug = new Map<string, string>();
    for (const file of walk(work)) {
      const slug = basename(file, ".svg").replace(/^\d+-icon-service-/, "");
      if (!bySlug.has(slug)) bySlug.set(slug, file);
    }
    const wanted = [...new Set(Object.values(ICON_SLUGS))];
    const missing = wanted.filter((s) => !bySlug.has(s));
    for (const out of dirs) {
      // The built UI only exists after a build; the source copy is always written.
      if (out !== dirs[0] && !existsSync(resolve(out, ".."))) continue;
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      for (const slug of wanted) {
        const src = bySlug.get(slug);
        if (src) copyFileSync(src, join(out, `${slug}.svg`));
      }
      writeFileSync(join(out, "SOURCE.txt"), `Microsoft Azure architecture icons\n${ICONS_ZIP_URL}\nTerms: ${ICONS_TERMS}\nNot for redistribution outside the permitted use.\n`);
    }
    log(`Extracted ${wanted.length - missing.length}/${wanted.length} icons`);
    if (!existsSync(join(dirs[0]!, "Resource-Groups.svg"))) throw new Error("The icon set did not contain the expected files");
    return { extracted: wanted.length - missing.length, wanted: wanted.length, missing };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
