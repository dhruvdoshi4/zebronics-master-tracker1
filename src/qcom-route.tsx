import { Navigate, useParams } from "react-router-dom";
import { QcomDashboardPage } from "./page-qcom-dashboard";
import { parseQuickCommerceChannel, qcomDashboardPath } from "./tenants";

export function QcomChannelRoute() {
  const { channel } = useParams<{ channel: string }>();
  const parsed = parseQuickCommerceChannel(channel);
  if (!parsed) {
    return <Navigate to={qcomDashboardPath("zepto")} replace />;
  }
  return <QcomDashboardPage channel={parsed} />;
}
