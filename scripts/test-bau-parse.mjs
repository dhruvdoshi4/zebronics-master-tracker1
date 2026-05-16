import XLSX from "xlsx";
import { readFileSync } from "fs";

const BAU_ALIASES = ["bau sp", "bau price", "bau rate", "bau", "mrp bau"];
const ASIN_ALIASES = ["asin"];
const FSN_ALIASES = ["fsn"];

function normalizeKey(v) {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[-_\s]+/g, " ")
    .replace(/[^\w\s/]/g, "")
    .trim();
}

function findCol(headers, aliases) {
  for (const alias of aliases) {
    const exact = headers.findIndex((h) => h === alias);
    if (exact >= 0) return exact;
    const inc = headers.findIndex((h) => h && h.includes(alias));
    if (inc >= 0) return inc;
  }
  return -1;
}

const buf = readFileSync(process.argv[2] || "c:/Users/Admin/Downloads/FK and AZ BAU.xlsx");
const wb = XLSX.read(buf);
let total = 0;
for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
  const h = (rows[0] ?? []).map(normalizeKey);
  const bauIdx = findCol(h, BAU_ALIASES);
  const asinIdx = findCol(h, ASIN_ALIASES);
  const fsnIdx = findCol(h, FSN_ALIASES);
  let count = 0;
  for (let r = 1; r < rows.length; r++) {
    const bau = Number(String(rows[r]?.[bauIdx] ?? "").replace(/,/g, ""));
    if (bau > 0) count++;
  }
  total += count;
  console.log(name, { bauIdx, asinIdx, fsnIdx, count });
}
console.log("total rows with BAU", total);
