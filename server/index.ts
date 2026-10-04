import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { CONFIG_PATH, ConfigMissingError, loadConfig, PROJECT_ROOT, ttlForBlueprint, withEnvOverrides, type LabctlConfig } from "./config.ts";
import { blankConfig, isConfigured, SettingsError } from "./settings.ts";
import { registerSetupRoutes, SetupConflict } from "./setupRoutes.ts";
import { ArmClient, ArmError } from "./azure/arm.ts";
import { listResourceGroups, listResources } from "./azure/resourceGraph.ts";
import { openDb, logAction, saveAuditRun, latestAuditRun, recentActions } from "./db.ts";
import { runAudit, type AuditReport } from "./audit/runAudit.ts";
import { checkRequest, newSessionToken } from "./security.ts";
import { assertAllowedSubscription, canModify, parseResourceId, ScopeError, typeFromId } from "./guard.ts";
import { CostService } from "./costService.ts";
import { buildSnapshot, liveProjectionFor } from "./snapshot.ts";
import { JobConflictError, JobRunner } from "./jobs.ts";
import { park, powerKind, resume } from "./actions/power.ts";
import { adoptResourceGroup, extendLab, releaseResourceGroup, setPersistent } from "./actions/tags.ts";
import { buildPreview, executePlan, fixConsumers, JobConflictPlanError, listLocks } from "./actions/deletion.ts";
import { readTags } from "./actions/tags.ts";
import { expiresAt, getTag, isLabManaged } from "./guard.ts";
import { allBlueprints, categoryOf, CATEGORIES, deployMinutesFor, getBlueprint, stagesFor } from "./labs/blueprints.ts";
import { exportToBlueprint, removeCustomBlueprint } from "./labs/export.ts";
import { estimate } from "./labs/pricing.ts";
import { forgetProvider } from "./labs/feasibility.ts";
import { suggestAlternatives } from "./labs/alternatives.ts";
import { backfillTimings, deployTimeFor, etaMinutes } from "./labs/timing.ts";
import { project } from "./azure/cost.ts";
import {
  deployLab,
  destroyLab,
  labProgress,
  LabRequestError,
  planReconcile,
  prepareLab,
  prepareRetry,
  readStageState,
  resumeLab,
  rgIdFor,
  stackUrl,
  validateLab,
  watchStack,
} from "./labs/engine.ts";
import { Sweeper } from "./labs/sweeper.ts";
import { getLab, listLabs, updateLab } from "./db.ts";
import { realProbes, validateScope } from "./validate.ts";
import { buildTopology } from "./topology.ts";
import { GraphDirectory } from "./sandbox/graph.ts";
import { courseList, markEnded, provisionSandbox, reprovisionSandbox, SandboxError, syncSandboxes } from "./sandbox/sandbox.ts";
import { getSandbox } from "./sandbox/store.ts";

// No config yet = first run: the app starts in setup mode and the UI walks through it.
let initial: LabctlConfig;
try {
  initial = loadConfig();
} catch (e) {
  if (!(e instanceof ConfigMissingError)) throw e;
  initial = withEnvOverrides(blankConfig());
}
const config = initial;
const runtime = { configured: isConfigured(config) };
const arm = new ArmClient({ tenantId: config.tenantId || undefined });
const db = openDb();
const costs = new CostService(arm, db);
const jobs = new JobRunner(db);
const token = newSessionToken();
const port = config.server.port;

const app = Fastify({ logger: { level: "info" } });

app.addHook("onRequest", async (req, reply) => {
  if (!req.url.startsWith("/api/")) return;
  const verdict = checkRequest({ method: req.method, url: req.url, headers: req.headers }, { apiPort: port, token });
  if (!verdict.ok) {
    req.log.warn({ reason: verdict.reason, url: req.url }, "request blocked");
    return reply.code(verdict.status).send({ error: verdict.reason });
  }
  // Until setup is done only the setup flow is reachable.
  if (!runtime.configured && !/^\/api\/(session|status|setup|jobs)(\/|\?|$)/.test(req.url)) {
    return reply.code(409).send({ error: "Gaia isn't set up yet", setupRequired: true });
  }
});

