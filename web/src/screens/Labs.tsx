import { useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { useStore } from "../store.tsx";
import { useActions } from "../components/actions.tsx";
import { Modal } from "../components/Modal.tsx";
import { ResourceIcon } from "../components/ResourceIcon.tsx";
import { Btn, Chip, Label } from "../components/ui.tsx";
import { IconPulse, IconTopology } from "../components/Icons.tsx";
import { ValidateDialog } from "../components/ValidateDialog.tsx";
import { TopologyDialog } from "../components/TopologyDialog.tsx";
import { relTime, usd } from "../format.ts";
import type { Catalog, InventoryGroup, Job, Lab, LabsResponse, StageState, StepProgress } from "../types.ts";

const ACTIVE = new Set(["deploying", "ready", "failed", "destroying"]);

/** Estimated cost of a finished lab (lifetime × hourly estimate). */
const labCost = (l: Lab) => (l.createdAt && l.destroyedAt && l.estHourly ? ((new Date(l.destroyedAt).getTime() - new Date(l.createdAt).getTime()) / 3_600_000) * l.estHourly : 0);

export function Labs({ go }: { go: (s: "catalog") => void }) {
  const { jobs, trackJobs, notify } = useStore();
  const actions = useActions();
  const [data, setData] = useState<LabsResponse>();
  const [catalog, setCatalog] = useState<Catalog>();
  const [confirm, setConfirm] = useState<Lab>();
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    api<LabsResponse>("/api/labs")
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    api<Catalog>("/api/blueprints").then(setCatalog).catch(() => undefined);
  }, []);

  const busy = data?.labs.some((l) => l.status === "deploying" || l.status === "destroying");
  useEffect(() => {
    load();
    const t = setInterval(load, busy ? 10_000 : 30_000);
    return () => clearInterval(t);
  }, [load, busy, jobs]);

  if (error && !data) return <p className="text-sm text-signal">{error}</p>;
  if (!data) return <div className="h-64 animate-pulse rounded-3xl bg-stone-200 dark:bg-stone-900" />;

  const active = data.labs.filter((l) => ACTIVE.has(l.status) && (l.exists || l.status === "deploying" || l.status === "failed"));
  const history = data.labs.filter((l) => !active.includes(l));
  const bp = (id: string) => catalog?.blueprints.find((b) => b.id === id);

  const destroy = async (lab: Lab) => {
    setConfirm(undefined);
    try {
      const sub = /^\/subscriptions\/([^/]+)/i.exec(lab.resourceGroupId)?.[1] ?? "";
      trackJobs([await api<Job>(`/api/labs/${encodeURIComponent(lab.name)}?subscriptionId=${encodeURIComponent(sub)}`, { method: "DELETE" })]);
      notify(`Destroying ${lab.name}…`);
      load();
    } catch (e) {
      notify((e as Error).message, "bad");
    }
  };

  const sweepNow = async () => {
    try {
      const r = await api<{ expired: string[]; started: string[] }>("/api/labs/sweep", { method: "POST" });
      notify(r.expired.length ? `Sweep: destroying ${r.started.join(", ")}` : "Sweep: nothing expired");
      load();
    } catch (e) {
      notify((e as Error).message, "bad");
    }
  };

  const extend = (lab: Lab, hours: number) => actions.extend({ id: lab.resourceGroupId, name: lab.name } as InventoryGroup, hours).then(load);

  const retry = async (lab: Lab) => {
    try {
      trackJobs([await api<Job>(`/api/labs/${encodeURIComponent(lab.name)}/retry`, { method: "POST" })]);
      notify(`Retrying ${lab.name}…`);
      load();
    } catch (e) {
      notify((e as Error).message, "bad");
    }
  };

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
        <span className={`size-1.5 rounded-full ${data.sweep.enabled ? "bg-calm" : "bg-stone-400"}`} />
        {data.sweep.enabled ? <>Auto-clean {data.sweep.nextAt ? relTime(data.sweep.nextAt) : "pending"}</> : "Auto-clean off"}
        {data.sweep.last && <span>· last {relTime(data.sweep.last.at)}</span>}
        <Btn onClick={sweepNow}>Sweep now</Btn>
        <Btn tone="solid" className="ml-auto" onClick={() => go("catalog")}>New lab</Btn>
      </div>

      {active.length === 0 ? (
        <div className="grid place-items-center rounded-3xl border border-dashed border-stone-300 py-16 text-center dark:border-stone-800">
          <p className="text-stone-500">No labs running.</p>
          <Btn tone="solid" className="mt-4" onClick={() => go("catalog")}>Open catalog</Btn>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {active.map((l) => (
            <LabCard key={l.name} lab={l} icons={bp(l.blueprint)?.icons ?? []} title={bp(l.blueprint)?.title ?? l.blueprint} running={jobs.some((j) => j.status === "running" && j.target_name === l.name)} onDestroy={() => setConfirm(l)} onExtend={(h) => extend(l, h)} onRetry={() => retry(l)} />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-3 select-none [&::-webkit-details-marker]:hidden">
            <span className="text-stone-400 transition group-open:rotate-90">›</span>
            <Label>History</Label>
            <span className="font-mono text-[10px] text-stone-400">
              {history.length} · ≈{usd(history.reduce((s, l) => s + labCost(l), 0))}
            </span>
            <span className="h-px flex-1 bg-stone-300/60 dark:bg-stone-800" />
          </summary>
          <div className="mt-4 space-y-6">
            {[...(catalog?.categories ?? []), "Other"]
              .map((cat) => ({ cat, items: history.filter((l) => (bp(l.blueprint)?.category ?? "Other") === cat) }))
              .filter((s) => s.items.length > 0)
              .map(({ cat, items }) => (
                <section key={cat}>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-stone-500">{cat}</span>
                    <span className="font-mono text-[10px] text-stone-400">{items.length}</span>
                  </div>
                  <ul className="mt-1 divide-y divide-stone-300/60 dark:divide-stone-800">
                    {items.map((l) => {
                      const hours = l.createdAt && l.destroyedAt ? (new Date(l.destroyedAt).getTime() - new Date(l.createdAt).getTime()) / 3_600_000 : undefined;
                      return (
                        <li key={l.name} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5 text-sm">
                          <div className="flex -space-x-1">{(bp(l.blueprint)?.icons ?? []).map((t) => <ResourceIcon key={t} type={t} size={18} />)}</div>
                          <div className="min-w-0 truncate">
                            {l.name} <span className="text-stone-500">· {l.purpose ?? bp(l.blueprint)?.title}</span>
                          </div>
                          <span className="font-mono text-xs text-stone-500">{hours !== undefined ? `${hours.toFixed(1)}h` : l.status}</span>
                          <span className="w-16 text-right font-mono text-xs tabular-nums">{hours !== undefined && l.estHourly ? `≈${usd(hours * l.estHourly)}` : "—"}</span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
          </div>
        </details>
      )}

      {confirm && (
        <Modal title="Destroy lab" tone="danger" onClose={() => setConfirm(undefined)}>
          <div className="text-2xl font-semibold">{confirm.name}</div>
          <p className="mt-2 text-sm text-stone-500">Deletes the deployment stack, the resource group and everything in it, then purges soft-deleted API Management.</p>
          <div className="mt-6 flex justify-end gap-2">
            <Btn onClick={() => setConfirm(undefined)}>Cancel</Btn>
            <Btn tone="danger" onClick={() => destroy(confirm)}>Destroy</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

const STATUS: Record<Lab["status"], { tone: "calm" | "signal" | "amber" | "plain"; text: string }> = {
  deploying: { tone: "amber", text: "Deploying" },
  ready: { tone: "calm", text: "Ready" },
  failed: { tone: "signal", text: "Failed" },
  destroying: { tone: "plain", text: "Destroying" },
  destroyed: { tone: "plain", text: "Destroyed" },
};

function LabCard({ lab, icons, title, running, onDestroy, onExtend, onRetry }: { lab: Lab; icons: string[]; title: string; running: boolean; onDestroy: () => void; onExtend: (h: number) => void; onRetry: () => void }) {
  const [steps, setSteps] = useState<StepProgress[]>();
  const [liveStage, setLiveStage] = useState<StageState | null>();
  const [panel, setPanel] = useState<"validate" | "diagram">();
  const showSteps = lab.status === "deploying" || lab.status === "failed";

  useEffect(() => {
    if (!showSteps) return;
    let alive = true;
    const tick = () =>
      api<{ steps: StepProgress[]; stage: StageState | null }>(`/api/labs/${encodeURIComponent(lab.name)}/progress`)
        .then((r) => {
          if (!alive) return;
          setSteps(r.steps);
          setLiveStage(r.stage);
        })
        .catch(() => undefined);
    void tick();
    const t = setInterval(tick, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [lab.name, showSteps]);
  const stage = (showSteps ? liveStage : undefined) ?? lab.stage;

  const s = STATUS[lab.status];
  const hoursUp = lab.createdAt ? (Date.now() - new Date(lab.createdAt).getTime()) / 3_600_000 : undefined;
  const expired = lab.expiresOn ? new Date(lab.expiresOn).getTime() < Date.now() : false;
  const done = steps?.filter((x) => x.state === "succeeded").length ?? 0;
  const outputs = Object.entries(lab.outputs).filter(([, v]) => typeof v === "string" && v);

  return (
    <article className="rounded-3xl border border-stone-300 p-5 dark:border-stone-800">
      <header className="flex items-start gap-4">
        <div className="flex -space-x-2">
          {icons.map((t) => (
            <span key={t} className="grid size-10 place-items-center rounded-xl bg-white ring-2 ring-stone-100 dark:bg-stone-950 dark:ring-[#0c0d10]">
              <ResourceIcon type={t} size={24} />
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm font-semibold">{lab.name}</span>
            <Chip tone={s.tone}>
              {(lab.status === "deploying" || lab.status === "destroying") && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
              {s.text}
            </Chip>
          </div>
          <div className="truncate text-sm text-stone-500">
            {lab.purpose && lab.purpose !== title ? `${lab.purpose} · ` : ""}
            {title} · {lab.region}
          </div>
        </div>
        <div className="text-right">
          <div className={`font-mono text-sm tabular-nums ${expired ? "text-signal" : ""}`}>{lab.expiresOn ? (expired ? "expired" : relTime(lab.expiresOn)) : "—"}</div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-stone-500">{hoursUp !== undefined && lab.estHourly ? `≈${usd(hoursUp * lab.estHourly)} so far` : ""}</div>
        </div>
      </header>

      {showSteps && stage && <StageTrack stage={stage} failed={lab.status === "failed"} eta={lab.status === "deploying" ? lab.etaMinutes : undefined} />}
      {showSteps && stage && stage.phase === "gate" && lab.status === "deploying" && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-300/15 px-3 py-2 text-xs">
          <span className="mt-0.5 size-2 shrink-0 animate-pulse rounded-full bg-amber-400" />
          <span className="min-w-0">
            <span className="font-medium">{stage.gate}</span>
            <span className="block truncate text-stone-500" title={stage.detail}>{stage.detail}</span>
          </span>
        </div>
      )}

      {showSteps && steps && (
        <div className="mt-5">
          {!stage && (
            <div className="mb-2 h-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
              <div className={`h-1 rounded-full transition-all ${lab.status === "failed" ? "bg-signal" : "bg-calm"}`} style={{ width: `${(done / Math.max(steps.length, 1)) * 100}%` }} />
            </div>
          )}
          <ol className="space-y-1.5">
            {steps.map((st) => (
              <li key={st.name} className="flex items-center gap-2.5 text-sm">
                <StepDot state={st.state} />
                <ResourceIcon type={st.type} size={16} />
                <span className={st.state === "pending" ? "text-stone-400" : ""}>{st.label}</span>
                <span className="ml-auto font-mono text-[10px] text-stone-500">{st.duration ? isoDuration(st.duration) : ""}</span>
              </li>
            ))}
          </ol>
          {steps.filter((x) => x.error).map((x) => <p key={x.name} className="mt-2 rounded-lg bg-signal/10 p-2 text-xs text-signal">{x.label}: {x.error}</p>)}
        </div>
      )}
      {lab.status === "failed" && lab.error && !steps?.some((x) => x.error) && <p className="mt-4 rounded-lg bg-signal/10 p-2 text-xs text-signal">{lab.error}</p>}
      {lab.status === "ready" && stage && (stage.warnings.length > 0 || (stage.passed?.length ?? 0) > 0) && (
        <details className={`mt-4 rounded-xl px-3 py-2 text-xs ${stage.warnings.length ? "bg-amber-300/15" : "bg-calm/10"}`}>
          <summary className={`cursor-pointer select-none ${stage.warnings.length ? "text-amber-700 dark:text-amber-300" : "text-teal-700 dark:text-calm"}`}>
            {stage.warnings.length ? `${stage.warnings.length} readiness warning${stage.warnings.length > 1 ? "s" : ""}` : `${stage.passed!.length} readiness check${stage.passed!.length > 1 ? "s" : ""} passed`}
          </summary>
          <ul className="mt-1.5 space-y-1 text-stone-500">
            {stage.warnings.map((w) => <li key={w}>! {w}</li>)}
            {(stage.passed ?? []).map((w) => <li key={w}>✓ {w}</li>)}
          </ul>
        </details>
      )}

      {lab.status === "ready" && outputs.length > 0 && (
        <dl className="mt-5 space-y-2">
          {outputs.map(([k, v]) => (
            <div key={k} className="group flex items-center gap-3">
              <dt className="w-32 shrink-0 font-mono text-[10px] uppercase tracking-widest text-stone-500">{k.replace(/([A-Z])/g, " $1")}</dt>
              <dd className="min-w-0 flex-1 truncate font-mono text-xs">{String(v)}</dd>
              <button onClick={() => navigator.clipboard.writeText(String(v))} className="text-[10px] text-stone-400 opacity-0 transition group-hover:opacity-100 hover:text-signal">copy</button>
            </div>
          ))}
        </dl>
      )}

      <footer className="mt-5 flex items-center gap-1 border-t border-stone-200 pt-4 dark:border-stone-800">
        {lab.exists && lab.status !== "destroying" && (
          <>
            <Btn onClick={() => onExtend(4)}>+4h</Btn>
            <Btn onClick={() => onExtend(24)}>+1d</Btn>
          </>
        )}
        {lab.exists && (lab.status === "ready" || lab.status === "failed") && (
          <>
            <Btn onClick={() => setPanel("validate")} title="Validate"><IconPulse width={14} height={14} />Validate</Btn>
            <Btn onClick={() => setPanel("diagram")} title="Topology"><IconTopology width={14} height={14} />Diagram</Btn>
          </>
        )}
        <span className="ml-auto" />
        {lab.status === "failed" && !running && (
          <Btn tone="solid" onClick={onRetry} title={stage && stage.total > 1 ? `Resume at stage ${stage.index + 1}` : "Re-apply the blueprint to this lab"}>
            {stage && stage.total > 1 ? `Resume ${stage.index + 1}/${stage.total}` : "Retry"}
          </Btn>
        )}
        {lab.status !== "destroying" && !running && (
          <Btn tone="danger" onClick={onDestroy}>Destroy</Btn>
        )}
      </footer>
      {panel === "validate" && <ValidateDialog targetId={lab.resourceGroupId} title={lab.name} onClose={() => setPanel(undefined)} />}
      {panel === "diagram" && <TopologyDialog resourceGroupId={lab.resourceGroupId} title={lab.name} onClose={() => setPanel(undefined)} />}
    </article>
  );
}

function StageTrack({ stage, failed, eta }: { stage: StageState; failed: boolean; eta?: number }) {
  return (
    <div className="mt-5">
      <div className="flex gap-1">
        {stage.labels.map((l, i) => {
          const done = i < stage.index || stage.phase === "done";
          const here = i === stage.index && stage.phase !== "done";
          const cls = done ? "bg-calm" : here ? (failed ? "bg-signal" : stage.phase === "gate" ? "bg-amber-400 animate-pulse" : "bg-calm/50 animate-pulse") : "bg-stone-200 dark:bg-stone-800";
          return <span key={l} title={l} className={`h-1.5 flex-1 rounded-full ${cls}`} />;
        })}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] uppercase tracking-widest text-stone-500">
        <span>
          Stage {Math.min(stage.index + 1, stage.total)}/{stage.total} · {stage.labels[stage.index]}
        </span>
        <span title={eta !== undefined ? "From your previous deployments of this setup" : undefined}>
          {eta !== undefined ? `~${eta} min left` : stage.phase === "gate" ? "gate" : stage.phase}
        </span>
      </div>
    </div>
  );
}

function StepDot({ state }: { state: StepProgress["state"] }) {
  const cls = {
    pending: "border border-stone-300 dark:border-stone-700",
    running: "border-2 border-signal border-t-transparent animate-spin",
    succeeded: "bg-calm",
    failed: "bg-signal",
  }[state];
  return <span className={`size-3 shrink-0 rounded-full ${cls}`} />;
}

function isoDuration(d: string): string {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/.exec(d);
  if (!m) return d;
  const h = Number(m[1] ?? 0), min = Number(m[2] ?? 0), s = Math.round(Number(m[3] ?? 0));
  return h ? `${h}h ${min}m` : min ? `${min}m ${s}s` : `${s}s`;
}

