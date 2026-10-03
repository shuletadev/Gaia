import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "./store.tsx";
import { ActionsProvider } from "./components/actions.tsx";
import { IconCrosshair, IconFlask, IconGauge, IconGear, IconGrid, IconList, IconMoon, IconRefresh, IconStack, IconSun } from "./components/Icons.tsx";
import { useTheme } from "./theme.ts";
import { Overview } from "./screens/Overview.tsx";
import { Inventory } from "./screens/Inventory.tsx";
import { Hunt } from "./screens/Hunt.tsx";
import { Log } from "./screens/Log.tsx";
import { Catalog } from "./screens/Catalog.tsx";
import { Labs } from "./screens/Labs.tsx";
import { Settings } from "./screens/Settings.tsx";
import { Setup } from "./screens/Setup.tsx";
import { relTime } from "./format.ts";

type Screen = "overview" | "labs" | "catalog" | "inventory" | "hunt" | "log" | "settings";

const NAV: { id: Screen; label: string; Icon: typeof IconGauge }[] = [
  { id: "overview", label: "Overview", Icon: IconGauge },
  { id: "labs", label: "Labs", Icon: IconFlask },
  { id: "catalog", label: "Catalog", Icon: IconGrid },
  { id: "inventory", label: "Inventory", Icon: IconStack },
  { id: "hunt", label: "Hunt", Icon: IconCrosshair },
  { id: "log", label: "Log", Icon: IconList },
  { id: "settings", label: "Settings", Icon: IconGear },
];

