import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The deploy loop compiles the blueprint first; the fixture has no Bicep, so compile is stubbed (as in the other engine tests).
vi.mock("../server/labs/compile.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/labs/compile.ts")>()),
  compileBlueprint: async () => ({ $schema: "test" }),
}));

import type { BlobUploadContent, SqlSeedContent, StorageSiteContent } from "../server/labs/blueprints.ts";
import { CLIENT_IP, deployContent, materialize, sqlBatches, type CommandRunner, type ContentCtx, type SqlRunner, type SqlTarget } from "../server/labs/content.ts";
import { SUB } from "./helpers.ts";

const KEY = "storage-key-ABC123==";
const noSleep = async () => undefined;

type Call = { cmd: string; args: string[]; env: NodeJS.ProcessEnv; files?: string[] };

/** A runner that records each call (and which files were on disk at that moment). */
const recorder = (failFirst = 0, stderr = "") => {
  const calls: Call[] = [];
  let failed = 0;
  const runner: CommandRunner = async (cmd, args, o) => {
    const src = args.includes("-s") ? args[args.indexOf("-s") + 1]! : undefined;
    calls.push({ cmd, args, env: o.env, files: src && existsSync(src) ? readdirSync(src, { recursive: true }).map(String) : undefined });
    if (failed < failFirst) {
      failed++;
      throw Object.assign(new Error("boom"), { stderr });
    }
    return { stdout: "", stderr: "" };
  };
  return { calls, runner };
};

const ctx = (extra: Partial<ContentCtx> = {}, outputs: Record<string, unknown> = { accountName: "stacct1" }) => {
  const posts: string[] = [];
  const base: ContentCtx = {
    arm: { post: async (p: string) => (posts.push(p), { keys: [{ value: KEY }] }) } as unknown as ContentCtx["arm"],
    subscriptionId: SUB,
    labName: "lab-csoda-ab12",
    blueprintId: "cr-soda-sitio-web",
    outputs,
    params: {},
    ...extra,
  };
  return { ctx: base, posts };
};

const site: StorageSiteContent = { kind: "storage-static-site", label: "Menu website", accountOutput: "accountName", source: { dir: "site" } };
const upload: BlobUploadContent = { kind: "blob-upload", label: "Sample reviews", accountOutput: "accountName", container: "muestras", source: { generator: "tourist-reviews" } };

describe("storage-static-site", () => {
  it("turns the website on, then uploads the folder to $web, with the key in the environment only", async () => {
    const { ctx: c, posts } = ctx();
    const { calls, runner } = recorder();
    const msg = await deployContent(site, c, runner, { sleep: noSleep });
    expect(posts).toEqual([`/subscriptions/${SUB}/resourceGroups/lab-csoda-ab12/providers/Microsoft.Storage/storageAccounts/stacct1/listKeys?api-version=2023-05-01`]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args).toEqual(["storage", "blob", "service-properties", "update", "--static-website", "--index-document", "index.html", "--404-document", "404.html"]);
    expect(calls[1]!.args.slice(0, 3)).toEqual(["storage", "blob", "upload-batch"]);
    expect(calls[1]!.args).toEqual(expect.arrayContaining(["-d", "$web", "--overwrite"]));
    for (const call of calls) {
      expect(call.cmd).toBe("az");
      expect(call.args.join(" ")).not.toContain(KEY);
      expect(call.env.AZURE_STORAGE_KEY).toBe(KEY);
      expect(call.env.AZURE_STORAGE_ACCOUNT).toBe("stacct1");
    }
    // The real site folder is uploaded in place (nothing copied or deleted).
    expect(calls[1]!.files).toEqual(expect.arrayContaining(["index.html", "404.html"]));
    expect(msg).toBe("Menu website published to stacct1");
  });

  it("fails clearly without an account output, or when the site has no index.html", async () => {
    const { runner } = recorder();
    await expect(deployContent(site, ctx({}, {}).ctx, runner, { sleep: noSleep })).rejects.toThrow(/no accountName output/);
    await expect(deployContent({ ...site, source: { generator: "farm-archive" } }, ctx().ctx, runner, { sleep: noSleep })).rejects.toThrow(/no index\.html/);
  });

  it("names the step that failed and never leaks the key", async () => {
    const { runner } = recorder(99, `ERROR: bad request for key ${KEY}`);
    const err = await deployContent(site, ctx().ctx, runner, { sleep: noSleep }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/^Menu website: enabling the static website failed: .*bad request for key \*\*\*/);
    expect((err as Error).message).not.toContain(KEY);
  });
});

