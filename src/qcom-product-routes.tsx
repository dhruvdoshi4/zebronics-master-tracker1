import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { QcomProductHubPage } from "./page-qcom-product-hub";
import { QcomProductPoPage } from "./page-qcom-po";
import { SelloutGrowthPage } from "./page-sellout-growth";
import { qcomProductHubPath } from "./qcom-paths";
import { parseQuickCommerceChannel } from "./tenants";

export function QcomProductHubRoute() {
  return <QcomProductHubPage />;
}

export function QcomProductPoRoute() {
  return <QcomProductPoPage />;
}

export function QcomProductSelloutRoute() {
  const { code, channel } = useParams<{ code: string; channel: string }>();
  const [searchParams] = useSearchParams();
  const fromAnalysis = searchParams.get("from") === "analysis";
  const parsed = parseQuickCommerceChannel(channel);
  const canonicalCode = decodeURIComponent(code ?? "").trim();

  if (!parsed || !canonicalCode) {
    return <Navigate to="/app/qcom/lookup" replace />;
  }

  return (
    <SelloutGrowthPage
      forcedMarketplace={parsed}
      forcedProductCode={canonicalCode}
      qcomBackPath={fromAnalysis ? undefined : qcomProductHubPath(canonicalCode)}
      qcomFromAnalysis={fromAnalysis}
    />
  );
}