class GuardError extends Error {}

/** Reason labctl may not modify a resource (used when a delete has to detach something that stays). */
const touchGuard = (id: string): string | undefined => {
  const v = canModify(config, id);
  return v.allowed ? undefined : v.reason;
};

app.setErrorHandler((err, req, reply) => {
  if (err instanceof ScopeError || err instanceof GuardError) return reply.code(403).send({ error: err.message });
  if (err instanceof JobConflictError || err instanceof JobConflictPlanError) return reply.code(409).send({ error: err.message });
  if (err instanceof SetupConflict) return reply.code(409).send(err.body);
  if (err instanceof SettingsError || err instanceof SandboxError) return reply.code(400).send({ error: err.message });
  if (err instanceof z.ZodError) return reply.code(400).send({ error: z.prettifyError(err) });
  if (err instanceof ArmError) return reply.code(502).send({ error: err.message, code: err.code });
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status >= 400 && status < 500) return reply.code(status).send({ error: (err as Error).message });
  req.log.error(err);
  return reply.code(500).send({ error: (err as Error).message });
});

/** Every mutating route funnels through here: allow-list, exclusions and a resolvable resource type. */
function guardTarget(id: string): { id: string; type: string; name: string } {
  const verdict = canModify(config, id);
  if (!verdict.allowed) throw new GuardError(verdict.reason);
  const rg = parseResourceId(id).resourceGroup!;
  const type = typeFromId(id) ?? "Microsoft.Resources/resourceGroups";
  return { id, type, name: id.split("/").pop() ?? rg };
}

const armId = z.string().regex(/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+(\/providers\/.+)?$/i, "must be an ARM resource or resource group ID");
const subQuery = z.object({ subscriptionId: z.string(), refresh: z.enum(["0", "1"]).optional() });

app.get("/api/session", async () => ({ token }));

app.get("/api/status", async () => {
  let identity: { ok: boolean; error?: string } = { ok: runtime.configured };
  if (runtime.configured) {
    try {
      await arm.get(`/subscriptions/${config.subscriptions[0]!.id}?api-version=2022-12-01`);
    } catch (e) {
      identity = { ok: false, error: (e as Error).message };
    }
  }
  return {
    configured: runtime.configured,
    tenantId: config.tenantId,
    subscriptions: config.subscriptions,
    excludedResourceGroups: config.excludedResourceGroups,
    budget: config.budget,
    ttlHours: config.ttlHours,
    owner: config.owner,
    identity,
  };
});

app.get("/api/snapshot", async (req) => {
  const { subscriptionId, refresh } = subQuery.parse(req.query);
  assertAllowedSubscription(config, subscriptionId);
  const { snapshot } = await buildSnapshot(arm, config, db, costs, subscriptionId, refresh === "1");
  if (refresh === "1") {
    const { daily: _d, groups: _g, ...report } = snapshot;
    saveAuditRun(db, subscriptionId, report);
    logAction(db, { action: "audit.run", target: subscriptionId, outcome: "ok", detail: `${snapshot.findings.length} findings` });
  }
  return snapshot;
});

app.get("/api/audit/latest", async (req) => {
  const { subscriptionId } = subQuery.parse(req.query);
  assertAllowedSubscription(config, subscriptionId);
  return latestAuditRun<AuditReport>(db, subscriptionId) ?? null;
});

app.post("/api/audit/run", async (req) => {
  const { subscriptionId } = subQuery.parse(req.body);
  assertAllowedSubscription(config, subscriptionId);
  const report = await runAudit(arm, config, subscriptionId, costs, { refreshCosts: true });
  saveAuditRun(db, subscriptionId, report);
  logAction(db, { action: "audit.run", target: subscriptionId, outcome: "ok", detail: `${report.findings.length} findings` });
  return report;
});

