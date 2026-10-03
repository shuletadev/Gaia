import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api.ts";
import type { Job, Snapshot, Status } from "./types.ts";

interface Store {
  status?: Status;
  /** The subscription the screens show and new labs deploy into. */
  subscriptionId?: string;
  setSubscriptionId: (id: string) => void;
  /** Re-reads /api/status (after setup or a settings change). */
  refreshStatus: () => Promise<void>;
  snapshot?: Snapshot;
  loading: boolean;
  error?: string;
  reload: (refresh?: boolean) => Promise<void>;
  jobs: Job[];
  trackJobs: (jobs: Job[]) => void;
  notice?: { text: string; tone: "ok" | "bad" };
  notify: (text: string, tone?: "ok" | "bad") => void;
}

const Ctx = createContext<Store | null>(null);
const SUB_KEY = "gaia-subscription";

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notice, setNotice] = useState<Store["notice"]>();
  const [chosen, setChosen] = useState<string | null>(() => localStorage.getItem(SUB_KEY));
  const configured = status?.configured ?? false;
  const subscriptionId = configured ? (status!.subscriptions.find((s) => s.id === chosen)?.id ?? status!.subscriptions[0]?.id) : undefined;
  const setSubscriptionId = useCallback((id: string) => {
    localStorage.setItem(SUB_KEY, id);
    setChosen(id);
    setSnapshot(undefined);
  }, []);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const notify = useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    setNotice({ text, tone });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(undefined), 5000);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api<Status>("/api/status"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const reload = useCallback(
    async (refresh = false) => {
      if (!subscriptionId) return;
      setLoading(true);
      setError(undefined);
      try {
        setSnapshot(await api<Snapshot>(`/api/snapshot?subscriptionId=${subscriptionId}${refresh ? "&refresh=1" : ""}`));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [subscriptionId],
  );

  useEffect(() => {
    void reload(false);
  }, [reload]);

  // Poll jobs quickly while any are running; reload the snapshot whenever one finishes.
  const running = jobs.some((j) => j.status === "running");
  const prevRunning = useRef(new Set<string>());
  useEffect(() => {
    if (!configured) return;
    let alive = true;
    const tick = async () => {
      try {
        const list = await api<Job[]>("/api/jobs");
        if (!alive) return;
        const nowRunning = new Set(list.filter((j) => j.status === "running").map((j) => j.id));
        const finished = list.filter((j) => prevRunning.current.has(j.id) && !nowRunning.has(j.id));
        prevRunning.current = nowRunning;
        setJobs(list);
        if (finished.length) {
          const failed = finished.filter((j) => j.status !== "succeeded");
          notify(
            failed.length ? `${failed[0]!.target_name}: ${failed[0]!.error ?? failed[0]!.status}` : `${finished.map((j) => j.target_name).join(", ")} done`,
            failed.length ? "bad" : "ok",
          );
          void reload(false);
        }
      } catch {
        /* server restarting; try again next tick */
      }
    };
    void tick();
    const t = setInterval(tick, running ? 3000 : 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [running, reload, notify, configured]);

  const trackJobs = useCallback((started: Job[]) => {
    for (const j of started) prevRunning.current.add(j.id);
    setJobs((cur) => [...started, ...cur.filter((c) => !started.some((s) => s.id === c.id))]);
  }, []);

  return (
    <Ctx.Provider value={{ status, subscriptionId, setSubscriptionId, refreshStatus, snapshot, loading, error, reload, jobs, trackJobs, notice, notify }}>
      {children}
    </Ctx.Provider>
  );
}
