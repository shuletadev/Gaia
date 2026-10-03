import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api.ts";
import { useStore } from "../store.tsx";
import { relTime, typeLabel, usd } from "../format.ts";
import type { DeletePreview, InventoryGroup, Job } from "../types.ts";
import { Modal } from "./Modal.tsx";
import { Btn, Chip, Label } from "./ui.tsx";
import { ResourceIcon } from "./ResourceIcon.tsx";

interface PowerTarget {
  id: string;
  name: string;
  type: string;
  cost30dUsd?: number;
}

interface Actions {
  requestPark: (t: PowerTarget) => void;
  requestResume: (t: PowerTarget) => void;
  requestDelete: (ids: string[]) => void;
  requestAdopt: (g: InventoryGroup) => void;
  setPersistent: (id: string, name: string, persistent: boolean) => Promise<void>;
  extend: (g: InventoryGroup, hours: number) => Promise<void>;
  release: (g: InventoryGroup) => Promise<void>;
  busyIds: Set<string>;
}

const Ctx = createContext<Actions | null>(null);
export const useActions = () => {
  const a = useContext(Ctx);
  if (!a) throw new Error("ActionsProvider missing");
  return a;
};

type Dialog =
  | { kind: "power"; mode: "park" | "resume"; target: PowerTarget }
  | { kind: "delete"; ids: string[] }
  | { kind: "adopt"; group: InventoryGroup };

const PARK_EFFECT: Record<string, string> = {
  "microsoft.network/azurefirewalls": "Deallocates the firewall. Traffic routed through it stops. IP configuration is saved for resume.",
  "microsoft.network/applicationgateways": "Stops the gateway. Listeners stop answering.",
  "microsoft.compute/virtualmachines": "Deallocates the VM. Disks are kept.",
  "microsoft.containerservice/managedclusters": "Stops the cluster. Workloads stop.",
};

