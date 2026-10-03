import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { PowerInfo, Severity } from "../types.ts";

export function Btn({ tone = "ghost", children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "ghost" | "solid" | "danger" | "calm" }) {
  const tones = {
    ghost: "text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-white",
    solid: "bg-stone-900 text-white hover:bg-signal hover:text-black dark:bg-white dark:text-black dark:hover:bg-signal",
    danger: "bg-signal text-black hover:brightness-110",
    calm: "bg-calm/15 text-teal-700 hover:bg-calm/25 dark:text-calm",
  };
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:pointer-events-none disabled:opacity-35 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Chip({ children, tone = "plain", title }: { children: ReactNode; tone?: "plain" | "signal" | "calm" | "amber" | "muted"; title?: string }) {
  const tones = {
    plain: "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
    signal: "bg-signal/15 text-orange-700 dark:text-signal",
    calm: "bg-calm/15 text-teal-700 dark:text-calm",
    amber: "bg-amber-300/25 text-amber-700 dark:text-amber-300",
    muted: "ring-1 ring-stone-300 text-stone-500 dark:ring-stone-700",
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tones[tone]}`}>
      {children}
    </span>
  );
}

export const sevTone: Record<Severity, "signal" | "amber" | "plain" | "muted"> = { high: "signal", medium: "amber", low: "plain", info: "muted" };

export function PowerChip({ power }: { power?: PowerInfo }) {
  if (!power) return null;
  const map = {
    running: { tone: "signal" as const, text: "Running", dot: "bg-signal animate-pulse" },
    parked: { tone: "calm" as const, text: "Parked", dot: "bg-calm" },
    "stopped-billing": { tone: "amber" as const, text: "Stopped · billing", dot: "bg-amber-400" },
    transitioning: { tone: "plain" as const, text: "Changing", dot: "bg-stone-400 animate-pulse" },
    unknown: { tone: "muted" as const, text: "Unknown", dot: "bg-stone-400" },
  }[power.state];
  return (
    <Chip tone={map.tone} title={power.note}>
      <span className={`size-1.5 rounded-full ${map.dot}`} />
      {map.text}
    </Chip>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-stone-500">{children}</div>;
}
