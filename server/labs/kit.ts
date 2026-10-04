import { z } from "zod";

/** Zod boolean that also accepts the strings a form or query might send. */
export const flag = (d: boolean) => z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).default(d);
