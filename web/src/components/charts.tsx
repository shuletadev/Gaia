import type { DailyCost } from "../../../server/azure/cost.ts";
import { usd } from "../format.ts";

export function BudgetRing({ spent, budget, size = 168 }: { spent?: number; budget: number; size?: number }) {
  const pct = spent === undefined ? 0 : spent / budget;
  const r = 56;
  const c = 2 * Math.PI * r;
  const color = pct >= 1 ? "stroke-signal" : pct >= 0.8 ? "stroke-amber-400" : "stroke-calm";
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 128 128" className="absolute inset-0 -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" strokeWidth="7" className="stroke-stone-300/70 dark:stroke-stone-800" />
        <circle cx="64" cy="64" r={r} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${Math.min(pct, 1) * c} ${c}`} className={`${color} transition-all duration-700`} />
      </svg>
      <div className="text-center">
        <div className="text-3xl font-semibold tabular-nums tracking-tight">{usd(spent, 0)}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">of {usd(budget, 0)}</div>
      </div>
    </div>
  );
}

/** Horizontal track: spent so far, projected month-end, and the configured alert thresholds. */
export function ForecastTrack({ spent = 0, forecast, budget, thresholds }: { spent?: number; forecast?: number; budget: number; thresholds: number[] }) {
  const max = Math.max(budget * 1.25, (forecast ?? 0) * 1.05, spent * 1.05);
  const pct = (v: number) => `${Math.min((v / max) * 100, 100)}%`;
  const over = (forecast ?? 0) > budget;
  return (
    <div className="relative h-10">
      <div className="absolute inset-x-0 top-4 h-2 rounded-full bg-stone-300/60 dark:bg-stone-800" />
      {forecast !== undefined && (
        <div
          className={`absolute top-4 h-2 rounded-full ${over ? "bg-signal/35" : "bg-calm/30"} [background-image:repeating-linear-gradient(135deg,transparent_0_4px,rgb(255_255_255/0.25)_4px_8px)]`}
          style={{ width: pct(forecast) }}
        />
      )}
      <div className={`absolute top-4 h-2 rounded-full ${over ? "bg-signal" : "bg-calm"}`} style={{ width: pct(spent) }} />
      {thresholds.map((t) => (
        <div key={t} className="absolute top-2 h-6 border-l border-dashed border-stone-400 dark:border-stone-600" style={{ left: pct(budget * t) }}>
          <span className="absolute -top-3 -translate-x-1/2 font-mono text-[9px] text-stone-500">{usd(budget * t, 0)}</span>
        </div>
      ))}
      {forecast !== undefined && (
        <div className="absolute top-7 -translate-x-1/2 font-mono text-[10px] text-stone-500" style={{ left: pct(forecast) }}>
          ▲ {usd(forecast, 0)}
        </div>
      )}
    </div>
  );
}

export function DailyBars({ daily, runRate }: { daily: DailyCost[]; runRate?: number }) {
  if (!daily.length) return <div className="h-28 text-xs text-stone-500">No daily data</div>;
  const today = new Date().toISOString().slice(0, 10);
  // Scale on complete days only; today's partial (and often lumpy) data is drawn clipped and greyed.
  const max = Math.max(...daily.filter((d) => d.date < today).map((d) => d.cost), runRate ?? 0, 0.01) * 1.15;
  const w = 100 / daily.length;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-28 w-full overflow-visible">
      {daily.map((d, i) => {
        const h = Math.min(d.cost / max, 1) * 38;
        const partial = d.date >= today;
        return (
          <rect key={d.date} x={i * w + w * 0.15} width={w * 0.7} y={40 - h} height={Math.max(h, 0.3)} rx={0.4} className={partial ? "fill-stone-400/50" : "fill-stone-800 dark:fill-stone-300"}>
            <title>{`${d.date} · ${usd(d.cost)}${partial ? " (partial)" : ""}`}</title>
          </rect>
        );
      })}
      {runRate !== undefined && (
        <line x1="0" x2="100" y1={40 - (runRate / max) * 38} y2={40 - (runRate / max) * 38} strokeDasharray="1 1" strokeWidth="0.3" className="stroke-signal" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
