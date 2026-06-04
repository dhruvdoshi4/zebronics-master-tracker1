import {
  CORE_SELL_OUT_SUB_CATEGORIES,
  type CoreSelloutSubCategory,
} from "./sellout-category-scope";

export type LegacyMarketplace = "amazon" | "flipkart";

export type QcomMarketplace = "zepto" | "blinkit" | "bigbasket" | "instamart";

/** Qcom master workbook Consolidated tab — network sellout by ASIN (HO Stock uses same marketplace key). */
export const QCOM_HO_STOCK_CATALOG_MARKETPLACE = "consolidated" as const;

export type QcomHoStockCatalogMarketplace = typeof QCOM_HO_STOCK_CATALOG_MARKETPLACE;

export type Marketplace =
  | LegacyMarketplace
  | QcomMarketplace
  | QcomHoStockCatalogMarketplace;

export const QCOM_MARKETPLACES: readonly QcomMarketplace[] = [
  "zepto",
  "blinkit",
  "bigbasket",
  "instamart",
] as const;

export const LEGACY_MARKETPLACES: readonly LegacyMarketplace[] = [
  "amazon",
  "flipkart",
] as const;

export function isQcomMarketplace(m: Marketplace): m is QcomMarketplace {
  return (QCOM_MARKETPLACES as readonly string[]).includes(m);
}

/** Channel tabs plus Consolidated master sheet (same DB marketplace as HO catalogue). */
export type QcomSelloutMarketplace = QcomMarketplace | QcomHoStockCatalogMarketplace;

export function isQcomSelloutMarketplace(m: Marketplace): m is QcomSelloutMarketplace {
  return isQcomMarketplace(m) || m === QCOM_HO_STOCK_CATALOG_MARKETPLACE;
}

export function isLegacyMarketplace(m: Marketplace): m is LegacyMarketplace {
  return m === "amazon" || m === "flipkart";
}

export type AppRole = "admin" | "viewer";

export type SubCategory =
  | CoreSelloutSubCategory
  | "projector_stand"
  | "cartridge";

/** Sub-categories ingested from the master sheet and shown on Dashboard / filters. */
export const TRACKED_SUB_CATEGORIES: readonly SubCategory[] = [
  ...CORE_SELL_OUT_SUB_CATEGORIES,
  "cartridge",
];

export const TRACKED_SUB_CATEGORY_SET = new Set<string>(TRACKED_SUB_CATEGORIES);

export const SUB_CATEGORY_LABELS: Record<SubCategory, string> = {
  monitor: "Monitors",
  monitor_arm: "Monitor arms",
  projector: "Projectors",
  projector_screen: "Projector screens",
  projector_stand: "Projector stands",
  cartridge: "Cartridges",
};

/** UI filter value — single sub-category or cumulative all tracked SKUs. */
export type SubCategoryFilter = SubCategory | "all";

export const SUB_CATEGORY_FILTER_OPTIONS: readonly SubCategoryFilter[] = [
  "all",
  ...TRACKED_SUB_CATEGORIES,
] as const;

export const SUB_CATEGORY_FILTER_LABELS: Record<SubCategoryFilter, string> = {
  all: "All",
  ...SUB_CATEGORY_LABELS,
};

/** @deprecated Use {@link SubCategoryFilter} */
export type DashboardSubCategoryFilter = SubCategoryFilter;

/** @deprecated Use {@link SUB_CATEGORY_FILTER_OPTIONS} */
export const DASHBOARD_SUB_CATEGORY_OPTIONS = SUB_CATEGORY_FILTER_OPTIONS;

/** @deprecated Use {@link SUB_CATEGORY_FILTER_LABELS} */
export const DASHBOARD_SUB_CATEGORY_LABELS = SUB_CATEGORY_FILTER_LABELS;

export function parseSubCategoryFilterParam(
  raw: string | null | undefined,
): SubCategoryFilter | null {
  const decoded = raw != null ? decodeURIComponent(raw) : "";
  if (decoded === "all") return "all";
  if (TRACKED_SUB_CATEGORIES.includes(decoded as SubCategory)) {
    return decoded as SubCategory;
  }
  return null;
}

export function getSubCategoryLabel(key: string | null | undefined): string {
  if (!key) return "";
  const canonical = String(key)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const label =
    SUB_CATEGORY_LABELS[key as SubCategory] ??
    SUB_CATEGORY_LABELS[canonical as SubCategory];
  return label ?? key.replace(/_/g, " ");
}

export type DataScope = "default" | "dawg";

export interface Profile {
  id: string;
  full_name: string | null;
  role: AppRole;
  data_scope?: DataScope;
  created_at: string;
}

export interface ProductMaster {
  id: number;
  marketplace: Marketplace;
  product_code: string;
  product_name: string;
  category: string | null;
  sub_category: string | null;
  brand: string | null;
  /** Hari monitor_projector vs Karan personal_audio — see catalog_workspace migration. */
  catalog_workspace?: string | null;
  image_url: string | null;
  /** Quick commerce platform SKU when product_code is the shared ASIN. */
  listing_code?: string | null;
  /** Override submitted BAU — all GMS (current + prior FY) use this when set. */
  bau_price?: number | null;
  created_at: string;
  updated_at: string;
}

export type UploadKind = "sellout" | "bau" | "gms_plan" | "ho_stock" | "ratings_ranking";

