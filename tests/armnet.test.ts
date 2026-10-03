import { describe, expect, it } from "vitest";
import { ArmClient } from "../server/azure/arm.ts";

describe("ArmClient network errors", () => {
  it("retries a dropped connection like a 503", async () => {
    let n = 0;
    const arm = new ArmClient({
      tenantId: "t",
      getToken: async () => "tok",
      sleep: async () => undefined,
      fetchImpl: (async () => {
        if (++n < 3) throw new TypeError("fetch failed");
        return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
      }) as typeof fetch,
    });
    expect(await arm.get("/x")).toEqual({ ok: 1 });
    expect(n).toBe(3);
  });

  it("gives up after the retry budget", async () => {
    const arm = new ArmClient({ tenantId: "t", maxRetries: 2, getToken: async () => "tok", sleep: async () => undefined, fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    await expect(arm.get("/x")).rejects.toThrow("fetch failed");
  });
});
