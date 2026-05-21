import { Navigate, useParams } from "react-router-dom";
import { QcomConsolidatedComparisonPage } from "./page-qcom-consolidated-comparison";
import { QcomDashboardPage } from "./page-qcom-dashboard";
import { QcomAnalysisCategoryDetailPage } from "./page-qcom-analysis-category-detail";
import { QcomAnalysisCategoryPage } from "./page-qcom-analysis-category";
import {
  parseQcomWorkspaceKey,
  parseQuickCommerceChannel,
  qcomDashboardPath,
} from "./tenants";
export function QcomChannelDashboardRoute() {
  const { channel } = useParams<{ channel: string }>();
  const workspace = parseQcomWorkspaceKey(channel);
  if (!workspace) {
    return <Navigate to={qcomDashboardPath("zepto")} replace />;
  }
  if (workspace === "consolidated") {
    return <QcomConsolidatedComparisonPage />;
  }
  return <QcomDashboardPage workspace={workspace} />;
}

export function QcomChannelAnalysisHubRoute() {
  const { channel } = useParams<{ channel: string }>();
  const marketplace = parseQuickCommerceChannel(channel);
  if (!marketplace) {
    return <Navigate to={qcomDashboardPath("zepto")} replace />;
  }
  return <QcomAnalysisCategoryPage marketplace={marketplace} />;
}

export function QcomChannelAnalysisDetailRoute() {
  const { channel } = useParams<{ channel: string }>();
  const marketplace = parseQuickCommerceChannel(channel);
  if (!marketplace) {
    return <Navigate to={qcomDashboardPath("zepto")} replace />;
  }
  return <QcomAnalysisCategoryDetailPage marketplace={marketplace} />;
}
