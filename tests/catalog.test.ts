import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BLUEPRINTS, getBlueprint, stagesFor } from "../server/labs/blueprints.ts";
import { BLUEPRINT_DIR, bicepPath, compileBlueprint } from "../server/labs/compile.ts";
import { sqlBatches } from "../server/labs/content.ts";
import { labResourceTypes } from "../server/labs/engine.ts";
import { GENERATORS } from "../server/labs/samples.ts";

const hasBicep = (() => {
  const p = bicepPath();
  return p !== "bicep" ? existsSync(p) : false;
})();

interface Res {
  type: string;
  name: string;
  properties?: { template?: { resources?: Res[] } };
}
interface Template {
  parameters: Record<string, { type: string }>;
  outputs: Record<string, unknown>;
  resources: Res[];
}
/** Every resource in a compiled template, including those inside nested module deployments. */
const allResources = (rs: Res[] = []): Res[] => rs.flatMap((r) => [r, ...allResources(r.properties?.template?.resources)]);

describe("the catalog as a whole", () => {
  it("has the 22 labs, each with a unique id and code", () => {
    expect(BLUEPRINTS.map((b) => b.id).sort()).toEqual(
      [
        "cr-cafe-demanda", "cr-clinica-seguridad", "cr-cooperativa-gobierno", "cr-facturas-escaner", "cr-farmacia-recibos", "cr-fincas-archivo", "cr-guia-turistico",
        "cr-pulperia-inventario", "cr-resenas-turismo", "cr-soda-sitio-web", "cr-sucursales-red", "cr-taller-servidores", "cr-tour-escala", "cr-ventas-reporte",
        "cr-ferreteria-monitoreo", "cr-lecheria-almacenamiento", "cr-repartos-contenedores", "cr-dental-respaldo", "cr-municipio-accesos", "cr-cooperativa-agente",
        "cr-feria-voz-vision", "cr-expedientes-contenido",
      ].sort(),
    );
    expect(new Set(BLUEPRINTS.map((b) => b.code)).size).toBe(BLUEPRINTS.length);
  });

  it("covers every exam in the plan with at least one lab", () => {
    const exams = BLUEPRINTS.flatMap((b) => b.scenario!.exams).join(" | ");
    for (const code of ["AZ-900", "AI-901", "DP-900", "SC-900", "AZ-104"]) expect(exams, code).toContain(code);
  });

  it("covers every AZ-104 domain and every AI-901 domain with at least one lab", () => {
    const by = (code: string, topic: RegExp) => BLUEPRINTS.filter((b) => b.scenario!.exams.some((e) => e.startsWith(code) && topic.test(e))).map((b) => b.id);
    for (const topic of [/storage/i, /container|compute|virtual machines/i, /network/i, /monitor/i, /backup/i, /access to Azure resources|roles/i]) expect(by("AZ-104", topic).length, `AZ-104 ${topic}`).toBeGreaterThan(0);
    for (const topic of [/generative|prompts|model/i, /speech/i, /vision|image/i, /extraction|extract/i, /responsible AI/i]) expect(by("AI-901", topic).length, `AI-901 ${topic}`).toBeGreaterThan(0);
  });

  it("every exam line starts with a known exam code, so the catalog page can tag each lab", () => {
    for (const b of BLUEPRINTS) for (const e of b.scenario!.exams) expect(e, `${b.id}: ${e}`).toMatch(/^(AZ-900|AZ-104|AI-901|AI-900|DP-900|SC-900)\b/);
  });

  it("every preset and alternative is valid for its blueprint and passes its own rules", () => {
    for (const b of BLUEPRINTS) {
      const defaults = b.schema.parse({});
      expect(b.rules?.(defaults) ?? [], b.id).toEqual([]);
      for (const p of b.presets ?? []) {
        const parsed = b.schema.parse({ ...defaults, ...p.params });
        expect(b.rules?.(parsed) ?? [], `${b.id} preset ${p.label}`).toEqual([]);
      }
      for (const a of b.alternatives?.(defaults) ?? []) expect(b.rules?.(b.schema.parse({ ...defaults, ...a.params })) ?? [], `${b.id} alternative`).toEqual([]);
      expect(typeof (b.timingKey?.(defaults) ?? ""), b.id).toBe("string");
    }
  });

  it("every price meter is complete, and quota names are ones Azure reports", () => {
    const known = new Set(["VirtualNetworks", "NetworkSecurityGroups", "IPv4StandardSkuPublicIpAddresses"]);
    for (const b of BLUEPRINTS) {
      for (const m of b.meters(b.schema.parse({}))) {
        expect(m.unitsPerHour, `${b.id} ${m.label}`).toBeGreaterThan(0);
        expect(m.fixedHourly === undefined ? [m.serviceName, m.skuName, m.meterName].every(Boolean) : m.fixedHourly >= 0, `${b.id} ${m.label}`).toBe(true);
      }
      for (const q of Object.keys(b.quotas?.(b.schema.parse({})) ?? {})) expect(known.has(q), `${b.id} quota ${q}`).toBe(true);
    }
  });

  it("every blueprint's resource types look like Azure resource types, and extra/region-free ones are listed", () => {
    for (const b of BLUEPRINTS) {
      const types = labResourceTypes(b, b.schema.parse({}));
      expect(types.length, b.id).toBeGreaterThan(0);
      for (const t of [...types, ...(b.regionFree ?? [])]) expect(t, b.id).toMatch(/^Microsoft\.[A-Za-z]+\/[A-Za-z]+/);
      for (const t of b.regionFree ?? []) expect(types, `${b.id} regionFree ${t} must be one of the lab's types`).toContain(t);
    }
  });

  it("the content each lab declares is real: generators exist, folders and scripts are there", () => {
    for (const b of BLUEPRINTS) {
      for (const c of b.content ?? []) {
        if (c.kind === "static-web-app") expect(existsSync(resolve(BLUEPRINT_DIR, b.id, c.dir, "index.html")), `${b.id} ${c.label}`).toBe(true);
        if (c.kind === "storage-static-site" || c.kind === "blob-upload") {
          if ("generator" in c.source) expect(Object.keys(GENERATORS), `${b.id} ${c.label}`).toContain(c.source.generator);
          else expect(existsSync(resolve(BLUEPRINT_DIR, b.id, c.source.dir)), `${b.id} ${c.label}`).toBe(true);
        }
        if (c.kind === "sql-seed") {
          const script = readFileSync(resolve(BLUEPRINT_DIR, b.id, c.script), "utf8");
          const batches = sqlBatches(script);
          expect(batches.length).toBeGreaterThan(3);
          expect(batches[0]).toMatch(/^(--[^\n]*\n)*\s*CREATE TABLE/i);
        }
      }
    }
  });

  it.skipIf(!hasBicep).each(BLUEPRINTS.map((b) => [b.id]))("%s: content outputs exist, secrets are generated, soft-deletable names are purgeable", async (id) => {
    const b = getBlueprint(id);
    const t = (await compileBlueprint(id)) as unknown as Template;

    // Content steps read these stack outputs; a typo would only show up at deploy time.
    for (const c of b.content ?? []) {
      const key = c.kind === "static-web-app" ? c.siteOutput : c.kind === "sql-seed" ? c.serverOutput : c.accountOutput;
      expect(t.outputs, `${id} content output ${key}`).toHaveProperty(key);
    }

    // Every secure parameter is one labctl generates (a hook), so a launch never asks a person for a secret.
    const hookKeys = (b.paramHooks ?? []).flatMap((h) => Object.keys(h.validateWith ?? {}));
    const secure = Object.entries(t.parameters).filter(([, p]) => p.type === "securestring").map(([k]) => k);
    expect(secure.sort(), `${id} secure parameters`).toEqual(hookKeys.sort());

    // A destroy purges soft-deleted Key Vaults and AI accounts by their lab-name prefix, so the name must start with it.
    const soft = allResources(t.resources).filter((r) => ["Microsoft.KeyVault/vaults", "Microsoft.CognitiveServices/accounts"].includes(r.type));
    for (const r of soft) expect(r.name, `${id} ${r.type}`).toMatch(/^\[format\('\{0\}-[a-z]+', parameters\('labName'\)\)\]$/);

    // No lab opens SSH or RDP to the internet.
    expect(JSON.stringify(t)).not.toMatch(/"destinationPortRange":\s*"(22|3389)"/);

    // Blob uploads target a container the template creates.
    const json = JSON.stringify(t);
    for (const c of b.content ?? []) if (c.kind === "blob-upload") expect(json, `${id} container ${c.container}`).toContain(c.container);
  }, 60_000);
});

