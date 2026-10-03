/**
 * Pure helpers behind `npm run package`: what must never ship, which personal identifiers to look for,
 * and the START-HERE note that goes into the zip.
 */

/** Paths that must never be in a package (personal config, local data, licensed icons, build output). */
const FORBIDDEN = [
  /^labctl\.config\.json$/i,
  /^data\//i,
  /^node_modules\//i,
  /^dist\//i,
  /^release\//i,
  /^web\/public\/azure-icons\//i,
  /^blueprints\/custom-/i,
  /(^|\/)\.env/i,
  /\.(db|sqlite|bundle|pfx|pem|key)$/i,
];

export function forbiddenPaths(paths: string[]): string[] {
  return paths.filter((p) => FORBIDDEN.some((re) => re.test(p)));
}

/** Names Azure creates for everyone; they legitimately appear in the code and docs. */
const GENERIC = [/^NetworkWatcherRG$/i, /^NetworkWatcher_/i, /^DefaultResourceGroup-/i, /^cloud-shell-storage-/i, /^MC_/i, /^AzureBackupRG_/i, /^Default-/i, /^LogAnalyticsDefaultResources$/i];
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

interface ConfigLike {
  tenantId?: string;
  subscriptions?: { id: string; name: string }[];
  owner?: string;
  excludedResourceGroups?: string[];
}

interface ReportLike {
  subscription?: { id?: string; name?: string };
  resourceGroups?: { name?: string }[];
  topResources?: { name?: string }[];
  findings?: { name?: string }[];
}

/**
 * Identifiers that would reveal whose environment this is: tenant and subscription IDs and names, the owner,
 * protected groups and the resource / group names from the last audit. Short and Azure-generic names are skipped.
 */
export function personalIdentifiers(config: ConfigLike | undefined, reports: ReportLike[], allow: string[] = []): string[] {
  const out = new Set<string>();
  const add = (v: string | undefined) => {
    const s = v?.trim();
    if (!s || s.length < 5 || s === ZERO_GUID || GENERIC.some((re) => re.test(s))) return;
    if (allow.some((a) => a.toLowerCase() === s.toLowerCase())) return;
    out.add(s);
  };
  add(config?.tenantId);
  add(config?.owner);
  for (const s of config?.subscriptions ?? []) (add(s.id), add(s.name));
  for (const g of config?.excludedResourceGroups ?? []) add(g);
  for (const r of reports) {
    add(r.subscription?.id);
    add(r.subscription?.name);
    for (const x of [...(r.resourceGroups ?? []), ...(r.topResources ?? []), ...(r.findings ?? [])]) add(x.name);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

export interface PackageInfo {
  version: string;
  commit: string;
  date: string;
}

export function packageName(i: Pick<PackageInfo, "version" | "commit">): string {
  return `Gaia-${i.version}-${i.commit}`;
}

/** The first file a recipient opens. Kept short; the README has the details. */
export function startHere(i: PackageInfo): string {
  return `# Project Gaia — start here

Version ${i.version} · build ${i.commit} · packaged ${i.date}

Gaia is a local control room for your own Azure sandbox: cost and orphan audits, park/resume,
dependency-aware delete and quick API Management / networking labs.

## Is it safe to run?

- It runs only on your machine and listens on 127.0.0.1 (not reachable from the network).
- It acts as **you**, through your own Azure CLI sign-in, and only on the subscriptions you pick at setup.
- Your settings and history stay in this folder (\`labctl.config.json\`, \`data/\`). Nothing is sent anywhere else:
  it talks only to Azure Resource Manager, the public Azure Retail Prices API and — only if you choose to —
  the official Azure icons download.
- This package contains source code only: no one else's settings, data or credentials.
- Deletes outside expired Gaia labs always need your typed confirmation.

## You need

- Node.js 22.13 or later (24 recommended) — https://nodejs.org
- Azure CLI — https://aka.ms/installazurecli
- Bicep CLI — run \`az bicep install\`
- A sandbox subscription you own, with Contributor (Owner if you want Gaia to register resource providers)

## Run it

\`\`\`powershell
cd Gaia
npm install
npm start
\`\`\`

Open http://127.0.0.1:4870 — a short setup wizard connects Gaia to your tenant and subscription.
Everything can be changed later under **Settings**.

## Updating to a newer package

Unzip the new version into a new folder, copy \`labctl.config.json\` and the \`data\` folder across from the old
one, then \`npm install\` and \`npm start\` there.

## Removing it

Destroy any running labs first (Labs screen), then delete the folder.

See README.md for the full guide.
`;
}
