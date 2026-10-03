import { useMemo, useState } from "react";
import { useStore } from "../store.tsx";
import { useActions } from "../components/actions.tsx";
import { Btn, Chip, PowerChip } from "../components/ui.tsx";
import { IconChevron, IconExport, IconExternal, IconPause, IconPin, IconPlay, IconPulse, IconTopology, IconTrash } from "../components/Icons.tsx";
import { ResourceIcon } from "../components/ResourceIcon.tsx";
import { ValidateDialog } from "../components/ValidateDialog.tsx";
import { TopologyDialog } from "../components/TopologyDialog.tsx";
import { ExportDialog } from "../components/ExportDialog.tsx";
import { portalUrl, relTime, typeLabel, usd } from "../format.ts";
import type { InventoryGroup, InventoryResource, ResourceRef } from "../types.ts";

type Filter = "all" | "costing" | "flagged" | "parked";

export function Inventory() {
  const { snapshot: s } = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    if (!s) return [];
    const needle = q.trim().toLowerCase();
    const match = (r: InventoryResource) =>
      (!needle || r.name.toLowerCase().includes(needle) || typeLabel(r.type).toLowerCase().includes(needle)) &&
      (filter === "all" ||
        (filter === "costing" && (r.cost30dUsd ?? 0) >= 0.5) ||
        (filter === "flagged" && r.findings.length > 0) ||
        (filter === "parked" && r.power?.state === "parked"));
    return s.groups
      .map((g) => ({ ...g, resources: g.resources.filter(match) }))
      .filter((g) => g.resources.length > 0 || (filter === "all" && (!needle || g.name.toLowerCase().includes(needle))));
  }, [s, filter, q]);

  if (!s) return null;
  const toggle = (id: string) => setOpen((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const searching = q.trim().length > 0 || filter !== "all";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(["all", "costing", "flagged", "parked"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-xs capitalize transition ${filter === f ? "bg-stone-900 text-white dark:bg-white dark:text-black" : "text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800"}`}>
            {f}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="ml-auto w-48 rounded-full border border-stone-300 bg-transparent px-3 py-1 text-xs outline-none focus:border-signal dark:border-stone-700" />
      </div>
      <div className="space-y-3">
        {groups.map((g) => (
          <GroupCard key={g.id} g={g} open={searching || open.has(g.id)} onToggle={() => toggle(g.id)} />
        ))}
      </div>
    </div>
  );
}

function GroupCard({ g, open, onToggle }: { g: InventoryGroup; open: boolean; onToggle: () => void }) {
  const a = useActions();
  const { status } = useStore();
  const [panel, setPanel] = useState<"validate" | "diagram" | "export">();
  const flagged = g.resources.filter((r) => r.findings.length).length;
  return (
    <section className={`rounded-2xl border ${g.excluded ? "border-dashed border-stone-300 opacity-60 dark:border-stone-800" : "border-stone-300 dark:border-stone-800"}`}>
      <header className="flex flex-wrap items-center gap-3 p-4">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={open}>
          <IconChevron className={`shrink-0 text-stone-400 transition ${open ? "rotate-90" : ""}`} />
          <ResourceIcon type="Microsoft.Resources/resourceGroups" size={22} />
          <span className="truncate text-lg font-medium">{g.name}</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-stone-500">{g.location}</span>
          <span className="text-xs text-stone-500">{g.resources.length}</span>
          {g.excluded && <Chip tone="muted">protected</Chip>}
          {g.persistent && <Chip tone="calm"><IconPin width={10} height={10} />persistent</Chip>}
          {g.lab.managed && <Chip tone={g.lab.expired ? "signal" : "calm"}>lab · {g.lab.expired ? "expired" : relTime(g.lab.expiresOn)}</Chip>}
          {flagged > 0 && <Chip tone="amber">{flagged} flagged</Chip>}
        </button>
        <span className="font-mono text-sm tabular-nums">{usd(g.cost30dUsd)}</span>
        {g.resources.length > 0 && (
          <div className="flex gap-0.5">
            <Btn onClick={() => setPanel("validate")} title="Validate"><IconPulse width={14} height={14} /></Btn>
            <Btn onClick={() => setPanel("diagram")} title="Topology"><IconTopology width={14} height={14} /></Btn>
            <Btn onClick={() => setPanel("export")} title="Save as blueprint"><IconExport width={14} height={14} /></Btn>
          </div>
        )}
        {!g.excluded && (
          <div className="flex gap-1">
            {g.lab.managed ? (
              <>
                <Btn onClick={() => a.extend(g, 4)}>+4h</Btn>
                <Btn onClick={() => a.release(g)}>Release</Btn>
              </>
            ) : (
              <>
                <Btn onClick={() => a.requestAdopt(g)} title="Give it an expiry">Adopt</Btn>
                <Btn onClick={() => a.setPersistent(g.id, g.name, !g.persistent)}>{g.persistent ? "Unpin" : "Pin"}</Btn>
              </>
            )}
            <Btn onClick={() => a.requestDelete([g.id])} aria-label={`Delete ${g.name}`}><IconTrash width={14} height={14} /></Btn>
          </div>
        )}
      </header>
      {open && g.resources.length > 0 && (
        <ul className="divide-y divide-stone-200 border-t border-stone-200 dark:divide-stone-800/80 dark:border-stone-800">
          {g.resources.map((r) => (
            <ResourceRow key={r.id} r={r} protectedGroup={g.excluded} tenantId={status?.tenantId} />
          ))}
        </ul>
      )}
      {open && g.resources.length === 0 && <div className="border-t border-stone-200 p-4 text-sm text-stone-500 dark:border-stone-800">Empty</div>}
      {panel === "validate" && <ValidateDialog targetId={g.id} title={g.name} onClose={() => setPanel(undefined)} />}
      {panel === "diagram" && <TopologyDialog resourceGroupId={g.id} title={g.name} onClose={() => setPanel(undefined)} />}
      {panel === "export" && <ExportDialog resourceGroupId={g.id} name={g.name} onClose={() => setPanel(undefined)} onOpenCatalog={() => (location.hash = "catalog")} />}
    </section>
  );
}

function ResourceRow({ r, protectedGroup, tenantId }: { r: InventoryResource; protectedGroup: boolean; tenantId?: string }) {
  const a = useActions();
  const [open, setOpen] = useState(false);
  const busy = a.busyIds.has(r.id.toLowerCase());
  const target = { id: r.id, name: r.name, type: r.type, cost30dUsd: r.cost30dUsd };
  const hasLinks = r.uses.length + r.usedBy.length > 0 || Boolean(r.reservedFor);
  return (
    <li className="px-4 py-2.5 pl-6">
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_6rem_auto]">
        <div className="flex min-w-0 items-center gap-3">
          <ResourceIcon type={r.type} size={26} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <button onClick={() => hasLinks && setOpen(!open)} className={`truncate text-left ${hasLinks ? "hover:text-signal" : "cursor-default"}`} aria-expanded={hasLinks ? open : undefined}>
                {r.name}
              </button>
              {r.persistent && <IconPin width={12} height={12} className="shrink-0 text-calm" />}
              {r.findings.length > 0 && <span className="size-1.5 shrink-0 rounded-full bg-amber-400" title={r.findings.join(", ")} />}
              {r.reservedFor ? (
                <LinkChip refd={r.reservedFor} tone="amber" prefix="for" title={`Unbound; appears reserved for ${r.reservedFor.name}`} />
              ) : (
                r.usedBy.slice(0, 2).map((u) => <LinkChip key={u.id} refd={u} prefix="↳" title={`Used by ${u.name}`} />)
              )}
              {!r.reservedFor && r.usedBy.length > 2 && <span className="text-[10px] text-stone-500">+{r.usedBy.length - 2}</span>}
            </div>
            <div className="truncate text-xs text-stone-500">
              {typeLabel(r.type)}
              {r.sku ? ` · ${r.sku}` : ""}
            </div>
          </div>
        </div>
        <div className="hidden sm:block">{busy ? <Chip tone="plain">working…</Chip> : <PowerChip power={r.power} />}</div>
        <span className="hidden text-right font-mono text-sm tabular-nums sm:block">{usd(r.cost30dUsd)}</span>
        <div className="flex justify-end gap-0.5">
          {!protectedGroup && !busy && (
            <>
              {r.power?.canPark && <Btn tone="calm" onClick={() => a.requestPark(target)} title="Park"><IconPause width={14} height={14} />Park</Btn>}
              {r.power?.canResume && <Btn onClick={() => a.requestResume(target)} title="Resume"><IconPlay width={14} height={14} />Resume</Btn>}
              <Btn onClick={() => a.setPersistent(r.id, r.name, !r.persistent)} title={r.persistent ? "Unpin" : "Pin as persistent"}>
                <IconPin width={14} height={14} className={r.persistent ? "text-calm" : ""} />
              </Btn>
              <Btn onClick={() => a.requestDelete([r.id])} title="Delete"><IconTrash width={14} height={14} /></Btn>
            </>
          )}
          <a href={portalUrl(r.id, tenantId)} target="_blank" rel="noreferrer" className="rounded-full p-1.5 text-stone-400 hover:text-stone-900 dark:hover:text-white" title="Open in portal">
            <IconExternal width={14} height={14} />
          </a>
        </div>
      </div>
      {open && (
        <div className="mt-3 ml-[2.4rem] grid gap-4 rounded-xl bg-stone-200/40 p-3 sm:grid-cols-2 dark:bg-stone-900/60">
          <LinkList label="Uses" items={r.uses} />
          <LinkList label="Used by" items={r.usedBy} empty={r.reservedFor ? `Nothing bound · looks reserved for ${r.reservedFor.name}` : "Nothing"} />
        </div>
      )}
    </li>
  );
}

function LinkChip({ refd, prefix, title, tone = "plain" }: { refd: ResourceRef; prefix: string; title: string; tone?: "plain" | "amber" }) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full py-0.5 pr-2 pl-1 text-[10px] ${tone === "amber" ? "bg-amber-300/25 text-amber-700 dark:text-amber-300" : "bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-300"}`}
    >
      <span className="opacity-70">{prefix}</span>
      <ResourceIcon type={refd.type} size={12} />
      {refd.name}
    </span>
  );
}

function LinkList({ label, items, empty = "Nothing" }: { label: string; items: ResourceRef[]; empty?: string }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-stone-500">{label}</div>
      {items.length === 0 ? (
        <div className="text-xs text-stone-500">{empty}</div>
      ) : (
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 text-sm">
              <ResourceIcon type={i.type} size={16} />
              <span className="truncate">{i.name}</span>
              <span className="text-xs text-stone-500">{typeLabel(i.type)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