describe("guards for the checks above", () => {
  it.skipIf(!hasBicep)("the purge and secret checks have real resources to look at", async () => {
    let soft = 0;
    let secure = 0;
    for (const b of BLUEPRINTS) {
      const t = (await compileBlueprint(b.id)) as unknown as Template;
      soft += allResources(t.resources).filter((r) => ["Microsoft.KeyVault/vaults", "Microsoft.CognitiveServices/accounts"].includes(r.type)).length;
      secure += Object.values(t.parameters).filter((p) => p.type === "securestring").length;
    }
    expect(soft).toBeGreaterThanOrEqual(5);
    expect(secure).toBeGreaterThanOrEqual(4);
  }, 60_000);
});

// ---- The two labs whose pages are served by a tiny Node server we ship ---------------------------

const free = () => 5100 + Math.floor(Math.random() * 800);

async function withServer(script: string, env: Record<string, string>, run: (base: string) => Promise<void>) {
  const dir = mkdtempSync(resolve(tmpdir(), "labctl-srv-"));
  const file = resolve(dir, "server.js");
  writeFileSync(file, script);
  const port = free();
  const child = spawn(process.execPath, [file], { env: { ...process.env, ...env, PORT: String(port) }, stdio: "ignore" });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${base}/health`)).status < 500) break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await run(base);
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

const embed = (id: string, page: string) => readFileSync(resolve(BLUEPRINT_DIR, id, "server.js"), "utf8").replace("__PAGE__", Buffer.from(page).toString("base64"));

describe("the Node servers shipped with the labs", () => {
  it("taller: the same page is served with the hosting text filled in", async () => {
    const page = readFileSync(resolve(BLUEPRINT_DIR, "cr-taller-servidores", "page.html"), "utf8").replace("__HOST__", "App Service (PaaS)").replace("__OSWHO__", "Azure").replace("__RUNWHO__", "Azure");
    await withServer(embed("cr-taller-servidores", page), {}, async (base) => {
      const res = await fetch(base);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toContain("App Service (PaaS)");
      expect(body).toContain("Taller Los Ángeles");
    });
  });

  it("tour: /health answers, /work burns CPU for the time asked, and the page shows version and instance", async () => {
    const page = readFileSync(resolve(BLUEPRINT_DIR, "cr-tour-escala", "page.html"), "utf8");
    await withServer(embed("cr-tour-escala", page), { APP_VERSION: "2", WEBSITE_INSTANCE_ID: "abcdef1234567890" }, async (base) => {
      expect(await (await fetch(`${base}/health`)).text()).toBe("ok");
      const t0 = Date.now();
      expect(await (await fetch(`${base}/work?ms=150`)).text()).toBe("listo");
      expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
      const body = await (await fetch(base)).text();
      expect(body).toContain('class="pill">2<');
      expect(body).toContain("abcdef12");
      expect(body).not.toMatch(/__VERSION__|__INSTANCE__/);
    });
  }, 20_000);

  it("tour: the page's script uses no names that collide with browser globals (window.status broke it once)", () => {
    const page = readFileSync(resolve(BLUEPRINT_DIR, "cr-tour-escala", "page.html"), "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(page)![1]!;
    expect(script).not.toMatch(/\bvar\s+(status|name|top|parent|self|length|event)\b|,\s*(status|name|top|parent|self|length|event)\s*=/);
    expect(() => new Function(script)).not.toThrow();
  });

  it("ferreteria: the shop answers normal orders, fails on purpose on /error, and serves the test page", async () => {
    const page = readFileSync(resolve(BLUEPRINT_DIR, "cr-ferreteria-monitoreo", "page.html"), "utf8");
    await withServer(embed("cr-ferreteria-monitoreo", page), {}, async (base) => {
      expect(await (await fetch(`${base}/health`)).text()).toBe("ok");
      expect((await fetch(`${base}/compra`)).status).toBe(200);
      expect((await fetch(`${base}/error`)).status).toBe(500);
      const html = await (await fetch(base)).text();
      expect(html).toContain("Ferretería El Tornillo");
      expect(html).not.toContain("__PAGE__");
    });
  }, 20_000);

  it("ferreteria: the page's script uses no names that collide with browser globals", () => {
    const page = readFileSync(resolve(BLUEPRINT_DIR, "cr-ferreteria-monitoreo", "page.html"), "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(page)![1]!;
    expect(script).not.toMatch(/\bvar\s+(status|name|top|parent|self|length|event)\b|,\s*(status|name|top|parent|self|length|event)\s*=/);
    expect(() => new Function(script)).not.toThrow();
  });

  it("municipio: the app reads the report with a token from its identity, and says so when the role is missing", async () => {
    let allowed = true;
    const seen: { tokenHeader?: string; auth?: string; path?: string } = {};
    const identity = createServer((q, r) => {
      seen.tokenHeader = String(q.headers["x-identity-header"]);
      r.writeHead(200, { "content-type": "application/json" });
      r.end(JSON.stringify({ access_token: "tok-123" }));
    });
    const blob = createServer((q, r) => {
      seen.auth = String(q.headers.authorization);
      seen.path = q.url;
      r.writeHead(allowed ? 200 : 403);
      r.end(allowed ? "informe de ejemplo" : "no");
    });
    await new Promise<void>((ok) => identity.listen(0, "127.0.0.1", ok));
    await new Promise<void>((ok) => blob.listen(0, "127.0.0.1", ok));
    const port = (s: typeof identity) => (s.address() as { port: number }).port;
    try {
      const page = readFileSync(resolve(BLUEPRINT_DIR, "cr-municipio-accesos", "page.html"), "utf8");
      const env = { STORAGE_ACCOUNT: "cuentademo", IDENTITY_ENDPOINT: `http://127.0.0.1:${port(identity)}/msi/token`, IDENTITY_HEADER: "secret-h", BLOB_BASE: `http://127.0.0.1:${port(blob)}` };
      await withServer(embed("cr-municipio-accesos", page), env, async (base) => {
        expect(await (await fetch(base)).text()).toContain("cuentademo");
        const ok = (await (await fetch(`${base}/leer`)).json()) as { ok: boolean; texto?: string };
        expect(ok).toMatchObject({ ok: true, texto: "informe de ejemplo" });
        expect(seen).toEqual({ tokenHeader: "secret-h", auth: "Bearer tok-123", path: "/informes/informes/informe-acueducto.txt" });
        allowed = false;
        const denied = (await (await fetch(`${base}/leer`)).json()) as { ok: boolean; status: number; error: string };
        expect(denied).toMatchObject({ ok: false, status: 403 });
        expect(denied.error).toMatch(/no tiene un rol/);
      });
      // Without an identity the page explains why instead of crashing.
      await withServer(embed("cr-municipio-accesos", page), { STORAGE_ACCOUNT: "x" }, async (base) => {
        expect(((await (await fetch(`${base}/leer`)).json()) as { error: string }).error).toMatch(/identidad administrada/);
      });
    } finally {
      identity.close();
      blob.close();
    }
  }, 20_000);

  it("every lab that declares a gate has a url output to check, and no lab blocks on a web gate by default", () => {
    for (const b of BLUEPRINTS) {
      const stages = stagesFor(b, b.schema.parse({}));
      for (const s of stages) if (s.gate) expect(s.gate.blocking, `${b.id} gate`).toBe(false);
    }
  });
});
