import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AdminRealmProvider } from "./admin-realm-context";
import { AuthProvider } from "./auth-context";
import { AppLayout } from "./layout";
import { AsinLookupPage } from "./page-asin";
import { DashboardPage } from "./page-dashboard";
import { HoStockPage } from "./page-ho-stock";
import { HoStockHubPage } from "./page-ho-stock-hub";
import { HoStockCategoryPage } from "./page-ho-stock-category";
import { HoStockCategoryDetailPage } from "./page-ho-stock-category-detail";
import { LoginPage } from "./page-login";
import { WelcomeSplashPage } from "./page-welcome";
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
import { AnalysisSelloutLookupPage } from "./page-analysis-sellout-lookup";
import { UploadPage } from "./page-upload";
import { GmsHubPage } from "./page-gms-hub";
import { GmsCategoryPage } from "./page-gms-category";
import { GmsCategoryDetailPage } from "./page-gms-category-detail";
import { GmsProductPage } from "./page-gms-product";
import { GmsProductHubPage } from "./page-gms-product-hub";
import { GmsProductDetailPage } from "./page-gms-product-detail";
import { QcomAnalysisCategoryPage } from "./page-qcom-analysis-category";
import { QcomAnalysisCategoryDetailPage } from "./page-qcom-analysis-category-detail";
import { QcomLookupPage } from "./page-qcom-lookup";
import { QcomUploadPage } from "./page-upload-qcom";
import { QcomChannelLayout, QcomChannelIndexRedirect } from "./page-qcom-channel-layout";
import {
  QcomChannelAnalysisDetailRoute,
  QcomChannelAnalysisHubRoute,
  QcomChannelDashboardRoute,
} from "./page-qcom-channel-routes";
import {
  QcomProductHubRoute,
  QcomProductPoRoute,
  QcomProductSelloutRoute,
} from "./qcom-product-routes";
import { QcomSelloutRoute } from "./qcom-sellout-route";
import { useAuth } from "./use-auth";
import { CatalogScopeProvider } from "./catalog-scope-context";
import { CATALOG_WORKSPACE_HOME_AUDIO } from "./catalog-workspace";
import { AppHomeRedirect } from "./tenant-gate";
import { InlineLoader } from "./ui";
import { getDefaultAppPath } from "./tenants";
import { isWelcomePending } from "./welcome-users";

function CatchAllRedirect() {
  const { isLoading, session } = useAuth();
  if (isLoading) {
    return (
      <div className="p-6">
        <InlineLoader />
      </div>
    );
  }
  return <Navigate to={getDefaultAppPath(session?.user.email)} replace />;
}

