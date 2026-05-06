import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth-context";
import { AppLayout } from "./layout";
import { AsinLookupPage } from "./page-asin";
import { DashboardPage } from "./page-dashboard";
import { LoginPage } from "./page-login";
import { ProductMasterPage } from "./page-products";
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
              <Route index element={<Navigate to="/app/amazon" replace />} />
              <Route path="amazon" element={<DashboardPage marketplace="amazon" />} />
              <Route path="flipkart" element={<DashboardPage marketplace="flipkart" />} />
              <Route path="upload" element={<UploadPage />} />
              <Route path="asin" element={<AsinLookupPage />} />
              <Route path="products" element={<ProductMasterPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/app/amazon" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
