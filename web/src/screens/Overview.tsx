import { useStore } from "../store.tsx";
import { useActions } from "../components/actions.tsx";
import { BudgetRing, DailyBars, ForecastTrack } from "../components/charts.tsx";
import { Btn, Chip, Label, sevTone } from "../components/ui.tsx";
import { IconPause } from "../components/Icons.tsx";
import { ResourceIcon } from "../components/ResourceIcon.tsx";
import { relTime, typeLabel, usd, usd0 } from "../format.ts";
import type { Finding } from "../types.ts";

export function Overview({ go }: { go: (screen: "inventory" | "hunt" | "labs" | "catalog") => void }) {
  const { snapshot: s } = useStore();
  const actions = useActions();
  if (!s) return <Skeleton />;

  const t = s.totals;
  const labs = s.groups.filter((g) => g.lab.managed).sort((a, b) => (a.lab.expiresOn ?? "").localeCompare(b.lab.expiresOn ?? ""));
  const topGroups = s.groups.filter((g) => (g.cost30dUsd ?? 0) > 0).slice(0, 5);
  const maxGroup = Math.max(...topGroups.map((g) => g.cost30dUsd ?? 0), 1);
  const fixFirst = s.findings.filter((f) => f.severity !== "info").sort((a, b) => (b.cost30dUsd ?? 0) - (a.cost30dUsd ?? 0)).slice(0, 4);
  const resourceById = new Map(s.groups.flatMap((g) => g.resources).map((r) => [r.id.toLowerCase(), r]));
  // Live forecast (what exists now) when available; the 7-day trend lags deletions by a week.
  const forecast = t.liveForecastMonth ?? t.forecastMonth;
  const dailyRate = t.liveDailyRate ?? t.dailyRunRate;
  const overBudget = (forecast ?? 0) > s.budget.monthlyUsd;

  return (
    <div className="space-y-12">
      <section className="grid items-center gap-10 lg:grid-cols-[auto_1fr]">
        <BudgetRing spent={t.costMtdUsd} budget={s.budget.monthlyUsd} />
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Forecast" value={usd0(forecast)} tone={overBudget ? "signal" : undefined} />
            <Stat label="Burn / hr" value={usd(dailyRate !== undefined ? dailyRate / 24 : t.hourlyBurn)} />
            <Stat label="Leaking / 30d" value={usd0(t.flaggedCost30dUsd)} tone={(t.flaggedCost30dUsd ?? 0) > 0 ? "signal" : undefined} />
            <Stat label="Last month" value={usd0(t.costPrevMonthUsd)} />
          </div>
          <ForecastTrack spent={t.costMtdUsd} forecast={forecast} budget={s.budget.monthlyUsd} thresholds={s.budget.alertThresholds} />
          {t.liveForecastMonth !== undefined && (
            <details className="text-xs text-stone-500">
              <summary className="cursor-pointer select-none">How it's forecast</summary>
              <ul className="mt-2 space-y-1">
                <li>
                  <b className="font-medium text-stone-700 dark:text-stone-300">Live {usd0(t.liveForecastMonth)}</b> — month so far + {usd(t.liveDailyRate)}/day for resources that still exist (typical day, {t.window?.[0]} – {t.window?.[t.window.length - 1]})
                </li>
                <li>
                  Trend {usd0(t.forecastMonth)} — month so far + 7-day average {usd(t.dailyRunRate)}/day; still counts {usd(t.removedDailyRate)}/day of deleted resources
                  {(t.parkedDailyRate ?? 0) > 0 ? ` and ${usd(t.parkedDailyRate)}/day now parked` : ""}
                </li>
                <li>Cost data lags Azure by 8–24 h, so changes made today show up tomorrow.</li>
              </ul>
            </details>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <Label>30 days</Label>
          <span className="font-mono text-[10px] text-signal">--- {usd(dailyRate)}/day run rate</span>
        </div>
        <DailyBars daily={s.daily} runRate={dailyRate} />
      </section>

      <section className="grid gap-10 lg:grid-cols-2">
        <div>
          <div className="mb-4 flex items-baseline justify-between">
            <Label>Fix first</Label>
            <button onClick={() => go("hunt")} className="text-xs text-stone-500 hover:text-signal">All findings →</button>
          </div>
          <ul className="space-y-2">
            {fixFirst.map((f) => (
              <FixRow key={f.ruleId + f.resourceId} f={f} power={resourceById.get(f.resourceId.toLowerCase())?.power} onPark={() => actions.requestPark({ id: f.resourceId, name: f.name, type: f.type, cost30dUsd: f.cost30dUsd })} onDelete={() => actions.requestDelete([f.resourceId])} onReview={() => go("inventory")} busy={actions.busyIds.has(f.resourceId.toLowerCase())} />
            ))}
            {fixFirst.length === 0 && <li className="text-sm text-stone-500">Nothing costly flagged.</li>}
          </ul>
        </div>
        <div>
          <div className="mb-4 flex items-baseline justify-between">
            <Label>Where it goes · 30d</Label>
            <button onClick={() => go("inventory")} className="text-xs text-stone-500 hover:text-signal">Inventory →</button>
          </div>
          <ul className="space-y-3">
            {topGroups.map((g) => (
              <li key={g.id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{g.name}</span>
                  <span className="font-mono tabular-nums">{usd(g.cost30dUsd)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-stone-300/50 dark:bg-stone-800">
                  <div className="h-1.5 rounded-full bg-stone-800 dark:bg-stone-300" style={{ width: `${((g.cost30dUsd ?? 0) / maxGroup) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between">
          <Label>Labs</Label>
          <button onClick={() => go("labs")} className="text-xs text-stone-500 hover:text-signal">Labs →</button>
        </div>
        {labs.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">
            No labs running. <button onClick={() => go("catalog")} className="text-signal hover:underline">Launch one</button>
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {labs.map((g) => (
              <li key={g.id} className="rounded-2xl border border-stone-300 p-4 dark:border-stone-800">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{g.name}</span>
                  <Chip tone={g.lab.expired ? "signal" : "calm"}>{g.lab.expired ? "expired" : relTime(g.lab.expiresOn)}</Chip>
                </div>
                <div className="mt-3 flex gap-1">
                  <Btn onClick={() => actions.extend(g, 4)}>+4h</Btn>
                  <Btn onClick={() => actions.extend(g, 24)}>+1d</Btn>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FixRow({ f, power, onPark, onDelete, onReview, busy }: { f: Finding; power?: { canPark: boolean }; onPark: () => void; onDelete: () => void; onReview: () => void; busy: boolean }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-stone-300 p-3 dark:border-stone-800">
      <ResourceIcon type={f.type} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{f.name}</span>
          <Chip tone={sevTone[f.severity]}>{f.severity}</Chip>
        </div>
        <div className="truncate text-xs text-stone-500">
          {typeLabel(f.type)} · {f.title}
        </div>
      </div>
      <span className="font-mono text-sm tabular-nums">{usd(f.cost30dUsd)}</span>
      {busy ? (
        <Chip tone="plain">working…</Chip>
      ) : f.action === "park" && power?.canPark ? (
        <Btn tone="calm" onClick={onPark}><IconPause width={14} height={14} />Park</Btn>
      ) : f.action === "delete" ? (
        <Btn onClick={onDelete}>Delete</Btn>
      ) : (
        <Btn onClick={onReview}>Review</Btn>
      )}
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "signal" }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className={`mt-1 text-3xl font-light tabular-nums tracking-tight ${tone === "signal" ? "text-signal" : ""}`}>{value}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid animate-pulse gap-8">
      <div className="h-40 rounded-3xl bg-stone-200 dark:bg-stone-900" />
      <div className="h-28 rounded-3xl bg-stone-200 dark:bg-stone-900" />
    </div>
  );
}