app.get("/api/jobs", async () => jobs.recent(50));
app.get("/api/history", async () => recentActions(db, 200));

// ---- Power -----------------------------------------------------------------------------------

const resourceBody = z.object({ resourceId: armId });

app.post("/api/actions/park", async (req) => {
  const t = guardTarget(resourceBody.parse(req.body).resourceId);
  if (!powerKind(t.type)) throw new GuardError(`${t.type} cannot be parked`);
  return jobs.start("power.park", t.id, t.name, () => park(arm, db, t));
});

app.post("/api/actions/resume", async (req) => {
  const t = guardTarget(resourceBody.parse(req.body).resourceId);
  if (!powerKind(t.type)) throw new GuardError(`${t.type} cannot be resumed`);
  return jobs.start("power.resume", t.id, t.name, () => resume(arm, db, t));
});

// ---- Tags ------------------------------------------------------------------------------------

async function tagAction(action: string, target: string, work: () => Promise<string>) {
  try {
    const detail = await work();
    logAction(db, { action, target, outcome: "succeeded", detail });
    return { ok: true, detail };
  } catch (e) {
    logAction(db, { action, target, outcome: "failed", detail: (e as Error).message });
    throw e;
  }
}

app.post("/api/actions/adopt", async (req) => {
  const body = z
    .object({ resourceGroupId: armId, ttlHours: z.number().positive().optional(), purpose: z.string().max(200).optional() })
    .parse(req.body);
  const t = guardTarget(body.resourceGroupId);
  const ttlHours = body.ttlHours ?? ttlForBlueprint(config, "adopted");
  return tagAction("lab.adopt", t.id, () => adoptResourceGroup(arm, config, t.id, { ttlHours, purpose: body.purpose }));
});

app.post("/api/actions/release", async (req) => {
  const t = guardTarget(z.object({ resourceGroupId: armId }).parse(req.body).resourceGroupId);
  return tagAction("lab.release", t.id, () => releaseResourceGroup(arm, t.id));
});

app.post("/api/actions/extend", async (req) => {
  const body = z.object({ resourceGroupId: armId, hours: z.number().positive() }).parse(req.body);
  const t = guardTarget(body.resourceGroupId);
  return tagAction("lab.extend", t.id, () => extendLab(arm, t.id, body.hours));
});

app.post("/api/actions/persist", async (req) => {
  const body = z.object({ targetId: armId, persistent: z.boolean() }).parse(req.body);
  const t = guardTarget(body.targetId);
  return tagAction(body.persistent ? "tag.persist" : "tag.unpersist", t.id, () => setPersistent(arm, t.id, body.persistent));
});

// ---- Delete ----------------------------------------------------------------------------------

const deleteBody = z.object({ targetIds: z.array(armId).min(1).max(50) });

async function preview(targetIds: string[]) {
  const subs = [...new Set(targetIds.map((id) => parseResourceId(id).subscriptionId.toLowerCase()))];
  for (const s of subs) assertAllowedSubscription(config, s);
  const [resources, groups] = await Promise.all([listResources(arm, subs), listResourceGroups(arm, subs)]);
  let costMap: Map<string, number> | undefined;
  try {
    const rows = (await costs.byResource30d(subs[0]!)).value;
    costMap = new Map(rows.map((r) => [r.key, r.cost]));
  } catch {
    costMap = undefined;
  }
  const locks = new Map<string, string[]>();
  const fetchLocks = (scopes: string[]) =>
    Promise.all(
      [...new Set(scopes.map((s) => s.toLowerCase()))]
        .filter((s) => s && !locks.has(s))
        .map(async (s) => {
          locks.set(s, await listLocks(arm, s).catch(() => []));
        }),
    );
  const rgOf = (id: string) => (/^\/subscriptions\/[^/]+\/resourcegroups\/[^/]+/i.exec(id)?.[0] ?? "");
  await fetchLocks(targetIds.flatMap((id) => [id, rgOf(id)]));
  // Resources the plan would modify (detach) must be unlocked too; plan once, read their locks, plan again.
  const first = buildPreview(config, targetIds, resources, groups, costMap, locks);
  const extra = fixConsumers(first.plan).filter((s) => !locks.has(s));
  if (!extra.length) return { preview: first, resources };
  await fetchLocks(extra);
  return { preview: buildPreview(config, targetIds, resources, groups, costMap, locks), resources };
}

