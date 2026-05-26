/**
 * Marketplace dashboard conventions (Hari monitor/projector + Karan personal audio).
 *
 * **Product Lookup** — always use {@link ProductLookupPanel} + {@link navigateFromUnifiedProductLookup}
 * so search is unified (ASIN / FSN / Product ID / model), deduped by ERP link, and model names come
 * from Amazon/Flipkart sellout masters only (`product-display.ts`).
 *
 * **Sellout MTD comparison** — any page that shows sellout & growth analysis must render
 * {@link SelloutMtdSection} above the FY trend chart when month-level data exists. Category pages
 * should build series via {@link buildCategoryMtdDashboardSeries}; product pages use YoY MoM from
 * uploaded `daily_sales` + `prior_year_mtd_units` on metrics.
 *
 * **Out of scope** — Quick Commerce (`/app/qcom/*`) and daWg data scope keep their own lookup/MTD
 * wrappers. GMS dashboards use GMS metrics, not sellout MTD units.
 *
 * New dashboards: import from this file’s modules; do not fork lookup or MTD UI.
 */

export { ProductLookupPanel } from "./product-lookup-panel";
export type { ProductLookupDestination } from "./product-lookup-nav";
export { navigateFromUnifiedProductLookup } from "./product-lookup-nav";
export { SelloutMtdSection, computeSelloutMtdDashboardProps } from "./sellout-mtd-section";
export { MtdSelloutDashboard } from "./mtd-sellout-dashboard";
export { buildCategoryMtdDashboardSeries } from "./category-sellout-insights";
