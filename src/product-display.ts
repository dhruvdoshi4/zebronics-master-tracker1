import { enrichFlipkartProductName, lookupFlipkartModelName } from "./flipkart-fsn-catalog";
import { normalizeKey } from "./utils";

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
  const name = String(productName ?? "").trim();

  if (code) {
    const enriched = enrichFlipkartProductName(code, productName);
    if (
      enriched &&
      enriched.toUpperCase() !== code.toUpperCase() &&
      !looksLikeProductSku(enriched)
    ) {
      return enriched;
    }
    const fromCatalog = lookupFlipkartModelName(code);
    if (fromCatalog) return fromCatalog;
  }

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

const LOOKUP_MODEL_MAX_LEN = 40;

/** Feature words that appear on Amazon masters but are not model names (e.g. v19HD listed as "HDMI"). */
const GENERIC_LISTING_LABELS = new Set([
  "hdmi",
  "usb",
  "vga",
  "dvi",
  "displayport",
  "led",
  "lcd",
  "fhd",
  "uhd",
  "hd",
  "fullhd",
  "monitor",
  "projector",
  "speaker",
  "headphone",
  "earphone",
  "keyboard",
  "mouse",
  "webcam",
  "cable",
  "adapter",
  "portable",
  "wireless",
  "bluetooth",
  "zebronics",
  "zeb",
  "gaming",
  "smart",
]);

/** User is searching by listing code (ASIN / FSN / product ID), not a model fragment. */
export function isDirectListingCodeQuery(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (/^\d{4,}$/.test(q)) return true;
  if (/^B0[A-Z0-9]{8}$/i.test(q)) return true;
  if (looksLikeProductSku(q)) return true;
  return false;
}

/** Model-name search only — matches catalogue labels like `A24FHD`, not `A24` inside an FSN. */
export function modelNameMatchesLookupQuery(modelName: string, query: string): boolean {
  const model = normalizeKey(modelName);
  const q = normalizeKey(query);
  if (!model || !q || model === "—") return false;
  if (/^\d+$/.test(modelName.trim())) return false;
  if (isGenericListingLabel(modelName)) return false;
  if (model === q) return true;
  if (model.startsWith(q)) return true;
  if (model.includes(q)) return q.length >= 3 || /\d/.test(q);

  const compactModel = model.replace(/\s/g, "");
  const compactQ = q.replace(/\s/g, "");
  if (compactQ.length >= 2 && compactModel.includes(compactQ)) {
    return compactQ.length >= 3 || /\d/.test(compactQ);
  }

  return false;
}

export function isGenericListingLabel(name: string): boolean {
  const key = normalizeKey(name);
  if (!key) return true;
  if (GENERIC_LISTING_LABELS.has(key)) return true;
  /** Keep short model SKUs (K20, V19); drop tiny generic words (HD, USB as sole label). */
  if (key.length <= 3 && !/\d/.test(key)) return true;
  return false;
}

function modelLabelScore(name: string): number {
  let score = name.length;
  if (/\d/.test(name)) score -= 8;
  if (/[a-z]+\d|[a-z]{2,}\d{2}/i.test(name)) score -= 6;
  if (isGenericListingLabel(name)) score += 50;
  return score;
}

/** Truncate very long marketplace titles in lookup dropdowns. */
export function compactLookupModelLabel(
  name: string,
  maxLen = LOOKUP_MODEL_MAX_LEN,
): string {
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1).trim()}…`;
}

function pickMarketplaceModelLabel(flipkart: string, amazon: string): string {
  const fk = flipkart.trim();
  const am = amazon.trim();
  const fkOk = fk.length > 0 && !isGenericListingLabel(fk);
  const amOk = am.length > 0 && !isGenericListingLabel(am);

  if (fkOk && amOk) {
    return modelLabelScore(fk) <= modelLabelScore(am) ? fk : am;
  }
  if (fkOk) return fk;
  if (amOk) return am;
  if (fk.length > 0) return fk;
  if (am.length > 0) return am;
  return "";
}

/**
 * Display model for Product Lookup + Model Workspace — **Amazon / Flipkart sellout master only**
 * (FSN catalogue map on Flipkart). HO stock titles are never used for the name line.
 */
export function unifiedLookupModelName(opts: {
  hoModelName?: string | null;
  amazonName?: string | null;
  amazonCode?: string | null;
  flipkartName?: string | null;
  flipkartCode?: string | null;
  fallback?: string | null;
}): string {
  void opts.hoModelName;

  const flipkart = catalogProductName(opts.flipkartName, opts.flipkartCode);
  const amazon = catalogProductName(opts.amazonName, opts.amazonCode);
  const picked = pickMarketplaceModelLabel(flipkart, amazon);
  if (picked) return compactLookupModelLabel(picked);

  return "—";
}

export function isAcceptableUnifiedSuggestion(
  row: {
    modelName: string;
    erpProductId: string | null;
    asin: string | null;
    fsn: string | null;
  },
  query: string,
): boolean {
  const q = query.trim();
  const name = row.modelName.trim();
  if (!name || name === "—") return false;
  if (/^\d+$/.test(name)) return false;
  if (row.erpProductId === name && !isDirectListingCodeQuery(q)) return false;
  if (isGenericListingLabel(name)) return false;

  if (isDirectListingCodeQuery(q)) {
    if (row.erpProductId === q) return true;
    if (row.asin?.toUpperCase() === q.toUpperCase()) return true;
    if (row.fsn?.toUpperCase() === q.toUpperCase()) return true;
  }

  return modelNameMatchesLookupQuery(name, q);
}

/** When merging lookup rows, prefer a real model label over generic tokens like "HDMI". */
export function mergeUnifiedModelNames(current: string, incoming: string): string {
  const a = current.trim();
  const b = incoming.trim();
  if (!a || a === "—") return b || "—";
  if (!b || b === "—") return a;
  return pickMarketplaceModelLabel(a, b) || a;
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
