import { Navigate, useParams } from "react-router-dom";
import { QcomDashboardPage } from "./page-qcom-dashboard";
import { parseQcomWorkspaceKey, qcomDashboardPath } from "./tenants";

export function QcomChannelRoute() {
  const { channel } = useParams<{ channel: string }>();
  const workspace = parseQcomWorkspaceKey(channel);
  if (!workspace) {
    return <Navigate to={qcomDashboardPath("zepto")} replace />;
  }
  return <QcomDashboardPage workspace={workspace} />;
}
