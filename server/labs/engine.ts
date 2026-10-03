import type { ArmClient } from "../azure/arm.ts";
import { ArmError } from "../azure/arm.ts";
import type { LabctlConfig } from "../config.ts";
import { getLab, insertLab, updateLab, type Db } from "../db.ts";
import { EXPIRES_TAG, MANAGED_BY_TAG, MANAGED_BY_VALUE } from "../guard.ts";
import { expiryFromNow } from "../actions/tags.ts";
import { deployMinutesFor, getBlueprint, LAB_NAME, newLabName, stagesFor, type Blueprint, type DeployStep } from "./blueprints.ts";
import { compileBlueprint } from "./compile.ts";
import { evaluateFeasibility, gatherFacts, namespacesOf, type FeasibilityCheck } from "./feasibility.ts";
import { runGate } from "./gates.ts";
import { estimate, type Estimate } from "./pricing.ts";
import { realProbes, type Probes } from "../validate.ts";
import { listResources } from "../azure/resourceGraph.ts";
import { planDeletion } from "../actions/deletePlan.ts";
import { applyFix, withDeleteRetry } from "../actions/deletion.ts";
import { deployTimeFor, recordTiming, variantOf } from "./timing.ts";
import { labDataDir } from "./hooks.ts";
import { CAPACITY_ERROR, recentCapacityEvent, recordCapacityEvent, tidyError } from "./capacity.ts";
import { rmSync } from "node:fs";
import { PARAM_HOOKS, type ParamHook } from "./hooks.ts";
import type { HookKind } from "./blueprints.ts";

const STACK_API = "2024-03-01";
const RG_API = "2021-04-01";

export interface LabRequest {
  blueprint: string;
  region: string;
  params: Record<string, unknown>;
  ttlHours: number;
  purpose?: string;
  labName?: string;
  /** Allow-listed subscription to deploy into (defaults to the first configured one). */
  subscriptionId?: string;
}

export interface PreparedLab {
  blueprint: Blueprint;
  params: Record<string, unknown>;
  labName: string;
  subscriptionId: string;
  region: string;
  expiresOn: string;
  tags: Record<string, string>;
  armParameters: Record<string, { value: unknown }>;
  purpose: string;
}

export const stackName = (labName: string) => `labctl-${labName}`;
export const stackUrl = (sub: string, labName: string) => `/subscriptions/${sub}/providers/Microsoft.Resources/deploymentStacks/${stackName(labName)}?api-version=${STACK_API}`;
export const rgIdFor = (sub: string, labName: string) => `/subscriptions/${sub}/resourceGroups/${labName}`;

export class LabRequestError extends Error {}

