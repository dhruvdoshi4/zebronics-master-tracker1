import { NavLink, Navigate, Outlet, useParams } from "react-router-dom";
import {
  parseQcomWorkspaceKey,
  qcomChannelAnalysisPath,
  qcomDashboardPath,
  type QuickCommerceChannel,
} from "./tenants";
import { cn } from "./utils";

function channelTabClass({ isActive }: { isActive: boolean }) {
  return cn(
    "rounded-lg px-4 py-2 text-sm font-bold transition",
    isActive
      ? "bg-violet-600 text-white shadow-sm shadow-violet-500/25"
      : "text-zinc-700 hover:bg-zinc-100",
  );
}

export function QcomChannelLayout() {
  const { channel } = useParams<{ channel: string }>();
  const workspace = parseQcomWorkspaceKey(channel);

  if (!workspace) {
    return <Navigate to={qcomDashboardPath("zepto")} replace />;
  }

  if (workspace === "consolidated") {
    return <Outlet />;
  }

  const channelKey = workspace as QuickCommerceChannel;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/80 p-1.5">
        <NavLink
          to={qcomDashboardPath(channelKey)}
          end
          className={channelTabClass}
        >
          Dashboard
        </NavLink>
        <NavLink to={qcomChannelAnalysisPath(channelKey)} className={channelTabClass}>
          Analysis
        </NavLink>
      </div>
      <Outlet />
    </div>
  );
}

export function QcomChannelIndexRedirect() {
  const { channel } = useParams<{ channel: string }>();
  const workspace = parseQcomWorkspaceKey(channel);
  if (!workspace) {
    return <Navigate to={qcomDashboardPath("zepto")} replace />;
  }
  return <Navigate to={qcomDashboardPath(workspace)} replace />;
}
