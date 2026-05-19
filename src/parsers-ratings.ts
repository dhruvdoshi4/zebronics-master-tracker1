import * as XLSX from "xlsx";
import { inferSubCategoryFromProductFields } from "./parsers";
import type { Marketplace, SubCategory } from "./types";
import { TRACKED_SUB_CATEGORY_SET } from "./types";
import { normalizeKey } from "./utils";

export type RatingsCellLabels = Partial<
  Record<
    | "review_y"
    | "review_count_y"
    | "rank_y"
    | "review_t"
    | "review_count_t"
    | "rank_t",
    string
  >
>;

export type ParsedRatingsRow = {
  marketplace: Marketplace;
  product_code: string;
  model_name: string;
  category: string;
  sub_category: string;
  tracked_sub_category: SubCategory | null;
  remarks: string;
  review_y: number | null;
  review_count_y: number | null;
  rank_y: number | null;
  review_t: number | null;
  review_count_t: number | null;
  rank_t: number | null;
  cell_labels: RatingsCellLabels;
};

export type ParsedRatingsPayload = {
  rows: ParsedRatingsRow[];
  amazonCount: number;
  flipkartCount: number;
  amazonWithReviewCounts: number;
  errors: string[];
};

const AMAZON_SHEET_ALIASES = ["az_rating&ranking", "amazon", "az"];
const FLIPKART_SHEET_ALIASES = ["fsn_ranking&rating", "flipkart", "fk"];

function sheetMatches(name: string, aliases: string[]): boolean {
  const key = normalizeKey(name);
  return aliases.some((a) => key === normalizeKey(a) || key.includes(normalizeKey(a)));
}

function findSheetName(sheetNames: string[], aliases: string[]): string | null {
  return sheetNames.find((n) => sheetMatches(n, aliases)) ?? null;
}

/** Match sheet headers exactly (Review_Count (Y) → review count y). */
function findColExact(headers: string[], aliases: string[]): number {
  const wanted = new Set(aliases.map((a) => normalizeKey(a)));
  for (let i = 0; i < headers.length; i++) {
    if (wanted.has(headers[i])) return i;
  }
  return -1;
}

function findCol(headers: string[], aliases: string[]): number {
  const exact = findColExact(headers, aliases);
  if (exact >= 0) return exact;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    for (const alias of aliases) {
      if (h.includes(alias)) return i;
    }
  }
  return -1;
}

/** Flipkart / Amazon masters often use 0 when there is no rating yet — treat as blank. */
function coalesceZeroRatingPair(
  rating: number | null,
  count: number | null,
): { rating: number | null; count: number | null } {
  if (rating === 0 && (count === 0 || count === null)) {
    return { rating: null, count: count === 0 ? null : count };
  }
  if (count === 0 && (rating === 0 || rating === null)) {
    return { rating: null, count: null };
  }
  return { rating, count };
}

function parseRatingsCell(value: unknown): { numeric: number | null; label: string | null } {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { numeric: value, label: null };
  }
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-" || raw === "—") return { numeric: null, label: null };
  if (/^new launch$/i.test(raw)) return { numeric: null, label: "New Launch" };
  if (/invalid|no review|not identified/i.test(raw)) {
    return { numeric: null, label: raw };
  }
  const cleaned = raw.replace(/,/g, "");
  const parsed = Number(cleaned);
  if (Number.isFinite(parsed)) return { numeric: parsed, label: null };
  return { numeric: null, label: raw };
}

function readMetric(
  row: unknown[],
  col: number,
  key: keyof RatingsCellLabels,
  labels: RatingsCellLabels,
): number | null {
  if (col < 0) return null;
  const { numeric, label } = parseRatingsCell(row[col]);
  if (label) labels[key] = label;
  return numeric;
}

function detectHeaderRow(rows: unknown[][], mustHave: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const headers = (rows[i] ?? []).map((c) => normalizeKey(c));
    if (mustHave.every((token) => headers.some((h) => h.includes(token)))) return i;
  }
  return -1;
}

function trackedSubCategory(
  modelName: string,
  category: string,
  subCategory: string,
): SubCategory | null {
  const inferred = inferSubCategoryFromProductFields(modelName, category, subCategory);
  if (inferred) return inferred;
  const key = normalizeKey(subCategory).replace(/\s+/g, "_");
  if (TRACKED_SUB_CATEGORY_SET.has(key)) return key as SubCategory;
  return null;
}