describe("blob-upload", () => {
  it("uploads generated sample files from a temporary folder, then removes it", async () => {
    const { ctx: c } = ctx();
    const { calls, runner } = recorder();
    const msg = await deployContent(upload, c, runner, { sleep: noSleep });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args.slice(0, 3)).toEqual(["storage", "blob", "upload-batch"]);
    expect(calls[0]!.args).toEqual(expect.arrayContaining(["-d", "muestras", "--overwrite"]));
    expect(calls[0]!.files).toEqual(["resenas", expect.stringMatching(/resenas[\\/]resenas\.csv/)]);
    const dir = calls[0]!.args[calls[0]!.args.indexOf("-s") + 1]!;
    expect(existsSync(dir)).toBe(false);
    expect(msg).toBe("Sample reviews uploaded to stacct1/muestras");
  });

  it("passes the lab's parameters to the generator", async () => {
    const { runner, calls } = recorder();
    await deployContent(upload, ctx({ params: { dataset: "small" } }).ctx, runner, { sleep: noSleep });
    expect(calls[0]!.files!.length).toBeGreaterThan(0);
  });

  it("retries a fresh account that is not ready, then succeeds", async () => {
    const { runner, calls } = recorder(2);
    const sleeps: number[] = [];
    await deployContent(upload, ctx().ctx, runner, { sleep: async (ms) => void sleeps.push(ms) });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([10_000, 10_000]);
  });

  it("gives up after four attempts and removes the temporary folder anyway", async () => {
    const { runner, calls } = recorder(99, "StorageAccountNotReady");
    await expect(deployContent(upload, ctx().ctx, runner, { sleep: noSleep })).rejects.toThrow(/Sample reviews: StorageAccountNotReady/);
    expect(calls).toHaveLength(4);
    const dir = calls[0]!.args[calls[0]!.args.indexOf("-s") + 1]!;
    expect(existsSync(dir)).toBe(false);
  });

  it("refuses a missing sample folder", () => {
    expect(() => materialize({ dir: "nope" }, { blueprintId: "cr-soda-sitio-web" })).toThrow(/does not exist/);
  });
});

