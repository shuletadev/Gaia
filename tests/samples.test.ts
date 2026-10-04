import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { GENERATORS, generateSamples, pdf, png, rng } from "../server/labs/samples.ts";

const lines = (csv: Buffer) => csv.toString("utf8").trim().split("\n");

describe("rng", () => {
  it("is deterministic and in [0, 1)", () => {
    const a = rng(5);
    const b = rng(5);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(rng(6)()).not.toBe(rng(5)());
  });
});

describe("pdf", () => {
  const doc = pdf(["Factura (ejemplo)", "Café y azúcar: ₡1 500".replace("₡", "CRC "), "a \\ b"]);
  const s = doc.toString("latin1");

  it("has a valid structure: header, cross-reference table at the offset startxref names, and an end marker", () => {
    expect(s.startsWith("%PDF-1.4\n")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    const offset = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1]);
    expect(s.slice(offset, offset + 4)).toBe("xref");
    // Every object offset in the table points at "N 0 obj".
    const entries = [...s.slice(offset).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(5);
    entries.forEach((o, i) => expect(s.slice(o, o + 7)).toBe(`${i + 1} 0 obj`));
  });

  it("keeps Spanish accents as Latin-1 and escapes parentheses and backslashes", () => {
    expect(s).toContain("Caf\xe9 y az\xfacar");
    expect(s).toContain("(Factura \\(ejemplo\\)) Tj");
    expect(s).toContain("(a \\\\ b) Tj");
  });
});

