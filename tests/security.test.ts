import { describe, expect, it } from "vitest";
import { checkRequest } from "../server/security.ts";

const token = "secret-token";
const opts = { apiPort: 4870, token };
const req = (method: string, headers: Record<string, string>) => ({ method, url: "/api/x", headers });

describe("checkRequest", () => {
  it("allows same-origin reads without a token", () => {
    expect(checkRequest(req("GET", { host: "127.0.0.1:4870" }), opts)).toEqual({ ok: true });
    expect(checkRequest(req("GET", { host: "localhost:5173", "sec-fetch-site": "same-origin" }), opts)).toEqual({ ok: true });
  });

  it("blocks DNS-rebinding hosts", () => {
    expect(checkRequest(req("GET", { host: "evil.example:4870" }), opts)).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest(req("GET", {}), opts)).toMatchObject({ ok: false, status: 403 });
  });

  it("blocks cross-site requests", () => {
    expect(checkRequest(req("GET", { host: "127.0.0.1:4870", origin: "https://evil.example" }), opts)).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest(req("GET", { host: "127.0.0.1:4870", "sec-fetch-site": "cross-site" }), opts)).toMatchObject({ ok: false, status: 403 });
  });

  it("requires the session token for mutations", () => {
    const base = { host: "127.0.0.1:4870", origin: "http://127.0.0.1:4870" };
    expect(checkRequest(req("POST", base), opts)).toMatchObject({ ok: false, status: 401 });
    expect(checkRequest(req("DELETE", { ...base, "x-labctl-token": "wrong" }), opts)).toMatchObject({ ok: false, status: 401 });
    expect(checkRequest(req("POST", { ...base, "x-labctl-token": token }), opts)).toEqual({ ok: true });
  });
});
