/**
 * Audit Quick Commerce May 2026 workbook vs app FY logic.
 * Run: node scripts/audit-qcom-may-2026.mjs
 */
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const FILE =
  process.argv[2] ??
  "c:\\Users\\Admin\\Downloads\\Quick-com Sell Out Report till 18th May 2026.xlsx";
const SNAPSHOT = "2026-05-18";

function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, " ")
    .replace(/[^\w\s/]/g, "")
    .trim();
}

function asNum(v) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function getCurrentFyStart(date) {
  const year = date.getFullYear();
  return date.getMonth() >= 3 ? year : year - 1;
}

const MONTH_LOOKUP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDailyHeader(rawHeader, snapshotDate) {
  const raw = String(rawHeader ?? "").trim();
  if (!raw) return null;
  if (/^20\d{2}\s+so$/i.test(raw)) return null;
  if (/mtd/i.test(raw) && !/gmt|202\d/i.test(raw)) return null;
  if (/gmt|202\d/i.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const short = /^(\d{1,2})\/([A-Za-z]{3})$/i.exec(raw);
  if (short) {
    const day = Number(short[1]);
    const month = MONTH_LOOKUP[short[2].slice(0, 3).toLowerCase()];
    if (month === undefined) return null;
    const snap = new Date(`${snapshotDate}T12:00:00`);
    let year = snap.getFullYear();
    if (month > snap.getMonth() + 2) year -= 1;
    const d = new Date(year, month, day);
    return d.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

const SHEETS = {
  zepto: "Zepto",
  blinkit: "Blinkit",
  instamart: "Swiggy",
  bigbasket: "BigBasket",
};

const wb = XLSX.read(readFileSync(FILE), { type: "buffer", cellDates: true });
const snap = new Date(`${SNAPSHOT}T12:00:00`);
const currentFyStart = getCurrentFyStart(snap);
const priorFyStart = currentFyStart - 1;

console.log("=".repeat(72));
console.log("FILE:", FILE);
console.log("SNAPSHOT:", SNAPSHOT);
console.log("App getCurrentFyStart():", currentFyStart, "→ Current FY = Apr", currentFyStart, "– Mar", currentFyStart + 1);
console.log("App priorFyStart:", priorFyStart, "→ Prior FY = Apr", priorFyStart, "– Mar", priorFyStart + 1);
console.log("User expectation: Prior FY Apr 2025–Mar 2026 | Current FY Apr 2026–Mar 2027");
console.log("=".repeat(72));

function detectHeader(rows) {
  const PRODUCT = ["asin", "asin/fsn", "sku"];
  const LISTING = ["item id", "item code", "pvid"];
  let best = 0,
    bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const h = (rows[i] ?? []).map(norm);
    const ok =
      h.some((x) => PRODUCT.some((a) => x === a || x.includes(a))) ||
      h.some((x) => LISTING.some((a) => x === a || x.includes(a)));
    if (!ok) continue;
    const score = Number(h.some((x) => x === "model")) + Number(h.some((x) => x === "category"));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function analyzeSheet(sheetName) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: false,
  });
  const hr = detectHeader(rows);
  const rawHeaders = (rows[hr] ?? []).map((c) => String(c ?? "").trim());
  const headers = rawHeaders.map(norm);

  const idx = (aliases) => {
    for (const a of aliases) {
      const e = headers.findIndex((h) => h === a);
      if (e >= 0) return e;
      const p = headers.findIndex((h) => h && h.includes(a));
      if (p >= 0) return p;
    }
    return -1;
  };

  const productIdx = idx(["asin", "asin/fsn", "sku"]);
  const listingIdx = idx(["item id", "item code", "pvid"]);
  const modelIdx = idx(["model"]);
  const catIdx = idx(["category"]);
  const totalSoIdx = headers.findIndex((h) => h === "total so");
  const so2026Idx = headers.findIndex((h) => h === "2026 so");
  const so2025Idx = headers.findIndex((h) => h === "2025 so");
  const so2024Idx = headers.findIndex((h) => h === "2024 so");
  const mtdIdx = headers.findIndex(
    (h) => h.includes("may") && h.includes("mtd") && !h.includes("nlc"),
  );

  const dailyCols = rawHeaders
    .map((h, i) => ({ i, d: parseDailyHeader(h, SNAPSHOT) }))
    .filter((x) => x.d);

  const dailyDates = dailyCols.map((x) => x.d).sort();
  const minD = dailyDates[0];
  const maxD = dailyDates[dailyDates.length - 1];

  let sum2025So = 0,
    sum2026So = 0,
    sumTotalSo = 0,
    sumMtd = 0,
    sumDailyAll = 0;
  const byMonth = new Map();
  const byMonthCurrentFy = new Map();
  const byMonthPriorFy = new Map();
  const categories = new Map();

  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const listing = listingIdx >= 0 ? String(row[listingIdx] ?? "").trim() : "";
    const asin = productIdx >= 0 ? String(row[productIdx] ?? "").trim() : "";
    const code = /^B0/i.test(asin) ? asin.toUpperCase() : listing || asin;
    if (!code || code === "-") continue;

    const cat = catIdx >= 0 ? String(row[catIdx] ?? "").trim() : "";
    const so25 = so2025Idx >= 0 ? asNum(row[so2025Idx]) : 0;
    const so26 = so2026Idx >= 0 ? asNum(row[so2026Idx]) : 0;
    const mtd = mtdIdx >= 0 ? asNum(row[mtdIdx]) : 0;
    sum2025So += so25;
    sum2026So += so26;
    sumTotalSo += totalSoIdx >= 0 ? asNum(row[totalSoIdx]) : 0;
    sumMtd += mtd;

    let rowDaily = 0;
    for (const col of dailyCols) {
      const u = asNum(row[col.i]);
      rowDaily += u;
      sumDailyAll += u;
      const ym = col.d.slice(0, 7);
      byMonth.set(ym, (byMonth.get(ym) ?? 0) + u);
      const [y, m] = ym.split("-").map(Number);
      const fyStart = m >= 4 ? y : y - 1;
      if (fyStart === currentFyStart) {
        byMonthCurrentFy.set(ym, (byMonthCurrentFy.get(ym) ?? 0) + u);
      }
      if (fyStart === priorFyStart) {
        byMonthPriorFy.set(ym, (byMonthPriorFy.get(ym) ?? 0) + u);
      }
    }

    if (cat) {
      const c = categories.get(cat) ?? {
        rows: 0,
        so2025: 0,
        so2026: 0,
        mtd: 0,
        daily: 0,
        dailyPriorFy: 0,
        dailyCurrentFy: 0,
      };
      c.rows += 1;
      c.so2025 += so25;
      c.so2026 += so26;
      c.mtd += mtd;
      c.daily += rowDaily;
      for (const col of dailyCols) {
        const u = asNum(row[col.i]);
        const ym = col.d.slice(0, 7);
        const [y, m] = ym.split("-").map(Number);
        const fyStart = m >= 4 ? y : y - 1;
        if (fyStart === priorFyStart) c.dailyPriorFy += u;
        if (fyStart === currentFyStart) c.dailyCurrentFy += u;
      }
      categories.set(cat, c);
    }
  }

  const sumDailyPriorFy = [...byMonthPriorFy.values()].reduce((a, b) => a + b, 0);
  const sumDailyCurrentFy = [...byMonthCurrentFy.values()].reduce((a, b) => b, 0);

  return {
    sheetName,
    hr,
    rowCount: rows.length - hr - 1,
    hasAsin: productIdx >= 0,
    listingCol: headers[listingIdx] ?? "?",
    dailyColCount: dailyCols.length,
    dailyRange: `${minD} → ${maxD}`,
    monthsInDaily: [...byMonth.keys()].sort().join(", "),
    sum2025So,
    sum2026So,
    sumTotalSo,
    sumMtd,
    sumDailyAll,
    sumDailyPriorFy,
    sumDailyCurrentFy,
    priorFyMonths: [...byMonthPriorFy.entries()].sort(([a], [b]) => a.localeCompare(b)),
    currentFyMonths: [...byMonthCurrentFy.entries()].sort(([a], [b]) => a.localeCompare(b)),
    categories,
  };
}

