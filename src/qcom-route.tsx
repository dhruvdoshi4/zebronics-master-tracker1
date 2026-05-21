import { Navigate, useParams } from "react-router-dom";
import { QcomConsolidatedComparisonPage } from "./page-qcom-consolidated-comparison";
import { QcomDashboardPage } from "./page-qcom-dashboard";
import { parseQcomWorkspaceKey, qcomDashboardPath } from "./tenants";

export function QcomChannelRoute() {
  const { channel } = useParams<{ channel: string }>();
  const workspace = parseQcomWorkspaceKey(channel);
  if (!workspace) {
    return <Navigate to={qcomDashboardPath("consolidated")} replace />;
  }
  if (workspace === "consolidated") {
    return <QcomConsolidatedComparisonPage />;
  }
  return <QcomDashboardPage workspace={workspace} />;
}
