import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { qcomProductHubPath } from "./qcom-paths";
import { SelloutGrowthPage } from "./page-sellout-growth";
import { parseQcomWorkspaceKey, qcomDashboardPath, qcomWorkspaceMarketplace } from "./tenants";

function resolveQcomHubCode(productCode: string): string {
  const trimmed = productCode.trim();
  return /^B0[A-Z0-9]{8,}$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

/** Legacy direct sellout URL — back link goes to model workspace. */
export function QcomSelloutRoute() {
  const { channel, code } = useParams<{ channel: string; code: string }>();
  const [searchParams] = useSearchParams();
  const fromAnalysis = searchParams.get("from") === "analysis";
  const workspace = parseQcomWorkspaceKey(channel);
  if (!workspace || !code) {
    return <Navigate to={qcomDashboardPath("zepto")} replace />;
  }
  const productCode = decodeURIComponent(code);
  return (
    <SelloutGrowthPage
      forcedMarketplace={qcomWorkspaceMarketplace(workspace)}
      forcedProductCode={productCode}
      qcomBackPath={fromAnalysis ? undefined : qcomProductHubPath(resolveQcomHubCode(productCode))}
      qcomFromAnalysis={fromAnalysis}
    />
  );
}
