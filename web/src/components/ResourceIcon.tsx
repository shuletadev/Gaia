import { useState } from "react";
import { iconSlugFor } from "../iconMap.ts";
import { typeLabel } from "../format.ts";

/** Official Azure icon for a resource type, falling back to a monogram tile when the icon set isn't installed. */
export function ResourceIcon({ type, kind, size = 22, className = "" }: { type: string; kind?: string; size?: number; className?: string }) {
  const slug = iconSlugFor(type, kind);
  const [failed, setFailed] = useState(false);
  const label = typeLabel(type);
  if (slug && !failed) {
    return (
      <img
        src={`/azure-icons/${encodeURIComponent(slug)}.svg`}
        alt=""
        title={label}
        width={size}
        height={size}
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
        className={`shrink-0 select-none ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const mono = label
    .split(/[\s/-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      title={label}
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-md bg-stone-200 font-mono font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300 ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.38) }}
    >
      {mono}
    </span>
  );
}
