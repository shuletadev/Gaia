/**
 * npm run package [-- --out <dir>] [--allow <name>]... [--allow-dirty]
 *
 * Builds a shareable zip of the last commit: source only, plus START-HERE.md. Refuses if the commit contains
 * personal config, local data or licensed icons, or mentions identifiers from your own environment
 * (tenant, subscriptions, owner, resource names from your audits).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CONFIG_PATH, DATA_DIR, PROJECT_ROOT } from "../server/config.ts";
import { forbiddenPaths, packageName, personalIdentifiers, startHere } from "./packageLib.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const values = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []));
const outDir = resolve(values("--out")[0] ?? join(PROJECT_ROOT, "release"));

const git = (...a: string[]) => execFileSync("git", a, { cwd: PROJECT_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const fail = (msg: string): never => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

// 1. Package exactly what is committed.
const dirty = git("status", "--porcelain", "--untracked-files=no");
if (dirty && !flag("--allow-dirty")) fail(`Uncommitted changes would not be in the package:\n${dirty}\nCommit them first, or pass --allow-dirty to package the last commit anyway.`);
const commit = git("rev-parse", "--short", "HEAD");
const version = (JSON.parse(git("show", "HEAD:package.json")) as { version: string }).version;
const date = new Date().toISOString().slice(0, 10);

// 2. Nothing personal, local or licensed in the tree.
const paths = git("ls-tree", "-r", "--name-only", "HEAD").split("\n").filter(Boolean);
const bad = forbiddenPaths(paths);
if (bad.length) fail(`These files must not be shared but are committed:\n  ${bad.join("\n  ")}`);

// 3. No identifiers from your own environment anywhere in the files.
let config: Parameters<typeof personalIdentifiers>[0];
if (existsSync(CONFIG_PATH)) config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const reports: Parameters<typeof personalIdentifiers>[1] = [];
const dbPath = join(DATA_DIR, "labctl.db");
if (existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  // The latest audit per subscription holds every resource group and flagged resource name.
  const rows = db.prepare("SELECT report_json FROM audit_runs WHERE id IN (SELECT MAX(id) FROM audit_runs GROUP BY subscription_id)").all() as { report_json: string }[];
  for (const r of rows) reports.push(JSON.parse(r.report_json));
  db.close();
}
const ids = personalIdentifiers(config, reports, values("--allow"));
const tmp = mkdtempSync(join(tmpdir(), "gaia-package-"));
try {
  if (ids.length) {
    const patterns = join(tmp, "patterns.txt");
    writeFileSync(patterns, ids.join("\n"));
    let hits = "";
    try {
      hits = git("grep", "-n", "-I", "-i", "-w", "-F", "-f", patterns, "HEAD");
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw e; // 1 = no matches
    }
    if (hits) {
      const lines = hits.split("\n").map((l) => l.replace(/^HEAD:/, ""));
      fail(`Found identifiers from your environment in the code:\n  ${lines.slice(0, 30).join("\n  ")}${lines.length > 30 ? `\n  …and ${lines.length - 30} more` : ""}\nReplace them with placeholders and commit, or pass --allow <name> for a false positive.`);
    }
  }

  // 4. Archive the commit with START-HERE.md on top.
  const name = packageName({ version, commit });
  const note = join(tmp, "START-HERE.md");
  writeFileSync(note, startHere({ version, commit, date }));
  mkdirSync(outDir, { recursive: true });
  const zip = join(outDir, `${name}.zip`);
  git("archive", "--format=zip", "--prefix=Gaia/", `--add-file=${note}`, "-o", zip, "HEAD");

  const hash = createHash("sha256").update(readFileSync(zip)).digest("hex");
  writeFileSync(`${zip}.sha256`, `${hash}  ${basename(zip)}\n`);
  const mb = (statSync(zip).size / 1024 / 1024).toFixed(1);
  console.log(`
✓ ${zip}
  ${paths.length + 1} files · ${mb} MB · version ${version} · build ${commit}
  checked ${ids.length} identifiers from your environment — none found
  SHA-256 ${hash}  (also in ${basename(zip)}.sha256)

Share the zip; recipients open Gaia/START-HERE.md.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
