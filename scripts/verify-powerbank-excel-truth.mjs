/**
 * Excel ground truth for Pravin PowerBank — matches this workbook layout:
 * 2025 SO / 2026 SO year columns, May, 2026 Jun MTD, daily serials (not Apr-25 headers).
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const filePath =
  process.argv[2] ||
  "C:\\Users\\Admin\\Downloads\\ROMA & Powerbank Sellout Report of AZ & Flipkart till 3rd June 2026.xlsx";

function normalizeKey(v) {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[-_\s]+/g, " ")
    .replace(/[^\w\s/]/g, "")
    .trim();
}

function isPowerBank(sub, cat, name) {
  const s = normalizeKey(sub);
  const c = normalizeKey(cat);
  const n = normalizeKey(name);
  if (s === "powerbank" || s === "power bank" || c === "powerbank" || c === "power bank") return true;
  if (/\bpower\s*bank\b/.test(s) || /\bpowerbank\b/.test(s.replace(/\s+/g, ""))) return true;
  return /\bpower\s*bank\b/.test(n);
}

function excelSerialToDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 30000) return null;
  const utc = new Date(Date.UTC(1899, 11, 30 + n));
  return utc.toISOString().slice(0, 10);
}

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseSheet(ws, layout, mergePass) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  let headerIdx = 1;
  for (let r = 0; r < 10; r++) {
    if (normalizeKey((rows[r] ?? [])[0]) === "asin" || normalizeKey((rows[r] ?? [])[0]) === "fsn") {
      headerIdx = r;
      break;
    }
  }
  const header = rows[headerIdx] ?? [];
  const above = headerIdx > 0 ? rows[headerIdx - 1] ?? [] : [];
  const { codeIdx, subIdx, nameIdx, y2026, y2025, mtd, may, dailyStart } = layout;

  const byAsin = new Map();
  const cocoblu = new Set();

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const code = String(row[codeIdx] ?? "").trim();
    if (!code) continue;
    const sub = subIdx >= 0 ? String(row[subIdx] ?? "") : "";
    const name = nameIdx >= 0 ? String(row[nameIdx] ?? "") : "";
    const key = code.toUpperCase();

    const cells = {
      y2025: Math.max(0, asNum(row[y2025])),
      y2026: Math.max(0, asNum(row[y2026])),
      may: Math.max(0, asNum(row[may])),
      mtd: Math.max(0, asNum(row[mtd])),
      dailyByMonth: new Map(),
    };

    if (dailyStart >= 0) {
      for (let c = dailyStart; c < row.length; c++) {
        const day = excelSerialToDate(header[c]);
        if (!day) continue;
        const ym = day.slice(0, 7);
        const u = Math.max(0, asNum(row[c]));
        if (u <= 0) continue;
        cells.dailyByMonth.set(ym, (cells.dailyByMonth.get(ym) ?? 0) + u);
      }
    }

    const prev = byAsin.get(key);
    const add = mergePass === "cocoblu" && prev;
    if (!prev) {
      byAsin.set(key, { ...cells, isPb: isPowerBank(sub, "", name), sub, name });
    } else {
      prev.y2025 = add ? prev.y2025 + cells.y2025 : Math.max(prev.y2025, cells.y2025);
      prev.y2026 = add ? prev.y2026 + cells.y2026 : Math.max(prev.y2026, cells.y2026);
      prev.may = add ? prev.may + cells.may : Math.max(prev.may, cells.may);
      prev.mtd = add ? prev.mtd + cells.mtd : Math.max(prev.mtd, cells.mtd);
      for (const [ym, u] of cells.dailyByMonth) {
        prev.dailyByMonth.set(ym, (prev.dailyByMonth.get(ym) ?? 0) + u);
      }
      if (isPowerBank(sub, "", name)) prev.isPb = true;
    }
    if (mergePass === "cocoblu") cocoblu.add(key);
  }
  return { byAsin, cocoblu };
}

function rollup(byAsin, cocoblu, mode) {
  const out = {
    y2025: 0,
    y2026: 0,
    may: 0,
    mtd: 0,
    sku: 0,
    monthsFromDaily: new Map(),
  };
  for (const [key, row] of byAsin) {
    const include = row.isPb || cocoblu.has(key);
    if (!include) continue;
    out.sku += 1;
    if (mode === "year_cols") {
      out.y2025 += row.y2025;
      out.y2026 += row.y2026;
    }
    out.may += row.may;
    out.mtd += row.mtd;
    for (const [ym, u] of row.dailyByMonth) {
      out.monthsFromDaily.set(ym, (out.monthsFromDaily.get(ym) ?? 0) + u);
    }
  }
  return out;
}

function sumPriorFyMonths(monthly) {
  const keys = [
    "2025-04",
    "2025-05",
    "2025-06",
    "2025-07",
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
  ];
  return keys.reduce((s, k) => s + (monthly.get(k) ?? 0), 0);
}

function sumCurrentFyMonths(monthly, reportYm, mtd) {
  const keys = [
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
    "2026-10",
    "2026-11",
    "2026-12",
    "2027-01",
    "2027-02",
    "2027-03",
  ];
  let t = 0;
  for (const ym of keys) {
    if (ym > reportYm) continue;
    if (ym === reportYm) t += mtd > 0 ? mtd : (monthly.get(ym) ?? 0);
    else t += monthly.get(ym) ?? 0;
  }
  return t;
}

const wb = XLSX.read(readFileSync(filePath), { type: "buffer" });
const click = parseSheet(
  wb.Sheets.Click_tect_SO,
  {
    codeIdx: 0,
    subIdx: 1,
    nameIdx: 2,
    y2026: 5,
    y2025: 6,
    mtd: 14,
    may: 15,
    dailyStart: 19,
  },
  "click_tect",
);
const coco = parseSheet(
  wb.Sheets.Cocoblu_SO,
  {
    codeIdx: 0,
    subIdx: 2,
    nameIdx: 1,
    y2026: 4,
    y2025: 5,
    mtd: 9,
    may: 10,
    dailyStart: 14,
  },
  "cocoblu",
);

const merged = new Map(click.byAsin);
for (const [k, v] of coco.byAsin) {
  const prev = merged.get(k);
  if (!prev) merged.set(k, v);
  else {
    prev.y2025 += v.y2025;
    prev.y2026 += v.y2026;
    prev.may += v.may;
    prev.mtd += v.mtd;
    for (const [ym, u] of v.dailyByMonth) {
      prev.dailyByMonth.set(ym, (prev.dailyByMonth.get(ym) ?? 0) + u);
    }
    if (v.isPb) prev.isPb = true;
  }
}
const allCocoblu = coco.cocoblu;

const azYear = rollup(merged, allCocoblu, "year_cols");
const azDailyOnly = rollup(merged, allCocoblu, "daily");

const priorFromDaily = sumPriorFyMonths(azDailyOnly.monthsFromDaily);
const currentFromDaily = sumCurrentFyMonths(
  azDailyOnly.monthsFromDaily,
  "2026-06",
  azDailyOnly.mtd,
);

const flip = parseSheet(
  wb.Sheets.Flipkart,
  { codeIdx: 0, subIdx: 2, nameIdx: 1, y2026: 5, y2025: 6, mtd: 9, may: 10, dailyStart: 14 },
  null,
);
const fk = rollup(flip.byAsin, new Set(), "year_cols");

console.log("=== Amazon PowerBank (Click_tect + Cocoblu ASINs) ===");
console.log("Listings:", azYear.sku);
console.log("\n--- Year columns (2025 SO / 2026 SO) ---");
console.log("Sum 2025 SO (prior FY year col):", azYear.y2025);
console.log("Sum 2026 SO (current FY year col):", azYear.y2026);
console.log("May column:", azYear.may);
console.log("Jun MTD:", azYear.mtd);
console.log("\n--- Method A: prior FY months from daily serials → month buckets ---");
console.log("Prior FY month sum:", priorFromDaily);
console.log("Current FY (months+Jun MTD rule):", currentFromDaily);
console.log("\n--- App screenshot ---");
console.log("FY 25-26 AZ: 71,646 | FK: 36,986 | total 108,632");
console.log("FY 26-27 AZ: 7,801 | FK: 7,824");
console.log("May AZ: 7,853 | Jun MTD AZ: 642");

console.log("\n=== Flipkart PowerBank only ===");
console.log("Listings:", fk.sku);
console.log("2025 SO:", fk.y2025);
console.log("2026 SO:", fk.y2026);
console.log("May:", fk.may);
console.log("Jun MTD:", fk.mtd);
