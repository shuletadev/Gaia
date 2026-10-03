import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api.ts";
import { Btn, Chip, Label } from "./ui.tsx";
import { IconCheck, IconRefresh } from "./Icons.tsx";
import type { AzStatus, GroupSuggestions, Job, SubscriptionList, TenantInfo } from "../types.ts";

/** Pieces shared by the first-run wizard and the Settings screen. */

export const field = "w-full rounded-xl border border-stone-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-signal dark:border-stone-700 dark:bg-[#15161a]";

/** Starts a server job and resolves when it finishes (sign-in, icon download). */
export async function runJob(path: string, body: unknown): Promise<Job> {
  const job = await api<Job>(path, { method: "POST", body });
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const j = (await api<Job[]>("/api/jobs")).find((x) => x.id === job.id);
    if (j && j.status !== "running") {
      if (j.status !== "succeeded") throw new Error(j.error ?? `${j.target_name} ${j.status}`);
      return j;
    }
  }
}

export const shortId = (id: string) => `${id.slice(0, 8)}…`;
export const tenantLabel = (t: Pick<TenantInfo, "tenantId" | "name" | "domain">) => t.name ?? t.domain ?? shortId(t.tenantId);

// ---- Sign-in ---------------------------------------------------------------------------------

export function SignIn({ az, onSignedIn, compact = false }: { az?: AzStatus; onSignedIn: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [tenant, setTenant] = useState("");
  const [error, setError] = useState<string>();

  const signIn = async (t?: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await runJob("/api/setup/login", t ? { tenant: t } : {});
      setTenant("");
      onSignedIn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (az && !az.installed) {
    return (
      <div className="rounded-2xl border border-signal/40 bg-signal/10 p-4 text-sm">
        Gaia uses your Azure CLI sign-in. Install the Azure CLI from{" "}
        <a className="underline" href="https://aka.ms/installazurecli" target="_blank" rel="noreferrer">
          aka.ms/installazurecli
        </a>
        , then reload this page.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex items-center gap-3 rounded-2xl border border-stone-300 p-4 dark:border-stone-800">
          <span className={`grid size-9 place-items-center rounded-full ${az?.signedIn ? "bg-calm/15 text-calm" : "bg-stone-200 text-stone-500 dark:bg-stone-800"}`}>
            {az?.signedIn ? <IconCheck /> : "?"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{az === undefined ? "Checking Azure CLI…" : az.signedIn ? az.user : "Not signed in"}</div>
            <div className="text-xs text-stone-500">{az?.signedIn ? `Azure CLI ${az.version ?? ""}` : "Sign in once; Gaia reuses the Azure CLI token."}</div>
          </div>
          {!az?.signedIn && az && (
            <Btn tone="solid" disabled={busy} onClick={() => signIn()}>
              {busy ? "Waiting for browser…" : "Sign in"}
            </Btn>
          )}
        </div>
      )}
      {(az?.signedIn || compact) && (
        <div className="flex items-center gap-2">
          <input value={tenant} onChange={(e) => setTenant(e.target.value.trim())} placeholder="Another tenant: ID or contoso.onmicrosoft.com" className={field} />
          <span className="shrink-0 whitespace-nowrap">
            <Btn disabled={busy || !tenant} onClick={() => signIn(tenant)}>
              {busy ? "Waiting…" : "Sign in"}
            </Btn>
          </span>
        </div>
      )}
      {busy && <p className="text-xs text-stone-500">Finish the sign-in in the browser window that opened.</p>}
      {error && <p className="text-xs text-signal">{error}</p>}
    </div>
  );
}

// ---- Subscriptions ---------------------------------------------------------------------------

export function useSubscriptions() {
  const [data, setData] = useState<SubscriptionList>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    setError(undefined);
    api<SubscriptionList>("/api/setup/subscriptions")
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  return { data, error, reload: load };
}

/**
 * Pick one tenant and one or more of its subscriptions. The first selected is the default for new labs.
 */
export function SubscriptionPicker({
  data,
  tenantId,
  selected,
  onChange,
}: {
  data: SubscriptionList;
  tenantId?: string;
  selected: string[];
  onChange: (tenantId: string, ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const tenant = tenantId ?? data.tenants[0]?.tenantId;
  const inTenant = useMemo(() => data.subscriptions.filter((s) => s.tenantId.toLowerCase() === tenant?.toLowerCase()), [data, tenant]);
  const shown = inTenant.filter((s) => !q || `${s.name} ${s.id}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => Number(selected.includes(b.id)) - Number(selected.includes(a.id)) || a.name.localeCompare(b.name));
  const toggle = (id: string) => onChange(tenant!, selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="space-y-3">
      {data.tenants.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {data.tenants.map((t) => (
            <button
              key={t.tenantId}
              onClick={() => t.tenantId !== tenant?.toLowerCase() && onChange(t.tenantId, [])}
              className={`rounded-full border px-3 py-1 text-xs transition ${t.tenantId === tenant?.toLowerCase() ? "border-signal bg-signal/10" : "border-stone-300 text-stone-500 hover:border-stone-400 dark:border-stone-700"}`}
              title={t.tenantId}
            >
              {tenantLabel(t)} <span className="font-mono text-[10px] opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
      )}
      {inTenant.length > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${inTenant.length} subscriptions`} className={field} />}
      <ul className="max-h-72 space-y-1 overflow-auto pr-1">
        {shown.map((s) => {
          const on = selected.includes(s.id);
          const idx = selected.indexOf(s.id);
          return (
            <li key={s.id}>
              <button
                onClick={() => toggle(s.id)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${on ? "border-calm/60 bg-calm/10" : "border-transparent hover:border-stone-300 dark:hover:border-stone-700"}`}
              >
                <span className={`grid size-4 shrink-0 place-items-center rounded border ${on ? "border-calm bg-calm text-black" : "border-stone-400"}`}>{on && <IconCheck width={12} height={12} />}</span>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {idx === 0 && selected.length > 1 && <Chip tone="calm">default</Chip>}
                {s.state !== "Enabled" && <Chip tone="amber">{s.state}</Chip>}
                <span className="font-mono text-[10px] text-stone-500">{shortId(s.id)}</span>
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="py-6 text-center text-sm text-stone-500">No subscriptions{q ? " match" : " in this tenant"}.</li>}
      </ul>
    </div>
  );
}

// ---- Regions ---------------------------------------------------------------------------------

export function RegionPicker({ all, regions, defaultRegion, onChange }: { all: string[]; regions: string[]; defaultRegion: string; onChange: (regions: string[], defaultRegion: string) => void }) {
  const [more, setMore] = useState(false);
  const shown = more ? all : [...new Set([...regions, ...all.slice(0, 12)])];
  const toggle = (r: string) => {
    const next = regions.includes(r) ? regions.filter((x) => x !== r) : [...regions, r];
    onChange(next, next.includes(defaultRegion) ? defaultRegion : (next[0] ?? defaultRegion));
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {shown.map((r) => (
          <button
            key={r}
            onClick={() => toggle(r)}
            onDoubleClick={() => regions.includes(r) && onChange(regions, r)}
            title={regions.includes(r) ? "Double-click to make it the default" : undefined}
            className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition ${regions.includes(r) ? (r === defaultRegion ? "border-signal bg-signal/15" : "border-calm/60 bg-calm/10") : "border-stone-300 text-stone-500 hover:border-stone-400 dark:border-stone-700"}`}
          >
            {r}
            {r === defaultRegion && " ★"}
          </button>
        ))}
        {!more && (
          <button onClick={() => setMore(true)} className="px-2 text-xs text-stone-500 hover:text-signal">
            all regions…
          </button>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs text-stone-500">
        Default
        <select value={defaultRegion} onChange={(e) => onChange(regions, e.target.value)} className={`${field} w-auto py-1`}>
          {regions.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

// ---- Protected groups ------------------------------------------------------------------------

export function ProtectedGroups({
  tenantId,
  subscriptionIds,
  value,
  onChange,
  preselect = false,
  onSignInNeeded,
}: {
  tenantId: string;
  subscriptionIds: string[];
  value: string[];
  onChange: (groups: string[]) => void;
  /** First run: tick every suggestion once they arrive. */
  preselect?: boolean;
  onSignInNeeded?: (tenantId: string) => void;
}) {
  const [s, setS] = useState<GroupSuggestions>();
  const [error, setError] = useState<string>();
  const [q, setQ] = useState("");
  const key = `${tenantId}|${subscriptionIds.join(",")}`;

  useEffect(() => {
    if (!tenantId || !subscriptionIds.length) return;
    setS(undefined);
    setError(undefined);
    const qs = new URLSearchParams({ tenantId });
    for (const id of subscriptionIds) qs.append("subscriptionId", id);
    api<GroupSuggestions>(`/api/setup/suggestions?${qs}`)
      .then((r) => {
        setS(r);
        if (preselect) onChange([...new Set([...value, ...r.suggested.map((g) => g.name)])]);
      })
      .catch((e: Error) => {
        setError(e.message);
        if (e instanceof ApiError && typeof e.body?.signInTenant === "string") onSignInNeeded?.(e.body.signInTenant);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const has = (g: string) => value.some((v) => v.toLowerCase() === g.toLowerCase());
  const toggle = (g: string) => onChange(has(g) ? value.filter((v) => v.toLowerCase() !== g.toLowerCase()) : [...value, g]);
  const reason = (g: string) => s?.suggested.find((x) => x.name.toLowerCase() === g.toLowerCase())?.reason;
  const others = (s?.groups ?? []).map((g) => g.name).filter((g, i, a) => a.indexOf(g) === i && !has(g) && !reason(g));
  const matches = q ? others.filter((g) => g.toLowerCase().includes(q.toLowerCase())).slice(0, 12) : [];
  const custom = q.trim() && /^[-\w._()]+$/.test(q.trim()) && !has(q.trim()) && !others.some((g) => g.toLowerCase() === q.trim().toLowerCase());

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {[...new Set([...value, ...(s?.suggested.map((g) => g.name) ?? [])])].map((g) => (
          <button
            key={g}
            onClick={() => toggle(g)}
            title={reason(g) ?? (has(g) ? "Protected" : undefined)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${has(g) ? "border-calm/60 bg-calm/10" : "border-dashed border-stone-300 text-stone-500 dark:border-stone-700"}`}
          >
            <span className={`size-1.5 rounded-full ${has(g) ? "bg-calm" : "bg-stone-400"}`} />
            {g}
            {reason(g) && <span className="text-[10px] opacity-60">· {reason(g)}</span>}
          </button>
        ))}
        {!s && !error && <span className="text-xs text-stone-500">Looking for governance and Azure-managed groups…</span>}
      </div>
      <div className="relative">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Protect another resource group…" className={field} />
        {(matches.length > 0 || custom) && (
          <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-stone-300 bg-stone-50 p-1 shadow-xl dark:border-stone-700 dark:bg-[#15161a]">
            {matches.map((g) => (
              <li key={g}>
                <button onClick={() => (toggle(g), setQ(""))} className="w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-stone-200 dark:hover:bg-stone-800">
                  {g}
                </button>
              </li>
            ))}
            {custom && (
              <li>
                <button onClick={() => (toggle(q.trim()), setQ(""))} className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800">
                  Protect “{q.trim()}” (not found yet)
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      {error && <p className="text-xs text-signal">{error}</p>}
    </div>
  );
}

// ---- Icons -----------------------------------------------------------------------------------

export function IconsPanel({ installed, terms, onInstalled }: { installed: boolean; terms: string; onInstalled: () => void }) {
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  const download = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await runJob("/api/setup/icons", { acceptTerms: true });
      setDone(true);
      onInstalled();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (installed || done) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="grid size-7 place-items-center rounded-full bg-calm/15 text-calm">
          <IconCheck width={14} height={14} />
        </span>
        Official Azure icons installed.
        <Btn className="ml-auto" onClick={download} disabled={busy} title="Download the latest icon set again">
          <IconRefresh width={12} height={12} className={busy ? "animate-spin" : ""} />
          Refresh
        </Btn>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-stone-500">Gaia draws resources with Microsoft's official Azure icons. They aren't bundled; each user downloads them after accepting Microsoft's terms.</p>
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="accent-[#ff6a3d]" />I accept the{" "}
        <a className="underline" href={terms} target="_blank" rel="noreferrer">
          Azure icon terms
        </a>
      </label>
      <Btn tone="solid" disabled={!accept || busy} onClick={download}>
        {busy ? "Downloading…" : "Download icons"}
      </Btn>
      {error && <p className="text-xs text-signal">{error}</p>}
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-stone-300 p-6 dark:border-stone-800">
      <div className="mb-4 flex items-baseline gap-3">
        <Label>{title}</Label>
        {hint && <span className="text-xs text-stone-500">{hint}</span>}
      </div>
      {children}
    </section>
  );
}
