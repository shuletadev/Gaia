/**
 * Prints expiry nudges for labs expiring soon (or overdue), once per lab+expiry.
 * Used by the Scout "labctl expiry nudges" automation:  npm run --silent nudge -- --mark
 * Prints exactly "NONE" when there is nothing to say.
 */
import { listResourceGroups } from "../server/azure/resourceGraph.ts";
import { listLabs } from "../server/db.ts";
import { formatNudges, markNudged, selectNudges, sentNudges } from "../server/labs/nudges.ts";
import { arg, context, withRetry } from "./context.ts";

const { config, arm, db } = context();
const within = Number(arg("within") ?? 75);

const groups = await withRetry(() => listResourceGroups(arm, config.subscriptions.map((s) => s.id)), 3, 5_000);
const nudges = selectNudges(groups, sentNudges(db), new Date(), within);

if (!nudges.length) {
  console.log("NONE");
} else {
  const hourly = new Map(listLabs(db, 500).filter((l) => l.est_hourly).map((l) => [l.name.toLowerCase(), l.est_hourly!]));
  console.log(formatNudges(nudges, hourly, `http://127.0.0.1:${config.server.port}`));
  if (arg("mark")) markNudged(db, nudges);
}
