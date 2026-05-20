import { Navigate, useParams } from "react-router-dom";
import { SelloutGrowthPage } from "./page-sellout-growth";
import { parseQuickCommerceChannel, qcomDashboardPath } from "./tenants";

/** Reuses sellout/growth charts with QCom marketplace in the URL. */
export function QcomSelloutRoute() {
  const { channel, code } = useParams<{ channel: string; code: string }>();
  const parsed = parseQuickCommerceChannel(channel);
  if (!parsed || !code) {
    return <Navigate to={qcomDashboardPath("zepto")} replace />;
  }
  const productCode = decodeURIComponent(code);
  return (
    <SelloutGrowthPage
      forcedMarketplace={parsed}
      forcedProductCode={productCode}
      qcomBackPath={qcomDashboardPath(parsed)}
    />
  );
}
