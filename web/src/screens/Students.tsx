import { useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { Btn, Chip, Label } from "../components/ui.tsx";
import { ProvisionDialog } from "../components/ProvisionDialog.tsx";
import { relTime } from "../format.ts";
import type { Sandbox } from "../types.ts";

const STATUS: Record<Sandbox["status"], { tone: "calm" | "plain" | "signal"; text: string }> = {
  active: { tone: "calm", text: "Active" },
  ended: { tone: "plain", text: "Ended" },
  failed: { tone: "signal", text: "Failed" },
};

/** The list and the provision form. Re-provision and delete come in the next step (see docs/student-sandbox.md). */
export function Students() {
  const [rows, setRows] = useState<Sandbox[]>();
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api<Sandbox[]>("/api/sandboxes")
      .then((d) => {
        setRows(d);
        setError(undefined);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (error && !rows) return <p className="text-sm text-signal">{error}</p>;
  if (!rows) return <div className="h-64 animate-pulse rounded-3xl bg-stone-200 dark:bg-stone-900" />;

  const active = rows.filter((r) => r.status === "active").length;

  return (
    <div className="space-y-8">
      <p className="flex items-start gap-2 rounded-xl bg-amber-300/15 px-3 py-2 text-xs">
        <span className="mt-1 size-2 shrink-0 rounded-full bg-amber-400" />
        <span>
          Student sandboxes have not been tried on Azure yet. Try one with a student you control before you invite a class. See <span className="font-mono">docs/student-sandbox.md</span>.
        </span>
      </p>

      {rows.length === 0 ? (
        <div className="grid place-items-center rounded-3xl border border-dashed border-stone-300 px-6 py-16 text-center dark:border-stone-800">
          <p className="text-stone-500">No student sandboxes yet.</p>
          <Btn tone="solid" className="mt-4" onClick={() => setCreating(true)}>
            New sandbox
          </Btn>
        </div>
      ) : (
        <section>
          <div className="mb-3 flex items-center gap-3">
            <Label>Sandboxes</Label>
            <span className="font-mono text-[10px] text-stone-400">
              {rows.length} · {active} active
            </span>
            <span className="h-px flex-1 bg-stone-300/60 dark:bg-stone-800" />
            <Btn tone="solid" onClick={() => setCreating(true)}>
              New sandbox
            </Btn>
          </div>
          <div className="hidden grid-cols-[minmax(0,1.3fr)_5rem_minmax(0,1fr)_6rem_7rem] gap-3 px-1 pb-2 font-mono text-[10px] uppercase tracking-widest text-stone-500 sm:grid">
            <span>Student</span>
            <span>Course</span>
            <span>Group</span>
            <span>Status</span>
            <span className="text-right">Ends</span>
          </div>
          <ul className="divide-y divide-stone-300/60 border-t border-stone-300/60 dark:divide-stone-800 dark:border-stone-800">
            {rows.map((r) => {
              const s = STATUS[r.status];
              const expired = r.status === "active" && new Date(r.expires_on).getTime() < Date.now();
              return (
                <li key={r.rg_name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-1 py-3 text-sm sm:grid-cols-[minmax(0,1.3fr)_5rem_minmax(0,1fr)_6rem_7rem]">
                  <div className="min-w-0 sm:col-start-1 sm:row-start-1">
                    <div className="truncate font-medium">{r.student_name}</div>
                    <div className="truncate font-mono text-xs text-stone-500">{r.student_upn}</div>
                  </div>
                  <span className="justify-self-end sm:col-start-4 sm:row-start-1 sm:justify-self-start">
                    <Chip tone={s.tone} title={r.error ?? undefined}>{s.text}</Chip>
                  </span>
                  {/* On a phone these three share one line under the name; from sm up they are columns of the row. */}
                  <div className="col-span-2 flex min-w-0 items-center gap-3 sm:contents">
                    <span className="sm:col-start-2 sm:row-start-1">
                      <Chip tone="plain">{r.course.toUpperCase()}</Chip>
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-500 sm:col-start-3 sm:row-start-1" title={r.rg_name}>{r.rg_name}</span>
                    <span className={`shrink-0 font-mono text-xs sm:col-start-5 sm:row-start-1 sm:text-right ${expired ? "text-signal" : "text-stone-500"}`}>
                      {r.status === "active" ? (expired ? "expired" : relTime(r.expires_on)) : r.status === "ended" ? `ended ${relTime(r.ended_at ?? undefined)}` : "—"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {creating && <ProvisionDialog onClose={() => setCreating(false)} onDone={load} />}
    </div>
  );
}
