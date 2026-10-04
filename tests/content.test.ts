import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../server/labs/compile.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/labs/compile.ts")>()),
  compileBlueprint: async () => ({ $schema: "test" }),
}));

import { getBlueprint, type ContentDef, type StaticWebAppContent } from "../server/labs/blueprints.ts";
import { contentDir, deployContent, scrub, SWA_CLI, type CommandRunner, type ContentCtx } from "../server/labs/content.ts";
import { deployLab, prepareLab } from "../server/labs/engine.ts";
import { getLab, openDb } from "../server/db.ts";
import { ArmError, type ArmClient } from "../server/azure/arm.ts";
import type { Probes } from "../server/validate.ts";
import { config, FIXTURE_ID, registerFixtureBlueprint, SUB } from "./helpers.ts";

registerFixtureBlueprint();

const TOKEN = "swa-secret-token-123";
const def: ContentDef = { kind: "static-web-app", label: "Pharmacy cashier app", dir: "app", siteOutput: "staticSiteName" };

const armWith = (apiKey: string | undefined) => {
  const calls: string[] = [];
  return { calls, arm: { post: async (path: string) => (calls.push(path), { properties: { apiKey } }) } as unknown as ContentCtx["arm"] };
};
const ctx = (arm: ContentCtx["arm"], outputs: Record<string, unknown> = { staticSiteName: "lab-cfarm-ab12-web" }): ContentCtx => ({
  arm,
  subscriptionId: SUB,
  labName: "lab-cfarm-ab12",
  blueprintId: "cr-farmacia-recibos",
  outputs,
});

