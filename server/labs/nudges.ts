import type { Db } from "../db.ts";
import { expiresAt, getTag, isLabManaged, type Tags } from "../guard.ts";

export interface LabGroup {
  name: string;
  tags?: Tags;
}

export interface Nudge {
  lab: string;
  kind: "expiring" | "overdue";
  expiresOn: string;
  minutes: number;
  purpose?: string;
  blueprint?: string;
  /** Dedupe key: a new expiry (after Extend) produces a new nudge. */
  key: string;
}

/**
 * Labs expiring within `withinMinutes`, plus labs already past expiry that still exist (the app was
 * closed, so nothing swept them). Each (lab, expiry, kind) is nudged once.
 */
export function selectNudges(groups: LabGroup[], alreadySent: Set<string>, now: Date, withinMinutes: number): Nudge[] {
  const out: Nudge[] = [];
  for (const g of groups) {
    if (!isLabManaged(g.tags)) continue;
    const exp = expiresAt(g.tags);
    if (!exp) continue;
    const minutes = Math.round((exp.getTime() - now.getTime()) / 60_000);
    const kind = minutes <= 0 ? "overdue" : minutes <= withinMinutes ? "expiring" : undefined;
    if (!kind) continue;
    const expiresOn = exp.toISOString();
    const key = `${expiresOn}#${kind}`;
    if (alreadySent.has(`${g.name.toLowerCase()}|${key}`)) continue;
    out.push({ lab: g.name, kind, expiresOn, minutes, purpose: getTag(g.tags, "purpose"), blueprint: getTag(g.tags, "blueprint"), key });
  }
  return out.sort((a, b) => a.minutes - b.minutes);
}

export function sentNudges(db: Db): Set<string> {
  const rows = db.prepare("SELECT lab, expires_on FROM nudges").all() as { lab: string; expires_on: string }[];
  return new Set(rows.map((r) => `${r.lab.toLowerCase()}|${r.expires_on}`));
}

export function markNudged(db: Db, nudges: Nudge[]) {
  const stmt = db.prepare("INSERT OR IGNORE INTO nudges (lab, expires_on, sent_at) VALUES (?, ?, ?)");
  for (const n of nudges) stmt.run(n.lab.toLowerCase(), n.key, new Date().toISOString());
}

const fmtMinutes = (m: number) => {
  const a = Math.abs(m);
  return a < 60 ? `${a} min` : `${Math.floor(a / 60)}h ${a % 60}m`;
};

export function formatNudges(nudges: Nudge[], hourlyByLab: Map<string, number>, appUrl: string): string {
  const lines = ["⏳ Project Gaia — lab expiry"];
  for (const n of nudges) {
    const rate = hourlyByLab.get(n.lab.toLowerCase());
    const what = [n.purpose, n.blueprint].filter(Boolean).join(" · ");
    lines.push(
      n.kind === "expiring"
        ? `• ${n.lab}${what ? ` (${what})` : ""} expires in ${fmtMinutes(n.minutes)} and will be destroyed by the next sweep.`
        : `• ${n.lab}${what ? ` (${what})` : ""} expired ${fmtMinutes(n.minutes)} ago and is still running${rate ? ` (~$${rate.toFixed(2)}/hr)` : ""}. It will be destroyed at your next logon/unlock or when the app opens.`,
    );
  }
  lines.push(`Extend or destroy: ${appUrl}/#labs`);
  return lines.join("\n");
}
