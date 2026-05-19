import { lookupFlipkartModelName } from "./flipkart-fsn-catalog";

/** True when a string looks like an Amazon ASIN or Flipkart FSN (not a human model name). */
export function looksLikeProductSku(value: string): boolean {
  const v = value.trim();
  if (!v || /\s/.test(v)) return false;

  if (/^B0[A-Z0-9]{8}$/i.test(v)) return true;

  // Flipkart FSN-style ids (e.g. MONH3YRKKXAEFY59) — long alphanumeric, no spaces.
  if (/^[A-Z0-9]{12,20}$/i.test(v) && !/[-_/]/.test(v)) return true;

  return false;
}

/**
 * Raw master name when it is a real catalogue label (not blank / ASIN / FSN).
 */
export function catalogProductName(
  productName: string | null | undefined,
  productCode?: string | null | undefined,
): string {
  const code = String(productCode ?? "").trim();
  const fromCatalog = code ? lookupFlipkartModelName(code) : undefined;
  if (fromCatalog) return fromCatalog;

  const name = String(productName ?? "").trim();

  if (!name) return "";
  if (code && name.toUpperCase() === code.toUpperCase()) return "";
  if (looksLikeProductSku(name)) return "";

  return name;
}

/**
 * Model column / headings: show catalogue model name only — never ASIN/FSN in the Model field.
 */
export function displayModelName(
  productName: string | null | undefined,
  productCode?: string | null | undefined,
): string {
  const catalog = catalogProductName(productName, productCode);
  return catalog || "—";
}

/** Short label for chart axes (truncated catalogue model name). */
export function chartAxisModelLabel(
  productName: string | null | undefined,
  productCode?: string | null | undefined,
  maxLen = 20,
): string {
  const model = displayModelName(productName, productCode);
  if (model === "—") return model;
  return model.length > maxLen ? `${model.slice(0, maxLen - 1)}…` : model;
}
