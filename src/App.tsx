import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "./auth-context";
import { AppLayout } from "./layout";
import { AsinLookupPage } from "./page-asin";
import { DashboardPage } from "./page-dashboard";
import { HoStockPage } from "./page-ho-stock";
import { LoginPage } from "./page-login";
import { WelcomeSplashPage } from "./page-welcome";
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
import { useAuth } from "./use-auth";
import { InlineLoader } from "./ui";
import { isWelcomePending } from "./welcome-users";

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
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/welcome" element={<WelcomeSplashPage />} />
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Navigate to="/app/upload" replace />} />
              <Route path="upload" element={<UploadPage />} />
              <Route path="asin" element={<AsinLookupPage />} />
              <Route path="amazon" element={<DashboardPage marketplace="amazon" />} />
              <Route path="flipkart" element={<DashboardPage marketplace="flipkart" />} />
              <Route path="analysis" element={<AnalysisHubPage />} />
              <Route path="analysis/category" element={<AnalysisCategoryPage />} />
              <Route path="analysis/category/:subCategory" element={<AnalysisCategoryDetailPage />} />
              <Route path="analysis/sellout-lookup" element={<AnalysisSelloutLookupPage />} />
              <Route path="gms" element={<GmsHubPage />} />
              <Route path="gms/category" element={<GmsCategoryPage />} />
              <Route path="gms/category/:subCategory" element={<GmsCategoryDetailPage />} />
              <Route path="gms/product" element={<GmsProductHubPage />} />
              <Route path="gms/product/:marketplace" element={<GmsProductPage />} />
              <Route
                path="gms/product/:marketplace/:code"
                element={<GmsProductDetailPage />}
              />
              <Route path="products" element={<ProductMasterPage />} />
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
          <Route path="*" element={<Navigate to="/app/upload" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