function useHashScreen(): [Screen, (s: Screen) => void] {
  const read = () => (NAV.some((n) => `#${n.id}` === location.hash) ? (location.hash.slice(1) as Screen) : "overview");
  const [screen, setScreen] = useState<Screen>(read);
  useEffect(() => {
    const on = () => setScreen(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return [screen, (s) => (location.hash = s)];
}

function Shell() {
  const { status, snapshot, loading, error, reload, jobs, notice, subscriptionId, setSubscriptionId } = useStore();
  const [screen, go] = useHashScreen();
  const [theme, toggleTheme] = useTheme();
  const running = jobs.filter((j) => j.status === "running");
  const findings = snapshot?.findings.filter((f) => f.severity !== "info").length ?? 0;

  if (!status) return <div className="grain min-h-screen" />;
  // First run: nothing works until Gaia knows which tenant and subscription to use.
  if (!status.configured) return <Setup
        onDone={() => {
          location.hash = "overview";
          location.reload();
        }}
      />;
  const current = status.subscriptions.find((s) => s.id === subscriptionId);

  return (
    <div className="grain min-h-screen lg:grid lg:grid-cols-[5.5rem_1fr]">
      <nav className="sticky top-0 z-20 flex items-center gap-1 border-b border-stone-300/60 bg-stone-100/80 px-4 py-3 backdrop-blur lg:h-screen lg:flex-col lg:border-r lg:border-b-0 lg:bg-transparent lg:px-0 lg:py-8 dark:border-stone-800 dark:bg-[#0c0d10]/80">
        <div className="mr-4 flex items-center gap-2 lg:mr-0 lg:mb-10 lg:flex-col lg:gap-3" title="Project Gaia">
          <img src="/gaia.svg" alt="" className="size-8 rounded-[9px] lg:size-10 lg:rounded-xl" />
          <span className="font-mono text-[10px] tracking-[0.35em] text-signal lg:[writing-mode:vertical-rl] lg:rotate-180">GAIA</span>
        </div>
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => go(id)}
            className={`group relative flex items-center gap-2 rounded-xl px-3 py-2 text-xs transition lg:flex-col lg:gap-1 lg:px-2 ${screen === id ? "text-stone-900 dark:text-white" : "text-stone-500 hover:text-stone-900 dark:hover:text-white"}`}
            aria-current={screen === id ? "page" : undefined}
          >
            <span className={`absolute left-0 hidden h-6 w-0.5 rounded-full bg-signal transition lg:block ${screen === id ? "opacity-100" : "opacity-0"}`} />
            <Icon />
            <span className="lg:font-mono lg:text-[9px] lg:uppercase lg:tracking-widest">{label}</span>
            {id === "hunt" && findings > 0 && <span className="absolute top-1 right-1 rounded-full bg-signal px-1 text-[9px] font-bold text-black">{findings}</span>}
          </button>
        ))}
        <button
          onClick={toggleTheme}
          className="ml-auto rounded-xl p-2 text-stone-500 transition hover:text-stone-900 lg:mt-auto lg:ml-0 dark:hover:text-white"
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <IconSun /> : <IconMoon />}
        </button>
      </nav>

      <div className="mx-auto w-full max-w-6xl px-6 py-8 lg:px-12">
        <header className="mb-10 flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight capitalize">{screen === "hunt" ? "Orphan hunt" : screen === "catalog" ? "Lab catalog" : screen}</h1>
            <div className="mt-1 flex items-center gap-2 text-xs text-stone-500">
              <span className={`size-1.5 rounded-full ${status?.identity.ok ? "bg-calm" : "bg-signal"}`} title={status?.identity.error} />
              {status.subscriptions.length > 1 ? (
                <select
                  value={subscriptionId}
                  onChange={(e) => setSubscriptionId(e.target.value)}
                  aria-label="Subscription"
                  className="-ml-1 cursor-pointer rounded-md bg-transparent px-1 py-0.5 text-xs outline-none hover:bg-stone-200 focus:ring-1 focus:ring-signal dark:hover:bg-stone-800 dark:[&>option]:bg-[#15161a]"
                >
                  {status.subscriptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                (snapshot?.subscription.name ?? current?.name ?? "…")
              )}
              {snapshot?.costFetchedAt && <span>· costs {relTime(new Date(snapshot.costFetchedAt).toISOString())}</span>}
            </div>
          </div>
          <button
            onClick={() => reload(true)}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-2 rounded-full border border-stone-300 px-4 py-2 text-xs transition hover:border-signal hover:text-signal disabled:opacity-50 dark:border-stone-700"
            title="Re-scan resources and refresh cost data"
          >
            <IconRefresh width={14} height={14} className={loading ? "animate-spin" : ""} />
            {loading ? "Scanning" : "Rescan"}
          </button>
        </header>

        {error && <p className="mb-6 rounded-xl bg-signal/15 px-4 py-3 text-sm text-signal">{error}</p>}

        {screen === "overview" && <Overview go={go} />}
        {screen === "inventory" && <Inventory />}
        {screen === "hunt" && <Hunt />}
        {screen === "log" && <Log />}
        {screen === "labs" && <Labs go={go} />}
        {screen === "catalog" && <Catalog onLaunched={() => go("labs")} />}
        {screen === "settings" && <Settings />}
      </div>

      <div className="fixed right-6 bottom-6 z-30 flex w-80 flex-col gap-2">
        {running.map((j) => (
          <div key={j.id} className="flex items-center gap-3 rounded-2xl border border-stone-300 bg-stone-50/95 px-4 py-3 text-sm shadow-lg backdrop-blur dark:border-stone-800 dark:bg-[#15161a]/95">
            <span className="size-3 animate-spin rounded-full border-2 border-signal border-t-transparent" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-mono text-[10px] uppercase tracking-widest text-stone-500">{j.kind.replace("power.", "")}</span> {j.target_name}
            </span>
            <span className="font-mono text-[10px] text-stone-500">{relTime(j.started_at).replace(" ago", "")}</span>
          </div>
        ))}
        {notice && (
          <div role="status" className={`rounded-2xl px-4 py-3 text-sm shadow-lg ${notice.tone === "bad" ? "bg-signal text-black" : "bg-stone-900 text-white dark:bg-white dark:text-black"}`}>
            {notice.text}
          </div>
        )}
      </div>
    </div>
  );
}

export function App() {
  return (
    <StoreProvider>
      <ActionsProvider>
        <Shell />
      </ActionsProvider>
    </StoreProvider>
  );
}
