import { useEffect, useMemo, useState } from "react";
import { api } from "../api.ts";
import { useStore } from "../store.tsx";
import { Modal } from "../components/Modal.tsx";
import { ResourceIcon } from "../components/ResourceIcon.tsx";
import { Btn, Chip, Label } from "../components/ui.tsx";
import { IconTrash } from "../components/Icons.tsx";
import { relTime, typeLabel, usd } from "../format.ts";
import type { Alternative, AlternativesResult, BlueprintInfo, Catalog as CatalogData, Estimate, FeasibilityCheck, Job, LabEstimate, ValidationResult } from "../types.ts";

export function Catalog({ onLaunched }: { onLaunched: () => void }) {
  const { notify } = useStore();
  const [catalog, setCatalog] = useState<CatalogData>();
  const [rates, setRates] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<{ b: BlueprintInfo; initial?: LaunchInitial }>();
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<CatalogData>("/api/blueprints")
      .then(async (c) => {
        setCatalog(c);
        for (const b of c.blueprints) {
          const params = Object.fromEntries(b.fields.map((f) => [f.key, f.default]));
          const e = await api<Estimate>("/api/labs/estimate", { method: "POST", body: { blueprint: b.id, region: c.defaultRegion, params } }).catch(() => undefined);
          if (e) setRates((r) => ({ ...r, [b.id]: e.hourly }));
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [reload]);

  const remove = async (b: BlueprintInfo) => {
    if (!confirm(`Remove the exported blueprint "${b.title}"? Labs already deployed from it are not affected.`)) return;
    try {
      await api(`/api/blueprints/${encodeURIComponent(b.id)}`, { method: "DELETE" });
      notify(`Removed ${b.title}`);
      setReload((n) => n + 1);
    } catch (e) {
      notify((e as Error).message, "bad");
    }
  };

  if (error) return <p className="text-sm text-signal">{error}</p>;
  if (!catalog) return <div className="h-64 animate-pulse rounded-3xl bg-stone-200 dark:bg-stone-900" />;

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <p className="text-sm text-stone-500">{catalog.blueprints.length} blueprints Â· {catalog.blueprints.filter((b) => b.custom).length} exported</p>
      </div>
      <div className="space-y-10">
        {catalog.categories
          .map((cat) => ({ cat, items: catalog.blueprints.filter((b) => b.category === cat) }))
          .filter((s) => s.items.length > 0)
          .map(({ cat, items }) => (
            <section key={cat}>
              <div className="mb-4 flex items-baseline gap-3">
                <Label>{cat}</Label>
                <span className="font-mono text-[10px] text-stone-400">{items.length}</span>
                <span className="h-px flex-1 bg-stone-300/60 dark:bg-stone-800" />
              </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {items.map((b) => (
          <div key={b.id} className="group relative">
          <button
            onClick={() => setOpen({ b })}
            className="relative flex h-full w-full flex-col overflow-hidden rounded-3xl border border-stone-300 bg-stone-50/60 p-6 text-left transition hover:-translate-y-0.5 hover:border-signal hover:shadow-xl dark:border-stone-800 dark:bg-stone-900/40"
          >
            <div className="flex items-center gap-2">
              {b.icons.map((t, i) => (
                <span key={t} className="contents">
                  {i > 0 && <span className="h-px w-4 bg-stone-300 dark:bg-stone-700" />}
                  <span className="grid size-12 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 dark:bg-stone-950 dark:ring-stone-800">
                    <ResourceIcon type={t} size={30} />
                  </span>
                </span>
              ))}
            </div>
            <h3 className="mt-6 text-xl font-semibold tracking-tight">{b.title}</h3>
            <p className="mt-1 text-sm text-stone-500">{b.tagline}</p>
            <div className="mt-6 flex items-end justify-between">
              <div>
                <div className="font-mono text-2xl tabular-nums">{rates[b.id] === undefined ? "â€¦" : usd(rates[b.id])}</div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-stone-500">per hour</div>
              </div>
              <div className="text-right">
                <Chip tone="plain">
                  {b.deployMinutes[0]}â€“{b.deployMinutes[1]} min
                </Chip>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-stone-500">{b.ttlHours}h default</div>
              </div>
            </div>
            <span className="absolute top-6 right-6 text-xs text-stone-400 opacity-0 transition group-hover:opacity-100">Launch â†’</span>
            {b.custom && (
              <span className="mt-4 flex items-center gap-2 text-[10px] text-stone-500">
                <Chip tone="calm">exported</Chip>
                from {b.custom.source.resourceGroup} Â· {b.custom.module === "lab.bicep" ? "Bicep" : "ARM JSON"}
                {b.custom.warnings.length > 0 && <Chip tone="amber">{b.custom.warnings.length} warning(s)</Chip>}
              </span>
            )}
          </button>
          {b.custom && (
            <button onClick={() => remove(b)} className="absolute right-4 bottom-4 rounded-full p-1.5 text-stone-400 opacity-0 transition group-hover:opacity-100 hover:text-signal" title="Remove exported blueprint" aria-label={`Remove ${b.title}`}>
              <IconTrash width={14} height={14} />
            </button>
          )}
          </div>
        ))}
      </div>
            </section>
          ))}
      </div>
      {open && <LaunchDialog blueprint={open.b} catalog={catalog} initial={open.initial} onClose={() => setOpen(undefined)} onLaunched={() => { setOpen(undefined); onLaunched(); }} />}
    </>
  );
}

export interface LaunchInitial {
  region?: string;
  params?: Record<string, unknown>;
  ttlHours?: number;
  purpose?: string;
}

export function LaunchDialog({ blueprint: b, catalog, onClose, onLaunched, initial }: { blueprint: BlueprintInfo; catalog: CatalogData; onClose: () => void; onLaunched: () => void; initial?: LaunchInitial }) {
  const { trackJobs, notify, subscriptionId } = useStore();
  const [region, setRegion] = useState(initial?.region ?? catalog.defaultRegion);
  const [params, setParams] = useState<Record<string, unknown>>(() => ({ ...Object.fromEntries(b.fields.map((f) => [f.key, f.default])), ...(initial?.params ?? {}) }));
  const [ttl, setTtl] = useState(initial?.ttlHours ?? b.ttlHours);
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [est, setEst] = useState<LabEstimate>();
  const [phase, setPhase] = useState<"idle" | "checking" | "launching">("idle");
  const [check, setCheck] = useState<{ key: string; result: ValidationResult }>();
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string>();
  const [alts, setAlts] = useState<{ key: string; result?: AlternativesResult; loading: boolean }>();

  const paramKey = useMemo(() => JSON.stringify(params), [params]);
  const checkKey = `${subscriptionId}|${region}|${paramKey}|${ttl}`;
  useEffect(() => {
    setEst(undefined);
    api<LabEstimate>("/api/labs/estimate", { method: "POST", body: { blueprint: b.id, region, params } }).then(setEst).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.id, region, paramKey]);
  useEffect(() => setAck(false), [checkKey]);

  const current = check?.key === checkKey ? check.result : undefined;
  const fails = current?.checks.filter((c) => c.status === "fail") ?? [];
  const warns = current?.checks.filter((c) => c.status === "warn") ?? [];
  const rules = est?.rules ?? [];
  const minutes = est?.deployMinutes ?? b.deployMinutes;
  const stages = est?.stages ?? b.stages;
  const body = { blueprint: b.id, region, params, ttlHours: ttl, purpose: purpose || undefined, subscriptionId };
  // Offer cheaper or deployable variants when the checks show a blocker that another region/tier fixes, or cost pressure.
  const wantAlts = Boolean(current?.checks.some((c) => (c.status === "fail" && /^(region|quota|vm-.*)$/.test(c.id)) || (c.status === "warn" && (c.id === "budget" || c.id === "capacity"))));
  useEffect(() => {
    if (!wantAlts || alts?.key === checkKey) return;
    setAlts({ key: checkKey, loading: true });
    api<AlternativesResult>("/api/labs/alternatives", { method: "POST", body })
      .then((r) => setAlts({ key: checkKey, result: r, loading: false }))
      .catch(() => setAlts({ key: checkKey, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantAlts, checkKey]);
  const altResult = alts?.key === checkKey ? alts : undefined;
  const apply = (a: Alternative) => {
    setRegion(a.region);
    setParams({ ...params, ...a.params });
  };

  const deploy = async (labName: string) => {
    setPhase("launching");
    const res = await api<{ job: Job; labName: string }>("/api/labs", { method: "POST", body: { ...body, labName } });
    trackJobs([res.job]);
    notify(`Launching ${res.labName}â€¦`);
    onLaunched();
  };

  const go = async () => {
    setError(undefined);
    try {
      if (current && !fails.length) return await deploy(current.labName);
      setPhase("checking");
      const v = await api<ValidationResult>("/api/labs/validate", { method: "POST", body });
      setCheck({ key: checkKey, result: v });
      // Clean preflight: launch straight away. Otherwise show the checklist and stop.
      if (!v.checks.some((c) => c.status === "fail" || c.status === "warn")) return await deploy(v.labName);
      setPhase("idle");
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
    }
  };

  const register = async (namespaces: string[]) => {
    try {
      for (const ns of namespaces) await api(`/api/providers/${encodeURIComponent(ns)}/register`, { method: "POST", body: { subscriptionId } });
      notify(`Registering ${namespaces.join(", ")} â€” re-check in a few minutes`);
    } catch (e) {
      notify((e as Error).message, "bad");
    }
  };

  const select = "w-full rounded-xl border border-stone-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-signal dark:border-stone-700 dark:bg-[#15161a]";
  const expires = new Date(Date.now() + ttl * 3_600_000).toISOString();
  const blocked = rules.length > 0 || fails.length > 0 || (warns.length > 0 && !ack);
  const label =
    phase === "checking" ? "Checkingâ€¦" : phase === "launching" ? "Launchingâ€¦" : fails.length ? "Re-check" : current ? "Launch" : "Check & launch";

  return (
    <Modal title="Launch lab" onClose={onClose}>
      <div className="flex items-center gap-4">
        <div className="flex -space-x-2">
          {b.icons.map((t) => (
            <span key={t} className="grid size-11 place-items-center rounded-xl bg-white ring-2 ring-stone-50 dark:bg-stone-950 dark:ring-[#15161a]">
              <ResourceIcon type={t} size={28} />
            </span>
          ))}
        </div>
        <div>
          <div className="text-xl font-semibold">{b.title}</div>
          <div className="text-sm text-stone-500">{b.tagline}</div>
        </div>
      </div>

      {b.scenario && (
        <details className="mt-4 rounded-2xl border border-stone-300 px-4 py-3 text-sm dark:border-stone-700">
          <summary className="cursor-pointer select-none font-medium">Scenario and what students learn</summary>
          <p className="mt-2 text-stone-600 dark:text-stone-400">{b.scenario.story}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-stone-600 dark:text-stone-400">{b.scenario.objectives.map((o) => <li key={o}>{o}</li>)}</ul>
          <div className="mt-2 flex flex-wrap gap-1.5">{b.scenario.exams.map((e) => <Chip key={e} tone="plain">{e}</Chip>)}</div>
        </details>
      )}

      {b.presets.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {b.presets.map((p) => {
            const on = Object.entries(p.params).every(([k, v]) => String(params[k]) === String(v));
            return (
              <button
                key={p.label}
                onClick={() => setParams({ ...params, ...p.params })}
                className={`rounded-full border px-3 py-1 text-xs transition ${on ? "border-signal bg-signal/10 text-stone-900 dark:text-white" : "border-stone-300 text-stone-500 hover:border-stone-400 dark:border-stone-700"}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <Label>Region</Label>
          <select value={region} onChange={(e) => setRegion(e.target.value)} className={`mt-1.5 ${select}`}>
            {catalog.regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        {b.fields.map((f) => (
          <label key={f.key} className="block">
            <Label>{f.label}</Label>
            {f.kind === "select" ? (
              <select value={String(params[f.key])} onChange={(e) => setParams({ ...params, [f.key]: e.target.value })} className={`mt-1.5 ${select}`}>
                {(f.optionsFrom === "regions" ? [{ value: "", label: f.emptyLabel ?? "None" }, ...catalog.regions.filter((r) => r !== region).map((r) => ({ value: r, label: r }))] : (f.options ?? [])).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : f.kind === "toggle" ? (
              <Toggle on={params[f.key] === true || params[f.key] === "true"} onChange={(v) => setParams({ ...params, [f.key]: v })} />
            ) : (
              <input type="number" min={f.min} max={f.max} value={Number(params[f.key])} onChange={(e) => setParams({ ...params, [f.key]: Number(e.target.value) })} className={`mt-1.5 ${select}`} />
            )}
          </label>
        ))}
      </div>
      {rules.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-signal">
          {rules.map((r) => <li key={r}>âœ• {r}</li>)}
        </ul>
      )}

      <label className="mt-5 block">
        <div className="flex items-baseline justify-between">
          <Label>Lifetime</Label>
          <span className="font-mono text-sm">{ttl}h Â· expires {relTime(expires)}</span>
        </div>
        <input type="range" min={1} max={72} value={ttl} onChange={(e) => setTtl(Number(e.target.value))} className="mt-2 w-full accent-[#ff6a3d]" />
      </label>

      <div className="mt-4 grid gap-3 ">
        <input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={80} placeholder="Purpose (optional)" className={select} />
      </div>
      {b.custom && b.custom.warnings.length > 0 && (
        <details className="mt-3 text-xs text-amber-600 dark:text-amber-300">
          <summary className="cursor-pointer select-none">{b.custom.warnings.length} export warning(s)</summary>
          <ul className="mt-1 list-disc pl-5">{b.custom.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </details>
      )}

      <div className="mt-5 flex items-end justify-between rounded-2xl bg-stone-200/50 p-4 dark:bg-stone-900">
        <div>
          <div className="font-mono text-3xl tabular-nums">{est ? usd(est.hourly * ttl) : "â€¦"}</div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-stone-500">{est ? `${usd(est.hourly)}/hr Ã— ${ttl}h` : "estimating"}</div>
        </div>
        <details className="text-right text-xs text-stone-500">
          <summary className="cursor-pointer select-none">Breakdown</summary>
          <ul className="mt-2 space-y-0.5">
            {est?.lines.map((l) => <li key={l.label}>{l.label} Â· {l.hourly === undefined ? "n/a" : `${usd(l.hourly, 3)}/hr`}</li>)}
            {est?.notes.map((n) => <li key={n} className="opacity-70">+ {n}</li>)}
          </ul>
        </details>
      </div>

      <details className="mt-4 text-sm text-stone-500">
        <summary className="cursor-pointer select-none">
          {stages.length > 1 ? `${stages.length} stages` : `${(est?.steps ?? b.steps).length} steps`} Â· {minutes[0]}â€“{minutes[1]} min
          {(est?.timing ?? b.timing)?.source === "learned" && (
            <span className="ml-1.5 text-xs text-calm" title={`Learned from your last ${(est?.timing ?? b.timing)!.samples} deployment(s)`}>
              Â· typically {(est?.timing ?? b.timing)!.typical} min ({(est?.timing ?? b.timing)!.samples} run{(est?.timing ?? b.timing)!.samples > 1 ? "s" : ""})
            </span>
          )}
        </summary>
        {stages.length > 1 || stages[0]?.gate ? (
          <ol className="mt-2 space-y-1.5">
            {stages.map((s, i) => (
              <li key={s.label} className="flex flex-wrap items-center gap-2">
                <span className="grid size-5 place-items-center rounded-full bg-stone-200 font-mono text-[10px] dark:bg-stone-800">{i + 1}</span>
                {s.label}
                {s.gate && <span className="text-xs text-stone-400">â¸ {s.gate}</span>}
              </li>
            ))}
          </ol>
        ) : (
          <ol className="mt-2 space-y-1">
            {(est?.steps ?? b.steps).map((s) => (
              <li key={s.name} className="flex items-center gap-2">
                <ResourceIcon type={s.type} size={16} />
                {s.label} <span className="text-xs opacity-60">{typeLabel(s.type)}</span>
              </li>
            ))}
          </ol>
        )}
      </details>

      {current && (fails.length > 0 || warns.length > 0) && (
        <div className="mt-4 rounded-2xl border border-stone-300 p-3 dark:border-stone-800">
          <Checklist checks={current.checks} onRegister={register} />
          {altResult && (altResult.loading || (altResult.result && (altResult.result.alternatives.length > 0 || altResult.result.ttl))) && (
            <div className="mt-3 border-t border-stone-200 pt-3 dark:border-stone-800">
              <Label>{fails.length ? "Deployable instead" : "Cheaper options"}</Label>
              {altResult.loading && <p className="mt-2 text-xs text-stone-500">Checking other regions and tiersâ€¦</p>}
              <ul className="mt-2 space-y-1.5">
                {altResult.result?.alternatives.map((a) => (
                  <li key={a.region + JSON.stringify(a.params)} className="flex items-start gap-2 text-xs">
                    <span className="w-16 shrink-0 font-mono tabular-nums">{usd(a.hourly)}/h</span>
                    <span className="min-w-0 flex-1">
                      {a.changes.join(" Â· ") || "Same setup"}
                      {a.loses && <span className="block text-stone-500">loses {a.loses}</span>}
                    </span>
                    <button onClick={() => apply(a)} className="shrink-0 rounded-full bg-stone-900 px-2 py-0.5 text-[10px] text-white dark:bg-white dark:text-black">
                      Apply
                    </button>
                  </li>
                ))}
                {altResult.result?.ttl && (
                  <li className="flex items-start gap-2 text-xs">
                    <span className="w-16 shrink-0 font-mono tabular-nums">{altResult.result.ttl.hours}h</span>
                    <span className="min-w-0 flex-1">Shorter lifetime {altResult.result.ttl.reason}</span>
                    <button onClick={() => setTtl(altResult.result!.ttl!.hours)} className="shrink-0 rounded-full bg-stone-900 px-2 py-0.5 text-[10px] text-white dark:bg-white dark:text-black">
                      Apply
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}
          {!fails.length && warns.length > 0 && (
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="accent-[#ff6a3d]" />
              Launch anyway
            </label>
          )}
        </div>
      )}
      {error && <p className="mt-4 rounded-xl bg-signal/10 p-3 text-xs text-signal">{error}</p>}

      <div className="mt-6 flex justify-end gap-2">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn tone="solid" disabled={phase !== "idle" || (blocked && !fails.length) || rules.length > 0} onClick={go}>
          {label}
        </Btn>
      </div>
    </Modal>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`mt-1.5 flex h-[38px] w-full items-center gap-2 rounded-xl border px-3 text-sm transition ${on ? "border-calm/60 text-stone-900 dark:text-white" : "border-stone-300 text-stone-500 dark:border-stone-700"}`}
    >
      <span className={`relative h-4 w-7 rounded-full transition ${on ? "bg-calm" : "bg-stone-300 dark:bg-stone-700"}`}>
        <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
      {on ? "On" : "Off"}
    </button>
  );
}

const DOT: Record<FeasibilityCheck["status"], string> = {
  pass: "bg-calm",
  warn: "bg-amber-400",
  fail: "bg-signal",
  skip: "border border-stone-400",
};

export function Checklist({ checks, onRegister }: { checks: FeasibilityCheck[]; onRegister?: (namespaces: string[]) => void }) {
  const order = { fail: 0, warn: 1, pass: 2, skip: 3 };
  const sorted = [...checks].sort((a, b) => order[a.status] - order[b.status]);
  const quiet = sorted.filter((c) => c.status === "pass" || c.status === "skip");
  const loud = sorted.filter((c) => c.status === "fail" || c.status === "warn");
  const row = (c: FeasibilityCheck) => (
    <li key={c.id} className="flex items-start gap-2.5 text-xs">
      <span className={`mt-1 size-2 shrink-0 rounded-full ${DOT[c.status]}`} />
      <span className="w-32 shrink-0 font-medium">{c.label}</span>
      <span className={`min-w-0 flex-1 ${c.status === "fail" ? "text-signal" : "text-stone-500"}`}>{c.detail}</span>
      {c.fix?.kind === "register-provider" && onRegister && (
        <button onClick={() => onRegister(c.fix!.namespaces)} className="shrink-0 rounded-full bg-stone-900 px-2 py-0.5 text-[10px] text-white dark:bg-white dark:text-black">
          Register
        </button>
      )}
    </li>
  );
  return (
    <div>
      <ul className="space-y-1.5">{loud.map(row)}</ul>
      {quiet.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-[11px] text-stone-500">{quiet.length} passed</summary>
          <ul className="mt-1.5 space-y-1.5">{quiet.map(row)}</ul>
        </details>
      )}
    </div>
  );
}
