import type { Blueprint } from "../blueprints.ts";
import { cafe } from "./cafe.ts";
import { clinica } from "./clinica.ts";
import { cooperativa } from "./cooperativa.ts";
import { facturas } from "./facturas.ts";
import { farmacia } from "./farmacia.ts";
import { guia } from "./guia.ts";
import { fincas } from "./fincas.ts";
import { pulperia } from "./pulperia.ts";
import { resenas } from "./resenas.ts";
import { soda } from "./soda.ts";
import { sucursales } from "./sucursales.ts";
import { tour } from "./tour.ts";
import { ventas } from "./ventas.ts";
import { taller } from "./taller.ts";

/** Built-in showcase blueprints, in catalog order. One file per lab; the specs live in docs/catalog/. */
export const CATALOG: Blueprint<any>[] = [farmacia, taller, cooperativa, soda, pulperia, facturas, resenas, clinica, fincas, ventas, tour, cafe, guia, sucursales];