describe("sql-seed", () => {
  const seed: SqlSeedContent = { kind: "sql-seed", label: "Sample inventory", serverOutput: "serverName", database: "pulperia", script: "seed.sql", adminUser: "pulperiaAdmin", passwordParam: "adminPassword" };
  const sqlCtx = (extra: Partial<ContentCtx> = {}) => {
    const puts: { path: string; body: unknown }[] = [];
    const arm = { post: async () => ({}), lro: async (_m: string, path: string, body: unknown) => (puts.push({ path, body }), {}) } as unknown as ContentCtx["arm"];
    return { puts, ctx: { ...ctx({ arm, blueprintId: "cr-pulperia-inventario", secrets: { adminPassword: "Sup3r-secret!" }, ...extra }, { serverName: "lab-cpulp-ab12-sql" }).ctx } };
  };

  it("splits the script into batches on GO lines", () => {
    expect(sqlBatches("CREATE TABLE a (x INT);\nGO\n\nINSERT INTO a VALUES (1);\n  go  \nSELECT 1")).toEqual(["CREATE TABLE a (x INT);", "INSERT INTO a VALUES (1);", "SELECT 1"]);
    expect(sqlBatches("-- only a comment\nGO\n")).toEqual(["-- only a comment"]);
  });

  it("runs every batch of the real seed script as the admin", async () => {
    const seen: { t: SqlTarget; n: number }[] = [];
    const sql: SqlRunner = async (t, batches) => void seen.push({ t, n: batches.length });
    const { ctx: c } = sqlCtx();
    const msg = await deployContent(seed, c, undefined, { sql, sleep: noSleep });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.t).toEqual({ server: "lab-cpulp-ab12-sql", database: "pulperia", user: "pulperiaAdmin", password: "Sup3r-secret!" });
    expect(seen[0]!.n).toBeGreaterThan(8);
    expect(msg).toBe(`Sample inventory ran ${seen[0]!.n} batches on pulperia`);
  });

  it("opens the firewall for the caller's IP when the server refuses it, then retries", async () => {
    let attempts = 0;
    const sql: SqlRunner = async () => {
      if (++attempts < 3) throw new Error("Cannot open server 'x' requested by the login. Client with IP address '203.0.113.7' is not allowed to access the server.");
    };
    const { ctx: c, puts } = sqlCtx();
    const sleeps: number[] = [];
    await deployContent(seed, c, undefined, { sql, sleep: async (ms) => void sleeps.push(ms) });
    expect(attempts).toBe(3);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.path).toContain("/servers/lab-cpulp-ab12-sql/firewallRules/labctl-deployer");
    expect(puts[0]!.body).toEqual({ properties: { startIpAddress: "203.0.113.7", endIpAddress: "203.0.113.7" } });
    expect(sleeps).toHaveLength(2);
  });

  it("recognizes the refusal message and never leaks the password in the final error", async () => {
    expect(CLIENT_IP.exec("Client with IP address '1.2.3.4' is not allowed")![1]).toBe("1.2.3.4");
    const sql: SqlRunner = async () => {
      throw new Error("Login failed for user 'pulperiaAdmin' with password Sup3r-secret!");
    };
    const err = await deployContent(seed, sqlCtx().ctx, undefined, { sql, sleep: noSleep }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/^Sample inventory: Login failed for user 'pulperiaAdmin' with password \*\*\*/);
    expect((err as Error).message).not.toContain("Sup3r-secret!");
  });

  it("needs the generated password and an existing script", async () => {
    const sql: SqlRunner = async () => undefined;
    await expect(deployContent(seed, sqlCtx({ secrets: {} }).ctx, undefined, { sql, sleep: noSleep })).rejects.toThrow(/password was not generated/);
    await expect(deployContent({ ...seed, script: "missing.sql" }, sqlCtx().ctx, undefined, { sql, sleep: noSleep })).rejects.toThrow(/does not exist/);
    await expect(deployContent(seed, ctx({ blueprintId: "cr-pulperia-inventario", secrets: { adminPassword: "x" } }, {}).ctx, undefined, { sql, sleep: noSleep })).rejects.toThrow(/no serverName output/);
  });
});

// ---- Through the real deploy loop ---------------------------------------------------------------

import { deployLab, prepareLab } from "../server/labs/engine.ts";
import { getLab, openDb } from "../server/db.ts";
import { ArmError, type ArmClient } from "../server/azure/arm.ts";
import type { Probes } from "../server/validate.ts";
import { config, FIXTURE_ID, registerFixtureBlueprint } from "./helpers.ts";
import { getBlueprint } from "../server/labs/blueprints.ts";

