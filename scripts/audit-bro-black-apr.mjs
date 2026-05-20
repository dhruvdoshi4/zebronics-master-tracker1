/**
 * Find "bro" models on Zepto sheet — compare Apr-26 column vs sum of April daily cells.
 */
import * as XLSX from "xlsx";
import { readFileSync, existsSync } from "node:fs";

const FILE =
  process.argv[2] ??
  "c:\\Users\\Admin\\Downloads\\Quick-com Sell Out Report till 18th May 2026.xlsx";

if (!existsSync(FILE)) {
  console.log("FILE_MISSING:", FILE);
  process.exit(1);
}

const SNAPSHOT = "2026-05-18";
const wb = XLSX.read(readFileSync(FILE), { type: "buffer", cellDates: true });
const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === "zepto") ?? "Zepto";
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
  header: 1,
  defval: "",
  raw: false,
});

const norm = (s) => String(s ?? "").trim().toLowerCase();
let hr = 0;
for (let i = 0; i < Math.min(rows.length, 20); i++) {
  const h = (rows[i] ?? []).map(norm);
  if (h.some((x) => x.includes("pvid") || x === "model")) {
    hr = i;
    break;
  }
}

const rawH = (rows[hr] ?? []).map((c) => String(c ?? "").trim());
const h = rawH.map(norm);
const modelIdx = h.findIndex((x) => x === "model");
const pvidIdx = h.findIndex((x) => x === "pvid");

const MONTH = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function parseMonHeader(raw) {
  const m = /^([A-Za-z]{3,9})[-\s'](\d{2,4})$/i.exec(String(raw ?? "").trim());
  if (!m) return null;
  const mo = MONTH[m[1].slice(0, 3).toLowerCase()];
  if (mo === undefined) return null;
  const y = Number(m[2]) < 100 ? 2000 + Number(m[2]) : Number(m[2]);
  return `${y}-${String(mo + 1).padStart(2, "0")}`;
}

const monthCols = rawH
  .map((raw, i) => ({ i, ym: parseMonHeader(raw) }))
  .filter((x) => x.ym);
const aprCol = monthCols.find((x) => x.ym === "2026-04");
const marCol = monthCols.find((x) => x.ym === "2026-03");

function asNum(v) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseDailyMonth(raw) {
  const short = /^(\d{1,2})\/([A-Za-z]{3})$/i.exec(String(raw ?? "").trim());
  if (!short) return null;
  const mo = MONTH[short[2].slice(0, 3).toLowerCase()];
  if (mo === undefined) return null;
  const snap = new Date(`${SNAPSHOT}T12:00:00`);
  let year = snap.getFullYear();
  if (mo > snap.getMonth() + 2) year -= 1;
  return `${year}-${String(mo + 1).padStart(2, "0")}`;
}

console.log("Sheet:", sheetName, "| Apr-26 col:", aprCol?.i, "| Mar-26 col:", marCol?.i);

for (let r = hr + 1; r < rows.length; r++) {
  const row = rows[r] ?? [];
  const model = modelIdx >= 0 ? String(row[modelIdx] ?? "") : "";
  if (!/bro/i.test(model)) continue;

  let aprDaily = 0;
  let marDaily = 0;
  for (let i = 0; i < rawH.length; i++) {
    const ym = parseDailyMonth(rawH[i]);
    if (!ym) continue;
    const u = asNum(row[i]);
    if (ym === "2026-04") aprDaily += u;
    if (ym === "2026-03") marDaily += u;
  }

  const aprSheet = aprCol ? asNum(row[aprCol.i]) : 0;
  const marSheet = marCol ? asNum(row[marCol.i]) : 0;
  const pvid = pvidIdx >= 0 ? String(row[pvidIdx] ?? "").trim() : "";

  console.log({
    model,
    pvid,
    mar26_sheet: marSheet,
    apr26_sheet: aprSheet,
    mar26_from_daily_sum: marDaily,
    apr26_from_daily_sum: aprDaily,
    apr_if_both_added: aprSheet + aprDaily,
    mar_if_both_added: marSheet + marDaily,
  });
}