app.post("/api/actions/delete/preview", async (req) => {
  const { targetIds } = deleteBody.parse(req.body);
  const { preview: result } = await preview(targetIds);
  logAction(db, {
    action: "delete.preview",
    target: targetIds.join(","),
    dryRun: true,
    outcome: "ok",
    detail: `${result.items.filter((i) => i.allowed).length}/${result.items.length} deletable, ${result.plan.steps.length} steps, ${result.plan.blockers.length} blockers`,
  });
  return result;
});

app.post("/api/actions/delete", async (req) => {
  const body = deleteBody.extend({ confirm: z.string() }).parse(req.body);
  // Recompute on the server so the confirmation always matches what is actually deleted now.
  const { preview: result, resources } = await preview(body.targetIds);
  const allowed = result.items.filter((i) => i.allowed);
  if (allowed.length === 0) throw new GuardError("Nothing in this selection can be deleted");
  if (body.confirm !== result.confirmPhrase) throw new GuardError(`Confirmation text does not match. Type: ${result.confirmPhrase}`);
  for (const s of result.plan.steps) guardTarget(s.target.id);
  const started = executePlan(arm, jobs, result.plan, resources);
  const skipped = result.items.filter((i) => !i.allowed).map((i) => ({ name: i.name, reason: i.reason }));
  return { jobs: started, skipped };
});

// ---- Labs ------------------------------------------------------------------------------------

const sweeper = new Sweeper(arm, db, config, jobs);

const labRequest = z.object({
  blueprint: z.string(),
  region: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  ttlHours: z.number(),
  purpose: z.string().max(200).optional(),
  labName: z.string().optional(),
  subscriptionId: z.string().regex(/^[0-9a-f-]{36}$/i).optional(),
});

function asGuard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof LabRequestError) throw new GuardError(e.message);
    throw e;
  }
}

app.get("/api/blueprints", async () => ({
  categories: CATEGORIES,
  regions: config.labs.regions,
  defaultRegion: config.labs.defaultRegion,
  blueprints: allBlueprints().map((b) => {
    const defaults = b.schema.parse({});
    return {
      id: b.id,
      title: b.title,
      category: categoryOf(b),
      tagline: b.tagline,
      scenario: b.scenario,
      icons: b.icons,
      fields: b.fields,
      notes: b.notes,
      ttlHours: ttlForBlueprint(config, b.id),
      steps: b.steps(defaults),
      stages: stagesFor(b, defaults).map((s) => ({ label: s.label, gate: s.gate?.label })),
      presets: b.presets ?? [],
      ...(() => {
        const t = deployTimeFor(db, b, defaults, config.labs.defaultRegion, deployMinutesFor(b, defaults));
        return { deployMinutes: t.minutes, timing: { source: t.source, samples: t.samples, typical: t.typical } };
      })(),
      custom: b.custom,
    };
  }),
}));

app.post("/api/blueprints/export", async (req) => {
  const body = z
    .object({ resourceGroupId: z.string().regex(/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+$/i), title: z.string().min(2).max(60), tagline: z.string().max(80).optional() })
    .parse(req.body);
  assertAllowedSubscription(config, parseResourceId(body.resourceGroupId).subscriptionId);
  const meta = await exportToBlueprint(arm, body.resourceGroupId, { title: body.title, tagline: body.tagline, takenCodes: new Set(allBlueprints().map((b) => b.code)) });
  logAction(db, { action: "blueprint.export", target: body.resourceGroupId, outcome: "ok", detail: `${meta.id} (${meta.resourceCount} resources, ${meta.module}, ${meta.warnings.length} warnings)` });
  return meta;
});

