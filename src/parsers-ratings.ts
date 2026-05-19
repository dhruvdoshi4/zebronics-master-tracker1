import * as XLSX from "xlsx";
import { inferSubCategoryFromProductFields } from "./parsers";
import type { Marketplace, SubCategory } from "./types";
import { TRACKED_SUB_CATEGORY_SET } from "./types";
import { normalizeKey } from "./utils";

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
};

export type ParsedRatingsPayload = {
  rows: ParsedRatingsRow[];
  amazonCount: number;
  flipkartCount: number;
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

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/new launch|invalid|no review|not identified|rfo/i.test(raw)) return null;
  const cleaned = raw.replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function findCol(headers: string[], aliases: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    for (const alias of aliases) {
      if (h === alias || h.includes(alias)) return i;
    }
  }
  return -1;
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
    reviewY: findCol(headers, ["review y", "review (y)"]),
    countY: findCol(headers, [
      "review count y",
      "review count (y)",
      "review_count (y)",
      "rev count y",
      "rev count (y)",
    ]),
    rankY: findCol(headers, ["rank y", "rank (y)"]),
    reviewT: findCol(headers, ["review t", "review (t)"]),
    countT: findCol(headers, [
      "rev count t",
      "rev. count (t)",
      "review count t",
      "review count (t)",
      "review_count (t)",
      "rev count (t)",
    ]),
    rankT: findCol(headers, ["rank t", "rank (t)"]),
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

    const parsed: ParsedRatingsRow = {
      marketplace: "amazon",
      product_code,
      model_name,
      category,
      sub_category,
      tracked_sub_category: trackedSubCategory(model_name, category, sub_category),
      remarks,
      review_y: idx.reviewY >= 0 ? parseOptionalNumber(row[idx.reviewY]) : null,
      review_count_y: idx.countY >= 0 ? parseOptionalNumber(row[idx.countY]) : null,
      rank_y: idx.rankY >= 0 ? parseOptionalNumber(row[idx.rankY]) : null,
      review_t: idx.reviewT >= 0 ? parseOptionalNumber(row[idx.reviewT]) : null,
      review_count_t: idx.countT >= 0 ? parseOptionalNumber(row[idx.countT]) : null,
      rank_t: idx.rankT >= 0 ? parseOptionalNumber(row[idx.rankT]) : null,
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
    rating: headers.findIndex((h) => h === "rating"),
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
    const review_t = idx.rating >= 0 ? parseOptionalNumber(row[idx.rating]) : null;
    const review_count_t = idx.count >= 0 ? parseOptionalNumber(row[idx.count]) : null;

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

  return {
    rows: [...amazonRows, ...flipkartRows],
    amazonCount: amazonRows.length,
    flipkartCount: flipkartRows.length,
    errors,
  };
}
