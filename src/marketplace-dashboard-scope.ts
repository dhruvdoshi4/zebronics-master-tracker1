import type { DataScope } from "./data-scope";
import { getActiveDataScope } from "./workspace-data-scope";
import {
  isMarketplaceDashboardSheetCategory,
  isMonitorAccessorySheetCategory,
  isProjectorAccessorySheetCategory,
  productMatchesHariMonitorProjectorDashboardScope,
} from "./hari-dashboard-scope";
import {
  rowBelongsToManagerDashboard,
  type ManagerDashboardRow,
} from "./manager-dashboard-scope";
import { getActiveCatalogWorkspace } from "./workspace-catalog-scope";

export {
  isMarketplaceDashboardSheetCategory,
  isMonitorAccessorySheetCategory,
  isProjectorAccessorySheetCategory,
};

export const productMatchesMarketplaceDashboardScope =
  productMatchesHariMonitorProjectorDashboardScope;

/** Legacy API: optional dataScope; uses active catalog workspace from route/login. */
export function productMatchesWorkspaceDashboardScope(
  row: ManagerDashboardRow,
  dataScope: DataScope = getActiveDataScope(),
): boolean {
  return rowBelongsToManagerDashboard(row, {
    catalogWorkspace: getActiveCatalogWorkspace(),
    dataScope,
  });
}
