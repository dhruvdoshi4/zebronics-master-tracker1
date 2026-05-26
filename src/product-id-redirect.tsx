import { Navigate, useParams } from "react-router-dom";
import { appRoutePrefixFromLocation, productLookupPath } from "./product-channel";

/** Old `/app/product/id/:productId` URLs → `/app/model/:productId` */
export function ProductIdRouteRedirect() {
  const { productId } = useParams<{ productId: string }>();
  const prefix = appRoutePrefixFromLocation();
  if (!productId) return <Navigate to={productLookupPath(prefix)} replace />;
  return <Navigate to={`${prefix}/model/${encodeURIComponent(productId)}`} replace />;
}

/** Old `/app/product/id/:productId/po/:marketplace` → model route */
export function ProductIdPoRouteRedirect() {
  const { productId, marketplace } = useParams<{ productId: string; marketplace: string }>();
  const prefix = appRoutePrefixFromLocation();
  if (!productId || !marketplace) return <Navigate to={productLookupPath(prefix)} replace />;
  return (
    <Navigate
      to={`${prefix}/model/${encodeURIComponent(productId)}/po/${marketplace}`}
      replace
    />
  );
}

/** Old sellout-growth under product/id */
export function ProductIdSelloutRouteRedirect() {
  const { productId, marketplace } = useParams<{ productId: string; marketplace: string }>();
  const prefix = appRoutePrefixFromLocation();
  if (!productId || !marketplace) return <Navigate to={productLookupPath(prefix)} replace />;
  return (
    <Navigate
      to={`${prefix}/model/${encodeURIComponent(productId)}/sellout-growth/${marketplace}`}
      replace
    />
  );
}
