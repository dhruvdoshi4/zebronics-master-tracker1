import { normalizeKey } from "./utils";

/** Quick Commerce master — brands excluded from ingest, lookup, and dashboards. */
const EXCLUDED_QCOM_BRANDS = new Set(["zebster"]);

export function isExcludedQcomBrand(brand: string | null | undefined): boolean {
  const key = normalizeKey(brand ?? "");
  return key !== "" && EXCLUDED_QCOM_BRANDS.has(key);
}
