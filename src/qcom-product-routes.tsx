import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { QcomProductHubPage } from "./page-qcom-product-hub";
import { QcomProductPoPage } from "./page-qcom-po";
import { SelloutGrowthPage } from "./page-sellout-growth";
import { qcomProductHubPath } from "./qcom-paths";
import { parseQcomWorkspaceKey, qcomWorkspaceMarketplace } from "./tenants";

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
  const workspace = parseQcomWorkspaceKey(channel);
  const canonicalCode = decodeURIComponent(code ?? "").trim();

  if (!workspace || !canonicalCode) {
    return <Navigate to="/app/qcom/lookup" replace />;
  }

  return (
    <SelloutGrowthPage
      forcedMarketplace={qcomWorkspaceMarketplace(workspace)}
      forcedProductCode={canonicalCode}
      qcomBackPath={fromAnalysis ? undefined : qcomProductHubPath(canonicalCode)}
      qcomFromAnalysis={fromAnalysis}
    />
  );
}
