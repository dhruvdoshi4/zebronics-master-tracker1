import type { QuickCommerceChannel } from "./tenants";

export type QcomWorkspaceSuffix = "po" | "sellout-growth";

/** Model workspace — choose PO or Sellout & Growth (like monitor / projector hub). */
export function qcomProductHubPath(canonicalProductCode: string): string {
  return `/app/qcom/product/${encodeURIComponent(canonicalProductCode)}`;
}

export function qcomProductWorkspacePath(
  canonicalProductCode: string,
  suffix: QcomWorkspaceSuffix,
  channel: QuickCommerceChannel,
): string {
  return `/app/qcom/product/${encodeURIComponent(canonicalProductCode)}/${suffix}/${channel}`;
}

/** @deprecated Prefer qcomProductHubPath — opens sellout directly without workspace chooser. */
export function qcomSelloutPath(channel: QuickCommerceChannel, productCode: string): string {
  return `/app/qcom/sellout/${channel}/${encodeURIComponent(productCode)}`;
}

export function qcomLookupPath(): string {
  return "/app/qcom/lookup";
}

/** Category roll-up list (sidebar entry). */
export function qcomCategoryAnalysisListPath(): string {
  return "/app/qcom/analysis/category";
}

export function qcomAnalysisCategoryPath(category: string): string {
  return `/app/qcom/analysis/category/${encodeURIComponent(category)}`;
}