app.delete("/api/blueprints/:id", async (req) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  try {
    removeCustomBlueprint(id);
  } catch (e) {
    throw new GuardError((e as Error).message);
  }
  logAction(db, { action: "blueprint.remove", target: id, outcome: "ok" });
  return { ok: true };
});

app.post("/api/labs/estimate", async (req) => {
  const body = z.object({ blueprint: z.string(), region: z.string(), params: z.record(z.string(), z.unknown()).default({}) }).parse(req.body);
  const p = asGuard(() => prepareLab(config, { ...body, ttlHours: 1 }, new Date(), { skipRules: true }));
  const est = await estimate(db, p.region, p.blueprint.meters(p.params), p.blueprint.notes);
  return {
    ...est,
    rules: p.blueprint.rules?.(p.params) ?? [],
    ...(() => {
      const t = deployTimeFor(db, p.blueprint, p.params, p.region, deployMinutesFor(p.blueprint, p.params));
      return { deployMinutes: t.minutes, timing: { source: t.source, samples: t.samples, typical: t.typical } };
    })(),
    steps: p.blueprint.steps(p.params),
    stages: stagesFor(p.blueprint, p.params).map((s) => ({ label: s.label, gate: s.gate?.label })),
  };
});

/** Month-end forecast for budget checks: the live one (existing resources) when available, else the trend. */
async function forecastMonth(sub: string): Promise<number | undefined> {
  const d = await costs.daily30(sub, false);
  if (!d.value.length) return undefined;
  const resources = await listResources(arm, [sub]).catch(() => undefined);
  const live = resources ? await liveProjectionFor(costs, db, sub, resources, d.value) : undefined;
  return live?.liveForecastMonth ?? project(d.value).forecastMonth;
}

app.post("/api/labs/validate", async (req) => {
  const body = labRequest.parse(req.body);
  asGuard(() => prepareLab(config, body, new Date(), { skipRules: true }));
  const result = await validateLab(arm, db, config, body, { forecastMonth });
  const warn = result.checks.filter((c) => c.status === "warn").length;
  logAction(db, {
    action: "lab.validate",
    target: result.labName,
    dryRun: true,
    outcome: result.issues.length ? "failed" : "ok",
    detail: result.issues.join(" | ") || `${body.blueprint}: ${result.checks.length} checks${warn ? `, ${warn} warnings` : ""}`,
  });
  return result;
});

app.post("/api/labs/alternatives", async (req) => {
  const body = labRequest.parse(req.body);
  asGuard(() => prepareLab(config, body, new Date(), { skipRules: true }));
  return suggestAlternatives(arm, db, config, body, { forecastMonth });
});

app.post("/api/providers/:namespace/register", async (req) => {
  const { namespace } = z.object({ namespace: z.string().regex(/^Microsoft\.[A-Za-z]+$/) }).parse(req.params);
  const { subscriptionId } = z.object({ subscriptionId: z.string().optional() }).parse(req.body ?? {});
  const sub = subscriptionId ?? config.subscriptions[0]!.id;
  assertAllowedSubscription(config, sub);
  await arm.post(`/subscriptions/${sub}/providers/${namespace}/register?api-version=2021-04-01`, {});
  forgetProvider(db, sub, namespace);
  logAction(db, { action: "provider.register", target: namespace, outcome: "ok" });
  return { ok: true, note: "Registration takes a few minutes; re-run the checks." };
});

app.post("/api/labs", async (req) => {
  const body = labRequest.parse(req.body);
  const p = asGuard(() => prepareLab(config, body));
  assertAllowedSubscription(config, p.subscriptionId);
  const est = await estimate(db, p.region, p.blueprint.meters(p.params), p.blueprint.notes).catch(() => undefined);
  const job = jobs.start("lab.deploy", rgIdFor(p.subscriptionId, p.labName), p.labName, () => deployLab(arm, db, p, est?.hourly));
  return { job, labName: p.labName, expiresOn: p.expiresOn };
});

