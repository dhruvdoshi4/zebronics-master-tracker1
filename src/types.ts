export type Marketplace = "amazon" | "flipkart";

export type AppRole = "admin" | "viewer";

export type SubCategory =
  | "monitor"
  | "projector"
  | "projector_screen"
  | "projector_stand"
  | "cartridge";

/** Sub-categories ingested from the master sheet and shown on Dashboard / filters. */
export const TRACKED_SUB_CATEGORIES: readonly SubCategory[] = [
  "monitor",
  "projector",
  "projector_screen",
  "projector_stand",
  "cartridge",
] as const;

export const TRACKED_SUB_CATEGORY_SET = new Set<string>(TRACKED_SUB_CATEGORIES);

export const SUB_CATEGORY_LABELS: Record<SubCategory, string> = {
  monitor: "Monitors",
  projector: "Projectors",
  projector_screen: "Projector screens",
  projector_stand: "Projector stands",
  cartridge: "Cartridges",
};

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

export interface Profile {
  id: string;
  full_name: string | null;
  role: AppRole;
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
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadRun {
  id: string;
  marketplace: Marketplace;
  file_name: string;
  uploaded_by: string;
  uploaded_at: string;
  /** Sheet "as of" date; used when deleting to remove matching metrics. */
  snapshot_date?: string | null;
  status: "processing" | "completed" | "failed";
  raw_row_count: number;
  valid_row_count: number;
  rejected_row_count: number;
  notes: string | null;
}

export interface ComputedMetric {
  marketplace: Marketplace;
  product_code: string;
  as_of_date: string;
  /** When set, delete upload removes these rows exactly (see deleteUploadRecord). */
  upload_id?: string | null;
  total_so_units: number;
  may_mtd_units: number;
  apr_so_units: number;
  drr_units: number;
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
  apr_so_units: number;
  drr_units: number;
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

export interface ParsedUploadPayload {
  products: Omit<
    ProductMaster,
    "id" | "created_at" | "updated_at" | "image_url"
  >[];
  metricInputs: MetricInput[];
  dailySales: DailySale[];
  errors: ParsedRowError[];
  rawCount: number;
  validCount: number;
  ignoredCount: number;
  /**
   * Normalized model-name keys from Flipkart Remarks=EOL rows (tracked sub-categories only).
   * Persisted on ingest for Amazon to exclude matching model names.
   */
  flipkartEolModelNames: string[];
}

export interface DashboardRecord extends ComputedMetric {
  product_name: string;
  sub_category: string | null;
  category: string | null;
  brand: string | null;
  image_url: string | null;
}
