import type { QuickCommerceChannel } from "./tenants";

export function qcomSelloutPath(channel: QuickCommerceChannel, productCode: string): string {
  return `/app/qcom/sellout/${channel}/${encodeURIComponent(productCode)}`;
}

export function qcomLookupPath(): string {
  return "/app/qcom/lookup";
}

export function qcomAnalysisCategoryPath(category: string): string {
  return `/app/qcom/analysis/category/${encodeURIComponent(category)}`;
}