/** Minutes left for a deploying lab, from learned stage durations. */
function labEta(r: { blueprint: string; params_json: string; created_at: string; stage_json?: string | null }): number | undefined {
  try {
    const b = getBlueprint(r.blueprint);
    return etaMinutes(db, b, b.schema.parse(JSON.parse(r.params_json)) as Record<string, unknown>, readStageState(r), r.created_at);
  } catch {
    return undefined;
  }
}

app.get("/api/labs", async () => {
  const subs = config.subscriptions.map((s) => s.id);
  const groups = await listResourceGroups(arm, subs).catch(() => []);
  const live = new Map(groups.filter((g) => isLabManaged(g.tags)).map((g) => [g.name.toLowerCase(), g]));
  const rows = listLabs(db, 100);
  const known = new Set(rows.map((r) => r.name.toLowerCase()));
  const labs = rows.map((r) => {
    const g = live.get(r.name.toLowerCase());
    return {
      name: r.name,
      blueprint: r.blueprint,
      region: r.region,
      status: r.status,
      purpose: r.purpose,
      params: JSON.parse(r.params_json) as Record<string, unknown>,
      estHourly: r.est_hourly,
      createdAt: r.created_at,
      readyAt: r.ready_at,
      destroyedAt: r.destroyed_at,
      expiresOn: expiresAt(g?.tags)?.toISOString(),
      outputs: r.outputs_json ? (JSON.parse(r.outputs_json) as Record<string, unknown>) : {},
      error: r.error,
      stage: readStageState(r) ?? null,
      etaMinutes: r.status === "deploying" ? labEta(r) : undefined,
      exists: Boolean(g),
      resourceGroupId: rgIdFor(r.subscription_id, r.name),
    };
  });
  // Labs adopted from the Inventory, or created elsewhere, are listed too.
  const adopted = [...live.values()]
    .filter((g) => !known.has(g.name.toLowerCase()))
    .map((g) => ({
      name: g.name,
      blueprint: getTag(g.tags, "blueprint") ?? "adopted",
      region: g.location,
      status: "ready",
      purpose: getTag(g.tags, "purpose") ?? null,
      params: {},
      estHourly: null,
      createdAt: getTag(g.tags, "createdOn") ?? null,
      readyAt: null,
      destroyedAt: null,
      expiresOn: expiresAt(g.tags)?.toISOString(),
      outputs: {},
      error: null,
      stage: null,
      exists: true,
      resourceGroupId: g.id,
    }));
  return { labs: [...adopted, ...labs], sweep: { last: sweeper.last, nextAt: sweeper.nextAt, enabled: config.labs.sweepEnabled } };
});

app.get("/api/labs/:name/progress", async (req) => {
  const { name } = z.object({ name: z.string().regex(/^[A-Za-z0-9._()-]+$/) }).parse(req.params);
  const row = getLab(db, name);
  if (!row) return { steps: [] };
  const bp = getBlueprint(row.blueprint);
  const steps = bp.steps(bp.schema.parse(JSON.parse(row.params_json)));
  return { steps: await labProgress(arm, row.subscription_id, name, steps), stage: readStageState(row) ?? null };
});