function parseAmazonSheet(sheet: XLSX.WorkSheet): ParsedRatingsRow[] {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
  const headerRow = detectHeaderRow(rows, ["asin", "review"]);
  if (headerRow < 0) return [];

  const headers = (rows[headerRow] ?? []).map((c) => normalizeKey(c));
  const idx = {
    asin: findCol(headers, ["asin"]),
    model: findCol(headers, ["model name", "model"]),
    category: findCol(headers, ["category"]),
    subCategory: findCol(headers, ["sub category", "subcategory"]),
    remarks: findCol(headers, ["remarks"]),
    reviewY: findColExact(headers, ["review y", "review (y)"]),
    countY: findColExact(headers, [
      "review count y",
      "review count (y)",
      "review_count (y)",
      "review_count y",
    ]),
    rankY: findColExact(headers, ["rank y", "rank (y)"]),
    reviewT: findColExact(headers, ["review t", "review (t)"]),
    countT: findColExact(headers, [
      "rev count t",
      "rev. count (t)",
      "review count t",
      "review count (t)",
      "review_count (t)",
    ]),
    rankT: findColExact(headers, ["rank t", "rank (t)"]),
  };
  if (idx.asin < 0) return [];

  const byCode = new Map<string, ParsedRatingsRow>();
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const product_code = String(row[idx.asin] ?? "").trim().toUpperCase();
    if (!product_code || product_code.length < 8) continue;

    const model_name = String(row[idx.model] ?? "").trim();
    const category = String(row[idx.category] ?? "").trim();
    const sub_category = String(row[idx.subCategory] ?? "").trim();
    const remarks = String(row[idx.remarks] ?? "").trim();

    const cell_labels: RatingsCellLabels = {};
    let review_y = readMetric(row, idx.reviewY, "review_y", cell_labels);
    let review_count_y = readMetric(row, idx.countY, "review_count_y", cell_labels);
    let review_t = readMetric(row, idx.reviewT, "review_t", cell_labels);
    let review_count_t = readMetric(row, idx.countT, "review_count_t", cell_labels);
    ({ rating: review_y, count: review_count_y } = coalesceZeroRatingPair(
      review_y,
      review_count_y,
    ));
    ({ rating: review_t, count: review_count_t } = coalesceZeroRatingPair(
      review_t,
      review_count_t,
    ));
    const parsed: ParsedRatingsRow = {
      marketplace: "amazon",
      product_code,
      model_name,
      category,
      sub_category,
      tracked_sub_category: trackedSubCategory(model_name, category, sub_category),
      remarks,
      review_y,
      review_count_y,
      rank_y: readMetric(row, idx.rankY, "rank_y", cell_labels),
      review_t,
      review_count_t,
      rank_t: readMetric(row, idx.rankT, "rank_t", cell_labels),
      cell_labels,
    };
    byCode.set(product_code, parsed);
  }
  return [...byCode.values()];
}

function parseFlipkartSheet(sheet: XLSX.WorkSheet): ParsedRatingsRow[] {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
  const headerRow = detectHeaderRow(rows, ["fsn", "rating"]);
  if (headerRow < 0) return [];

  const headers = (rows[headerRow] ?? []).map((c) => normalizeKey(c));
  const idx = {
    fsn: findCol(headers, ["fsn"]),
    model: findCol(headers, ["model name", "model"]),
    category: findCol(headers, ["category"]),
    subCategory: findCol(headers, ["sub category", "subcategory"]),
    remarks: findCol(headers, ["remarks"]),
    rating: findColExact(headers, ["rating"]),
    count: findCol(headers, ["rating count", "rating_count", "rating count t"]),
  };
  if (idx.fsn < 0) return [];

  const byCode = new Map<string, ParsedRatingsRow>();
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const product_code = String(row[idx.fsn] ?? "").trim().toUpperCase();
    if (!product_code || product_code.length < 8) continue;

    const model_name = String(row[idx.model] ?? "").trim();
    const category = String(row[idx.category] ?? "").trim();
    const sub_category = String(row[idx.subCategory] ?? "").trim();
    const remarks = String(row[idx.remarks] ?? "").trim();
    const cell_labels: RatingsCellLabels = {};
    let review_t = readMetric(row, idx.rating, "review_t", cell_labels);
    let review_count_t = readMetric(row, idx.count, "review_count_t", cell_labels);
    ({ rating: review_t, count: review_count_t } = coalesceZeroRatingPair(
      review_t,
      review_count_t,
    ));

    byCode.set(product_code, {
      marketplace: "flipkart",
      product_code,
      model_name,
      category,
      sub_category,
      tracked_sub_category: trackedSubCategory(model_name, category, sub_category),
      remarks,
      review_y: null,
      review_count_y: null,
      rank_y: null,
      review_t,
      review_count_t,
      rank_t: null,
      cell_labels,
    });
  }
  return [...byCode.values()];
}

export async function parseRatingsRankingFile(file: File): Promise<ParsedRatingsPayload> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: false });
  const errors: string[] = [];

  const amazonSheet = findSheetName(wb.SheetNames, AMAZON_SHEET_ALIASES);
  const flipkartSheet = findSheetName(wb.SheetNames, FLIPKART_SHEET_ALIASES);

  if (!amazonSheet) {
    errors.push('Missing Amazon sheet (expected "AZ_Rating&Ranking").');
  }
  if (!flipkartSheet) {
    errors.push('Missing Flipkart sheet (expected "FSN_Ranking&Rating").');
  }

  const amazonRows = amazonSheet ? parseAmazonSheet(wb.Sheets[amazonSheet]) : [];
  const flipkartRows = flipkartSheet ? parseFlipkartSheet(wb.Sheets[flipkartSheet]) : [];

  if (amazonRows.length === 0 && flipkartRows.length === 0) {
    errors.push("No rating rows parsed. Check sheet names and header row.");
  }
  if (amazonSheet && amazonRows.length === 0 && flipkartRows.length > 0) {
    errors.push(
      'Amazon tab "AZ_Rating&Ranking" parsed 0 rows — check header row (ASIN, Review Y) and sheet layout.',
    );
  }
  if (flipkartSheet && flipkartRows.length === 0 && amazonRows.length > 0) {
    errors.push(
      'Flipkart tab "FSN_Ranking&Rating" parsed 0 rows — check header row (FSN, Rating).',
    );
  }

  const amazonWithReviewCounts = amazonRows.filter(
    (r) => r.review_count_y != null || r.review_count_t != null,
  ).length;

  return {
    rows: [...amazonRows, ...flipkartRows],
    amazonCount: amazonRows.length,
    flipkartCount: flipkartRows.length,
    amazonWithReviewCounts,
    errors,
  };
}
