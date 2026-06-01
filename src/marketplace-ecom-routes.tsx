import { Navigate, Route } from "react-router-dom";
import { ADMIN_APP_PREFIX } from "./admin-app-paths";
import { DAWG_APP_PREFIX } from "./dawg-app-paths";
import { MONITOR_APP_PREFIX } from "./monitor-app-paths";
import { AsinLookupPage } from "./page-asin";
import { DashboardPage } from "./page-dashboard";
import { HoStockPage } from "./page-ho-stock";
import { HoStockHubPage } from "./page-ho-stock-hub";
import { HoStockCategoryPage } from "./page-ho-stock-category";
import { HoStockCategoryDetailPage } from "./page-ho-stock-category-detail";
import {
  ProductIdPoRouteRedirect,
  ProductIdRouteRedirect,
  ProductIdSelloutRouteRedirect,
} from "./product-id-redirect";
import { ProductHubPage } from "./page-product-hub";
import { ProductPoPage } from "./page-po";
import { ProductMasterPage } from "./page-products";
import { SelloutChannelPage } from "./page-sellout-channel";
import { SelloutGrowthPage } from "./page-sellout-growth";
import { AnalysisCategoryDetailPage } from "./page-analysis-category-detail";
import { AnalysisCategoryPage } from "./page-analysis-category";
import { AnalysisHubPage } from "./page-analysis-hub";
import { UploadPage } from "./page-upload";
import { GmsHubPage } from "./page-gms-hub";
import { GmsCategoryPage } from "./page-gms-category";
import { GmsCategoryDetailPage } from "./page-gms-category-detail";
import { GmsProductPage } from "./page-gms-product";
import { GmsProductHubPage } from "./page-gms-product-hub";
import { GmsProductDetailPage } from "./page-gms-product-detail";

type EcomPrefix =
  | typeof MONITOR_APP_PREFIX
  | typeof ADMIN_APP_PREFIX
  | typeof DAWG_APP_PREFIX;

function lookupPath(prefix: EcomPrefix): string {
  return `${prefix}/lookup`;
}

/** Shared Amazon + Flipkart routes for Hari (`/app/mp`) and admin global (`/app/admin`). */
export function marketplaceEcomRouteElements(prefix: EcomPrefix) {
  const lookup = lookupPath(prefix);

  return (
    <>
      <Route path="upload" element={<UploadPage />} />
      <Route path="lookup" element={<AsinLookupPage />} />
      <Route path="asin" element={<Navigate to={lookup} replace />} />
      <Route path="amazon" element={<DashboardPage marketplace="amazon" />} />
      <Route path="flipkart" element={<DashboardPage marketplace="flipkart" />} />
      <Route path="analysis" element={<AnalysisHubPage />} />
      <Route path="analysis/category" element={<AnalysisCategoryPage />} />
      <Route path="analysis/category/:category" element={<AnalysisCategoryDetailPage />} />
      <Route
        path="analysis/sellout-lookup"
        element={<Navigate to={lookup} replace />}
      />
      <Route path="ho-stock" element={<HoStockHubPage />} />
      <Route path="ho-stock/category" element={<HoStockCategoryPage />} />
      <Route path="ho-stock/category/:subCategory" element={<HoStockCategoryDetailPage />} />
      <Route path="gms" element={<GmsHubPage />} />
      <Route path="gms/category" element={<GmsCategoryPage />} />
      <Route path="gms/category/charts" element={<GmsCategoryDetailPage />} />
      <Route path="gms/category/:subCategory" element={<GmsCategoryDetailPage />} />
      <Route path="gms/product" element={<GmsProductHubPage />} />
      <Route path="gms/product/id/:productId" element={<GmsProductDetailPage />} />
      <Route path="gms/product/:marketplace" element={<GmsProductPage />} />
      <Route path="gms/product/:marketplace/:code" element={<GmsProductDetailPage />} />
      <Route path="products" element={<ProductMasterPage />} />
      <Route path="model/:productId" element={<ProductHubPage />} />
      <Route path="model/:productId/po/:marketplace" element={<ProductPoPage />} />
      <Route path="model/:productId/sellout-growth/:marketplace" element={<SelloutGrowthPage />} />
      <Route path="product/id/:productId" element={<ProductIdRouteRedirect />} />
      <Route path="product/id/:productId/po/:marketplace" element={<ProductIdPoRouteRedirect />} />
      <Route
        path="product/id/:productId/sellout-growth/:marketplace"
        element={<ProductIdSelloutRouteRedirect />}
      />
      <Route path="product/:marketplace/:code" element={<ProductHubPage />} />
      <Route path="product/:marketplace/:code/po" element={<ProductPoPage />} />
      <Route path="product/:marketplace/:code/sellout-channel" element={<SelloutChannelPage />} />
      <Route path="product/:marketplace/:code/sellout-growth" element={<SelloutGrowthPage />} />
      <Route path="product/:marketplace/:code/ho-stock" element={<HoStockPage />} />
      <Route path="sellout/:marketplace/:code" element={<SelloutGrowthPage />} />
    </>
  );
}
