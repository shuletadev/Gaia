import { AzureCliCredential, type AccessToken } from "@azure/identity";

const ARM = "https://management.azure.com";
const ARM_SCOPE = `${ARM}/.default`;

export class ArmError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface ArmClientOptions {
  /** Tenant to request tokens for; omitted = the Azure CLI's default tenant (used during first-run setup). */
  tenantId?: string;
  maxRetries?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  getToken?: () => Promise<string>;
}

/** Path without host, query string or opaque tokens, for readable error messages. */
export function shortPath(path: string): string {
  const p = path.replace(/^https?:\/\/[^/]+/, "").split("?")[0]!;
  return p
    .split("/")
    .map((seg) => (seg.length > 48 ? `${seg.slice(0, 12)}…` : seg))
    .join("/");
}

/** Reads every *retry-after header (ARM and Cost Management use several) and returns the longest wait in ms. */
export function retryAfterMs(headers: Headers, attempt: number): number {
  let seconds = 0;
  headers.forEach((value, name) => {
    if (name.toLowerCase().endsWith("retry-after")) {
      const n = Number(value);
      if (Number.isFinite(n)) seconds = Math.max(seconds, n);
    }
  });
  const backoff = Math.min(2 ** attempt * 1000, 30_000);
  return Math.max(seconds * 1000, backoff);
}

export class ArmClient {
  private credential: AzureCliCredential;
  private token?: AccessToken;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly getTokenOverride?: () => Promise<string>;

  constructor(readonly options: ArmClientOptions) {
    this.credential = new AzureCliCredential(options.tenantId ? { tenantId: options.tenantId } : {});
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = options.maxRetries ?? 4;
    this.getTokenOverride = options.getToken;
  }

  get tenantId(): string | undefined {
    return this.options.tenantId;
  }

  /** Points every later request at another tenant (settings change); the cached token is dropped. */
  setTenant(tenantId: string | undefined) {
    if (tenantId === this.options.tenantId) return;
    this.options.tenantId = tenantId;
    this.credential = new AzureCliCredential(tenantId ? { tenantId } : {});
    this.token = undefined;
  }

  private async accessToken(): Promise<string> {
    if (this.getTokenOverride) return this.getTokenOverride();
    if (!this.token || this.token.expiresOnTimestamp - Date.now() < 5 * 60_000) {
      this.token = await this.credential.getToken(ARM_SCOPE);
    }
    return this.token.token;
  }

  /** Sends a request with throttling/5xx retries; throws ArmError for non-success responses. */
  async raw(method: string, path: string, body?: unknown): Promise<RawResponse> {
    const url = path.startsWith("http") ? path : `${ARM}${path}`;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${await this.accessToken()}`,
            "content-type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        // Dropped connections and DNS hiccups ("fetch failed") are as transient as a 503.
        if (e instanceof TypeError && attempt < this.maxRetries) {
          await this.sleep(Math.min(2 ** attempt * 1000, 30_000));
          continue;
        }
        throw e;
      }
      if (res.ok) {
        const text = await res.text();
        return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined };
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        await this.sleep(retryAfterMs(res.headers, attempt));
        continue;
      }
      let code: string | undefined;
      let message = `${method} ${shortPath(path)} failed with ${res.status}`;
      try {
        const err = (await res.json()) as { error?: { code?: string; message?: string } };
        code = err.error?.code;
        if (err.error?.message) message = `${message}: ${err.error.message}`;
      } catch {
        /* non-JSON error body */
      }
      throw new ArmError(message, res.status, code);
    }
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await this.raw(method, path, body)).body as T;
  }

  get<T>(path: string) {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body: unknown) {
    return this.request<T>("POST", path, body);
  }

  /**
   * Runs a long-running ARM operation to completion, following Azure-AsyncOperation or Location polling.
   * For PUT/PATCH the final resource is re-read once the operation succeeds.
   */
  async lro<T>(method: string, path: string, body?: unknown, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<T | undefined> {
    const deadline = Date.now() + (opts.timeoutMs ?? 60 * 60_000);
    const pollMs = opts.pollMs ?? 5000;
    const first = await this.raw(method, path, body);
    const asyncUrl = first.headers.get("azure-asyncoperation");
    const location = first.headers.get("location");
    const wait = (h: Headers) => this.sleep(Math.max(Number(h.get("retry-after") ?? 0) * 1000, pollMs));

    if (asyncUrl) {
      let headers = first.headers;
      for (;;) {
        if (Date.now() > deadline) throw new ArmError(`${method} ${path} timed out`, 408, "Timeout");
        await wait(headers);
        const poll = await this.raw("GET", asyncUrl);
        headers = poll.headers;
        const op = (poll.body ?? {}) as { status?: string; error?: { code?: string; message?: string } };
        const status = (op.status ?? "").toLowerCase();
        if (status === "succeeded") break;
        if (status === "failed" || status === "canceled" || status === "cancelled") {
          throw new ArmError(`${method} ${path} ${status}: ${op.error?.message ?? "no details"}`, 409, op.error?.code ?? status);
        }
      }
      if (method === "PUT" || method === "PATCH") return this.get<T>(path);
      return undefined;
    }

    if (location && first.status === 202) {
      let headers = first.headers;
      for (;;) {
        if (Date.now() > deadline) throw new ArmError(`${method} ${path} timed out`, 408, "Timeout");
        await wait(headers);
        const poll = await this.raw("GET", location);
        if (poll.status !== 202) return poll.body as T;
        headers = poll.headers;
      }
    }

    return first.body as T;
  }
}

export interface RawResponse {
  status: number;
  headers: Headers;
  body: unknown;
}