export function ActionsProvider({ children }: { children: ReactNode }) {
  const { reload, trackJobs, notify, jobs } = useStore();
  const [dialog, setDialog] = useState<Dialog>();
  const busyIds = new Set(jobs.filter((j) => j.status === "running").map((j) => j.target));

  const tagCall = useCallback(
    async (path: string, body: unknown) => {
      try {
        const res = await api<{ detail: string }>(path, { method: "POST", body });
        notify(res.detail);
        await reload(false);
      } catch (e) {
        notify((e as Error).message, "bad");
      }
    },
    [notify, reload],
  );

  const value: Actions = {
    requestPark: (target) => setDialog({ kind: "power", mode: "park", target }),
    requestResume: (target) => setDialog({ kind: "power", mode: "resume", target }),
    requestDelete: (ids) => setDialog({ kind: "delete", ids }),
    requestAdopt: (group) => setDialog({ kind: "adopt", group }),
    setPersistent: (id, _name, persistent) => tagCall("/api/actions/persist", { targetId: id, persistent }),
    extend: (g, hours) => tagCall("/api/actions/extend", { resourceGroupId: g.id, hours }),
    release: (g) => tagCall("/api/actions/release", { resourceGroupId: g.id }),
    busyIds,
  };

  const close = () => setDialog(undefined);

  return (
    <Ctx.Provider value={value}>
      {children}
      {dialog?.kind === "power" && (
        <PowerDialog
          mode={dialog.mode}
          target={dialog.target}
          onClose={close}
          onStarted={(job) => {
            trackJobs([job]);
            notify(`${dialog.mode === "park" ? "Parking" : "Resuming"} ${dialog.target.name}…`);
            close();
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteDialog
          ids={dialog.ids}
          onClose={close}
          onStarted={(started, skipped) => {
            trackJobs(started);
            notify(`Deleting ${started.length} item(s)${skipped ? ` · ${skipped} skipped` : ""}…`);
            close();
          }}
        />
      )}
      {dialog?.kind === "adopt" && (
        <AdoptDialog
          group={dialog.group}
          onClose={close}
          onDone={async (ttlHours, purpose) => {
            close();
            await tagCall("/api/actions/adopt", { resourceGroupId: dialog.group.id, ttlHours, purpose });
          }}
        />
      )}
    </Ctx.Provider>
  );
}

function PowerDialog({ mode, target, onClose, onStarted }: { mode: "park" | "resume"; target: PowerTarget; onClose: () => void; onStarted: (job: Job) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const go = async () => {
    setBusy(true);
    try {
      onStarted(await api<Job>(`/api/actions/${mode}`, { method: "POST", body: { resourceId: target.id } }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={mode === "park" ? "Park" : "Resume"} onClose={onClose}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <ResourceIcon type={target.type} size={44} />
          <div>
            <div className="text-2xl font-semibold">{target.name}</div>
            <div className="text-sm text-stone-500">{typeLabel(target.type)}</div>
          </div>
        </div>
        {mode === "park" && target.cost30dUsd !== undefined && (
          <div className="text-right">
            <div className="font-mono text-xl tabular-nums text-calm">−{usd(target.cost30dUsd, 0)}</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-stone-500">per 30 days</div>
          </div>
        )}
      </div>
      <details className="mt-4 text-sm text-stone-500">
        <summary className="cursor-pointer select-none">What happens</summary>
        <p className="mt-2">{mode === "park" ? PARK_EFFECT[target.type.toLowerCase()] : "Starts the resource again. Billing resumes."} Runs in the background; may take several minutes.</p>
      </details>
      {error && <p className="mt-4 text-sm text-signal">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn tone={mode === "park" ? "calm" : "solid"} disabled={busy} onClick={go}>
          {busy ? "Starting…" : mode === "park" ? "Park" : "Resume"}
        </Btn>
      </div>
    </Modal>
  );
}

function DeleteDialog({ ids: initialIds, onClose, onStarted }: { ids: string[]; onClose: () => void; onStarted: (jobs: Job[], skipped: number) => void }) {
  const [ids, setIds] = useState(initialIds);
  const [preview, setPreview] = useState<DeletePreview>();
  const [error, setError] = useState<string>();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(undefined);
    setTyped("");
    api<DeletePreview>("/api/actions/delete/preview", { method: "POST", body: { targetIds: ids } })
      .then(setPreview)
      .catch((e: Error) => setError(e.message));
  }, [ids]);

  const allowed = preview?.items.filter((i) => i.allowed) ?? [];
  const total = allowed.reduce((s, i) => s + (i.cost30dUsd ?? 0), 0);
  const matches = preview !== undefined && typed === preview.confirmPhrase && allowed.length > 0;
  const steps = preview?.plan.steps ?? [];
  const fixes = steps.filter((s) => s.kind === "fix");
  const waves = [...new Set(steps.map((s) => s.wave))].sort((a, b) => a - b);
  const include = (id: string) => setIds((cur) => (cur.some((x) => x.toLowerCase() === id.toLowerCase()) ? cur : [...cur, id]));

  const go = async () => {
    setBusy(true);
    try {
      const res = await api<{ jobs: Job[]; skipped: unknown[] }>("/api/actions/delete", { method: "POST", body: { targetIds: ids, confirm: typed } });
      onStarted(res.jobs, res.skipped.length);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Delete · dry run" onClose={onClose} tone="danger">
      {!preview && !error && <div className="py-8 text-center text-sm text-stone-500">Checking dependencies, order and locks…</div>}
      {preview && (
        <>
          <ul className="max-h-[38vh] space-y-2 overflow-auto pr-1">
            {preview.items.map((i) => (
              <li key={i.id} className={`rounded-xl border p-3 ${i.allowed ? "border-stone-300 dark:border-stone-800" : "border-dashed border-stone-300 dark:border-stone-700"}`}>
                <div className={`flex items-center justify-between gap-3 ${i.allowed ? "" : "opacity-60"}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <ResourceIcon type={i.type} size={24} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{i.name}</div>
                      <div className="text-xs text-stone-500">{typeLabel(i.type)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {i.cost30dUsd !== undefined && <span className="font-mono text-xs tabular-nums">{usd(i.cost30dUsd)}</span>}
                    {i.allowed ? <Chip tone="signal">delete</Chip> : <Chip tone="muted" title={i.reason}>skip · {i.blockers?.length ? "held" : i.reason}</Chip>}
                  </div>
                </div>
                {i.contains.length > 0 && (
                  <details className="mt-2 text-xs text-stone-500">
                    <summary className="cursor-pointer">{i.contains.length} resource(s) inside</summary>
                    <ul className="mt-1 columns-2 gap-4">{i.contains.map((c) => <li key={c.id} className="truncate">{c.name}</li>)}</ul>
                  </details>
                )}
                {i.blockers?.map((b) => (
                  <div key={b.consumer.id + b.detail} className="mt-2 flex items-center gap-2 text-xs text-signal">
                    <ResourceIcon type={b.consumer.type} size={14} />
                    <span className="min-w-0 flex-1">{b.detail}</span>
                    <button onClick={() => include(b.consumer.id)} className="shrink-0 rounded-full bg-stone-900 px-2 py-0.5 text-[10px] text-white dark:bg-white dark:text-black">
                      Include
                    </button>
                  </div>
                ))}
                {i.allowed && i.referencedBy.length > 0 && !fixes.length && <p className="mt-2 text-xs text-stone-500">Used by {i.referencedBy.map((r) => r.name).join(", ")}</p>}
                {i.reservedFor && <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">Looks reserved for {i.reservedFor.name} — not currently bound</p>}
                {i.locks.length > 0 && <p className="mt-2 text-xs text-signal">Lock: {i.locks.join(", ")}</p>}
              </li>
            ))}
          </ul>

          {steps.length > 1 || fixes.length > 0 ? (
            <div className="mt-4 rounded-xl border border-stone-300 p-3 dark:border-stone-800">
              <Label>Order</Label>
              <ol className="mt-2 space-y-1.5 text-xs">
                {waves.map((w, n) => (
                  <li key={w} className="flex gap-2.5">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-stone-200 font-mono text-[10px] dark:bg-stone-800">{n + 1}</span>
                    <ul className="min-w-0 flex-1 space-y-1 pt-0.5">
                      {steps
                        .filter((s) => s.wave === w)
                        .map((s) => (
                          <li key={s.key} className="flex items-start gap-2">
                            <ResourceIcon type={s.target.type} size={14} />
                            <span className={s.kind === "fix" ? "text-amber-700 dark:text-amber-300" : ""}>
                              {s.kind === "fix" ? <>Keep <b>{s.target.name}</b>, {s.fixes.map((f) => f.label).join("; ")}</> : s.label}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ol>
              {fixes.length > 0 && <p className="mt-2 text-[11px] text-stone-500">Amber steps change resources that stay; they only remove references to what is being deleted.</p>}
            </div>
          ) : null}
          {preview.plan.warnings.length > 0 && (
            <details className="mt-3 text-xs text-stone-500">
              <summary className="cursor-pointer select-none">{preview.plan.warnings.length} note{preview.plan.warnings.length > 1 ? "s" : ""}</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{preview.plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </details>
          )}

          {allowed.length > 0 ? (
            <div className="mt-5">
              <div className="mb-2 flex items-baseline justify-between text-sm">
                <span>
                  Type <code className="rounded bg-signal/15 px-1.5 py-0.5 font-mono text-signal">{preview.confirmPhrase}</code>
                </span>
                <span className="font-mono text-xs text-stone-500">{usd(total)} / 30d</span>
              </div>
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && matches && !busy && void go()}
                className="w-full rounded-xl border border-stone-300 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-signal dark:border-stone-700"
                spellCheck={false}
                aria-label="Confirmation text"
              />
            </div>
          ) : (
            <p className="mt-4 text-sm text-stone-500">Nothing here can be deleted.</p>
          )}
        </>
      )}
      {error && <p className="mt-4 text-sm text-signal">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn tone="danger" disabled={!matches || busy} onClick={go}>
          {busy ? "Starting…" : `Delete ${allowed.length || ""}`}
        </Btn>
      </div>
    </Modal>
  );
}
function AdoptDialog({ group, onClose, onDone }: { group: InventoryGroup; onClose: () => void; onDone: (ttlHours: number, purpose: string) => void }) {
  const { status } = useStore();
  const [hours, setHours] = useState(status?.ttlHours.default ?? 8);
  const [purpose, setPurpose] = useState("");
  const expires = new Date(Date.now() + hours * 3_600_000).toISOString();
  return (
    <Modal title="Adopt as lab" onClose={onClose}>
      <div className="text-2xl font-semibold">{group.name}</div>
      <div className="text-sm text-stone-500">
        {group.resources.length} resources · {usd(group.cost30dUsd)} / 30d
      </div>
      <label className="mt-6 block">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-stone-500">Lifetime</span>
          <span className="font-mono text-sm">
            {hours}h · expires {relTime(expires)}
          </span>
        </div>
        <input type="range" min={1} max={72} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="mt-2 w-full accent-[#ff6a3d]" />
      </label>
      <input
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
        placeholder="Purpose (optional)"
        className="mt-4 w-full rounded-xl border border-stone-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-signal dark:border-stone-700"
      />
      <details className="mt-4 text-sm text-stone-500">
        <summary className="cursor-pointer select-none">What this means</summary>
        <p className="mt-2">
          Tags the group <code>managedBy=labctl</code> with an expiry. Once expired, the whole group becomes eligible for the expiry sweep, which deletes it. You can extend or release it any time.
        </p>
      </details>
      <div className="mt-6 flex justify-end gap-2">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn tone="solid" onClick={() => onDone(hours, purpose)}>
          Adopt
        </Btn>
      </div>
    </Modal>
  );
}
