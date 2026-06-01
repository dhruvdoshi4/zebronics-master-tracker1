import { Route } from "react-router-dom";
import { LegacyBareAppPathRedirect } from "./legacy-monitor-path-redirect";

/** Redirect old bookmarks `/app/upload` → `/app/admin/upload` or `/app/mp/upload`. */
export function legacyBareEcomRedirectRoutes() {
  const redirect = <LegacyBareAppPathRedirect />;
  return (
    <>
      <Route path="upload" element={redirect} />
      <Route path="lookup" element={redirect} />
      <Route path="asin" element={redirect} />
      <Route path="asin/*" element={redirect} />
      <Route path="amazon" element={redirect} />
      <Route path="flipkart" element={redirect} />
      <Route path="products" element={redirect} />
      <Route path="analysis" element={redirect} />
      <Route path="analysis/*" element={redirect} />
      <Route path="ho-stock" element={redirect} />
      <Route path="ho-stock/*" element={redirect} />
      <Route path="gms" element={redirect} />
      <Route path="gms/*" element={redirect} />
      <Route path="model/*" element={redirect} />
      <Route path="product/*" element={redirect} />
      <Route path="sellout/*" element={redirect} />
    </>
  );
}
