/**
 * Quick sanity check for AZ sellout workbook month columns vs row-0 totals.
 * Usage: node scripts/validate-az-sellout.mjs "path/to/file.xlsx"
 */
import XLSX from "xlsx";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const path =
  process.argv[2] ||
  "c:/Users/Admin/Downloads/AZ(A) - Zebronics Sellout report till 24th May  & Warehouse Report as on 24th May 2026.xlsx";

function parseMonth(h) {
  const cleaned = String(h)
    .replace(/\r\n/g, " ")
    .replace(/\n/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned || /\bMTD\b/i.test(cleaned) || /^([A-Za-z]{3,9})\s+SO$/i.test(cleaned))
    return null;
  const M = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const mi = (t) => M[t.slice(0, 3).toLowerCase()];
  let m = /^(\d{4})\s+([A-Za-z]{3,9})$/i.exec(cleaned);
  if (m) return `${m[1]}-${String(mi(m[2]) + 1).padStart(2, "0")}`;
  m = /^([A-Za-z]{3,9})[-\s'](\d{2,4})$/i.exec(cleaned);
  if (m) {
    const y = Number(m[2]) < 100 ? 2000 + Number(m[2]) : Number(m[2]);
    return `${y}-${String(mi(m[1]) + 1).padStart(2, "0")}`;
  }
  return null;
}

const wb = XLSX.readFile(path, {
  sheets: ["Ecom Sellout"],
  cellDates: false,
  sheetRows: 12000,
});
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Ecom Sellout"], {
  header: 1,
  defval: "",
});
const hdr = rows[1];
const cols = hdr.map((h, i) => ({ i, ym: parseMonth(h) })).filter((x) => x.ym);
const sums = Object.fromEntries(cols.map((c) => [c.ym, 0]));
let n = 0;
for (let r = 2; r < rows.length; r++) {
  const asin = String(rows[r][0] ?? "").trim();
  if (!asin) continue;
  n++;
  for (const c of cols) sums[c.ym] += Number(rows[r][c.i]) || 0;
}
console.log("Rows with ASIN:", n);
console.log("Month columns parsed:", cols.length);
for (const c of cols.slice(0, 4)) {
  console.log(
    c.ym,
    "sum=",
    Math.round(sums[c.ym]),
    "excel-total-row=",
    Math.round(Number(rows[0][c.i]) || 0),
    "delta=",
    Math.round(sums[c.ym] - (Number(rows[0][c.i]) || 0)),
  );
}
let mtd = 0;
let aprSo = 0;
for (let r = 2; r < rows.length; r++) {
  if (!String(rows[r][0] ?? "").trim()) continue;
  mtd += Number(rows[r][18]) || 0;
  aprSo += Number(rows[r][19]) || 0;
}
console.log("May MTD sum", Math.round(mtd), "row0", Math.round(Number(rows[0][18]) || 0));
console.log("Apr SO sum", Math.round(aprSo), "row0", Math.round(Number(rows[0][19]) || 0));
