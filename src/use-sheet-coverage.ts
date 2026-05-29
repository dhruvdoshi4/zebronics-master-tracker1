import { useEffect, useState } from "react";
import { useCatalogScope } from "./catalog-scope-context";
import { useAdminRealm } from "./admin-realm-context";
import { getAdminGlobalUploadSheetCoverageByMarketplace } from "./admin-dashboard-data";
import { isDawgDataScope } from "./data-scope";
import { getLatestUploadSheetCoverageByMarketplace } from "./data";
import { useAuth } from "./use-auth";
import { useDataScope } from "./use-data-scope";

/** Latest `snapshot_date` per marketplace for the active catalog workspace. */
export function useLatestUploadSheetCoverageByMarketplace(): {
  amazon: string | null;
  flipkart: string | null;
} | null {
  const { workspace } = useCatalogScope();
  const { isLoading: authLoading } = useAuth();
  const { isMarketplaceGlobal, impersonatedWorkspace } = useAdminRealm();
  const useAdminGlobalCoverage =
    !authLoading && isMarketplaceGlobal && impersonatedWorkspace == null;
  const dataScope = useDataScope();
  const uploadScope = isDawgDataScope(dataScope) ? "dawg" : workspace;
  const [coverage, setCoverage] = useState<{
    amazon: string | null;
    flipkart: string | null;
  } | null>(null);

  useEffect(() => {
    if (authLoading) return;

    let cancelled = false;
    void (useAdminGlobalCoverage
      ? getAdminGlobalUploadSheetCoverageByMarketplace()
      : getLatestUploadSheetCoverageByMarketplace(uploadScope))
      .then((row) => {
        if (!cancelled) setCoverage(row);
      })
      .catch(() => {
        if (!cancelled) setCoverage({ amazon: null, flipkart: null });
      });
    return () => {
      cancelled = true;
    };
  }, [uploadScope, authLoading, useAdminGlobalCoverage]);

  return coverage;
}
