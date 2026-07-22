import type { Marketplace } from "./types";

/**
 * Zebronics sellout master — DRR column contract (ops spreadsheets).
 *
 * Update this file only when Amazon / Flipkart change their export headers.
 *
 * | Channel   | HO Stock / dashboard `drr_units`               | PO `drr_28d_avg_units` |
 * |-----------|--------------------------------------------------|-------------------------|
 * | Amazon    | **15 Days Avg** if present, else **7 Days Avg**  | **28 Days Avg**         |
 * | Flipkart  | **7 Days Avg** (authoritative DRR)               | **28 Days Avg**         |
 *
 * Verified against FK master: `Consolidated (FK + Minutes)` — cols **7 Days Avg**, **28 Days Avg**.
 * Ops has been dropping the **15 Days Avg** column from Amazon masters (all managers, admin
 * consolidated, daWg) in favor of **7 Days Avg** (same role Flipkart already used). Parsing
 * auto-falls back to 7-day whenever 15-day is absent — see `amazonDrrUsesSevenDayAvg` in parsers.ts.
 */
export const SELLOUT_DRR_LITERAL_ALIASES = ["drr", "daily run rate", "drr (avg)"] as const;

export const SELLOUT_DRR_AMAZON_FALLBACK_ALIASES = [
  "15 days avg",
  "15 day avg",
  "15 days average",
  "15 day average",
  "15 days drr",
  "15 day drr",
] as const;

export const SELLOUT_DRR_FLIPKART_FALLBACK_ALIASES = [
  "7 days avg",
  "7 day avg",
  "7 days average",
  "7 day average",
  "7 days drr",
  "7 day drr",
] as const;

export const SELLOUT_PO_28D_AVG_ALIASES = [
  "28 days avg",
  "28 day avg",
  "28 days average",
  "28 day average",
  "28daysavg",
  "28 days drr",
  "28 day drr",
] as const;

export function selloutDrrFallbackAliases(
  marketplace: Marketplace,
): readonly string[] {
  return marketplace === "amazon"
    ? SELLOUT_DRR_AMAZON_FALLBACK_ALIASES
    : SELLOUT_DRR_FLIPKART_FALLBACK_ALIASES;
}

/** Human label for UI copy / errors. */
export function selloutDrrFallbackLabel(marketplace: Marketplace): string {
  return marketplace === "amazon" ? "15 Days Avg" : "7 Days Avg";
}

/** Whole units — matches Excel cells formatted with zero decimals (7/15/28-day avg, DRR). */
export function roundSheetDrrUnits(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

/**
 * `drr_units` at ingest must follow ops sheet contract exactly:
 * - Amazon dashboard/HO DRR = 15 Days Avg, falling back to 7 Days Avg when 15-day is absent
 * - Flipkart dashboard/HO DRR = 7 Days Avg
 * Never uses 28-day avg (PO only).
 */
export function resolveSelloutDrrUnits(
  marketplace: Marketplace,
  literalDrr: number,
  sevenDayAvg: number,
  fifteenDayAvg: number,
): number {
  const fallback = marketplace === "amazon" ? fifteenDayAvg : sevenDayAvg;
  const fallbackRounded = roundSheetDrrUnits(fallback);
  if (fallbackRounded > 0) return fallbackRounded;
  /** Guardrail for malformed sheets where 7/15-day columns are blank. */
  return roundSheetDrrUnits(literalDrr);
}
