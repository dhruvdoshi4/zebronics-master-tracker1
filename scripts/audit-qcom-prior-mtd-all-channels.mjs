/**
 * Cross-channel check: prior-year MTD daily (May 1–20 2025) vs May-25 month column (Audio).
 * Mirrors parser layout rules after BB fixes.
 */
import { readFileSync, existsSync } from "node:fs";
import * as XLSX from "xlsx";
import { format } from "date-fns";

const CHANNELS = [
  {
    key: "zepto",
    path: "C:/Users/Admin/Downloads/Zepto Sell Out Report till 20th May 2026.xlsx",
    sheet: "Consolidated",
  },
  {
    key: "blinkit",
    path: "C:/Users/Admin/Downloads/Blinkit Sell Out Report till 20th May 2026.xlsx",
    sheet: null,
  },
  {
    key: "bigbasket",
    path: "C:/Users/Admin/Downloads/BigBasket Sell Out Report till 20th May 2026.xlsx",
    sheet: "BB_SO",
  },
  {
    key: "instamart",
    path: "C:/Users/Admin/Downloads/Swiggy Sell Out Report till 18th May 2026.xlsx",
    sheet: null,
  },
];

const SNAPSHOT = "2026-05-20";
const CATEGORY = "Audio";
const MONTH_LOOKUP = {
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

function tightenWorksheetRange(ws) {
  let maxR = 0;
  let maxC = 0;
  for (const key of Object.keys(ws)) {
    if (key[0] === "!") continue;
    const cell = XLSX.utils.decode_cell(key);
    if (cell.r >= 100_000) continue;
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c > maxC) maxC = cell.c;
  }
  if (maxC < 0) return;
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxR, c: maxC },
  });
}

function cellText(ws, r, c) {
  const key = XLSX.utils.encode_cell({ r, c });
  const cell = ws[key];
  if (!cell) return "";
  return String(cell.w ?? cell.v ?? "").trim();
}

