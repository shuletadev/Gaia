import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { useStore } from "../store.tsx";
import { Chip, Label } from "../components/ui.tsx";
import type { ActionLogEntry } from "../types.ts";

export function Log() {
  const { jobs } = useStore();
  const [entries, setEntries] = useState<ActionLogEntry[]>([]);
  useEffect(() => {
    api<ActionLogEntry[]>("/api/history").then(setEntries).catch(() => undefined);
  }, [jobs]);

  const tone = (o: string) => (o === "succeeded" || o === "ok" ? "calm" : o === "failed" || o === "interrupted" ? "signal" : "plain");
  const short = (target: string) => target.split(",").map((t) => t.split("/").pop()).join(", ");

  return (
    <div>
      <Label>Action log</Label>
      <ul className="mt-4 divide-y divide-stone-300/60 dark:divide-stone-800">
        {entries.map((e) => (
          <li key={e.id} className="grid grid-cols-[11.5rem_8rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-sm">
            <span className="whitespace-nowrap font-mono text-xs text-stone-500">{new Date(e.at).toLocaleString()}</span>
            <span className="font-mono text-xs">{e.action}</span>
            <span className="min-w-0 truncate" title={`${e.target}\n${e.detail ?? ""}`}>
              {short(e.target)} {e.detail && <span className="text-stone-500">· {e.detail}</span>}
            </span>
            <Chip tone={tone(e.outcome)}>{e.dry_run ? "dry run" : e.outcome}</Chip>
          </li>
        ))}
      </ul>
      {entries.length === 0 && <p className="mt-6 text-sm text-stone-500">Nothing yet.</p>}
    </div>
  );
}
