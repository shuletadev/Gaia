import { describe, expect, it } from "vitest";
import { ArmClient, ArmError, retryAfterMs } from "../server/azure/arm.ts";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("retryAfterMs", () => {
  it("uses the longest retry-after header, including Cost Management variants", () => {
    const h = new Headers({ "retry-after": "2", "x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after": "9" });
    expect(retryAfterMs(h, 0)).toBe(9000);
  });
  it("falls back to exponential backoff", () => {
    expect(retryAfterMs(new Headers(), 2)).toBe(4000);
  });
});

describe("ArmClient", () => {
  it("retries 429 then succeeds", async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    const responses = [json(429, {}, { "retry-after": "3" }), json(200, { ok: 1 })];
    const client = new ArmClient({
      tenantId: "t",
      getToken: async () => "tok",
      sleep: async (ms) => void sleeps.push(ms),
      fetchImpl: (async (url: string) => {
        calls.push(url);
        return responses.shift()!;
      }) as unknown as typeof fetch,
    });
    await expect(client.get("/x")).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([3000]);
  });

  it("surfaces ARM error codes without retrying 4xx", async () => {
    let n = 0;
    const client = new ArmClient({
      tenantId: "t",
      getToken: async () => "tok",
      fetchImpl: (async () => {
        n++;
        return json(403, { error: { code: "AuthorizationFailed", message: "nope" } });
      }) as unknown as typeof fetch,
    });
    const err = await client.get("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArmError);
    expect(err).toMatchObject({ status: 403, code: "AuthorizationFailed" });
    expect(n).toBe(1);
  });

  const scripted = (responses: Response[], seen: string[] = []) =>
    new ArmClient({
      tenantId: "t",
      getToken: async () => "tok",
      sleep: async () => undefined,
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.push(`${init.method} ${url}`);
        return responses.shift()!;
      }) as unknown as typeof fetch,
    });

  it("follows Azure-AsyncOperation and re-reads the resource after a PUT", async () => {
    const seen: string[] = [];
    const client = scripted(
      [
        json(201, { provisioningState: "Updating" }, { "azure-asyncoperation": "https://management.azure.com/op/1" }),
        json(200, { status: "InProgress" }),
        json(200, { status: "Succeeded" }),
        json(200, { name: "fw", provisioningState: "Succeeded" }),
      ],
      seen,
    );
    await expect(client.lro("PUT", "/fw?api-version=1", {})).resolves.toEqual({ name: "fw", provisioningState: "Succeeded" });
    expect(seen).toEqual([
      "PUT https://management.azure.com/fw?api-version=1",
      "GET https://management.azure.com/op/1",
      "GET https://management.azure.com/op/1",
      "GET https://management.azure.com/fw?api-version=1",
    ]);
  });

  it("follows Location polling until it stops returning 202", async () => {
    const client = scripted([
      new Response(null, { status: 202, headers: { location: "https://management.azure.com/loc/1" } }),
      new Response(null, { status: 202 }),
      new Response(null, { status: 200 }),
    ]);
    await expect(client.lro("DELETE", "/rg?api-version=1")).resolves.toBeUndefined();
  });

  it("raises when the async operation fails", async () => {
    const client = scripted([
      new Response(null, { status: 202, headers: { "azure-asyncoperation": "https://management.azure.com/op/2" } }),
      json(200, { status: "Failed", error: { code: "Conflict", message: "in use" } }),
    ]);
    await expect(client.lro("DELETE", "/ip?api-version=1")).rejects.toMatchObject({ code: "Conflict" });
  });
});