describe("deployContent", () => {
  it("fetches the token from the site, then publishes the folder with the token in the environment only", async () => {
    const { arm, calls } = armWith(TOKEN);
    const seen: { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const runner: CommandRunner = async (cmd, args, o) => (seen.push({ cmd, args, env: o.env }), { stdout: "", stderr: "" });
    const msg = await deployContent(def, ctx(arm), runner);
    expect(calls).toEqual([`/subscriptions/${SUB}/resourceGroups/lab-cfarm-ab12/providers/Microsoft.Web/staticSites/lab-cfarm-ab12-web/listSecrets?api-version=2023-12-01`]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.args.slice(0, 3)).toEqual(["--yes", SWA_CLI, "deploy"]);
    expect(seen[0]!.args).toContain(contentDir("cr-farmacia-recibos", def));
    expect(seen[0]!.args.join(" ")).not.toContain(TOKEN);
    expect(seen[0]!.env.SWA_CLI_DEPLOYMENT_TOKEN).toBe(TOKEN);
    expect(msg).toBe("Pharmacy cashier app published to lab-cfarm-ab12-web");
  });

  it("pins the CLI to an exact version", () => {
    expect(SWA_CLI).toMatch(/^@azure\/static-web-apps-cli@\d+\.\d+\.\d+$/);
  });

  it("never lets the token reach an error message", async () => {
    const { arm } = armWith(TOKEN);
    const runner: CommandRunner = async () => {
      throw Object.assign(new Error("failed"), { stderr: `Error: 401 for token ${TOKEN}, check ${TOKEN}` });
    };
    const err = await deployContent(def, ctx(arm), runner).catch((e: Error) => e);
    expect((err as Error).message).toContain("Pharmacy cashier app: Error: 401 for token ***, check ***");
    expect((err as Error).message).not.toContain(TOKEN);
    expect(scrub("a b", "")).toBe("a b");
  });

  it("fails clearly without a site output, a token, or an app folder", async () => {
    const { arm } = armWith(TOKEN);
    const never: CommandRunner = async () => {
      throw new Error("should not run");
    };
    await expect(deployContent(def, ctx(arm, {}), never)).rejects.toThrow(/no staticSiteName output/);
    await expect(deployContent(def, ctx(armWith(undefined).arm), never)).rejects.toThrow(/no deployment token/);
    await expect(deployContent({ ...def, dir: "missing" }, ctx(arm), never)).rejects.toThrow(/no index\.html/);
  });
});

describe("the pharmacy blueprint's app", () => {
  const b = getBlueprint("cr-farmacia-recibos");
  const content = b.content![0] as StaticWebAppContent;

  it("declares content whose folder and output exist", () => {
    expect(content).toMatchObject({ kind: "static-web-app", dir: "app", siteOutput: "staticSiteName" });
    expect(readFileSync(resolve(contentDir(b.id, content), "index.html"), "utf8")).toContain("Farmacia Pura Vida");
  });

  it("ships a page whose script parses, with no external requests", () => {
    const html = readFileSync(resolve(contentDir(b.id, content), "index.html"), "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(() => new Function(script)).not.toThrow();
    expect(html).not.toMatch(/(src|href)="https?:\/\//);
    expect(html).toContain('lang="es"');
  });

  it("ships a config that is valid JSON with security headers", () => {
    const cfg = JSON.parse(readFileSync(resolve(contentDir(b.id, content), "staticwebapp.config.json"), "utf8")) as { globalHeaders: Record<string, string> };
    expect(cfg.globalHeaders["X-Content-Type-Options"]).toBe("nosniff");
  });
});

describe("content in the staged engine", () => {
  const now = new Date("2026-10-03T18:00:00Z");
  const engineArm = (events: string[], failPut = false) =>
    ({
      lro: async () => {
        events.push("put");
        if (failPut) throw new Error("DeploymentFailed");
        return {};
      },
      get: async (u: string) => {
        if (u.includes("deploymentStacks")) return { properties: { provisioningState: "Succeeded", outputs: { url: { value: "https://app" }, staticSiteName: { value: "site-1" } }, error: { message: "boom" } } };
        if (u.includes("/deployments?")) return { value: [] };
        throw new ArmError(u, 404, "NotFound");
      },
      post: async () => ({ properties: { apiKey: TOKEN } }),
    }) as unknown as ArmClient;
  const probes = (events: string[], arm: ArmClient): Probes => ({ arm, http: async () => (events.push("gate"), { status: 200, ms: 1 }), dns: async () => [] });
  const withContent = () => {
    const fixture = getBlueprint(FIXTURE_ID);
    fixture.content = [{ kind: "static-web-app", label: "Demo app", dir: "../cr-farmacia-recibos/app", siteOutput: "staticSiteName", fromStage: 2 }];
    return () => {
      delete fixture.content;
    };
  };

  it("publishes after the stage that creates the site and before its gate", async () => {
    const cleanup = withContent();
    try {
      const events: string[] = [];
      const arm = engineArm(events);
      const runner: CommandRunner = async () => (events.push("publish"), { stdout: "", stderr: "" });
      const p = prepareLab(config, { blueprint: FIXTURE_ID, region: "centralus", params: {}, ttlHours: 8, labName: "lab-fxweb-ab12" }, now);
      const msg = await deployLab(arm, openDb(":memory:"), p, 0, { probes: probes(events, arm), gateOpts: { pollMs: 0, sleep: async () => undefined }, contentRunner: runner });
      expect(msg).toBe("Ready");
      // stage 1: put; stage 2: put, publish, then the gate probe.
      expect(events).toEqual(["put", "put", "publish", "gate"]);
    } finally {
      cleanup();
    }
  });

  it("a failed publish fails the lab at that stage and stores no token", async () => {
    const cleanup = withContent();
    try {
      const db = openDb(":memory:");
      const events: string[] = [];
      const arm = engineArm(events);
      const runner: CommandRunner = async () => {
        throw Object.assign(new Error("x"), { stderr: `denied ${TOKEN}` });
      };
      const p = prepareLab(config, { blueprint: FIXTURE_ID, region: "centralus", params: {}, ttlHours: 8, labName: "lab-fxweb-ab12" }, now);
      await expect(deployLab(arm, db, p, 0, { probes: probes(events, arm), gateOpts: { pollMs: 0, sleep: async () => undefined }, contentRunner: runner })).rejects.toThrow(/^Stage 2\/2 \(Apps\): Demo app: denied \*\*\*/);
      const row = getLab(db, p.labName)!;
      expect(row.status).toBe("failed");
      expect(JSON.stringify(row)).not.toContain(TOKEN);
      expect(events).not.toContain("gate");
    } finally {
      cleanup();
    }
  });
});