export interface UploadRun {
  id: string;
  marketplace: Marketplace;
  file_name: string;
  uploaded_by: string;
  uploaded_at: string;
  /** Sheet "as of" date; used when deleting to remove matching metrics. */
  snapshot_date?: string | null;
  upload_kind?: UploadKind;
  catalog_workspace?: string | null;
  status: "processing" | "completed" | "failed";
  raw_row_count: number;
  valid_row_count: number;
  rejected_row_count: number;
  notes: string | null;
}

export interface ComputedMetric {
  marketplace: Marketplace;
  product_code: string;
  /** Sheet coverage date (`yyyy-MM-dd`): inventory/SO as on this day — not upload timestamp. */
  as_of_date: string;
  /** When set, delete upload removes these rows exactly (see deleteUploadRecord). */
  upload_id?: string | null;
  total_so_units: number;
  may_mtd_units: number;
  /** Units in the latest day column on the sheet (e.g. 18/May) for this snapshot. */
  latest_day_so_units?: number;
  apr_so_units: number;
  /** Prior-year same-period MTD from sheet column (e.g. **2025 May MTD** when report is May 2026). */
  prior_year_mtd_units?: number;
  /** Completed prior FY SO from sheet column (e.g. FY 2025-26 SO on Flipkart). */
  prior_fy_so_units: number;
  /** Current in-progress FY SO from sheet column (e.g. FY 2026-27 SO). */
  current_fy_so_units?: number;
  drr_units: number;
  /** Sheet "28 Days Avg" — used for PO (28 × avg − inventory). */
  drr_28d_avg_units?: number;
  doc_days: number;
  inventory_units: number;
  purchase_order_units: number;
}

export interface MetricInput {
  marketplace: Marketplace;
  product_code: string;
  as_of_date: string;
  inventory_units: number;
  total_so_units: number;
  may_mtd_units: number;
  latest_day_so_units?: number;
  apr_so_units: number;
  prior_year_mtd_units?: number;
  prior_fy_so_units?: number;
  current_fy_so_units?: number;
  drr_units: number;
  drr_28d_avg_units?: number;
  doc_days_excel: number | null;
  upload_id?: string | null;
}

export interface DailySale {
  marketplace: Marketplace;
  product_code: string;
  sale_date: string;
  units_sold: number;
}

export interface ParsedRowError {
  rowNumber: number;
  reason: string;
  payload?: Record<string, unknown>;
}

/** Per sub-category month total from sheet columns (Apr-25, May-25, …) at parse time. */
export interface CategoryMonthlySelloutInput {
  marketplace: Marketplace;
  /** Marketplace sub-category enum or QCom category label (e.g. Audio). */
  sub_category: SubCategory | string;
  month_ym: string;
  units_sold: number;
}

export interface ParsedUploadPayload {
  products: Omit<
    ProductMaster,
    "id" | "created_at" | "updated_at" | "image_url"
  >[];
  metricInputs: MetricInput[];
  dailySales: DailySale[];
  /** Summed from the same rows/columns as dailySales — used for category MoM charts. */
  categoryMonthlySellout: CategoryMonthlySelloutInput[];
  errors: ParsedRowError[];
  rawCount: number;
  validCount: number;
  ignoredCount: number;
  /** Rows with Category = Cartridge on Ecom Sellout (Hari). */
  cartridgeRowCount: number;
  /**
   * Normalized model-name keys from Flipkart Remarks=EOL rows (tracked sub-categories only).
   * Persisted on ingest for Amazon to exclude matching model names.
   */
  flipkartEolModelNames: string[];
  /** Flipkart FSNs with Remarks = EOL on the sellout master (explicit row-level only). */
  flipkartEolFsns: string[];
  /** Channel tab total for the leftmost day column (e.g. 18/May) — stored on upload for dashboard KPIs. */
  channelLatestDaySellout?: {
    saleDate: string;
    totalUnits: number;
  } | null;
  /** Admin consolidated Amazon parse: mapKey → manager workspace for split ingest. */
  adminWorkspaceByMapKey?: Record<string, string>;
  /** Column-header KPI sums by sheet Category (every row on the master). */
  sheetCategoryKpis?: import("./sheet-category-kpi-totals").SheetCategoryKpiTotalsDoc;
  /** Pravin ROMA & PowerBank Amazon: PowerBank month-column totals after Click_tect + Cocoblu merge. */
  pravinPowerBankAmazonMonthTotals?: Record<string, number>;
  /** Every ASIN parsed from the Cocoblu Amazon tab (included in PowerBank roll-up). */
  pravinAmazonCocobluProductCodes?: string[];
  /** Amazon PowerBank category-analysis KPIs (month-column FY rule, computed at ingest). */
  pravinPowerBankAmazonSheetKpis?: import("./pravin-powerbank-amazon-truth").PravinPowerBankAmazonSheetKpis;
}

/** One daily sellout column on the dashboard (sheet day, not month anchor). */
export type DashboardDailySoPoint = {
  sale_date: string;
  units_sold: number;
};

export interface DashboardRecord extends ComputedMetric {
  product_name: string;
  sub_category: string | null;
  category: string | null;
  brand: string | null;
  image_url: string | null;
  /** Last three daily SO columns from the sellout sheet (newest → oldest). */
  last3DaysSo?: DashboardDailySoPoint[];
  /** Channel SKU from Consolidated link (PVID, Item ID, etc.). */
  listing_code?: string | null;
  /** HO warehouse + network DOC — same model as HO Stock (not QCom / daWg). */
  ho_units?: number;
  gurgaon_units?: number;
  amazon_inventory_units?: number;
  flipkart_inventory_units?: number;
  amazon_drr_units?: number;
  flipkart_drr_units?: number;
  network_doc_days?: number | null;
}
