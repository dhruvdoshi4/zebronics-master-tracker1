import { Navigate, useParams } from "react-router-dom";

/** Old `/app/product/id/:productId` URLs → `/app/model/:productId` */
export function ProductIdRouteRedirect() {
  const { productId } = useParams<{ productId: string }>();
  if (!productId) return <Navigate to="/app/asin" replace />;
  return <Navigate to={`/app/model/${encodeURIComponent(productId)}`} replace />;
}

/** Old `/app/product/id/:productId/po/:marketplace` → model route */
export function ProductIdPoRouteRedirect() {
  const { productId, marketplace } = useParams<{ productId: string; marketplace: string }>();
  if (!productId || !marketplace) return <Navigate to="/app/asin" replace />;
  return (
    <Navigate
      to={`/app/model/${encodeURIComponent(productId)}/po/${marketplace}`}
      replace
    />
  );
}

/** Old sellout-growth under product/id */
export function ProductIdSelloutRouteRedirect() {
  const { productId, marketplace } = useParams<{ productId: string; marketplace: string }>();
  if (!productId || !marketplace) return <Navigate to="/app/asin" replace />;
  return (
    <Navigate
      to={`/app/model/${encodeURIComponent(productId)}/sellout-growth/${marketplace}`}
      replace
    />
  );
}