function parseMonthCol(h) {
  const m = /^([A-Za-z]{3,9})[-'](\d{2,4})$/i.exec(String(h).trim());
  if (!m) return null;
  const mo = MONTH_LOOKUP[m[1].slice(0, 3).toLowerCase()];
  if (mo === undefined) return null;
  const y = Number(m[2]) < 100 ? 2000 + Number(m[2]) : Number(m[2]);
  return `${y}-${String(mo + 1).padStart(2, "0")}`;
}

function auditChannel({ key, path, sheet: sheetHint }) {
  if (!existsSync(path)) {
    return { channel: key, error: "file not found", path };
  }

  const wb = XLSX.read(readFileSync(path), {
    type: "buffer",
    cellDates: false,
    sheets: sheetHint ? [sheetHint] : undefined,
  });
  const sheetName =
    sheetHint ??
    wb.SheetNames.find((n) => /consolidated|bb_so|bb so/i.test(n)) ??
    wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return { channel: key, error: "no sheet", path };

  tightenWorksheetRange(ws);

  let headerRow = 0;
  let maxCols = 0;
  for (const k of Object.keys(ws)) {
    if (k[0] === "!") continue;
    const { r, c } = XLSX.utils.decode_cell(k);
    if (r > 5) continue;
    if (c > maxCols) maxCols = c;
    const joined = cellText(ws, r, 0) + cellText(ws, r, 1) + cellText(ws, r, 2);
    if (/category|asin|item code|pvid/i.test(joined)) headerRow = r;
  }

  const snap = new Date(`${SNAPSHOT}T12:00:00`);
  const priorYear = snap.getFullYear() - 1;
  const month = snap.getMonth();
  const maxDay = snap.getDate();

  let catIdx = -1;
  let codeIdx = -1;
  for (let c = 0; c <= maxCols; c++) {
    const h = cellText(ws, headerRow, c).toLowerCase();
    if (catIdx < 0 && h === "category") catIdx = c;
    if (codeIdx < 0 && (h === "item code" || h === "asin" || h === "pvid" || h === "item id")) {
      codeIdx = c;
    }
  }

  let firstMonthCol = Number.POSITIVE_INFINITY;
  let may25Idx = -1;
  let apr26Idx = -1;
  let latestDailyIdx = -1;

  for (let c = 0; c <= maxCols; c++) {
    const raw = cellText(ws, headerRow, c);
    const ym = parseMonthCol(raw);
    if (ym) {
      if (c < firstMonthCol) firstMonthCol = c;
      if (raw === "May-25") may25Idx = c;
      if (raw === "Apr-26") apr26Idx = c;
    }
    if (/^20-May$/i.test(raw) && latestDailyIdx < 0) latestDailyIdx = c;
  }
  if (!Number.isFinite(firstMonthCol)) firstMonthCol = maxCols + 1;
  if (latestDailyIdx < 0) latestDailyIdx = 13;

  const runs = [];
  let run = null;
  for (let i = latestDailyIdx + 1; i < firstMonthCol; i++) {
    const raw = cellText(ws, headerRow, i);
    const m = /^(\d{1,2})[-/]([A-Za-z]{3})$/i.exec(raw);
    if (!m) {
      if (run) {
        runs.push(run);
        run = null;
      }
      continue;
    }
    const mo = MONTH_LOOKUP[m[2].slice(0, 3).toLowerCase()];
    if (mo === undefined) {
      if (run) {
        runs.push(run);
        run = null;
      }
      continue;
    }
    if (!run || run.month !== mo) {
      if (run) runs.push(run);
      run = { start: i, end: i, month: mo };
    } else {
      run.end = i;
    }
  }
  if (run) runs.push(run);

  const mayRuns = runs.filter((r) => r.month === month);
  const priorRun = mayRuns.sort((a, b) => b.start - a.start)[0] ?? null;
  const currentRun = mayRuns.sort((a, b) => a.start - b.start)[0] ?? null;

  let maxDataRow = 0;
  for (const k of Object.keys(ws)) {
    if (k[0] === "!") continue;
    const { r } = XLSX.utils.decode_cell(k);
    if (r > maxDataRow) maxDataRow = r;
  }

  let priorMtdDaily = 0;
  let may25Month = 0;
  let apr26Month = 0;
  let audioSku = 0;

  if (priorRun) {
    for (let i = priorRun.start; i <= priorRun.end; i++) {
      const raw = cellText(ws, headerRow, i);
      const m = /^(\d{1,2})[-/]([A-Za-z]{3})$/i.exec(raw);
      if (!m) continue;
      const day = Number(m[1]);
      if (day < 1 || day > maxDay) continue;
      for (let r = headerRow + 1; r <= maxDataRow; r++) {
        if (cellText(ws, r, catIdx) !== CATEGORY) continue;
        audioSku++;
        priorMtdDaily += Number(cellText(ws, r, i).replace(/,/g, "")) || 0;
      }
    }
  }

  if (may25Idx >= 0) {
    for (let r = headerRow + 1; r <= maxDataRow; r++) {
      if (cellText(ws, r, catIdx) !== CATEGORY) continue;
      may25Month += Number(cellText(ws, r, may25Idx).replace(/,/g, "")) || 0;
    }
  }

  if (apr26Idx >= 0) {
    for (let r = headerRow + 1; r <= maxDataRow; r++) {
      if (cellText(ws, r, catIdx) !== CATEGORY) continue;
      apr26Month += Number(cellText(ws, r, apr26Idx).replace(/,/g, "")) || 0;
    }
  }

  const gap = may25Month - priorMtdDaily;
  const sameProblem =
    may25Month > 0 &&
    priorMtdDaily > 0 &&
    gap > Math.max(50, priorMtdDaily * 0.05);

  return {
    channel: key,
    sheet: sheetName,
    path,
    layout: {
      headerRow: headerRow + 1,
      latestDailyIdx,
      firstMonthCol: firstMonthCol === Number.POSITIVE_INFINITY ? null : firstMonthCol,
      apr26Idx,
      may25Idx,
      mayRuns: mayRuns.map((r) => ({
        start: r.start,
        end: r.end,
        cols: r.end - r.start + 1,
      })),
      priorRunDetected: priorRun
        ? { start: priorRun.start, end: priorRun.end, cols: priorRun.end - priorRun.start + 1 }
        : null,
      currentMayRun: currentRun
        ? { start: currentRun.start, end: currentRun.end }
        : null,
    },
    audio: {
      skuRows: audioSku,
      priorMtdDailyMay1to20_2025: priorMtdDaily,
      may25FullMonth: may25Month,
      apr26FullMonth: apr26Month,
      gapMonthVsDaily: gap,
      pctGap: priorMtdDaily > 0 ? Math.round((gap / priorMtdDaily) * 100) : null,
    },
    samePriorMtdProblem: sameProblem,
    parserWouldIngestPriorDaily: Boolean(priorRun && priorRun.end - priorRun.start + 1 >= maxDay - 1),
  };
}

const results = CHANNELS.map(auditChannel);
console.log(JSON.stringify({ snapshot: SNAPSHOT, category: CATEGORY, results }, null, 2));
