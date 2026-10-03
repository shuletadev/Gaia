import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Btn, Label } from "../components/ui.tsx";
import { IconCheck } from "../components/Icons.tsx";
import { field, IconsPanel, ProtectedGroups, RegionPicker, runJob, SignIn, SubscriptionPicker, tenantLabel, useSubscriptions } from "../components/SetupParts.tsx";
import { usd } from "../format.ts";
import type { Settings, SetupState } from "../types.ts";

const STEPS = ["Sign in", "Subscription", "Guardrails", "Icons", "Review"] as const;

/** First run: connect Gaia to the user's own Azure tenant and subscription, then set the guardrails. */
export function Setup({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<SetupState>();
  const subs = useSubscriptions();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Settings>();
  const [ids, setIds] = useState<string[]>([]);
  const [tenantId, setTenantId] = useState<string>();
  const [signInTenant, setSignInTenant] = useState<string>();
  const [groupsKey, setGroupsKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const loadState = () =>
    api<SetupState>("/api/setup/state")
      .then((s) => {
        setState(s);
        setDraft((d) => d ?? { ...s.defaults, owner: s.az.user ?? "" });
        setTenantId((t) => t ?? s.az.defaultTenantId?.toLowerCase());
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void loadState();
  }, []);

  if (!state || !draft) {
    return (
      <Frame step={0}>
        <div className="h-40 animate-pulse rounded-3xl bg-stone-200 dark:bg-stone-900" />
        {error && <p className="mt-4 text-sm text-signal">{error}</p>}
      </Frame>
    );
  }

  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });
  const chosen = ids.map((id) => subs.data?.subscriptions.find((s) => s.id === id)).filter(Boolean) as NonNullable<typeof subs.data>["subscriptions"];
  const tenant = subs.data?.tenants.find((t) => t.tenantId === tenantId);
  const finalSettings: Settings = { ...draft, tenantId: tenantId ?? "", subscriptions: chosen.map((s) => ({ id: s.id, name: s.name })) };
  const canNext = [state.az.signedIn, ids.length > 0, Boolean(draft.owner.trim()) && draft.budget.monthlyUsd > 0 && draft.labs.regions.length > 0, true, true][step];

  const finish = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api("/api/setup", { method: "POST", body: finalSettings });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Frame step={step}>
      {step === 0 && (
        <Panel title="Sign in to Azure" lead="Gaia runs on your machine and acts as you, through the Azure CLI. Nothing is stored except the choices you make here.">
          <SignIn
            az={state.az}
            onSignedIn={() => {
              void loadState();
              subs.reload();
            }}
          />
        </Panel>
      )}

      {step === 1 && (
        <Panel title="Choose your lab subscription" lead="Use a sandbox subscription you own. Gaia only ever reads or changes the subscriptions you pick here; the first is the default for new labs.">
          {subs.error && <p className="mb-3 text-sm text-signal">{subs.error}</p>}
          {!subs.data ? (
            <div className="h-40 animate-pulse rounded-2xl bg-stone-200 dark:bg-stone-900" />
          ) : (
            <SubscriptionPicker
              data={subs.data}
              tenantId={tenantId}
              selected={ids}
              onChange={(t, next) => {
                setTenantId(t.toLowerCase());
                setIds(next);
              }}
            />
          )}
          <details className="mt-4 text-xs text-stone-500">
            <summary className="cursor-pointer select-none">Subscription in another tenant?</summary>
            <div className="mt-3">
              <SignIn az={state.az} compact onSignedIn={() => subs.reload()} />
            </div>
          </details>
        </Panel>
      )}

      {step === 2 && (
        <Panel title="Guardrails" lead="Defaults that keep labs cheap and stop Gaia from touching what matters. All of it can be changed later in Settings.">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block sm:col-span-1">
              <Label>Monthly budget</Label>
              <div className="relative mt-1.5">
                <span className="absolute top-2 left-3 text-sm text-stone-500">$</span>
                <input type="number" min={1} value={draft.budget.monthlyUsd} onChange={(e) => set({ budget: { ...draft.budget, monthlyUsd: Number(e.target.value) } })} className={`${field} pl-7`} />
              </div>
            </label>
            <label className="block">
              <Label>Default lab lifetime</Label>
              <div className="relative mt-1.5">
                <input type="number" min={1} max={72} value={draft.ttlHours.default} onChange={(e) => set({ ttlHours: { ...draft.ttlHours, default: Number(e.target.value) } })} className={`${field} pr-10`} />
                <span className="absolute top-2 right-3 text-sm text-stone-500">h</span>
              </div>
            </label>
            <label className="block">
              <Label>Owner tag</Label>
              <input value={draft.owner} onChange={(e) => set({ owner: e.target.value })} className={`${field} mt-1.5`} placeholder="you@company.com" />
            </label>
          </div>
          <div className="mt-6">
            <Label>Lab regions</Label>
            <div className="mt-2">
              <RegionPicker all={state.regions} regions={draft.labs.regions} defaultRegion={draft.labs.defaultRegion} onChange={(regions, defaultRegion) => set({ labs: { ...draft.labs, regions, defaultRegion } })} />
            </div>
          </div>
          <div className="mt-6">
            <Label>Protected resource groups</Label>
            <p className="mt-1 mb-2 text-xs text-stone-500">Never flagged, parked or deleted. Suggestions come from your subscription.</p>
            {tenantId && (
              <ProtectedGroups
                key={groupsKey}
                tenantId={tenantId}
                subscriptionIds={ids}
                value={draft.excludedResourceGroups}
                onChange={(g) => set({ excludedResourceGroups: g })}
                preselect
                onSignInNeeded={setSignInTenant}
              />
            )}
            {signInTenant && (
              <div className="mt-3 rounded-2xl border border-amber-400/40 p-3">
                <p className="mb-2 text-xs">Your Azure CLI needs a sign-in for this tenant before Gaia can read it.</p>
                <Btn
                  tone="solid"
                  onClick={async () => {
                    try {
                      setBusy(true);
                      await runJob("/api/setup/login", { tenant: signInTenant });
                      setSignInTenant(undefined);
                      setGroupsKey((k) => k + 1);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                >
                  {busy ? "Waiting for browser…" : "Sign in to this tenant"}
                </Btn>
              </div>
            )}
          </div>
        </Panel>
      )}

      {step === 3 && (
        <Panel title="Azure icons" lead="Optional. Without them Gaia shows simple monograms instead.">
          <IconsPanel installed={state.icons.installed} terms={state.icons.terms} onInstalled={() => void loadState()} />
        </Panel>
      )}

      {step === 4 && (
        <Panel title="Ready" lead="Gaia saves these choices on this machine only.">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
            <Row k="Signed in as" v={state.az.user ?? "—"} />
            <Row k="Tenant" v={tenant ? `${tenantLabel(tenant)}` : (tenantId ?? "—")} />
            <Row k="Subscriptions" v={chosen.map((s, i) => `${s.name}${i === 0 && chosen.length > 1 ? " (default)" : ""}`).join(", ")} />
            <Row k="Budget" v={`${usd(draft.budget.monthlyUsd)} / month`} />
            <Row k="Lab lifetime" v={`${draft.ttlHours.default} h by default · auto-clean every ${draft.labs.sweepIntervalMinutes} min`} />
            <Row k="Regions" v={`${draft.labs.regions.join(", ")} (default ${draft.labs.defaultRegion})`} />
            <Row k="Protected groups" v={draft.excludedResourceGroups.join(", ") || "none"} />
          </dl>
        </Panel>
      )}

      {error && <p className="mt-4 rounded-xl bg-signal/10 p-3 text-sm text-signal">{error}</p>}

      <div className="mt-8 flex items-center gap-2">
        {step > 0 && <Btn onClick={() => setStep(step - 1)}>Back</Btn>}
        <span className="ml-auto" />
        {step === 3 && !state.icons.installed && <Btn onClick={() => setStep(4)}>Skip</Btn>}
        {step < 4 ? (
          <Btn tone="solid" disabled={!canNext} onClick={() => setStep(step + 1)}>
            Continue
          </Btn>
        ) : (
          <Btn tone="solid" disabled={busy} onClick={finish}>
            {busy ? "Saving…" : "Start Gaia"}
          </Btn>
        )}
      </div>
    </Frame>
  );
}

function Frame({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <div className="grain min-h-screen">
      <div className="mx-auto grid min-h-screen w-full max-w-5xl gap-12 px-6 py-12 lg:grid-cols-[15rem_1fr] lg:py-20">
        <aside>
          <div className="flex items-center gap-3">
            <img src="/gaia.svg" alt="" className="size-12 rounded-2xl" />
            <div>
              <div className="text-xl font-semibold tracking-tight">Project Gaia</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-stone-500">first run</div>
            </div>
          </div>
          <ol className="mt-12 hidden space-y-1 lg:block">
            {STEPS.map((s, i) => (
              <li key={s} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${i === step ? "bg-stone-200/70 text-stone-900 dark:bg-stone-900 dark:text-white" : i < step ? "text-stone-500" : "text-stone-400 dark:text-stone-600"}`}>
                <span className={`grid size-6 place-items-center rounded-full font-mono text-[10px] ${i < step ? "bg-calm text-black" : i === step ? "bg-signal text-black" : "ring-1 ring-stone-300 dark:ring-stone-700"}`}>
                  {i < step ? <IconCheck width={12} height={12} /> : i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

function Panel({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 mb-8 max-w-xl text-sm text-stone-500">{lead}</p>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="font-mono text-[10px] uppercase tracking-widest text-stone-500 sm:pt-0.5">{k}</dt>
      <dd className="min-w-0 break-words">{v}</dd>
    </>
  );
}