app.post("/api/labs/:name/retry", async (req) => {
  const { name } = z.object({ name: z.string().regex(/^[A-Za-z0-9._()-]+$/) }).parse(req.params);
  const row = getLab(db, name);
  if (!row) throw new GuardError("Only labs created by labctl can be retried");
  if (row.status !== "failed") throw new GuardError(`Lab is ${row.status}, not failed`);
  const rgId = rgIdFor(row.subscription_id, name);
  guardTarget(rgId);
  const tags = await readTags(arm, rgId).catch(() => ({}) as Record<string, string>);
  const p = asGuard(() => prepareRetry(config, row, tags));
  return jobs.start("lab.deploy", rgId, name, () => deployLab(arm, db, p, row.est_hourly ?? undefined, { resume: true }));
});
app.delete("/api/labs/:name", async (req) => {
  const { name } = z.object({ name: z.string().regex(/^[A-Za-z0-9._()-]+$/) }).parse(req.params);
  const { subscriptionId } = z.object({ subscriptionId: z.string().optional() }).parse(req.query);
  // A lab Gaia created knows its subscription; adopted ones are named by the caller.
  const sub = getLab(db, name)?.subscription_id ?? subscriptionId ?? config.subscriptions[0]!.id;
  const rgId = rgIdFor(sub, name);
  const t = guardTarget(rgId);
  // Destroy is only for labs: the group must carry managedBy=labctl, or be a lab this app created.
  const tags = await readTags(arm, rgId).catch(() => ({}) as Record<string, string>);
  if (!isLabManaged(tags) && !getLab(db, name)) throw new GuardError("Not a labctl lab; delete it from the Inventory instead");
  return jobs.start("lab.destroy", t.id, name, () => destroyLab(arm, db, sub, name, { canTouch: touchGuard }));
});

app.post("/api/labs/sweep", async () => sweeper.run("manual"));

// ---- Student sandboxes (one resource group per student and course; see docs/student-sandbox.md) ----

const directory = new GraphDirectory({ tenantId: config.tenantId || undefined });
const sandboxDeps = () => ({ arm, db, config, directory });

app.get("/api/sandboxes/courses", async () => courseList());

app.get("/api/sandboxes", async () => syncSandboxes({ arm, db }));

app.post("/api/sandboxes", async (req) => {
  const body = z.object({ student: z.string().min(3).max(200), course: z.string(), days: z.coerce.number().int().min(1).max(90).optional(), subscriptionId: z.string().optional() }).parse(req.body);
  return provisionSandbox(sandboxDeps(), body);
});

app.post("/api/sandboxes/:name/reprovision", async (req) => {
  const { name } = z.object({ name: z.string().regex(/^[A-Za-z0-9._()-]+$/) }).parse(req.params);
  const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).optional() }).parse(req.body ?? {});
  const row = getSandbox(db, name);
  if (row) guardTarget(rgIdFor(row.subscription_id, name));
  return reprovisionSandbox(sandboxDeps(), name, days);
});

app.delete("/api/sandboxes/:name", async (req) => {
  const { name } = z.object({ name: z.string().regex(/^[A-Za-z0-9._()-]+$/) }).parse(req.params);
  const row = getSandbox(db, name);
  if (!row) throw new GuardError("Not a sandbox Gaia created");
  const t = guardTarget(rgIdFor(row.subscription_id, name));
  return jobs.start("sandbox.destroy", t.id, name, async () => {
    const note = await destroyLab(arm, db, row.subscription_id, name, { canTouch: touchGuard });
    markEnded(db, name);
    return note;
  });
});

// ---- Topology --------------------------------------------------------------------------------

app.get("/api/topology", async (req) => {
  const { resourceGroupId } = z.object({ resourceGroupId: z.string().regex(/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+$/i) }).parse(req.query);
  const { subscriptionId, resourceGroup } = parseResourceId(resourceGroupId);
  assertAllowedSubscription(config, subscriptionId);
  return buildTopology(resourceGroup!, await listResources(arm, [subscriptionId]));
});

// ---- Validate --------------------------------------------------------------------------------

