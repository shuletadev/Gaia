import { crc32, deflateSync } from "node:zlib";

/**
 * Synthetic sample data for classroom labs. Everything here is invented and deterministic (seeded), so a lab
 * deployed twice gets the same files, nothing real is ever uploaded, and no binaries live in git.
 */

export interface SampleFile {
  /** Path inside the upload folder (forward slashes). */
  path: string;
  data: Buffer;
}

export type Generator = (params: Record<string, unknown>) => SampleFile[];

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
const text = (s: string) => Buffer.from(s, "utf8");

// ---- Minimal PDF (text only, Helvetica, Latin-1) ------------------------------------------------

/** One-page text PDF. Text is encoded as Latin-1 (WinAnsi), which covers Spanish accents. */
export function pdf(lines: string[], opts: { size?: number } = {}): Buffer {
  const size = opts.size ?? 11;
  const esc = (s: string) => s.replace(/[\\()]/g, (m) => `\\${m}`);
  const body = ["BT", `/F1 ${size} Tf`, `${size + 4} TL`, "50 800 Td", ...lines.flatMap((l) => [`(${esc(l)}) Tj`, "T*"]), "ET"].join("\n");
  const stream = Buffer.from(body, "latin1");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets: number[] = [];
  const add = (b: Buffer) => {
    offsets.push(parts.reduce((n, p) => n + p.length, 0));
    parts.push(b);
  };
  objs.forEach((o, i) => add(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, "latin1")));
  add(Buffer.concat([Buffer.from(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream\nendobj\n", "latin1")]));
  const xrefAt = parts.reduce((n, p) => n + p.length, 0);
  const xref = ["xref", `0 ${offsets.length + 1}`, "0000000000 65535 f ", ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `)].join("\n");
  parts.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts);
}

// ---- Minimal PNG --------------------------------------------------------------------------------

export function png(w: number, h: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const crc = (n: number) => `₡${n.toLocaleString("en-US")}`.replace("₡", "CRC ");

// ---- Lab 07: invoices and receipts --------------------------------------------------------------

const SUPPLIERS = [
  { name: "Distribuidora Meseta Central S.A.", id: "3-101-000123", city: "San José" },
  { name: "Importadora Valle del Café Ltda.", id: "3-102-000456", city: "Heredia" },
  { name: "Suministros Pura Vida S.A.", id: "3-101-000789", city: "Alajuela" },
  { name: "Comercial Los Volcanes S.A.", id: "3-101-000321", city: "Cartago" },
  { name: "Papelería y Más Tres Ríos Ltda.", id: "3-102-000654", city: "Cartago" },
  { name: "Ferretería La Fortuna S.A.", id: "3-101-000987", city: "San Carlos" },
];
const ITEMS = ["Acetaminofén 500 mg caja 100", "Alcohol en gel 250 ml", "Guantes de látex caja 50", "Papel higiénico paquete 12", "Café molido 1 kg", "Azúcar 2 kg", "Bolsas plásticas paquete 100", "Detergente líquido 1 L", "Tinta para impresora", "Resma de papel carta"];

function invoices(): SampleFile[] {
  const r = rng(7);
  const files: SampleFile[] = [];
  SUPPLIERS.forEach((s, i) => {
    const lines = Array.from({ length: 2 + Math.floor(r() * 3) }, () => {
      const qty = 1 + Math.floor(r() * 9);
      const unit = 800 + Math.floor(r() * 24) * 250;
      return { item: pick(r, ITEMS), qty, unit };
    });
    const sub = lines.reduce((n, l) => n + l.qty * l.unit, 0);
    const iva = Math.round(sub * 0.13);
    const n = 100 + i * 7;
    const day = String(3 + i * 4).padStart(2, "0");
    files.push({
      path: `facturas/factura-${s.id.replace(/-/g, "")}-${n}.pdf`,
      data: pdf([
        s.name,
        `Cédula jurídica ${s.id} · ${s.city}, Costa Rica`,
        "FACTURA (DOCUMENTO DE EJEMPLO, NO VÁLIDO)",
        `Factura No. FE-${String(n).padStart(8, "0")}`,
        `Fecha: 2025-09-${day}`,
        "Cliente: Farmacia Pura Vida (ficticia)",
        "",
        "Cant.  Descripción                                   Precio       Importe",
        ...lines.map((l) => `${String(l.qty).padEnd(6)} ${l.item.padEnd(42)} ${crc(l.unit).padEnd(12)} ${crc(l.qty * l.unit)}`),
        "",
        `Subtotal: ${crc(sub)}`,
        `IVA 13%: ${crc(iva)}`,
        `TOTAL: ${crc(sub + iva)}`,
      ]),
    });
  });
  return files;
}

function receipts(): SampleFile[] {
  const r = rng(11);
  const shops = ["Soda Doña Rosa (ficticia)", "Pulpería Don Beto (ficticia)", "Panadería La Espiga (ficticia)", "Verdulería El Mercadito (ficticia)"];
  return shops.map((shop, i) => {
    const lines = Array.from({ length: 3 + Math.floor(r() * 3) }, () => ({ item: pick(r, ["Casado", "Gallo pinto", "Café", "Pan dulce", "Frutas", "Arroz 1 kg", "Frijoles 1 kg", "Leche 1 L", "Huevos docena"]), amount: 600 + Math.floor(r() * 30) * 100 }));
    const total = lines.reduce((n, l) => n + l.amount, 0);
    return {
      path: `recibos/recibo-${i + 1}.pdf`,
      data: pdf([shop, "San José, Costa Rica", `Tiquete ${1000 + i * 13}`, `2025-09-${String(10 + i * 3).padStart(2, "0")} 1${i}:2${i}`, "", ...lines.map((l) => `${l.item.padEnd(30)} ${crc(l.amount)}`), "", `TOTAL ${crc(total)}`, "Gracias por su compra. Documento de ejemplo."], { size: 12 }),
    };
  });
}

// ---- Lab 08: tourist reviews --------------------------------------------------------------------

const REVIEWS_ES = [
  "El desayuno estuvo buenísimo, el gallo pinto con huevo y natilla, pura vida.",
  "Muy tuanis el hotel, el personal super amable y la vista al volcán es una chiva.",
  "El cuarto estaba limpio pero el aire acondicionado hacía un ruido horrible toda la noche.",
  "Carísimo para lo que ofrecen, mae. El agua caliente nunca llegó a la habitación.",
  "Qué lindo todo, ojalá hubiera wifi que sirviera. Lo demás perfecto.",
  "Buenísimo el servicio, pero el camino para llegar es una trocha, casi no llegamos.",
  "Sí, claro, el 'vista al mar' era un pedacito de mar entre dos edificios. Excelente publicidad.",
  "Nos encantó la piscina y los jardines. Volveremos con los niños el próximo verano.",
  "La atención en recepción fue pésima, nadie sabía nada de nuestra reserva.",
  "Todo bien, nada especial. Cumple para una noche.",
  "El tour de aves con el guía fue lo mejor del viaje, muy recomendado.",
  "Mucho ruido de la fiesta del salón hasta la una de la mañana, no pudimos dormir.",
];
const REVIEWS_EN = [
  "Beautiful lodge, the breakfast was great and the staff made us feel at home.",
  "The room was clean but the road to get here is terrible, our rental car barely made it.",
  "Overpriced for what you get. The hot water never worked and nobody fixed it.",
  "Amazing sunrise from the balcony, the birdwatching tour was the highlight of our trip.",
  "Great, another hotel where 'free wifi' means one bar of signal at the reception.",
  "Friendly staff, comfortable beds, a bit noisy on weekends. Would stay again.",
  "Nothing special. It was fine for one night.",
  "The pool is lovely and the gardens are full of hummingbirds. Pura vida!",
];
const HOTELS = ["Hotel Nubes del Norte (ficticio)", "Cabinas Río Claro (ficticias)", "Lodge Mirador del Volcán (ficticio)", "Hostal La Ceiba (ficticio)"];

function reviews(params: Record<string, unknown>): SampleFile[] {
  const r = rng(23);
  const rows = ["id,hotel,idioma,fecha,texto"];
  const count = params.dataset === "small" ? 20 : 60;
  for (let i = 1; i <= count; i++) {
    const es = r() < 0.65;
    const t = pick(r, es ? REVIEWS_ES : REVIEWS_EN);
    const m = 1 + Math.floor(r() * 9);
    const d = 1 + Math.floor(r() * 27);
    rows.push([i, pick(r, HOTELS), es ? "es" : "en", `2025-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, `"${t.replace(/"/g, '""')}"`].join(","));
  }
  return [{ path: "resenas/resenas.csv", data: text(rows.join("\n") + "\n") }];
}

// ---- Lab 10: coffee farm archive ----------------------------------------------------------------

function farmArchive(): SampleFile[] {
  const r = rng(31);
  const files: SampleFile[] = [];
  const farms = ["finca-la-esperanza", "finca-el-mirador", "finca-san-rafael"];
  let n = 0;
  for (const farm of farms) {
    for (const year of [2021, 2023, 2025]) {
      const hue = [r() * 60 + 80, r() * 40 + 20, r() * 40 + 160][n % 3]!;
      files.push({
        path: `${farm}/fotos/cosecha-${year}-${String(1 + (n % 12)).padStart(2, "0")}-15.png`,
        data: png(160, 100, (x, y) => {
          const g = y / 100;
          const dx = x - 80 - Math.sin(n) * 30;
          const dy = y - 60;
          const sun = dx * dx + dy * dy < 400;
          return sun ? [240, 200, 80] : [Math.round(hue * (1 - g) + 30), Math.round(120 + 80 * g), Math.round(60 + 40 * (1 - g))];
        }),
      });
      n++;
    }
    files.push({
      path: `${farm}/informes/suelo-2025.csv`,
      data: text(["parcela,ph,materia_organica_pct,nitrogeno_ppm", ...Array.from({ length: 6 }, (_, i) => `${i + 1},${(4.8 + r() * 1.2).toFixed(1)},${(3 + r() * 3).toFixed(1)},${Math.round(15 + r() * 20)}`)].join("\n") + "\n"),
    });
  }
  files.push({ path: "LEEME.txt", data: text("Archivo de ejemplo de la cooperativa cafetalera (datos y fotos sintéticos para clase).\n") });
  return files;
}

// ---- Lab 09: tourism brochures ------------------------------------------------------------------

function brochures(): SampleFile[] {
  const docs: [string, string[]][] = [
    ["senderos", ["Reserva Nubes del Sur (ficticia): senderos", "", "Sendero Mirador: 2,4 km, dificultad baja, 1 hora y 30 minutos.", "Sendero Cascada Escondida: 4,8 km, dificultad media, 3 horas.", "Sendero Cumbre: 7,5 km, dificultad alta, 5 horas. Solo con guía.", "Todos los senderos cierran a las 3:00 p. m. por seguridad.", "Se recomienda calzado cerrado, impermeable y agua."]],
    ["horarios", ["Reserva Nubes del Sur (ficticia): horarios", "", "Apertura: todos los días de 7:00 a. m. a 4:00 p. m.", "Última entrada: 2:00 p. m.", "Cerrada el 25 de diciembre y el 1 de enero.", "Tour de aves al amanecer: 5:30 a. m., salida desde la recepción.", "Tour nocturno: solo sábados, 6:00 p. m., cupo de 12 personas."]],
    ["precios", ["Reserva Nubes del Sur (ficticia): tarifas", "", "Entrada nacional adulto: 4 000 colones.", "Entrada extranjero adulto: 18 dólares.", "Niños de 6 a 12 años: mitad de precio. Menores de 6: gratis.", "Guía privado (hasta 6 personas): 35 dólares.", "Tour nocturno: 28 dólares por persona.", "Los precios son de ejemplo para esta clase."]],
    ["seguridad", ["Reserva Nubes del Sur (ficticia): seguridad", "", "No salga de los senderos marcados.", "No alimente a los animales.", "En caso de tormenta eléctrica, regrese a la recepción.", "Teléfono de emergencias del país: 911.", "Hay botiquín y personal de primeros auxilios en la recepción."]],
    ["preguntas", ["Reserva Nubes del Sur (ficticia): preguntas frecuentes", "", "¿Se permiten mascotas? No.", "¿Hay alimentación? Sí, una soda con almuerzo de 11:00 a. m. a 2:00 p. m.", "¿Hay transporte? No; hay estacionamiento gratuito para 40 vehículos.", "¿Puedo reservar? Sí, por correo con 48 horas de anticipación.", "¿Aceptan tarjetas? Sí, y también efectivo en colones."]],
  ];
  return docs.map(([n, lines]) => ({ path: `folletos/${n}.pdf`, data: pdf(lines, { size: 12 }) }));
}

// ---- Lab 11: pharmacy sales ---------------------------------------------------------------------

const PRODUCTS = [
  { id: 1, name: "Acetaminofén 500 mg (20 tab)", cat: "Medicamentos", price: 1850, rain: 1.0 },
  { id: 2, name: "Ibuprofeno 400 mg (10 tab)", cat: "Medicamentos", price: 1500, rain: 1.2 },
  { id: 3, name: "Loratadina 10 mg (10 tab)", cat: "Medicamentos", price: 2300, rain: 1.6 },
  { id: 4, name: "Suero oral (sobre)", cat: "Medicamentos", price: 950, rain: 1.3 },
  { id: 5, name: "Omeprazol 20 mg (14 cáps)", cat: "Medicamentos", price: 3200, rain: 1.0 },
  { id: 6, name: "Vitamina C 1 g (30 tab)", cat: "Vitaminas", price: 4800, rain: 1.4 },
  { id: 7, name: "Multivitamínico (60 tab)", cat: "Vitaminas", price: 9500, rain: 1.0 },
  { id: 8, name: "Zinc 50 mg (30 tab)", cat: "Vitaminas", price: 5200, rain: 1.2 },
  { id: 9, name: "Protector solar FPS 50", cat: "Cuidado personal", price: 11800, rain: 0.5 },
  { id: 10, name: "Repelente de insectos", cat: "Cuidado personal", price: 4300, rain: 1.8 },
  { id: 11, name: "Alcohol en gel 250 ml", cat: "Cuidado personal", price: 2100, rain: 1.0 },
  { id: 12, name: "Termómetro digital", cat: "Cuidado personal", price: 6900, rain: 1.1 },
];

function pharmacySales(params: Record<string, unknown>): SampleFile[] {
  const years = params.dataSize === "three" ? [2023, 2024, 2025] : [2025];
  const r = rng(41);
  const rows = ["sale_id,fecha,hora,producto_id,producto,categoria,cantidad,precio_unitario,total"];
  let id = 1;
  for (const year of years) {
    for (let day = 0; day < 365; day++) {
      const d = new Date(Date.UTC(year, 0, 1 + day));
      const month = d.getUTCMonth() + 1;
      const rainy = month >= 5 && month <= 11;
      const dow = d.getUTCDay();
      const sales = Math.round((9 + (dow === 6 ? 5 : dow === 0 ? -3 : 0) + (month === 12 ? 4 : 0)) * (0.8 + r() * 0.5));
      for (let s = 0; s < sales; s++) {
        const hour = Math.min(20, Math.max(8, Math.round(13 + (r() + r() + r() - 1.5) * 8)));
        const minute = Math.floor(r() * 60);
        for (let l = 0; l < 1 + Math.floor(r() * 3); l++) {
          // Weighted pick: products that sell more in the rainy season show up more then.
          const weights = PRODUCTS.map((p) => (rainy ? p.rain : 1 / p.rain));
          let x = r() * weights.reduce((a, b) => a + b, 0);
          let p = PRODUCTS[0]!;
          for (let k = 0; k < PRODUCTS.length; k++) {
            x -= weights[k]!;
            if (x <= 0) {
              p = PRODUCTS[k]!;
              break;
            }
          }
          const qty = 1 + Math.floor(r() * r() * 3);
          rows.push([id++, d.toISOString().slice(0, 10), `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, p.id, `"${p.name}"`, p.cat, qty, p.price, p.price * qty].join(","));
        }
      }
    }
  }
  return [{ path: "ventas/ventas.csv", data: text(rows.join("\n") + "\n") }];
}

// ---- Lab 14: coffee demand ----------------------------------------------------------------------

function coffeeDemand(params: Record<string, unknown>): SampleFile[] {
  const messy = params.dataset === "messy";
  const r = rng(53);
  const rows = ["mes,unidades_vendidas,precio_promedio,promocion,temperatura_media"];
  for (let i = 0; i < 36; i++) {
    const year = 2023 + Math.floor(i / 12);
    const m = (i % 12) + 1;
    // Cold, rainy months and the December holidays sell more; slow growth over three years.
    const season = 1 + 0.25 * Math.cos(((m - 12) / 12) * 2 * Math.PI) + (m === 12 ? 0.2 : 0);
    const promo = r() < 0.2 ? 1 : 0;
    let units = Math.round(900 * season * (1 + i * 0.008) * (1 + promo * 0.12) * (0.95 + r() * 0.1));
    const price = (2800 + r() * 300).toFixed(0);
    const temp = (21 + 3 * Math.sin(((m - 3) / 12) * 2 * Math.PI) + r()).toFixed(1);
    let unitsText = String(units);
    if (messy) {
      if (i === 7 || i === 19) unitsText = ""; // gaps
      if (i === 27) unitsText = String(units * 10); // an outlier (extra zero)
    }
    rows.push([`${year}-${String(m).padStart(2, "0")}`, unitsText, price, promo, temp].join(","));
  }
  if (messy) rows.push(rows[12]!); // a duplicated row
  return [{ path: "datos/demanda-cafe.csv", data: text(rows.join("\n") + "\n") }];
}

export const GENERATORS: Record<string, Generator> = {
  "invoices-receipts": (p) => (p.sampleSet === "invoices" ? invoices() : [...invoices(), ...receipts()]),
  "tourist-reviews": reviews,
  "farm-archive": farmArchive,
  "tourism-brochures": brochures,
  "pharmacy-sales": pharmacySales,
  "coffee-demand": coffeeDemand,
};

export function generateSamples(name: string, params: Record<string, unknown> = {}): SampleFile[] {
  const g = GENERATORS[name];
  if (!g) throw new Error(`Unknown sample generator ${name}`);
  return g(params);
}
