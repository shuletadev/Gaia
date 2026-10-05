import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "./store.tsx";
import { ActionsProvider } from "./components/actions.tsx";
import { IconFlask, IconGauge, IconGear, IconMoon, IconRefresh, IconStack, IconSun, IconUsers } from "./components/Icons.tsx";
import { useTheme } from "./theme.ts";
import { Overview } from "./screens/Overview.tsx";
import { Inventory } from "./screens/Inventory.tsx";
import { Hunt } from "./screens/Hunt.tsx";
import { Log } from "./screens/Log.tsx";
import { Catalog } from "./screens/Catalog.tsx";
import { Labs } from "./screens/Labs.tsx";
import { Students } from "./screens/Students.tsx";
import { Settings } from "./screens/Settings.tsx";
import { Setup } from "./screens/Setup.tsx";
import { relTime } from "./format.ts";

/** Every page keeps its own id and hash (#catalog, #hunt...), so links and go() calls are unchanged. */
type Screen = "overview" | "labs" | "catalog" | "students" | "inventory" | "hunt" | "log" | "settings";

/** The nav shows five sections; sections with several pages show them as tabs under the title. */
const SECTIONS: { id: string; label: string; Icon: typeof IconGauge; pages: { id: Screen; label: string }[] }[] = [
  { id: "overview", label: "Overview", Icon: IconGauge, pages: [{ id: "overview", label: "Overview" }] },
  {
    id: "labs",
    label: "Labs",
    Icon: IconFlask,
    pages: [
      { id: "labs", label: "Running" },
      { id: "catalog", label: "Catalog" },
    ],
  },
  { id: "students", label: "Students", Icon: IconUsers, pages: [{ id: "students", label: "Sandboxes" }] },
  {
    id: "resources",
    label: "Resources",
    Icon: IconStack,
    pages: [
      { id: "inventory", label: "Inventory" },
      { id: "hunt", label: "Orphan hunt" },
      { id: "log", label: "Log" },
    ],
  },
  { id: "settings", label: "Settings", Icon: IconGear, pages: [{ id: "settings", label: "Settings" }] },
];

const PAGES = SECTIONS.flatMap((s) => s.pages.map((p) => p.id));

function useHashScreen(): [Screen, (s: Screen) => void] {
  const read = () => (PAGES.some((id) => `#${id}` === location.hash) ? (location.hash.slice(1) as Screen) : "overview");
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
  // Clicking a section returns to the page you last had open in it.
  const [lastPage, setLastPage] = useState<Record<string, Screen>>({});
  const section = SECTIONS.find((s) => s.pages.some((p) => p.id === screen)) ?? SECTIONS[0]!;
  useEffect(() => setLastPage((m) => (m[section.id] === screen ? m : { ...m, [section.id]: screen })), [screen, section.id]);
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
        {SECTIONS.map(({ id, label, Icon, pages }) => {
          const here = section.id === id;
          return (
            <button
              key={id}
              onClick={() => go(lastPage[id] ?? pages[0]!.id)}
              className={`group relative flex items-center gap-2 rounded-xl px-3 py-2 text-xs transition lg:flex-col lg:gap-1 lg:px-2 ${here ? "text-stone-900 dark:text-white" : "text-stone-500 hover:text-stone-900 dark:hover:text-white"}`}
              aria-current={here ? "page" : undefined}
              aria-label={label}
            >
              <span className={`absolute left-0 hidden h-6 w-0.5 rounded-full bg-signal transition lg:block ${here ? "opacity-100" : "opacity-0"}`} />
              <Icon />
              {/* On a phone only the open section shows its name, so five entries fit. */}
              <span className={`${here ? "" : "max-sm:hidden"} lg:block lg:font-mono lg:text-[9px] lg:uppercase lg:tracking-widest`}>{label}</span>
              {id === "resources" && findings > 0 && <span className="absolute top-1 right-1 rounded-full bg-signal px-1 text-[9px] font-bold text-black">{findings}</span>}
            </button>
          );
        })}
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
        <header className={`flex flex-wrap items-center gap-4 ${section.pages.length > 1 ? "mb-6" : "mb-10"}`}>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{section.label}</h1>
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

        {section.pages.length > 1 && (
          <nav aria-label={`${section.label} pages`} className="mb-8 flex flex-wrap gap-1.5">
            {section.pages.map((p) => (
              <button
                key={p.id}
                onClick={() => go(p.id)}
                aria-current={screen === p.id ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${screen === p.id ? "border-signal bg-signal/10 text-stone-900 dark:text-white" : "border-stone-300 text-stone-500 hover:border-stone-400 dark:border-stone-700"}`}
              >
                {p.label}
                {p.id === "hunt" && findings > 0 && <span className="rounded-full bg-signal px-1 text-[9px] font-bold text-black">{findings}</span>}
              </button>
            ))}
          </nav>
        )}

        {error && <p className="mb-6 rounded-xl bg-signal/15 px-4 py-3 text-sm text-signal">{error}</p>}

        {screen === "overview" && <Overview go={go} />}
        {screen === "inventory" && <Inventory />}
        {screen === "hunt" && <Hunt />}
        {screen === "log" && <Log />}
        {screen === "labs" && <Labs go={go} />}
        {screen === "students" && <Students />}
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
