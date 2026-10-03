/**
 * Downloads the official Azure architecture icon set and extracts the icons Gaia uses (also available from
 * the app's setup and Settings screens). The icons are Microsoft's and are not committed to this repository.
 *
 *   npm run icons -- --accept-terms
 */
import { downloadIcons, ICONS_TERMS } from "../server/icons.ts";

if (!process.argv.includes("--accept-terms")) {
  console.error(`The Azure architecture icons are provided by Microsoft under these terms:\n  ${ICONS_TERMS}\nRe-run with --accept-terms to download them.`);
  process.exit(1);
}

const r = await downloadIcons({ log: (s) => console.log(s) });
if (r.missing.length) console.warn(`Not found in this release (generic glyph will be used): ${r.missing.join(", ")}`);