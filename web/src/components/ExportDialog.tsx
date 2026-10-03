import { useState } from "react";
import { api } from "../api.ts";
import { Modal } from "./Modal.tsx";
import { ResourceIcon } from "./ResourceIcon.tsx";
import { Btn, Chip, Label } from "./ui.tsx";
import type { CustomMeta } from "../types.ts";

export function ExportDialog({ resourceGroupId, name, onClose, onOpenCatalog }: { resourceGroupId: string; name: string; onClose: () => void; onOpenCatalog: () => void }) {
  const [title, setTitle] = useState(name.replace(/^lab-[a-z0-9]+-[a-z0-9]{4}$/, "").trim() || name);
  const [tagline, setTagline] = useState("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<CustomMeta>();
  const [error, setError] = useState<string>();
  const field = "w-full rounded-xl border border-stone-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-signal dark:border-stone-700";

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setMeta(await api<CustomMeta>("/api/blueprints/export", { method: "POST", body: { resourceGroupId, title, tagline: tagline || undefined } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Save as blueprint · ${name}`} onClose={onClose}>
      {!meta ? (
        <>
          <div className="grid gap-3">
            <label>
              <Label>Name</Label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} className={`mt-1.5 ${field}`} />
            </label>
            <label>
              <Label>Tagline</Label>
              <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={80} placeholder={`Exported from ${name}`} className={`mt-1.5 ${field}`} />
            </label>
          </div>
          <details className="mt-4 text-sm text-stone-500">
            <summary className="cursor-pointer select-none">What happens</summary>
            <p className="mt-2">
              Azure exports the group's template. labctl derives every name from the new lab's name, takes location and tags from the launch, prefixes globally unique names and DNS labels, and
              keeps readable Bicep when it compiles (ARM JSON otherwise). The result appears in the Catalog; Launch runs a preflight before anything is created. Read-only for the source group.
            </p>
          </details>
          {error && <p className="mt-4 text-sm text-signal">{error}</p>}
          <div className="mt-6 flex justify-end gap-2">
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn tone="solid" disabled={busy || title.trim().length < 2} onClick={run}>{busy ? "Exporting…" : "Export"}</Btn>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <div className="flex -space-x-2">{meta.icons.map((t) => <span key={t} className="grid size-11 place-items-center rounded-xl bg-white ring-2 ring-stone-50 dark:bg-stone-950 dark:ring-[#15161a]"><ResourceIcon type={t} size={28} /></span>)}</div>
            <div>
              <div className="text-xl font-semibold">{meta.title}</div>
              <div className="text-sm text-stone-500">{meta.resourceCount} resources · {meta.module === "lab.bicep" ? "Bicep" : "ARM JSON"} · {meta.meters.length ? `${meta.meters.length} priced meter(s)` : "no priced SKUs"}</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <Chip tone={meta.warnings.length ? "amber" : "calm"}>{meta.warnings.length ? `${meta.warnings.length} warning(s)` : "no warnings"}</Chip>
            <Chip tone={meta.decompile.ok ? "calm" : "plain"}>{meta.decompile.ok ? "Bicep compiles" : "deploys from ARM JSON"}</Chip>
            <Chip tone="muted">{meta.id}</Chip>
          </div>
          {meta.warnings.length > 0 && (
            <ul className="mt-4 max-h-40 list-disc space-y-1 overflow-auto pl-5 text-xs text-amber-600 dark:text-amber-300">{meta.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
          {!meta.decompile.ok && meta.decompile.diagnostics.length > 0 && (
            <details className="mt-3 text-xs text-stone-500">
              <summary className="cursor-pointer select-none">Why not Bicep ({meta.decompile.diagnostics.length})</summary>
              <ul className="mt-1 space-y-0.5 font-mono">{meta.decompile.diagnostics.map((d) => <li key={d}>{d}</li>)}</ul>
            </details>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Btn onClick={onClose}>Close</Btn>
            <Btn tone="solid" onClick={onOpenCatalog}>Open catalog</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}
