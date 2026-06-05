/**
 * Local ingest smoke test for Pravin PowerBank Amazon parse.
 * Usage: node scripts/test-pravin-powerbank-parse.mjs [path-to-xlsx]
 */
import { readFileSync } from "node:fs";
import { parseSelloutFromBuffer } from "../src/parsers.ts";
import {
  PRAVIN_POWERBANK_SUB_LABEL,
  productMatchesPravinTopCategory,
} from "../src/pravin-category-scope.ts";
import {
  currentFyMonthYms,
  priorFyMonthYms,
  sumChannelUnitsForMonthKeys,
  sumCurrentFyUnitsFromMonthMap,
} from "../src/category-sellout-insights.ts";

const path =
  process.argv[2] ||
  "C:\\Users\\Admin\\Downloads\\ROMA & Powerbank Sellout Report of AZ & Flipkart till 3rd June 2026.xlsx";

const fileBuf = readFileSync(path);
const buf = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);

const snap = "2026-06-03";
const t0 = performance.now();

const az = parseSelloutFromBuffer(buf, {
  fileName: path.split(/[/\\]/).pop() ?? "workbook.xlsx",
  marketplace: "amazon",
  snapshotDate: snap,
  catalogWorkspace: "pravin",
  pravinWorkbook: true,
  flipkartEolFromDb: new Set(),
});

const pbCodes = new Set();
for (const p of az.products) {
  if (
    productMatchesPravinTopCategory(PRAVIN_POWERBANK_SUB_LABEL, {
      category: p.category,
      sub_category: p.sub_category,
      product_name: p.product_name,
    })
  ) {
    pbCodes.add(p.product_code.toUpperCase());
  }
}

const monthly = new Map();
for (const d of az.dailySales) {
  if (!pbCodes.has(d.product_code.toUpperCase())) continue;
  const ym = d.sale_date.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) continue;
  monthly.set(ym, (monthly.get(ym) ?? 0) + Number(d.units_sold ?? 0));
}

let may = 0;
let mtd = 0;
for (const m of az.metricInputs) {
  if (!pbCodes.has(m.product_code.toUpperCase())) continue;
  may += Number(m.apr_so_units ?? 0);
  mtd += Number(m.may_mtd_units ?? 0);
}

const prior = sumChannelUnitsForMonthKeys(monthly, priorFyMonthYms(snap));
const cur = sumCurrentFyUnitsFromMonthMap(monthly, currentFyMonthYms(snap), "2026-06", mtd);

console.log("Parse ms:", Math.round(performance.now() - t0));
console.log("Amazon PB listings:", pbCodes.size);
console.log("Prior FY (month map):", prior, "expected ~111031");
console.log("Current FY:", cur, "expected ~14968");
console.log("May:", may, "expected ~7853");
console.log("Jun MTD:", mtd, "expected ~642");
console.log("Month map rows:", monthly.size);