app.post("/api/validate", async (req) => {
  const { targetId } = z.object({ targetId: armId }).parse(req.body);
  const { subscriptionId, resourceGroup } = parseResourceId(targetId);
  assertAllowedSubscription(config, subscriptionId);
  const all = await listResources(arm, [subscriptionId]);
  const isGroup = /^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+$/i.test(targetId);
  const inScope = isGroup
    ? all.filter((r) => r.resourceGroup.toLowerCase() === resourceGroup!.toLowerCase())
    : all.filter((r) => r.id.toLowerCase() === targetId.toLowerCase());
  const lab = isGroup ? getLab(db, resourceGroup!) : undefined;
  const outputs = lab?.outputs_json ? (JSON.parse(lab.outputs_json) as Record<string, unknown>) : {};
  const report = await validateScope(targetId, inScope, all, realProbes(arm), outputs);
  logAction(db, { action: "validate", target: targetId, outcome: report.summary.fail ? "failed" : "ok", detail: `${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail` });
  return report;
});

// ---- Setup & settings ------------------------------------------------------------------------

registerSetupRoutes(app, {
  config,
  runtime,
  configPath: CONFIG_PATH,
  arm,
  db,
  jobs,
  onConfigured: () => {
    sweeper.start(10_000);
    void reconcileLabs().catch((e: Error) => app.log.warn({ err: e.message }, "lab reconciliation failed"));
  },
  onChanged: () => sweeper.restart(),
});

// ---- Static UI -------------------------------------------------------------------------------

const webDist = resolve(PROJECT_ROOT, "dist", "web");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
    return reply.sendFile("index.html");
  });
}

// Seed learned deploy times from labs deployed before timings were recorded.
try {
  const n = backfillTimings(db, (id) => allBlueprints().find((b) => b.id === id));
  if (n) app.log.info({ labs: n }, "deploy timings backfilled");
} catch (e) {
  app.log.warn({ err: (e as Error).message }, "timing backfill failed");
}

await app.listen({ host: "127.0.0.1", port });
app.log.info(runtime.configured ? `Project Gaia on http://127.0.0.1:${port}` : `Project Gaia setup on http://127.0.0.1:${port} (first run)`);
if (runtime.configured) {
  sweeper.start();
  void reconcileLabs().catch((e: Error) => app.log.warn({ err: e.message }, "lab reconciliation failed"));
}

/** After a restart, re-attach to labs that were mid-deploy or mid-destroy, based on what Azure shows. */
async function reconcileLabs() {
  const running = new Set(jobs.recent(200).filter((j) => j.status === "running").map((j) => j.target));
  for (const row of listLabs(db, 200).filter((r) => r.status === "deploying" || r.status === "destroying")) {
    const rgId = rgIdFor(row.subscription_id, row.name);
    const rgExists = await arm.get(`${rgId}?api-version=2021-04-01`).then(() => true, () => false);
    const stack = await arm.get<{ properties: { provisioningState: string } }>(stackUrl(row.subscription_id, row.name)).catch(() => undefined);
    const plan = planReconcile(row, running.has(rgId.toLowerCase()), rgExists, stack?.properties.provisioningState);
    if (!plan) continue;
    app.log.info({ lab: row.name, action: plan.action }, "reconciling lab");
    if (plan.action === "destroyed") updateLab(db, row.name, { status: "destroyed", destroyed_at: row.destroyed_at ?? new Date().toISOString() });
    else if (plan.action === "failed") updateLab(db, row.name, { status: "failed", error: "Deployment was interrupted and no stack exists" });
    else if (plan.action === "watch") {
      // Staged labs continue with their remaining gates and stages; older labs are just followed.
      if (readStageState(row)) {
        const tags = await readTags(arm, rgId).catch(() => ({}) as Record<string, string>);
        const p = prepareRetry(config, row, tags);
        jobs.start("lab.deploy", rgId, row.name, () => resumeLab(arm, db, p, row.est_hourly ?? undefined));
      } else jobs.start("lab.deploy", rgId, row.name, () => watchStack(arm, db, row.subscription_id, row.name));
    } else jobs.start("lab.destroy", rgId, row.name, () => destroyLab(arm, db, row.subscription_id, row.name, { canTouch: touchGuard }));
  }
}