function ProtectedRoute() {
  const { isLoading, session } = useAuth();
  const location = useLocation();
  const welcomeRoute = location.pathname === "/welcome";

  if (isLoading && !(welcomeRoute && isWelcomePending())) {
    return (
      <div className="p-6">
        <InlineLoader />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AdminRealmProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/welcome" element={<WelcomeSplashPage />} />
            <Route
              path="/app"
              element={
                <CatalogScopeProvider>
                  <AppLayout />
                </CatalogScopeProvider>
              }
            >
              <Route index element={<AppHomeRedirect />} />
              <Route path="qcom/upload" element={<QcomUploadPage />} />
              <Route path="qcom/lookup" element={<QcomLookupPage />} />
              <Route path="qcom/product/:code" element={<QcomProductHubRoute />} />
              <Route path="qcom/product/:code/po/:channel" element={<QcomProductPoRoute />} />
              <Route
                path="qcom/product/:code/sellout-growth/:channel"
                element={<QcomProductSelloutRoute />}
              />
              <Route
                path="qcom/analysis"
                element={<Navigate to="/app/qcom/analysis/category" replace />}
              />
              <Route path="qcom/analysis/category" element={<QcomAnalysisCategoryPage />} />
              <Route path="qcom/analysis/category/:category" element={<QcomAnalysisCategoryDetailPage />} />
              <Route
                path="qcom/analysis/sellout-lookup"
                element={<Navigate to="/app/qcom/lookup" replace />}
              />
              <Route path="qcom/sellout/:channel/:code" element={<QcomSelloutRoute />} />
              <Route path="qcom" element={<Navigate to="/app/qcom/upload" replace />} />
              <Route path="qcom/:channel" element={<QcomChannelLayout />}>
                <Route index element={<QcomChannelIndexRedirect />} />
                <Route path="dashboard" element={<QcomChannelDashboardRoute />} />
                <Route path="analysis" element={<QcomChannelAnalysisHubRoute />} />
                <Route
                  path="analysis/:category"
                  element={<QcomChannelAnalysisDetailRoute />}
                />
              </Route>
              <Route path="upload" element={<UploadPage />} />
              <Route path="asin" element={<AsinLookupPage />} />
              <Route path="amazon" element={<DashboardPage marketplace="amazon" />} />
              <Route path="flipkart" element={<DashboardPage marketplace="flipkart" />} />
              <Route
                path="pa"
                element={
                  <CatalogScopeProvider workspace="personal_audio">
                    <Outlet />
                  </CatalogScopeProvider>
                }
              >
                <Route index element={<Navigate to="/app/pa/upload" replace />} />
                <Route path="upload" element={<UploadPage />} />
                <Route path="asin" element={<Navigate to="/app/pa/lookup" replace />} />
                <Route path="lookup" element={<AsinLookupPage />} />
                <Route path="amazon" element={<DashboardPage marketplace="amazon" />} />
                <Route path="flipkart" element={<DashboardPage marketplace="flipkart" />} />
                <Route
                  path="analysis"
                  element={<Navigate to="/app/pa/analysis/category" replace />}
                />
                <Route path="analysis/category" element={<AnalysisCategoryPage />} />
                <Route
                  path="analysis/category/:category"
                  element={<AnalysisCategoryDetailPage />}
                />
                <Route
                  path="analysis/sellout-lookup"
                  element={<Navigate to="/app/pa/lookup" replace />}
                />
                <Route path="ho-stock" element={<HoStockHubPage />} />
                <Route path="ho-stock/category" element={<HoStockCategoryPage />} />
                <Route
                  path="ho-stock/category/:subCategory"
                  element={<HoStockCategoryDetailPage />}
                />
                <Route path="gms" element={<GmsHubPage />} />
                <Route path="gms/category" element={<GmsCategoryPage />} />
                <Route path="gms/category/charts" element={<GmsCategoryDetailPage />} />
                <Route path="gms/category/:subCategory" element={<GmsCategoryDetailPage />} />
                <Route path="gms/product" element={<GmsProductHubPage />} />
                <Route path="gms/product/id/:productId" element={<GmsProductDetailPage />} />
                <Route path="gms/product/:marketplace" element={<GmsProductPage />} />
                <Route
                  path="gms/product/:marketplace/:code"
                  element={<GmsProductDetailPage />}
                />
                <Route path="products" element={<ProductMasterPage />} />
                <Route path="model/:productId" element={<ProductHubPage />} />
                <Route path="model/:productId/po/:marketplace" element={<ProductPoPage />} />
                <Route
                  path="model/:productId/sellout-growth/:marketplace"
                  element={<SelloutGrowthPage />}
                />
                <Route path="product/:marketplace/:code" element={<ProductHubPage />} />
                <Route path="product/:marketplace/:code/po" element={<ProductPoPage />} />
                <Route
                  path="product/:marketplace/:code/sellout-channel"
                  element={<SelloutChannelPage />}
                />
                <Route
                  path="product/:marketplace/:code/sellout-growth"
                  element={<SelloutGrowthPage />}
                />
                <Route path="product/:marketplace/:code/ho-stock" element={<HoStockPage />} />
                <Route path="sellout/:marketplace/:code" element={<SelloutGrowthPage />} />
              </Route>
              <Route
                path="ri"
                element={
                  <CatalogScopeProvider workspace="rithika_it_gaming">
                    <Outlet />
                  </CatalogScopeProvider>
                }
              >
                <Route index element={<Navigate to="/app/ri/upload" replace />} />
                <Route path="upload" element={<UploadPage />} />
                <Route path="asin" element={<Navigate to="/app/ri/lookup" replace />} />
                <Route path="lookup" element={<AsinLookupPage />} />
                <Route path="amazon" element={<DashboardPage marketplace="amazon" />} />
                <Route path="flipkart" element={<DashboardPage marketplace="flipkart" />} />
                <Route path="analysis" element={<AnalysisHubPage />} />
                <Route path="analysis/category" element={<AnalysisCategoryPage />} />
                <Route
                  path="analysis/category/:category"
                  element={<AnalysisCategoryDetailPage />}
                />
                <Route path="analysis/sellout-lookup" element={<AnalysisSelloutLookupPage />} />
                <Route path="ho-stock" element={<HoStockHubPage />} />
                <Route path="ho-stock/category" element={<HoStockCategoryPage />} />
                <Route
                  path="ho-stock/category/:subCategory"
                  element={<HoStockCategoryDetailPage />}
                />
                <Route path="gms" element={<GmsHubPage />} />
                <Route path="gms/category" element={<GmsCategoryPage />} />
                <Route path="gms/category/charts" element={<GmsCategoryDetailPage />} />
                <Route path="gms/category/:subCategory" element={<GmsCategoryDetailPage />} />
                <Route path="gms/product" element={<GmsProductHubPage />} />
                <Route path="gms/product/id/:productId" element={<GmsProductDetailPage />} />
                <Route path="gms/product/:marketplace" element={<GmsProductPage />} />
                <Route
                  path="gms/product/:marketplace/:code"
                  element={<GmsProductDetailPage />}
                />
                <Route path="products" element={<ProductMasterPage />} />
                <Route path="model/:productId" element={<ProductHubPage />} />
                <Route path="model/:productId/po/:marketplace" element={<ProductPoPage />} />
                <Route
                  path="model/:productId/sellout-growth/:marketplace"
                  element={<SelloutGrowthPage />}
                />
                <Route path="product/:marketplace/:code" element={<ProductHubPage />} />
                <Route path="product/:marketplace/:code/po" element={<ProductPoPage />} />
                <Route
                  path="product/:marketplace/:code/sellout-channel"
                  element={<SelloutChannelPage />}
                />
                <Route
                  path="product/:marketplace/:code/sellout-growth"
                  element={<SelloutGrowthPage />}
                />
                <Route path="product/:marketplace/:code/ho-stock" element={<HoStockPage />} />
                <Route path="sellout/:marketplace/:code" element={<SelloutGrowthPage />} />
              </Route>
              <Route
                path="pv"
                element={
                  <CatalogScopeProvider workspace="roma_powerbank">
                    <Outlet />
                  </CatalogScopeProvider>
                }
              >
                <Route index element={<Navigate to="/app/pv/upload" replace />} />
                <Route path="upload" element={<UploadPage />} />
                <Route path="lookup" element={<AsinLookupPage />} />
                <Route path="amazon" element={<DashboardPage marketplace="amazon" />} />
                <Route path="flipkart" element={<DashboardPage marketplace="flipkart" />} />
                <Route
                  path="analysis"
                  element={<Navigate to="/app/pv/analysis/category" replace />}
                />
                <Route path="analysis/category" element={<AnalysisCategoryPage />} />
                <Route
                  path="analysis/category/:category"
                  element={<AnalysisCategoryDetailPage />}
                />
                <Route path="gms" element={<GmsHubPage />} />
                <Route path="gms/category" element={<GmsCategoryPage />} />
                <Route path="gms/category/charts" element={<GmsCategoryDetailPage />} />
                <Route path="gms/category/:subCategory" element={<GmsCategoryDetailPage />} />
                <Route path="gms/product" element={<GmsProductHubPage />} />
                <Route path="gms/product/id/:productId" element={<GmsProductDetailPage />} />
                <Route path="gms/product/:marketplace" element={<GmsProductPage />} />
                <Route
                  path="gms/product/:marketplace/:code"
                  element={<GmsProductDetailPage />}
                />
                <Route path="ho-stock" element={<HoStockHubPage />} />
                <Route path="ho-stock/category" element={<HoStockCategoryPage />} />
                <Route
                  path="ho-stock/category/:subCategory"
                  element={<HoStockCategoryDetailPage />}
                />
                <Route path="products" element={<ProductMasterPage />} />
                <Route path="model/:productId" element={<ProductHubPage />} />
                <Route path="model/:productId/po/:marketplace" element={<ProductPoPage />} />
                <Route
                  path="model/:productId/sellout-growth/:marketplace"
                  element={<SelloutGrowthPage />}
                />
                <Route path="product/:marketplace/:code" element={<ProductHubPage />} />
                <Route path="product/:marketplace/:code/po" element={<ProductPoPage />} />
                <Route
                  path="product/:marketplace/:code/sellout-channel"
                  element={<SelloutChannelPage />}
                />
                <Route
                  path="product/:marketplace/:code/sellout-growth"
                  element={<SelloutGrowthPage />}
                />
                <Route path="product/:marketplace/:code/ho-stock" element={<HoStockPage />} />
                <Route path="sellout/:marketplace/:code" element={<SelloutGrowthPage />} />
              </Route>
              <Route
                path="ha"
                element={
                  <CatalogScopeProvider workspace={CATALOG_WORKSPACE_HOME_AUDIO}>
                    <Outlet />
                  </CatalogScopeProvider>
                }
              >
                <Route index element={<Navigate to="/app/ha/upload" replace />} />
                <Route path="upload" element={<UploadPage />} />
                <Route path="asin" element={<Navigate to="/app/ha/lookup" replace />} />
                <Route path="lookup" element={<AsinLookupPage />} />
                <Route path="amazon" element={<DashboardPage marketplace="amazon" />} />
                <Route path="flipkart" element={<DashboardPage marketplace="flipkart" />} />
                <Route path="analysis" element={<AnalysisHubPage />} />
                <Route path="analysis/category" element={<AnalysisCategoryPage />} />
                <Route
                  path="analysis/category/:category"
                  element={<AnalysisCategoryDetailPage />}
                />
                <Route path="analysis/sellout-lookup" element={<AnalysisSelloutLookupPage />} />
                <Route path="ho-stock" element={<HoStockHubPage />} />
                <Route path="ho-stock/category" element={<HoStockCategoryPage />} />
                <Route
                  path="ho-stock/category/:subCategory"
                  element={<HoStockCategoryDetailPage />}
                />
                <Route path="gms" element={<GmsHubPage />} />
                <Route path="gms/category" element={<GmsCategoryPage />} />
                <Route path="gms/category/charts" element={<GmsCategoryDetailPage />} />
                <Route path="gms/category/:subCategory" element={<GmsCategoryDetailPage />} />
                <Route path="gms/product" element={<GmsProductHubPage />} />
                <Route path="gms/product/id/:productId" element={<GmsProductDetailPage />} />
                <Route path="gms/product/:marketplace" element={<GmsProductPage />} />
                <Route
                  path="gms/product/:marketplace/:code"
                  element={<GmsProductDetailPage />}
                />
                <Route path="products" element={<ProductMasterPage />} />
                <Route path="model/:productId" element={<ProductHubPage />} />
                <Route path="model/:productId/po/:marketplace" element={<ProductPoPage />} />
                <Route
                  path="model/:productId/sellout-growth/:marketplace"
                  element={<SelloutGrowthPage />}
                />
                <Route path="product/:marketplace/:code" element={<ProductHubPage />} />
                <Route path="product/:marketplace/:code/po" element={<ProductPoPage />} />
                <Route
                  path="product/:marketplace/:code/sellout-channel"
                  element={<SelloutChannelPage />}
                />
                <Route
                  path="product/:marketplace/:code/sellout-growth"
                  element={<SelloutGrowthPage />}
                />
                <Route path="product/:marketplace/:code/ho-stock" element={<HoStockPage />} />
                <Route path="sellout/:marketplace/:code" element={<SelloutGrowthPage />} />
              </Route>
              <Route path="analysis" element={<AnalysisHubPage />} />
              <Route path="analysis/category" element={<AnalysisCategoryPage />} />
              <Route path="analysis/category/:category" element={<AnalysisCategoryDetailPage />} />
              <Route
                path="analysis/sellout-lookup"
                element={<Navigate to="/app/asin" replace />}
              />
              <Route path="ho-stock" element={<HoStockHubPage />} />
              <Route path="ho-stock/category" element={<HoStockCategoryPage />} />
              <Route
                path="ho-stock/category/:subCategory"
                element={<HoStockCategoryDetailPage />}
              />
              <Route path="gms" element={<GmsHubPage />} />
              <Route path="gms/category" element={<GmsCategoryPage />} />
              <Route path="gms/category/charts" element={<GmsCategoryDetailPage />} />
              <Route path="gms/category/:subCategory" element={<GmsCategoryDetailPage />} />
              <Route path="gms/product" element={<GmsProductHubPage />} />
              <Route path="gms/product/id/:productId" element={<GmsProductDetailPage />} />
              <Route path="gms/product/:marketplace" element={<GmsProductPage />} />
              <Route
                path="gms/product/:marketplace/:code"
                element={<GmsProductDetailPage />}
              />
              <Route path="products" element={<ProductMasterPage />} />
              <Route path="model/:productId" element={<ProductHubPage />} />
              <Route path="model/:productId/po/:marketplace" element={<ProductPoPage />} />
              <Route
                path="model/:productId/sellout-growth/:marketplace"
                element={<SelloutGrowthPage />}
              />
              <Route path="product/id/:productId" element={<ProductIdRouteRedirect />} />
              <Route
                path="product/id/:productId/po/:marketplace"
                element={<ProductIdPoRouteRedirect />}
              />
              <Route
                path="product/id/:productId/sellout-growth/:marketplace"
                element={<ProductIdSelloutRouteRedirect />}
              />
              <Route path="product/:marketplace/:code" element={<ProductHubPage />} />
              <Route path="product/:marketplace/:code/po" element={<ProductPoPage />} />
              <Route
                path="product/:marketplace/:code/sellout-channel"
                element={<SelloutChannelPage />}
              />
              <Route
                path="product/:marketplace/:code/sellout-growth"
                element={<SelloutGrowthPage />}
              />
              <Route
                path="product/:marketplace/:code/ho-stock"
                element={<HoStockPage />}
              />
              <Route
                path="sellout/:marketplace/:code"
                element={<SelloutGrowthPage />}
              />
            </Route>
          </Route>
          <Route path="*" element={<CatchAllRedirect />} />
        </Routes>
        </AdminRealmProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}