describe("content inside deployLab", () => {
  registerFixtureBlueprint();
  const now = new Date("2026-10-03T18:00:00Z");

  const engineArm = (events: string[]) =>
    ({
      lro: async (m: string, u: string) => {
        events.push(u.includes("deploymentStacks") ? "put" : `${m} ${u.split("/").slice(-1)[0]!.split("?")[0]}`);
        return {};
      },
      get: async (u: string) => {
        if (u.includes("deploymentStacks")) return { properties: { provisioningState: "Succeeded", outputs: { url: { value: "https://app" }, accountName: { value: "stacct1" }, serverName: { value: "lab-fxweb-ab12-sql" } } } };
        if (u.includes("/deployments?")) return { value: [] };
        throw new ArmError(u, 404, "NotFound");
      },
      post: async () => ({ keys: [{ value: KEY }] }),
    }) as unknown as ArmClient;
  const probes = (arm: ArmClient): Probes => ({ arm, http: async () => ({ status: 200, ms: 1 }), dns: async () => [] });

  it("hands the generated password to the SQL seed and skips content whose toggle is off", async () => {
    const fixture = getBlueprint(FIXTURE_ID);
    // Borrow the real seed script (a relative path out of the fixture's own folder).
    fixture.content = [
      { kind: "blob-upload", fromStage: 2, label: "Samples", accountOutput: "accountName", container: "muestras", source: { generator: "tourist-reviews" }, when: (p: { count: number }) => p.count > 1 },
      { kind: "sql-seed", fromStage: 2, label: "Seed", serverOutput: "serverName", database: "db", script: "../cr-pulperia-inventario/seed.sql", adminUser: "admin", passwordParam: "adminPassword" },
    ];
    try {
      const events: string[] = [];
      const arm = engineArm(events);
      const seen: SqlTarget[] = [];
      const runner = recorder();
      const p = prepareLab(config, { blueprint: FIXTURE_ID, region: "centralus", params: { count: 1 }, ttlHours: 8, labName: "lab-fxweb-ab12" }, now);
      const hooks = { "vm-password": async () => ({ adminPassword: "Generated-Pw-1!" }) };
      const msg = await deployLab(arm, openDb(":memory:"), p, 0, {
        probes: probes(arm),
        gateOpts: { pollMs: 0, sleep: async () => undefined },
        hooks,
        contentRunner: runner.runner,
        contentSql: async (t) => void seen.push(t),
        contentSleep: noSleep,
      });
      expect(msg).toBe("Ready");
      // count = 1, so the upload's `when` is false: no az call at all, and the SQL seed ran with the generated password.
      expect(runner.calls).toHaveLength(0);
      expect(seen).toEqual([{ server: "lab-fxweb-ab12-sql", database: "db", user: "admin", password: "Generated-Pw-1!" }]);

      // With two instances the upload runs too.
      const p2 = prepareLab(config, { blueprint: FIXTURE_ID, region: "centralus", params: { count: 2 }, ttlHours: 8, labName: "lab-fxweb-cd34" }, now);
      await deployLab(arm, openDb(":memory:"), p2, 0, { probes: probes(arm), gateOpts: { pollMs: 0, sleep: async () => undefined }, hooks, contentRunner: runner.runner, contentSql: async () => undefined, contentSleep: noSleep });
      expect(runner.calls.map((c) => c.args[2])).toEqual(["upload-batch"]);
    } finally {
      delete fixture.content;
    }
  });

  it("a failed content step fails the stage and keeps the generated password out of the stored lab", async () => {
    const fixture = getBlueprint(FIXTURE_ID);
    fixture.content = [{ kind: "sql-seed", fromStage: 2, label: "Seed", serverOutput: "serverName", database: "db", script: "../cr-pulperia-inventario/seed.sql", adminUser: "admin", passwordParam: "adminPassword" }];
    try {
      const db = openDb(":memory:");
      const arm = engineArm([]);
      const p = prepareLab(config, { blueprint: FIXTURE_ID, region: "centralus", params: {}, ttlHours: 8, labName: "lab-fxweb-ef56" }, now);
      const hooks = { "vm-password": async () => ({ adminPassword: "Generated-Pw-1!" }) };
      const sql = async () => {
        throw new Error("Login failed (Generated-Pw-1!)");
      };
      await expect(deployLab(arm, db, p, 0, { probes: probes(arm), gateOpts: { pollMs: 0, sleep: async () => undefined }, hooks, contentSql: sql, contentSleep: noSleep })).rejects.toThrow(/^Stage 2\/2 \(Apps\): Seed: Login failed \(\*\*\*\)/);
      const row = getLab(db, p.labName)!;
      expect(row.status).toBe("failed");
      expect(JSON.stringify(row)).not.toContain("Generated-Pw-1!");
    } finally {
      delete fixture.content;
    }
  });
});
