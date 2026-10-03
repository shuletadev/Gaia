import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Modal } from "./Modal.tsx";
import { ResourceIcon } from "./ResourceIcon.tsx";
import { Btn, Chip } from "./ui.tsx";
import type { CheckResult, CheckStatus, ValidateReport } from "../../../server/validate.ts";

const tone: Record<CheckStatus, "calm" | "amber" | "signal" | "muted"> = { pass: "calm", warn: "amber", fail: "signal", skip: "muted" };
const glyph: Record<CheckStatus, string> = { pass: "✓", warn: "!", fail: "✕", skip: "–" };

export function ValidateDialog({ targetId, title, onClose }: { targetId: string; title: string; onClose: () => void }) {
  const [report, setReport] = useState<ValidateReport>();
  const [error, setError] = useState<string>();
  const [run, setRun] = useState(0);

  useEffect(() => {
    setReport(undefined);
    setError(undefined);
    api<ValidateReport>("/api/validate", { method: "POST", body: { targetId } }).then(setReport).catch((e: Error) => setError(e.message));
  }, [targetId, run]);

  return (
    <Modal title={`Validate · ${title}`} onClose={onClose}>
      {!report && !error && (
        <div className="flex items-center gap-3 py-10 text-sm text-stone-500">
          <span className="size-3 animate-spin rounded-full border-2 border-signal border-t-transparent" />
          Probing backends, routes, DNS and gateways…
        </div>
      )}
      {error && <p className="text-sm text-signal">{error}</p>}
      {report && (
        <>
          <div className="mb-4 flex items-center gap-2">
            {(["fail", "warn", "pass", "skip"] as CheckStatus[]).map((s) => report.summary[s] > 0 && (
              <Chip key={s} tone={tone[s]}>
                {report.summary[s]} {s}
              </Chip>
            ))}
            <span className="ml-auto font-mono text-[10px] text-stone-500">{(report.durationMs / 1000).toFixed(1)} s</span>
          </div>
          {report.checks.length === 0 ? (
            <p className="py-6 text-sm text-stone-500">Nothing here has checks yet.</p>
          ) : (
            <ul className="max-h-[55vh] space-y-1.5 overflow-auto pr-1">
              {report.checks.map((c, i) => <Row key={`${c.id}-${c.target?.id ?? ""}-${i}`} c={c} />)}
            </ul>
          )}
        </>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Btn onClick={() => setRun((n) => n + 1)} disabled={!report && !error}>Run again</Btn>
        <Btn tone="solid" onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}

function Row({ c }: { c: CheckResult }) {
  const color = { pass: "text-calm", warn: "text-amber-500", fail: "text-signal", skip: "text-stone-400" }[c.status];
  return (
    <li className={`grid grid-cols-[1.25rem_1.5rem_minmax(0,1fr)] items-start gap-2 rounded-xl px-2 py-2 ${c.status === "fail" ? "bg-signal/10" : c.status === "warn" ? "bg-amber-300/10" : ""}`}>
      <span className={`pt-0.5 text-center font-mono text-sm font-bold ${color}`}>{glyph[c.status]}</span>
      {c.target ? <ResourceIcon type={c.target.type} size={20} /> : <span className="grid size-5 place-items-center font-mono text-[10px] text-stone-500">e2e</span>}
      <div className="min-w-0">
        <div className="text-sm">
          {c.target && <span className="font-medium">{c.target.name} </span>}
          <span className="text-stone-500">{c.title}</span>
        </div>
        <div className="text-xs break-words text-stone-500">{c.detail}</div>
      </div>
    </li>
  );
}
