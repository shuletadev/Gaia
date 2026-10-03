import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api.ts";
import { useStore } from "../store.tsx";
import { Btn, Chip, Label } from "../components/ui.tsx";
import { Modal } from "../components/Modal.tsx";
import { field, IconsPanel, ProtectedGroups, RegionPicker, Section, shortId, SignIn, SubscriptionPicker, tenantLabel, useSubscriptions } from "../components/SetupParts.tsx";
import type { Catalog, Settings as SettingsT, SetupState } from "../types.ts";

/** Everything first-run setup chose, editable later. Changes apply immediately without a restart. */
export function Settings() {
  const { notify, refreshStatus } = useStore();
  const [base, setBase] = useState<SettingsT>();
  const [draft, setDraft] = useState<SettingsT>();
  const [configPath, setConfigPath] = useState("");
  const [tenantName, setTenantName] = useState<string>();
  const [regions, setRegions] = useState<string[]>([]);
  const [state, setState] = useState<SetupState>();
  const [catalog, setCatalog] = useState<Catalog>();
  const [changingSubs, setChangingSubs] = useState(false);
  const [confirm, setConfirm] = useState<{ sensitive: string[]; summary: string[] }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = () =>
    api<{ settings: SettingsT; configPath: string; regions: string[]; tenantName?: string }>("/api/settings")
      .then((r) => {
        setBase(r.settings);
        setDraft(structuredClone(r.settings));
        setConfigPath(r.configPath);
      setTenantName(r.tenantName);
        setRegions(r.regions);
      })
      .catch((e: Error) => setError(e.message));
  const loadState = () => api<SetupState>("/api/setup/state").then(setState).catch(() => undefined);

  useEffect(() => {
    void load();
    void loadState();
    api<Catalog>("/api/blueprints").then(setCatalog).catch(() => undefined);
  }, []);

  const dirty = useMemo(() => Boolean(base && draft && JSON.stringify(base) !== JSON.stringify(draft)), [base, draft]);

  if (!draft || !base) return error ? <p className="text-sm text-signal">{error}</p> : <div className="h-64 animate-pulse rounded-3xl bg-stone-200 dark:bg-stone-900" />;

  const set = (patch: Partial<SettingsT>) => setDraft({ ...draft, ...patch });

  const save = async (confirmed = false) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ summary: string[] }>("/api/settings", { method: "PUT", body: { settings: draft, confirm: confirmed } });
      setConfirm(undefined);
      notify(r.summary.length ? `Saved: ${r.summary.slice(0, 2).join("; ")}${r.summary.length > 2 ? "…" : ""}` : "Nothing changed");
      await load();
      await refreshStatus();
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.body?.needsConfirmation)) {
        setConfirm({ sensitive: e.body.needsConfirmation as string[], summary: (e.body.summary as string[]) ?? [] });
      } else {
        setError((e as Error).message);
        setConfirm(undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 pb-24">
      <Section title="Azure" hint="Gaia acts as your Azure CLI sign-in">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span>
              <span className="text-stone-500">Signed in · </span>
              {state?.az.user ?? "…"}
            </span>
            <span title={draft.tenantId}>
              <span className="text-stone-500">Tenant · </span>
              {tenantName ? <span title={draft.tenantId}>{tenantName}</span> : <span className="font-mono text-xs">{shortId(draft.tenantId)}</span>}
            </span>
          </div>
          {!changingSubs ? (
            <div className="flex flex-wrap items-center gap-2">
              {draft.subscriptions.map((s, i) => (
                <span key={s.id} className="inline-flex items-center gap-2 rounded-full border border-stone-300 px-3 py-1 text-sm dark:border-stone-700" title={s.id}>
                  {s.name}
                  {i === 0 && draft.subscriptions.length > 1 && <Chip tone="calm">default</Chip>}
                </span>
              ))}
              <Btn onClick={() => setChangingSubs(true)}>Change…</Btn>
            </div>
          ) : (
            <SubscriptionEditor
              settings={draft}
              onChange={(tenantId, subs) => set({ tenantId, subscriptions: subs, excludedResourceGroups: tenantId === base.tenantId ? draft.excludedResourceGroups : [] })}
              onDone={() => setChangingSubs(false)}
            />
          )}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Budget">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-stone-500">Monthly budget</span>
              <div className="relative mt-1.5">
                <span className="absolute top-2 left-3 text-sm text-stone-500">$</span>
                <input type="number" min={1} value={draft.budget.monthlyUsd} onChange={(e) => set({ budget: { ...draft.budget, monthlyUsd: Number(e.target.value) } })} className={`${field} pl-7`} />
              </div>
            </label>
            <label className="block">
              <span className="text-xs text-stone-500">Alert at (% of budget)</span>
              <input
                value={draft.budget.alertThresholds.map((t) => Math.round(t * 100)).join(", ")}
                onChange={(e) => {
                  const t = e.target.value
                    .split(/[,\s]+/)
                    .map(Number)
                    .filter((n) => n > 0 && n <= 200)
                    .map((n) => n / 100);
                  set({ budget: { ...draft.budget, alertThresholds: t.length ? t : draft.budget.alertThresholds } });
                }}
                className={`${field} mt-1.5`}
              />
            </label>
            <label className="col-span-2 block">
              <span className="text-xs text-stone-500">Owner tag on labs</span>
              <input value={draft.owner} onChange={(e) => set({ owner: e.target.value })} className={`${field} mt-1.5`} />
            </label>
          </div>
        </Section>

        <Section title="Auto-clean" hint="Destroys labs past their expiry">
          <div className="space-y-4">
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" checked={draft.labs.sweepEnabled} onChange={(e) => set({ labs: { ...draft.labs, sweepEnabled: e.target.checked } })} className="size-4 accent-[#3dd6b0]" />
              Check for expired labs while Gaia is open
            </label>
            <label className="flex items-center gap-3 text-sm">
              Every
              <input type="number" min={5} max={240} value={draft.labs.sweepIntervalMinutes} onChange={(e) => set({ labs: { ...draft.labs, sweepIntervalMinutes: Number(e.target.value) } })} className={`${field} w-20`} disabled={!draft.labs.sweepEnabled} />
              minutes
            </label>
          </div>
        </Section>
      </div>

      <Section title="Lab lifetimes" hint="Hours before a lab expires; blank uses the default">
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <label className="flex items-center gap-3 text-sm sm:col-span-2">
            <span className="w-48 font-medium">Default</span>
            <input type="number" min={1} max={72} value={draft.ttlHours.default} onChange={(e) => set({ ttlHours: { ...draft.ttlHours, default: Number(e.target.value) } })} className={`${field} w-24`} />
            <span className="text-stone-500">h</span>
          </label>
          {catalog?.blueprints
            .filter((b) => !b.custom)
            .map((b) => (
              <label key={b.id} className="flex items-center gap-3 text-sm">
                <span className="w-48 truncate text-stone-500" title={b.title}>
                  {b.title}
                </span>
                <input
                  type="number"
                  min={1}
                  max={72}
                  placeholder={String(draft.ttlHours.default)}
                  value={draft.ttlHours.byBlueprint[b.id] ?? ""}
                  onChange={(e) => {
                    const by = { ...draft.ttlHours.byBlueprint };
                    if (e.target.value) by[b.id] = Number(e.target.value);
                    else delete by[b.id];
                    set({ ttlHours: { ...draft.ttlHours, byBlueprint: by } });
                  }}
                  className={`${field} w-24`}
                />
              </label>
            ))}
        </div>
      </Section>

      <Section title="Regions" hint="Where labs may be launched; ★ default">
        <RegionPicker all={regions} regions={draft.labs.regions} defaultRegion={draft.labs.defaultRegion} onChange={(r, d) => set({ labs: { ...draft.labs, regions: r, defaultRegion: d } })} />
      </Section>

      <Section title="Protected resource groups" hint="Never flagged, parked or deleted">
        <ProtectedGroups tenantId={draft.tenantId} subscriptionIds={draft.subscriptions.map((s) => s.id)} value={draft.excludedResourceGroups} onChange={(g) => set({ excludedResourceGroups: g })} />
      </Section>

      <Section title="Azure icons">{state && <IconsPanel installed={state.icons.installed} terms={state.icons.terms} onInstalled={() => void loadState()} />}</Section>

      <p className="font-mono text-[10px] text-stone-500">Saved to {configPath}</p>

      {(dirty || error) && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-300 bg-stone-100/90 backdrop-blur lg:left-[5.5rem] dark:border-stone-800 dark:bg-[#0c0d10]/90">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3 lg:px-12">
            {error ? <span className="min-w-0 flex-1 truncate text-sm text-signal">{error}</span> : <span className="flex-1 text-sm text-stone-500">Unsaved changes</span>}
            <Btn
              onClick={() => {
                setDraft(structuredClone(base));
                setError(undefined);
                setChangingSubs(false);
              }}
            >
              Discard
            </Btn>
            <Btn tone="solid" disabled={busy || !dirty} onClick={() => save(false)}>
              {busy ? "Saving…" : "Save"}
            </Btn>
          </div>
        </div>
      )}

      {confirm && (
        <Modal title="Confirm changes" tone="danger" onClose={() => setConfirm(undefined)}>
          <p className="text-sm">These changes widen what Gaia may touch or remove a safety net:</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {confirm.sensitive.map((s) => (
              <li key={s} className="flex gap-2">
                <span className="text-signal">!</span>
                {s}
              </li>
            ))}
          </ul>
          {confirm.summary.length > confirm.sensitive.length && (
            <details className="mt-3 text-xs text-stone-500">
              <summary className="cursor-pointer select-none">All changes</summary>
              <ul className="mt-1 list-disc pl-5">
                {confirm.summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Btn onClick={() => setConfirm(undefined)}>Cancel</Btn>
            <Btn tone="danger" disabled={busy} onClick={() => save(true)}>
              Apply
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SubscriptionEditor({ settings, onChange, onDone }: { settings: SettingsT; onChange: (tenantId: string, subs: { id: string; name: string }[]) => void; onDone: () => void }) {
  const subs = useSubscriptions();
  const [state, setState] = useState<SetupState>();
  useEffect(() => {
    api<SetupState>("/api/setup/state").then(setState).catch(() => undefined);
  }, []);
  const tenant = subs.data?.tenants.find((t) => t.tenantId === settings.tenantId.toLowerCase());
  return (
    <div className="space-y-4 rounded-2xl border border-stone-300 p-4 dark:border-stone-800">
      <div className="flex items-center gap-2 text-sm">
        <Label>Subscriptions</Label>
        {tenant && <span className="text-xs text-stone-500">in {tenantLabel(tenant)}</span>}
        <Btn className="ml-auto" onClick={onDone}>
          Done
        </Btn>
      </div>
      {subs.error && <p className="text-sm text-signal">{subs.error}</p>}
      {!subs.data ? (
        <div className="h-32 animate-pulse rounded-xl bg-stone-200 dark:bg-stone-900" />
      ) : (
        <SubscriptionPicker
          data={subs.data}
          tenantId={settings.tenantId.toLowerCase()}
          selected={settings.subscriptions.map((s) => s.id)}
          onChange={(t, ids) =>
            onChange(
              t,
              ids.map((id) => ({ id, name: subs.data!.subscriptions.find((s) => s.id === id)?.name ?? id })),
            )
          }
        />
      )}
      <details className="text-xs text-stone-500">
        <summary className="cursor-pointer select-none">Subscription in another tenant?</summary>
        <div className="mt-3">
          <SignIn az={state?.az} compact onSignedIn={() => subs.reload()} />
        </div>
      </details>
    </div>
  );
}
