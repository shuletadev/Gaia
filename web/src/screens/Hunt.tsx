import { useMemo, useState } from "react";
import { useStore } from "../store.tsx";
import { useActions } from "../components/actions.tsx";
import { Btn, Chip, sevTone } from "../components/ui.tsx";
import { IconPause, IconTrash } from "../components/Icons.tsx";
import { ResourceIcon } from "../components/ResourceIcon.tsx";
import { typeLabel, usd } from "../format.ts";
import type { Finding, ResourceRef, Severity } from "../types.ts";

const ORDER: Severity[] = ["high", "medium", "low", "info"];

export function Hunt() {
  const { snapshot: s } = useStore();
  const a = useActions();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sev, setSev] = useState<Severity | "all">("all");

  const resourceById = useMemo(() => new Map((s?.groups ?? []).flatMap((g) => g.resources).map((r) => [r.id.toLowerCase(), r])), [s]);
  const findings = useMemo(() => (s?.findings ?? []).filter((f) => sev === "all" || f.severity === sev), [s, sev]);
  if (!s) return null;

  const deletable = findings.filter((f) => f.action === "delete");
  const chosen = s.findings.filter((f) => selected.has(f.resourceId));
  const chosenCost = chosen.reduce((sum, f) => sum + (f.cost30dUsd ?? 0), 0);
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allChosen = deletable.length > 0 && deletable.every((f) => selected.has(f.resourceId));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(["all", ...ORDER] as const).map((k) => {
          const n = k === "all" ? s.findings.length : s.findings.filter((f) => f.severity === k).length;
          return (
            <button key={k} onClick={() => setSev(k)} className={`rounded-full px-3 py-1 text-xs capitalize transition ${sev === k ? "bg-stone-900 text-white dark:bg-white dark:text-black" : "text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800"}`}>
              {k} <span className="opacity-60">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="sticky top-0 z-10 -mx-2 mb-3 flex items-center gap-3 rounded-2xl bg-stone-100/90 px-2 py-2 backdrop-blur dark:bg-[#0c0d10]/90">
        <label className="flex items-center gap-2 text-xs text-stone-500">
          <input type="checkbox" checked={allChosen} onChange={() => setSelected(allChosen ? new Set() : new Set(deletable.map((f) => f.resourceId)))} className="accent-[#ff6a3d]" />
          Select deletable
        </label>
        <span className="ml-auto font-mono text-xs text-stone-500">{selected.size ? `${selected.size} · ${usd(chosenCost)} / 30d` : ""}</span>
        <Btn tone="danger" disabled={selected.size === 0} onClick={() => a.requestDelete([...selected])}>
          <IconTrash width={14} height={14} />
          Preview delete
        </Btn>
      </div>

      <ul className="divide-y divide-stone-300/60 dark:divide-stone-800">
        {findings.map((f) => (
          <Row key={f.ruleId + f.resourceId} f={f} checked={selected.has(f.resourceId)} onCheck={() => toggle(f.resourceId)} canPark={Boolean(resourceById.get(f.resourceId.toLowerCase())?.power?.canPark)} busy={a.busyIds.has(f.resourceId.toLowerCase())} related={f.relatedId ? resourceById.get(f.relatedId.toLowerCase()) : undefined} />
        ))}
      </ul>
      {findings.length === 0 && <p className="py-10 text-center text-sm text-stone-500">Clean.</p>}
      {s.warnings.length > 0 && (
        <details className="mt-6 text-xs text-amber-600 dark:text-amber-300">
          <summary className="cursor-pointer">{s.warnings.length} warning(s)</summary>
          <ul className="mt-1 list-disc pl-5">{s.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function Row({ f, checked, onCheck, canPark, busy, related }: { f: Finding; checked: boolean; onCheck: () => void; canPark: boolean; busy: boolean; related?: ResourceRef }) {
  const a = useActions();
  return (
    <li className="grid grid-cols-[1.5rem_4.5rem_minmax(0,1fr)_auto_auto] items-center gap-3 py-3">
      {f.action === "delete" ? <input type="checkbox" checked={checked} onChange={onCheck} className="accent-[#ff6a3d]" aria-label={`Select ${f.name}`} /> : <span />}
      <Chip tone={sevTone[f.severity]}>{f.severity}</Chip>
      <div className="flex min-w-0 items-center gap-3">
        <ResourceIcon type={f.type} size={26} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium">
            <span className="truncate">{f.name}</span>
            <span className="shrink-0 font-normal text-stone-500">· {f.resourceGroup}</span>
            {related && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-300/25 py-0.5 pr-2 pl-1 text-[10px] font-normal text-amber-700 dark:text-amber-300">
                <ResourceIcon type={related.type} size={12} />
                {related.name}
              </span>
            )}
          </div>
          <details className="text-xs text-stone-500">
            <summary className="cursor-pointer select-none">
              {typeLabel(f.type)} · {f.title}
            </summary>
            <p className="mt-1">{f.detail}</p>
          </details>
        </div>
      </div>
      <span className="font-mono text-sm tabular-nums">{usd(f.cost30dUsd)}</span>
      <div className="flex w-28 justify-end gap-0.5">
        {busy ? (
          <Chip tone="plain">working…</Chip>
        ) : f.action === "park" && canPark ? (
          <Btn tone="calm" onClick={() => a.requestPark({ id: f.resourceId, name: f.name, type: f.type, cost30dUsd: f.cost30dUsd })}>
            <IconPause width={14} height={14} />
            Park
          </Btn>
        ) : f.action === "delete" ? (
          <Btn onClick={() => a.requestDelete([f.resourceId])}>Delete</Btn>
        ) : (
          <>
            <Btn onClick={() => a.setPersistent(f.resourceId, f.name, true)} title="Keep it and stop flagging">Keep</Btn>
            {f.type !== "Microsoft.Resources/resourceGroups" && (
              <Btn onClick={() => a.requestDelete([f.resourceId])} title="Delete">
                <IconTrash width={14} height={14} />
              </Btn>
            )}
          </>
        )}
      </div>
    </li>
  );
}

