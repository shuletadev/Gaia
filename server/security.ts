import { randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_HEADER = "x-labctl-token";
export const DEV_WEB_PORT = 5173;

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function allowedHosts(apiPort: number): Set<string> {
  const hosts = new Set<string>();
  for (const port of [apiPort, DEV_WEB_PORT]) {
    hosts.add(`127.0.0.1:${port}`);
    hosts.add(`localhost:${port}`);
  }
  return hosts;
}

export interface RequestShape {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
}

export type SecurityVerdict = { ok: true } | { ok: false; status: 401 | 403; reason: string };

const header = (req: RequestShape, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Protects the local API from DNS rebinding (Host check), cross-site requests (Origin and
 * Sec-Fetch-Site checks) and drive-by state changes (per-launch token on every mutating call).
 */
export function checkRequest(req: RequestShape, opts: { apiPort: number; token: string }): SecurityVerdict {
  const hosts = allowedHosts(opts.apiPort);
  const host = header(req, "host")?.toLowerCase();
  if (!host || !hosts.has(host)) return { ok: false, status: 403, reason: "host not allowed" };

  const origin = header(req, "origin")?.toLowerCase();
  if (origin && !hosts.has(origin.replace(/^http:\/\//, ""))) return { ok: false, status: 403, reason: "origin not allowed" };

  const site = header(req, "sec-fetch-site")?.toLowerCase();
  if (site && site !== "same-origin" && site !== "none") return { ok: false, status: 403, reason: "cross-site request" };

  const method = req.method.toUpperCase();
  const safe = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (!safe) {
    const supplied = header(req, TOKEN_HEADER);
    if (!supplied || !tokensMatch(supplied, opts.token)) return { ok: false, status: 401, reason: "missing or invalid session token" };
  }
  return { ok: true };
}
