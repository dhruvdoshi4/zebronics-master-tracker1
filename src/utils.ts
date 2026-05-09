import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_\s-]+/g, " ")
    .replace(/[^\w\s/]/g, "")
    .trim();
}

export function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const intFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

const decimalFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});

export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return intFormatter.format(value);
}

export function formatDecimal(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return decimalFormatter.format(value);
}

/** Month token (prefix or full) → 0–11 */
const COVERAGE_MONTH_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function coverageMonthIndex(token: string): number | null {
  const t = token.toLowerCase().replace(/\./g, "").trim();
  if (COVERAGE_MONTH_INDEX[t] !== undefined) return COVERAGE_MONTH_INDEX[t];
  const pref = t.slice(0, 3);
  return COVERAGE_MONTH_INDEX[pref] ?? null;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

function inferCalendarYear(monthIndex: number, day: number): number {
  const now = new Date();
  let y = now.getFullYear();
  let cand = new Date(y, monthIndex, day);
  if (cand > addDays(now, 40)) y -= 1;
  cand = new Date(y, monthIndex, day);
  if (cand > addDays(now, 40)) y -= 1;
  return y;
}

function parseYearFragment(raw: string | undefined): number | null {
  if (!raw) return null;
  const y = parseInt(raw.replace(/^[, ]+/, ""), 10);
  if (!Number.isFinite(y)) return null;
  if (raw.length <= 2) return 2000 + y;
  return y;
}

function toIsoDateOrNull(year: number, monthIndex: number, day: number): string | null {
  const dt = new Date(year, monthIndex, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== monthIndex ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Reads sellout coverage through-date from common upload filenames, e.g.
 * `Ecom_till_4th_may.xlsx`, `report till 5 may 2026.csv`, `upto 04-May-25`.
 * Returns `yyyy-MM-dd` or null if nothing matched.
 */
export function parseCoverageDateFromUploadFileName(fileName: string): string | null {
  const stem = fileName.replace(/\.[^.]+$/i, "").replace(/[_\-]+/g, " ");
  const s = stem.toLowerCase();

  const tagged =
    /(?:till|until|upto|up\s*to|as\s+on|as\s+of)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z.]+)\s*(?:[, ]\s*(\d{2,4}))?/i.exec(
      s,
    );
  if (tagged) {
    const day = parseInt(tagged[1], 10);
    const monthIx = coverageMonthIndex(tagged[2]);
    const yExplicit = parseYearFragment(tagged[3]);
    if (monthIx !== null && day >= 1 && day <= 31) {
      const year = yExplicit ?? inferCalendarYear(monthIx, day);
      const iso = toIsoDateOrNull(year, monthIx, day);
      if (iso) return iso;
    }
  }

  /** "till may 4th" / "upto may 4 2026" */
  const taggedMonthFirst =
    /(?:till|until|upto|up\s*to|as\s+on|as\s+of)\s+([a-z.]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[,\s]+\s*(20\d{2}|\d{2}))?/i.exec(
      s,
    );
  if (taggedMonthFirst) {
    const monthIx = coverageMonthIndex(taggedMonthFirst[1]);
    const day = parseInt(taggedMonthFirst[2], 10);
    const yExplicit = parseYearFragment(taggedMonthFirst[3]);
    if (monthIx !== null && day >= 1 && day <= 31) {
      const year = yExplicit ?? inferCalendarYear(monthIx, day);
      const iso = toIsoDateOrNull(year, monthIx, day);
      if (iso) return iso;
    }
  }

  /** `2026-05-04` anywhere in the name */
  const isoYmd = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(s);
  if (isoYmd) {
    const y = parseInt(isoYmd[1], 10);
    const mo = parseInt(isoYmd[2], 10);
    const d = parseInt(isoYmd[3], 10);
    const out = toIsoDateOrNull(y, mo - 1, d);
    if (out) return out;
  }

  /** `4may2026`, `04may26`, `4-may-2026` (month word sandwiched) */
  const compact =
    /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-]*([a-z]{3,})(?:[\s\-]*(20\d{2}|\d{2}))?\b/i.exec(s);
  if (compact) {
    const day = parseInt(compact[1], 10);
    const monthIx = coverageMonthIndex(compact[2]);
    const yRaw = compact[3];
    const yExplicit = yRaw !== undefined ? parseYearFragment(yRaw) : null;
    if (monthIx !== null && day >= 1 && day <= 31) {
      const year = yExplicit ?? inferCalendarYear(monthIx, day);
      const iso = toIsoDateOrNull(year, monthIx, day);
      if (iso) return iso;
    }
  }

  /** `4 may 2026` without till/upto (common in exports) */
  const dayMonthYearWords =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,})\s+(20\d{2})\b/i.exec(s);
  if (dayMonthYearWords) {
    const day = parseInt(dayMonthYearWords[1], 10);
    const monthIx = coverageMonthIndex(dayMonthYearWords[2]);
    const y = parseInt(dayMonthYearWords[3], 10);
    if (monthIx !== null && day >= 1 && day <= 31) {
      const iso = toIsoDateOrNull(y, monthIx, day);
      if (iso) return iso;
    }
  }

  const dmy = /\b(\d{1,2})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{2,4})\b/i.exec(s);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    const y = parseYearFragment(dmy[3]);
    if (y !== null && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const iso = toIsoDateOrNull(y, month - 1, day);
      if (iso) return iso;
    }
  }

  return null;
}

/**
 * Sheet **coverage** date (inventory/SO “as on” that day), not the upload day.
 * Prefer date encoded in the upload filename; otherwise use the picker value.
 */
export function resolveUploadSnapshotDate(fileName: string, pickerDateYyyyMmDd: string): string {
  return parseCoverageDateFromUploadFileName(fileName) ?? pickerDateYyyyMmDd;
}

/** True for a real calendar `yyyy-MM-dd` (not empty, not invalid like 2026-02-31). */
export function isValidIsoDateString(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Min / max sheet coverage among metric rows (e.g. dashboard SKUs may differ slightly by refresh). */
export function sheetCoverageMinMax(
  records: readonly { as_of_date: string }[],
): { min: string | null; max: string | null } {
  if (records.length === 0) return { min: null, max: null };
  const uniq = [...new Set(records.map((r) => r.as_of_date))].sort();
  return { min: uniq[0] ?? null, max: uniq[uniq.length - 1] ?? null };
}

/** Human label for a coverage ISO date (no clock time — this is “data through”, not upload time). */
export function formatCoverageDataAsOf(isoYyyyMmDd: string): string {
  const d = new Date(`${isoYyyyMmDd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoYyyyMmDd;
  const day = d.getDate();
  const ord =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  const month = d.toLocaleString("en-IN", { month: "short" });
  const year = d.getFullYear();
  return `${day}${ord} ${month} ${year}`;
}

