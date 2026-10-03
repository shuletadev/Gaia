let tokenPromise: Promise<string> | undefined;

async function sessionToken(): Promise<string> {
  tokenPromise ??= fetch("/api/session")
    .then((r) => {
      if (!r.ok) throw new Error(`session ${r.status}`);
      return r.json() as Promise<{ token: string }>;
    })
    .then((b) => b.token)
    .catch((e: unknown) => {
      // Don't cache a failure (e.g. the server was restarting); try again next call.
      tokenPromise = undefined;
      throw e;
    });
  return tokenPromise;
}

/** A failed API call, keeping the status and body (e.g. a 409 asking for confirmation). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> | null,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; retried?: boolean }): Promise<T> {
  const method = init?.method ?? "GET";
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["x-labctl-token"] = await sessionToken();
  const res = await fetch(path, { method, headers, body: init?.body === undefined ? undefined : JSON.stringify(init.body) });
  const body = (await res.json().catch(() => null)) as T & { error?: string };
  // The server issues a new token each launch; a 401 after a restart means ours is stale.
  if (res.status === 401 && method !== "GET" && !init?.retried) {
    tokenPromise = undefined;
    return api<T>(path, { ...init, retried: true });
  }
  if (!res.ok) throw new ApiError(body?.error ?? `${method} ${path} failed (${res.status})`, res.status, body as Record<string, unknown> | null);
  return body;
}