const channelStats = [];
for (const [ch, sheet] of Object.entries(SHEETS)) {
  const s = analyzeSheet(sheet);
  channelStats.push({ ch, ...s });
  console.log(`\n--- ${sheet} (${ch}) ---`);
  console.log("Rows:", s.rowCount, "| ASIN col:", s.hasAsin, "| Listing:", s.listingCol);
  console.log("Daily columns:", s.dailyColCount, "| Range:", s.dailyRange);
  console.log("Months present in daily:", s.monthsInDaily);
  console.log("Sheet totals:");
  console.log("  2025 SO (app uses as prior_fy_so):", s.sum2025So.toLocaleString());
  console.log("  2026 SO:", s.sum2026So.toLocaleString());
  console.log("  May MTD:", s.sumMtd.toLocaleString());
  console.log("  Sum ALL daily cols:", s.sumDailyAll.toLocaleString());
  console.log("  Sum daily in PRIOR FY (Apr25–Mar26):", s.sumDailyPriorFy.toLocaleString());
  console.log("  Sum daily in CURRENT FY (Apr26+):", s.sumDailyCurrentFy.toLocaleString());
  console.log("  GAP: 2025 SO vs daily prior FY:", (s.sum2025So - s.sumDailyPriorFy).toLocaleString());
  console.log("  GAP: 2026 SO vs daily current FY:", (s.sum2026So - s.sumDailyCurrentFy).toLocaleString());
  console.log("  GAP: 2026 SO vs daily+MTD approx:", (s.sum2026So - (s.sumDailyCurrentFy)).toLocaleString(), "(MTD may overlap May daily)");
  if (s.priorFyMonths.length) {
    console.log("  Prior FY months from daily:", s.priorFyMonths.map(([m, u]) => `${m}:${u}`).join(" "));
  }
  if (s.currentFyMonths.length) {
    console.log("  Current FY months from daily:", s.currentFyMonths.map(([m, u]) => `${m}:${u}`).join(" "));
  }
}

