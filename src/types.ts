export type Marketplace = "amazon" | "flipkart";

export type AppRole = "admin" | "viewer";

export type SubCategory = "monitor" | "projector";

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
}

export interface DashboardRecord extends ComputedMetric {
  product_name: string;
  sub_category: string | null;
  category: string | null;
  brand: string | null;
  image_url: string | null;
}