describe("png", () => {
  const img = png(8, 4, (x, y) => [x * 30, y * 60, 100]);

  it("has the PNG signature, the right size and a valid checksum on every chunk", () => {
    expect([...img.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(img.readUInt32BE(16)).toBe(8);
    expect(img.readUInt32BE(20)).toBe(4);
    let at = 8;
    const types: string[] = [];
    while (at < img.length) {
      const len = img.readUInt32BE(at);
      const type = img.subarray(at + 4, at + 8).toString("latin1");
      types.push(type);
      expect(img.readUInt32BE(at + 8 + len)).toBe(crc32(img.subarray(at + 4, at + 8 + len)) >>> 0);
      at += 12 + len;
    }
    expect(types).toEqual(["IHDR", "IDAT", "IEND"]);
  });
});

describe("generators", () => {
  it("are registered for every sample the catalog uses, and reject unknown names", () => {
    expect(Object.keys(GENERATORS).sort()).toEqual(["coffee-demand", "farm-archive", "invoices-receipts", "pharmacy-sales", "tourism-brochures", "tourist-reviews"]);
    expect(() => generateSamples("nope")).toThrow(/Unknown sample generator/);
  });

  it("produce the same bytes every time, so a lab deployed twice gets the same files", () => {
    for (const name of Object.keys(GENERATORS)) {
      const a = generateSamples(name, {});
      const b = generateSamples(name, {});
      expect(a.map((f) => f.path)).toEqual(b.map((f) => f.path));
      expect(a.every((f, i) => f.data.equals(b[i]!.data)), name).toBe(true);
    }
  });

  it("stay small and use forward-slash paths", () => {
    for (const name of Object.keys(GENERATORS)) {
      const files = generateSamples(name, name === "pharmacy-sales" ? { dataSize: "three" } : {});
      expect(files.length, name).toBeGreaterThan(0);
      expect(files.every((f) => !f.path.includes("\\") && !f.path.startsWith("/") && !f.path.includes("..")), name).toBe(true);
      expect(files.reduce((n, f) => n + f.data.length, 0), name).toBeLessThan(5_000_000);
    }
  });

  it("invoices and receipts are PDFs marked as examples, with fictional suppliers", () => {
    const all = generateSamples("invoices-receipts");
    const invoices = all.filter((f) => f.path.startsWith("facturas/"));
    const receipts = all.filter((f) => f.path.startsWith("recibos/"));
    expect([invoices.length, receipts.length]).toEqual([6, 4]);
    for (const f of all) expect(f.data.subarray(0, 5).toString()).toBe("%PDF-");
    for (const f of invoices) expect(f.data.toString("latin1")).toContain("DOCUMENTO DE EJEMPLO, NO V\xc1LIDO");
    for (const f of receipts) expect(f.data.toString("latin1")).toContain("ficticia");
    expect(generateSamples("invoices-receipts", { sampleSet: "invoices" })).toHaveLength(6);
  });

  it("reviews: 60 rows or 20, both languages, well-formed CSV", () => {
    const full = lines(generateSamples("tourist-reviews")[0]!.data);
    expect(full[0]).toBe("id,hotel,idioma,fecha,texto");
    expect(full).toHaveLength(61);
    expect(lines(generateSamples("tourist-reviews", { dataset: "small" })[0]!.data)).toHaveLength(21);
    const langs = new Set(full.slice(1).map((l) => l.split(",")[2]));
    expect(langs).toEqual(new Set(["es", "en"]));
    // The text column is quoted, so its commas never split the row.
    expect(full.slice(1).every((l) => /^\d+,[^,]+(,[^,]+){2},"/.test(l))).toBe(true);
    expect(full.join("\n")).toMatch(/tuanis|pura vida|chiva/i);
  });

  it("farm archive: photos, soil reports and a readme, spread over three farms", () => {
    const files = generateSamples("farm-archive");
    expect(files.filter((f) => f.path.endsWith(".png"))).toHaveLength(9);
    expect(files.filter((f) => f.path.endsWith("suelo-2025.csv"))).toHaveLength(3);
    expect(files.some((f) => f.path === "LEEME.txt")).toBe(true);
    expect(new Set(files.map((f) => f.path.split("/")[0])).size).toBe(4);
    for (const f of files.filter((x) => x.path.endsWith(".png"))) expect(f.data.readUInt32BE(16)).toBe(160);
  });

  it("brochures: five PDFs about the fictional reserve", () => {
    const files = generateSamples("tourism-brochures");
    expect(files.map((f) => f.path).sort()).toEqual(["folletos/horarios.pdf", "folletos/precios.pdf", "folletos/preguntas.pdf", "folletos/seguridad.pdf", "folletos/senderos.pdf"]);
    for (const f of files) expect(f.data.toString("latin1")).toContain("ficticia");
  });

  it("pharmacy sales: consistent rows, a year or three, and a rainy-season effect", () => {
    const one = lines(generateSamples("pharmacy-sales", { dataSize: "one" })[0]!.data);
    const three = lines(generateSamples("pharmacy-sales", { dataSize: "three" })[0]!.data);
    expect(one[0]).toBe("sale_id,fecha,hora,producto_id,producto,categoria,cantidad,precio_unitario,total");
    expect(one.length).toBeGreaterThan(5000);
    expect(three.length).toBeGreaterThan(one.length * 2.5);
    const rows = one.slice(1).map((l) => l.replace(/"[^"]*"/, "P").split(","));
    for (const r of rows) {
      expect(Number(r[6]) * Number(r[7])).toBe(Number(r[8]));
      expect(r[2]).toMatch(/^(0[89]|1\d|20):\d\d$/);
    }
    // Repellent (id 10) sells more per rainy day than per dry day; sunscreen (id 9) the opposite.
    const perDay = (id: string, rainy: boolean) => {
      const month = (r: string[]) => Number(r[1]!.slice(5, 7));
      const sel = rows.filter((r) => r[3] === id && (month(r) >= 5 && month(r) <= 11) === rainy);
      return sel.reduce((n, r) => n + Number(r[6]), 0) / (rainy ? 214 : 151);
    };
    expect(perDay("10", true)).toBeGreaterThan(perDay("10", false) * 1.5);
    expect(perDay("9", false)).toBeGreaterThan(perDay("9", true));
  });

  it("coffee demand: 36 clean months, or a messy version with gaps, an outlier and a duplicate", () => {
    const clean = lines(generateSamples("coffee-demand", { dataset: "clean" })[0]!.data);
    expect(clean).toHaveLength(37);
    expect(clean.slice(1).every((l) => l.split(",")[1] !== "")).toBe(true);
    const messy = lines(generateSamples("coffee-demand", { dataset: "messy" })[0]!.data);
    expect(messy).toHaveLength(38);
    expect(messy.filter((l) => l.split(",")[1] === "")).toHaveLength(2);
    expect(messy.at(-1)).toBe(messy[12]);
    const units = messy.slice(1).map((l) => Number(l.split(",")[1])).filter(Boolean);
    expect(Math.max(...units)).toBeGreaterThan(5000);
  });
});