// Cross-channel category Audio
console.log("\n" + "=".repeat(72));
console.log('CATEGORY "Audio" — sheet truth vs what charts would use');
console.log("=".repeat(72));

const audioByCh = {};
for (const { ch, categories } of channelStats) {
  const a = categories.get("Audio");
  if (a) audioByCh[ch] = a;
}

let audio2025 = 0,
  audio2026 = 0,
  audioMtd = 0,
  audioDailyPrior = 0,
  audioDailyCurrent = 0;
for (const [ch, a] of Object.entries(audioByCh)) {
  audio2025 += a.so2025;
  audio2026 += a.so2026;
  audioMtd += a.mtd;
  audioDailyPrior += a.dailyPriorFy;
  audioDailyCurrent += a.dailyCurrentFy;
  console.log(
    `  ${ch}: rows=${a.rows} | 2025 SO=${a.so2025} | 2026 SO=${a.so2026} | MTD=${a.mtd} | daily prior FY=${a.dailyPriorFy} | daily current FY=${a.dailyCurrentFy}`,
  );
}
console.log("  ALL CHANNELS Audio:");
console.log("    2025 SO total:", audio2025);
console.log("    2026 SO total:", audio2026);
console.log("    May MTD total:", audioMtd);
console.log("    Daily sum prior FY:", audioDailyPrior);
console.log("    Daily sum current FY:", audioDailyCurrent);
console.log("\n  App category charts (today):");
console.log("    - Prior FY KPI/chart: sums DAILY months Apr25–Mar26 only (~", audioDailyPrior, ") NOT 2025 SO column (", audio2025, ")");
console.log("    - If daily incomplete, spreads 2025 SO/12 across months (distorts MoM)");
console.log("    - Current FY: sums daily Apr26+May from GMT cols; may miss MTD vs 2026 SO");

// Sample product Thunder Black Blinkit
console.log("\n" + "=".repeat(72));
console.log("SAMPLE SKU: Blinkit Item 10154212 Thunder (Black)");
console.log("=".repeat(72));
{
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Blinkit, { header: 1, defval: "", raw: false });
  const hr = detectHeader(rows);
  const headers = (rows[hr] ?? []).map(norm);
  const itemIdx = headers.findIndex((h) => h.includes("item id"));
  const modelIdx = headers.findIndex((h) => h === "model");
  const so25 = headers.findIndex((h) => h === "2025 so");
  const so26 = headers.findIndex((h) => h === "2026 so");
  const mtd = headers.findIndex((h) => h.includes("may") && h.includes("mtd"));
  const rawHeaders = (rows[hr] ?? []).map((c) => String(c ?? "").trim());
  const dailyCols = rawHeaders.map((h, i) => ({ i, d: parseGmtDate(h) })).filter((x) => x.d);

  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (String(row[itemIdx] ?? "").trim() !== "10154212") continue;
    let dPrior = 0,
      dCurrent = 0,
      dAll = 0;
    for (const col of dailyCols) {
      const u = asNum(row[col.i]);
      dAll += u;
      const ym = col.d.slice(0, 7);
      const [y, m] = ym.split("-").map(Number);
      const fy = m >= 4 ? y : y - 1;
      if (fy === priorFyStart) dPrior += u;
      if (fy === currentFyStart) dCurrent += u;
    }
    console.log("  Model:", row[modelIdx]);
    console.log("  2025 SO:", row[so25], "| 2026 SO:", row[so26], "| May MTD:", row[mtd]);
    console.log("  Sum daily cols:", dAll);
    console.log("  Sum daily prior FY:", dPrior, "| current FY:", dCurrent);
    console.log("  → Dashboard prior FY should be 2025 SO (4757) not daily prior (", dPrior, ")");
    break;
  }
}

console.log("\n" + "=".repeat(72));
console.log("ROOT CAUSE SUMMARY");
console.log("=".repeat(72));