/** Pure: validates the request and builds names, tags and ARM parameters. */
export function prepareLab(config: LabctlConfig, req: LabRequest, now = new Date(), opts: { skipRules?: boolean } = {}): PreparedLab {
  const blueprint = getBlueprint(req.blueprint);
  if (!config.labs.regions.includes(req.region)) throw new LabRequestError(`Region ${req.region} is not enabled in Settings`);
  if (!(Number.isFinite(req.ttlHours) && req.ttlHours >= 1 && req.ttlHours <= 72)) throw new LabRequestError("Lifetime must be 1â€“72 hours");
  const parsed = blueprint.schema.safeParse(req.params ?? {});
  if (!parsed.success) throw new LabRequestError(`Invalid parameters: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const ruleErrors = blueprint.rules?.(parsed.data) ?? [];
  if (ruleErrors.length && !opts.skipRules) throw new LabRequestError(ruleErrors.join("; "));
  const labName = req.labName ?? newLabName(blueprint.code);
  if (!LAB_NAME.test(labName) || !labName.startsWith(`lab-${blueprint.code}-`)) throw new LabRequestError(`Invalid lab name ${labName}`);  const purpose = (req.purpose ?? "").replace(/[<>%&\\?/]/g, "").trim().slice(0, 80) || blueprint.title;
  const subscriptionId = req.subscriptionId ?? config.subscriptions[0]?.id;
  if (!subscriptionId) throw new LabRequestError("No subscription is configured; finish setup first");
  if (!config.subscriptions.some((s) => s.id.toLowerCase() === subscriptionId.toLowerCase())) throw new LabRequestError("That subscription is not enabled in Settings");
  const expiresOn = expiryFromNow(req.ttlHours, now);
  const tags: Record<string, string> = {
    [MANAGED_BY_TAG]: MANAGED_BY_VALUE,
    [EXPIRES_TAG]: expiresOn,
    owner: config.owner,
    blueprint: blueprint.id,
    purpose,
    createdOn: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    labctlStack: stackName(labName),
  };
  const armParameters: Record<string, { value: unknown }> = {
    labName: { value: labName },
    location: { value: req.region },
    tags: { value: tags },
  };
  for (const [k, v] of Object.entries(blueprint.armParams(parsed.data, { owner: config.owner }))) armParameters[k] = { value: v };
  return { blueprint, params: parsed.data, labName, subscriptionId, region: req.region, expiresOn, tags, armParameters, purpose };
}

export function stackBody(p: PreparedLab, template: Record<string, unknown>) {
  return {
    location: p.region,
    tags: p.tags,
    properties: {
      description: `labctl ${p.blueprint.id}: ${p.purpose}`,
      template,
      parameters: p.armParameters,
      // Anything the stack stops managing is deleted, and deleting the stack removes the whole lab.
      actionOnUnmanage: { resources: "delete", resourceGroups: "delete", managementGroups: "detach" },
      denySettings: { mode: "none" },
      bypassStackOutOfSyncError: false,
    },
  };
}

/** Rebuilds a lab's request from its record so a failed deployment can be re-applied to the same stack. */
export function prepareRetry(
  config: LabctlConfig,
  row: { name: string; blueprint: string; region: string; params_json: string; purpose: string | null; subscription_id?: string },
  currentTags: Record<string, string>,
): PreparedLab {
  const p = prepareLab(config, {
    blueprint: row.blueprint,
    region: row.region,
    params: JSON.parse(row.params_json) as Record<string, unknown>,
    ttlHours: 1,
    purpose: row.purpose ?? undefined,
    labName: row.name,
    subscriptionId: row.subscription_id,
  });
  // Keep the lab's live tags (expiry may have been extended); only fill in what is missing.
  const tags = { ...p.tags, ...currentTags };
  return { ...p, tags, expiresOn: tags[EXPIRES_TAG] ?? p.expiresOn, armParameters: { ...p.armParameters, tags: { value: tags } } };
}

/** Walks nested ARM error details down to the most specific messages. */
export function innermostErrors(err: unknown, out: string[] = []): string[] {
  const e = err as { message?: string; code?: string; details?: unknown[] } | undefined;
  if (!e) return out;
  if (e.details?.length) for (const d of e.details) innermostErrors(d, out);
  else if (e.message) out.push(tidyError(e.code ? `${e.code}: ${e.message}` : e.message));
  return [...new Set(out)];
}

async function exists(arm: ArmClient, path: string): Promise<boolean> {
  try {
    await arm.get(path);
    return true;
  } catch (e) {
    if (e instanceof ArmError && e.status === 404) return false;
    throw e;
  }
}

export interface ValidationResult {
  labName: string;
  expiresOn: string;
  estimate: Estimate;
  steps: DeployStep[];
  stages: { label: string; gate?: string; blocking?: boolean }[];
  checks: FeasibilityCheck[];
  /** Blocking problems (failed checks), kept for older clients. */
  issues: string[];
}

/** Resource types a lab creates: progress steps plus the card's icon types. */
export function labResourceTypes(b: Blueprint, params: Record<string, unknown>): string[] {
  const extra = typeof b.extraTypes === "function" ? b.extraTypes(params) : (b.extraTypes ?? []);
  return [...new Set([...b.steps(params).map((s) => s.type), ...b.icons, ...extra])].filter((t) => /^[A-Za-z]+\.[A-Za-z]+\/[A-Za-z]/.test(t));
}

export async function validateLab(
  arm: ArmClient,
  db: Db,
  config: LabctlConfig,
  req: LabRequest,
  deps: { forecastMonth?: (subscriptionId: string) => Promise<number | undefined> } = {},
): Promise<ValidationResult> {
  const p = prepareLab(config, req, new Date(), { skipRules: true });
  const rules = p.blueprint.rules?.(p.params) ?? [];
  const types = labResourceTypes(p.blueprint, p.params);
  const quotas = p.blueprint.quotas?.(p.params);
  const vmSizes = p.blueprint.vmSizes?.(p.params) ?? [];

  const [est, facts, forecast] = await Promise.all([
    estimate(db, p.region, p.blueprint.meters(p.params), p.blueprint.notes),
    gatherFacts(arm, db, p.subscriptionId, p.region, {
      namespaces: namespacesOf([...types, "Microsoft.Resources/deploymentStacks"]),
      quotas: Boolean(quotas && Object.keys(quotas).length),
      vms: Boolean(vmSizes.length),
    }),
    deps.forecastMonth?.(p.subscriptionId).catch(() => undefined),
  ]);
  const checks = evaluateFeasibility(
    {
      region: p.region,
      enabledRegions: config.labs.regions,
      ttlHours: req.ttlHours,
      hourly: est.hourly,
      resourceTypes: types,
      regionFree: p.blueprint.regionFree,
      quotas,
      vmSizes,
      rules,
      deployMinutes: deployTimeFor(db, p.blueprint, p.params, p.region, deployMinutesFor(p.blueprint, p.params)).minutes,
      budget: { monthlyUsd: config.budget.monthlyUsd, forecastMonth: forecast },
      capacity: recentCapacityEvent(db, p.blueprint.id, variantOf(p.blueprint, p.params), p.region),
    },
    facts,
  );

  // Names: the group must be new and .
  const names: string[] = [];
  if (await exists(arm, `${rgIdFor(p.subscriptionId, p.labName)}?api-version=${RG_API}`)) names.push(`Resource group ${p.labName} already exists`);
  checks.push(names.length ? { id: "names", label: "Names", status: "fail", detail: names.join("; ") } : { id: "names", label: "Names", status: "pass", detail: p.labName });

  // Template + policy: the stack's own validation (skipped when the configuration is already invalid).
  if (rules.length) {
    checks.push({ id: "template", label: "Template + policy", status: "skip", detail: "Fix the configuration first" });
  } else {
    const template = await compileBlueprint(p.blueprint.id);
    try {
      const url = stackUrl(p.subscriptionId, p.labName).replace("?", "/validate?");
      const placeholders = Object.fromEntries((p.blueprint.paramHooks ?? []).flatMap((h) => Object.entries(h.validateWith ?? {})).map(([k, v]) => [k, { value: v }]));
      const res = await arm.lro<{ error?: unknown }>("POST", url, stackBody({ ...p, armParameters: { ...p.armParameters, ...placeholders } }, template), { timeoutMs: 5 * 60_000, pollMs: 2000 });
      const errs = res?.error ? innermostErrors(res.error) : [];
      checks.push(errs.length ? { id: "template", label: "Template + policy", status: "fail", detail: errs.join("; ") } : { id: "template", label: "Template + policy", status: "pass", detail: "Stack validation passed" });
    } catch (e) {
      checks.push({ id: "template", label: "Template + policy", status: "fail", detail: e instanceof ArmError ? e.message : String(e) });
    }
  }

  const stages = stagesFor(p.blueprint, p.params).map((s) => ({ label: s.label, gate: s.gate?.label, blocking: s.gate?.blocking }));
  return {
    labName: p.labName,
    expiresOn: p.expiresOn,
    estimate: est,
    steps: p.blueprint.steps(p.params),
    stages,
    checks,
    issues: checks.filter((c) => c.status === "fail").map((c) => `${c.label}: ${c.detail}`),
  };
}

/** Specific errors from the failed operations of every failed deployment in the lab's group. */
export async function operationFailures(arm: ArmClient, sub: string, labName: string): Promise<string[]> {
  const base = `${rgIdFor(sub, labName)}/providers/Microsoft.Resources/deployments`;
  const deps = await arm.get<{ value: { name: string; properties: { provisioningState: string } }[] }>(`${base}?api-version=${RG_API}`);
  const out: string[] = [];
  for (const d of deps.value.filter((x) => x.properties.provisioningState === "Failed")) {
    const ops = await arm.get<{ value: { properties: { provisioningState: string; targetResource?: { resourceName?: string }; statusMessage?: { error?: unknown } } }[] }>(
      `${base}/${encodeURIComponent(d.name)}/operations?api-version=${RG_API}`,
    );
    for (const o of ops.value.filter((x) => x.properties.provisioningState === "Failed")) {
      const msgs = innermostErrors(o.properties.statusMessage?.error).filter((m) => !/DeploymentFailed|At least one resource deployment/i.test(m));
      for (const m of msgs) out.push(`${o.properties.targetResource?.resourceName ?? d.name}: ${m}`);
    }
  }
  return [...new Set(out)];
}

/** Where a staged deployment is; persisted in labs.stage_json. */
export interface StageState {
  index: number;
  total: number;
  labels: string[];
  phase: "deploying" | "gate" | "done" | "failed";
  /** Gate label while waiting on one. */
  gate?: string;
  detail?: string;
  warnings: string[];
  /** Gate outcomes so far ("label: detail"), shown on the lab once it is ready. */
  passed?: string[];
  /** When the current stage started (for the ETA). */
  stageStartedAt?: string;
  updatedAt: string;
}

export function readStageState(row: { stage_json?: string | null } | undefined): StageState | undefined {
  if (!row?.stage_json) return undefined;
  try {
    return JSON.parse(row.stage_json) as StageState;
  } catch {
    return undefined;
  }
}

/**
 * Where a resumed deployment starts. Without saved state (labs from before staging) the lab was
 * deployed in one pass with every resource, so it must resume at the last stage: re-applying an
 * earlier stage would make the stack delete the later stages' resources.
 */
export function resumeIndex(prev: StageState | undefined, total: number): number {
  if (!prev) return total - 1;
  return Math.max(0, Math.min(prev.index, total - 1));
}

async function deploymentDetail(arm: ArmClient, p: PreparedLab, e: unknown): Promise<string> {
  let detail = (e as Error).message;
  try {
    const stack = await arm.get<{ properties: { error?: unknown } }>(stackUrl(p.subscriptionId, p.labName));
    const inner = innermostErrors(stack.properties.error);
    if (inner.length) detail = inner.join(" | ");
  } catch {
    /* keep the original message */
  }
  if (/DeploymentFailed|At least one resource deployment/i.test(detail)) {
    const specific = await operationFailures(arm, p.subscriptionId, p.labName).catch(() => []);
    if (specific.length) detail = specific.join(" | ");
  }
  return detail;
}

class StageFailure extends Error {}

export interface DeployOptions {
  /** Continue from the saved stage instead of stage 1 (Retry, restart). */
  resume?: boolean;
  /** The current stage's stack update already succeeded (re-attached after a restart). */
  skipFirstPut?: boolean;
  probes?: Probes;
  gateOpts?: Parameters<typeof runGate>[2];
  /** Injected for tests; defaults to the real token/certificate hooks. */
  hooks?: Record<HookKind, ParamHook>;
}

/**
 * Applies the blueprint stage by stage: each stage updates the stack with `stage=n` (every stage
 * includes the previous ones), then polls the stage's readiness gate. A blocking gate that fails
 * stops the lab with a clear reason; Retry resumes at that stage instead of starting over.
 */
export async function deployLab(arm: ArmClient, db: Db, p: PreparedLab, estHourly?: number, opts: DeployOptions = {}): Promise<string> {
  const template = await compileBlueprint(p.blueprint.id);
  const stages = stagesFor(p.blueprint, p.params);
  const existing = getLab(db, p.labName);
  const prev = opts.resume ? readStageState(existing) : undefined;
  const start = opts.resume ? resumeIndex(prev, stages.length) : 0;
  const warnings = new Set(prev?.warnings ?? []);
  const passed = new Set(prev?.passed ?? []);
  let outputs: Record<string, unknown> = opts.resume && existing?.outputs_json ? (JSON.parse(existing.outputs_json) as Record<string, unknown>) : {};

  const save = (index: number, phase: StageState["phase"], extra: Partial<StageState> = {}) =>
    updateLab(db, p.labName, {
      stage_json: JSON.stringify({ index, total: stages.length, labels: stages.map((s) => s.label), phase, warnings: [...warnings], passed: [...passed], updatedAt: new Date().toISOString(), ...extra } satisfies StageState),
    });

  if (existing) {
    updateLab(db, p.labName, { status: "deploying", error: null });
  } else {
    insertLab(db, {
      name: p.labName,
      blueprint: p.blueprint.id,
      subscription_id: p.subscriptionId,
      region: p.region,
      params_json: JSON.stringify(p.params),
      purpose: p.purpose,
      est_hourly: estHourly ?? null,
      created_at: new Date().toISOString(),
      status: "deploying",
    });
  }

  const url = stackUrl(p.subscriptionId, p.labName);
  const probes = opts.probes ?? realProbes(arm);
  const variant = variantOf(p.blueprint, p.params);
  const timing = (kind: "stage" | "gate" | "total", stage: number, startedMs: number) =>
    recordTiming(db, { lab: p.labName, blueprint: p.blueprint.id, variant, region: p.region, kind, stage, seconds: (Date.now() - startedMs) / 1000, at: new Date().toISOString() });
  const runStarted = Date.now();
  // Values computed by labctl between stages (tokens, certificates) that later stages take as parameters.
  const hookParams: Record<string, unknown> = {};
  const ranHooks = new Set<string>();
  const hooks = opts.hooks ?? PARAM_HOOKS;
  let i = start;
  try {
    for (; i < stages.length; i++) {
      const stage = stages[i]!;
      const stageStarted = Date.now();
      const stageStartedAt = new Date(stageStarted).toISOString();
      save(i, "deploying", { detail: stage.label, stageStartedAt });
      if (!(opts.skipFirstPut && i === start)) {
        for (const h of p.blueprint.paramHooks ?? []) {
          if (h.fromStage > (stage.value ?? Number.MAX_SAFE_INTEGER) || ranHooks.has(h.hook)) continue;
          save(i, "deploying", { detail: `${stage.label} Â· preparing ${h.label}`, stageStartedAt });
          Object.assign(hookParams, await hooks[h.hook]({ arm, labName: p.labName, subscriptionId: p.subscriptionId, region: p.region, params: p.params, outputs }));
          ranHooks.add(h.hook);
          save(i, "deploying", { detail: stage.label, stageStartedAt });
        }
        const extra = Object.fromEntries(Object.entries(hookParams).map(([k, v]) => [k, { value: v }]));
        const parameters = { ...p.armParameters, ...extra, ...(stage.value === undefined ? {} : { stage: { value: stage.value } }) };
        try {
          await arm.lro("PUT", url, stackBody({ ...p, armParameters: parameters }, template), { timeoutMs: 3 * 60 * 60_000, pollMs: 15_000 });
        } catch (e) {
          throw new StageFailure(await deploymentDetail(arm, p, e));
        }
        timing("stage", i, stageStarted);
      }
      const stack = await arm.get<{ properties: { outputs?: Record<string, { value: unknown }> } }>(url);
      outputs = { ...outputs, ...Object.fromEntries(Object.entries(stack.properties.outputs ?? {}).map(([k, v]) => [k, v.value])) };
      updateLab(db, p.labName, { outputs_json: JSON.stringify(outputs) });

      if (stage.gate) {
        const gate = stage.gate;
        const gateStarted = Date.now();
        save(i, "gate", { gate: gate.label, detail: "Checkingâ€¦", stageStartedAt });
        const r = await runGate(gate, { x: probes, sub: p.subscriptionId, labName: p.labName, params: p.params, outputs }, {
          ...opts.gateOpts,
          onTick: (t) => save(i, "gate", { gate: gate.label, detail: t.detail, stageStartedAt }),
        });
        if (r.ok) timing("gate", i, gateStarted);
        outputs = { ...outputs, ...r.outputs };
        updateLab(db, p.labName, { outputs_json: JSON.stringify(outputs) });
        if (!r.ok) {
          if (gate.blocking) throw new StageFailure(`${gate.label}: ${r.detail}`);
          warnings.add(`${gate.label}: ${r.detail}`);
        } else passed.add(`${gate.label}: ${r.detail}`);
      }
    }
    // Only an uninterrupted run from the first stage is a fair total.
    if (!opts.resume) timing("total", -1, runStarted);
    save(stages.length - 1, "done", { detail: warnings.size ? `${warnings.size} warning${warnings.size > 1 ? "s" : ""}` : "All gates passed" });
    updateLab(db, p.labName, { status: "ready", ready_at: new Date().toISOString(), outputs_json: JSON.stringify(outputs), error: null });
    return warnings.size ? `Ready with warnings: ${[...warnings].join(" | ")}` : "Ready";
  } catch (e) {
    const detail = tidyError(e instanceof StageFailure ? e.message : await deploymentDetail(arm, p, e));
    // Remember regional capacity shortages so the next launch here is warned and steered elsewhere.
    if (CAPACITY_ERROR.test(detail)) recordCapacityEvent(db, p.blueprint.id, variantOf(p.blueprint, p.params), p.region, detail);
    const at = Math.min(i, stages.length - 1);
    const prefix = stages.length > 1 ? `Stage ${at + 1}/${stages.length} (${stages[at]!.label}): ` : "";
    save(at, "failed", { detail });
    updateLab(db, p.labName, { status: "failed", error: `${prefix}${detail}`.slice(0, 2000) });
    throw new Error(`${prefix}${detail}`);
  }
}

/**
 * Re-attaches to a lab whose deployment was interrupted (app restart): waits for the in-flight
 * stack update, then continues with the remaining gates and stages.
 */
export async function resumeLab(arm: ArmClient, db: Db, p: PreparedLab, estHourly?: number, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<string> {
  const stack = await waitForStack(arm, stackUrl(p.subscriptionId, p.labName), opts);
  const state = stack.properties.provisioningState.toLowerCase();
  if (state !== "succeeded") {
    const detail = innermostErrors(stack.properties.error).join(" | ") || `Stack ${state}`;
    const prev = readStageState(getLab(db, p.labName));
    if (prev) updateLab(db, p.labName, { stage_json: JSON.stringify({ ...prev, phase: "failed", detail, updatedAt: new Date().toISOString() }) });
    updateLab(db, p.labName, { status: "failed", error: detail.slice(0, 2000) });
    throw new Error(detail);
  }
  return deployLab(arm, db, p, estHourly, { resume: true, skipFirstPut: true });
}

export interface StepProgress extends DeployStep {
  state: "pending" | "running" | "succeeded" | "failed";
  startedAt?: string;
  duration?: string;
  error?: string;
}

interface DeploymentListItem {
  name: string;
  properties: { provisioningState: string; timestamp?: string; duration?: string; error?: unknown };
}

export function mergeProgress(steps: DeployStep[], deployments: DeploymentListItem[]): StepProgress[] {
  const byName = new Map(deployments.map((d) => [d.name.toLowerCase(), d]));
  return steps.map((s) => {
    const d = byName.get(s.name.toLowerCase());
    if (!d) return { ...s, state: "pending" };
    const ps = d.properties.provisioningState.toLowerCase();
    const state = ps === "succeeded" ? "succeeded" : ps === "failed" || ps === "canceled" ? "failed" : "running";
    return {
      ...s,
      state,
      startedAt: d.properties.timestamp,
      duration: d.properties.duration,
      error: state === "failed" ? innermostErrors(d.properties.error).join(" | ") || undefined : undefined,
    };
  });
}

export async function labProgress(arm: ArmClient, sub: string, labName: string, steps: DeployStep[]): Promise<StepProgress[]> {
  try {
    const res = await arm.get<{ value: DeploymentListItem[] }>(`${rgIdFor(sub, labName)}/providers/Microsoft.Resources/deployments?api-version=${RG_API}`);
    return mergeProgress(steps, res.value);
  } catch (e) {
    if (e instanceof ArmError && e.status === 404) return mergeProgress(steps, []);
    throw e;
  }
}

/**
 * Removes the stack without deleting resources (detach), then deletes the resource group.\r\n *\r\n * Deleting through the stack removes resources one by one and can retry for a long time on child\r\n * resources; a resource-group delete removes everything as a whole and lets Azure order it.
 */
export async function destroyLab(arm: ArmClient, db: Db, sub: string, labName: string, opts: { canTouch?: (id: string) => string | undefined } = {}): Promise<string> {
  updateLab(db, labName, { status: "destroying" });
  const notes: string[] = [];
  try {
    // Outside resources that reference the lab would hold the group delete hostage for hours: find them first.
    const resources = await listResources(arm, [sub]).catch(() => undefined);
    if (resources) {
      const rgId = rgIdFor(sub, labName);
      const plan = planDeletion([{ id: rgId, name: labName, type: "Microsoft.Resources/resourceGroups", isGroup: true }], resources, { canTouch: opts.canTouch ?? (() => "unattended") });
      if (plan.blockers.length) throw new Error(`Held by resources outside the lab: ${plan.blockers.map((b) => b.detail).join("; ")}`);
      const fixes = plan.steps.filter((s) => s.kind === "fix");
      // Peerings and DNS links pointing at the lab only dangle once it's gone, so they're removed here.
      // Anything that changes how a resource outside the lab works (subnet/NIC associations) needs a person.
      const changes = fixes.flatMap((s) => s.fixes).filter((f) => f.action.op !== "delete-child");
      if (changes.length) throw new Error(`Outside resources use lab resources: ${changes.map((f) => f.label).join("; ")}. Delete the group from the Inventory to review and apply the detach plan.`);
      for (const f of fixes.flatMap((s) => s.fixes)) notes.push(await withDeleteRetry(() => applyFix(arm, f.action)));
    }
    const url = stackUrl(sub, labName);
    if (await exists(arm, url)) {
      try {
        await arm.lro("DELETE", `${url}&unmanageAction.Resources=detach&unmanageAction.ResourceGroups=detach&unmanageAction.ManagementGroups=detach`, undefined, {
          timeoutMs: 15 * 60_000,
          pollMs: 5000,
        });
        notes.push("stack removed");
      } catch (e) {
        // A stack already mid-delete may refuse; the group delete below still removes everything.
        notes.push(`stack: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    const rg = `${rgIdFor(sub, labName)}?api-version=${RG_API}`;
    if (await exists(arm, rg)) {
      await arm.lro("DELETE", rg, undefined, { timeoutMs: 2 * 60 * 60_000, pollMs: 15_000 });
      notes.push("group deleted");
    }
    // A stack that was mid-delete refuses removal until that delete settles; with the group gone it
    // owns nothing, so try once more and leave no orphaned stack behind.
    if (await exists(arm, stackUrl(sub, labName)).catch(() => false)) {
      try {
        await arm.lro("DELETE", `${stackUrl(sub, labName)}&unmanageAction.Resources=detach&unmanageAction.ResourceGroups=detach&unmanageAction.ManagementGroups=detach`, undefined, { timeoutMs: 15 * 60_000, pollMs: 5000 });
        notes.push("stack removed");
      } catch (e) {
        notes.push(`stack left behind (${(e as Error).message.slice(0, 120)})`);
      }
    }
    // Lab-local secrets (generated certificates) go with the lab.
    try {
      rmSync(labDataDir(labName), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    updateLab(db, labName, { status: "destroyed", destroyed_at: new Date().toISOString() });
    return notes.filter((n) => !n.startsWith("stack: ")).join("; ") || "Nothing left to delete";
  } catch (e) {
    updateLab(db, labName, { status: "failed", error: `Destroy: ${(e as Error).message}`.slice(0, 2000) });
    throw e;
  }
}

type StackState = { properties: { provisioningState: string; outputs?: Record<string, { value: unknown }>; error?: unknown } };

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

export async function waitForStack(arm: ArmClient, url: string, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<StackState> {
  const deadline = Date.now() + (opts.timeoutMs ?? 3 * 60 * 60_000);
  for (;;) {
    const stack = await arm.get<StackState>(url);
    if (TERMINAL.has(stack.properties.provisioningState.toLowerCase())) return stack;
    if (Date.now() > deadline) throw new Error("Timed out waiting for the stack");
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 15_000));
  }
}

/** Follows an existing stack to a terminal state and records the result (used to re-attach after a restart). */
export async function watchStack(arm: ArmClient, db: Db, sub: string, labName: string, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<string> {
  const stack = await waitForStack(arm, stackUrl(sub, labName), opts);
  const state = stack.properties.provisioningState.toLowerCase();
  if (state === "succeeded") {
    const outputs = Object.fromEntries(Object.entries(stack.properties.outputs ?? {}).map(([k, v]) => [k, v.value]));
    updateLab(db, labName, { status: "ready", ready_at: new Date().toISOString(), outputs_json: JSON.stringify(outputs), error: null });
    return "Ready";
  }
  const detail = innermostErrors(stack.properties.error).join(" | ") || `Stack ${state}`;
  updateLab(db, labName, { status: "failed", error: detail.slice(0, 2000) });
  throw new Error(detail);
}

export type Reconciliation = { name: string; action: "destroyed" | "watch" | "destroy" | "failed" };

/**
 * Decides how to repair a lab whose in-progress status has no live job (e.g. after a restart).
 * Pure so it can be unit-tested; the caller performs the actions.
 */
export function planReconcile(row: { name: string; status: string }, hasRunningJob: boolean, rgExists: boolean, stackState?: string): Reconciliation | undefined {
  if (hasRunningJob) return undefined;
  const s = stackState?.toLowerCase();
  if (row.status === "destroying") return rgExists || s ? { name: row.name, action: "destroy" } : { name: row.name, action: "destroyed" };
  if (row.status === "deploying") {
    if (!s) return { name: row.name, action: rgExists ? "failed" : "destroyed" };
    return { name: row.name, action: "watch" };
  }
  return undefined;
}



