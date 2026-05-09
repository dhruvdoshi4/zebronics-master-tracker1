import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth-context";
import { AppLayout } from "./layout";
import { AsinLookupPage } from "./page-asin";
import { DashboardPage } from "./page-dashboard";
import { HoStockPage } from "./page-ho-stock";
import { LoginPage } from "./page-login";
import { ProductHubPage } from "./page-product-hub";
import { ProductPoPage } from "./page-po";
import { ProductMasterPage } from "./page-products";
import { SelloutChannelPage } from "./page-sellout-channel";
import { SelloutGrowthPage } from "./page-sellout-growth";
import { UploadPage } from "./page-upload";
import { useAuth } from "./use-auth";
import { InlineLoader } from "./ui";

function ProtectedRoute() {
  const { isLoading, session } = useAuth();
  if (isLoading) {
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
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Navigate to="/app/upload" replace />} />
              <Route path="upload" element={<UploadPage />} />
              <Route path="asin" element={<AsinLookupPage />} />
              <Route path="amazon" element={<DashboardPage marketplace="amazon" />} />
              <Route path="flipkart" element={<DashboardPage marketplace="flipkart" />} />
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
