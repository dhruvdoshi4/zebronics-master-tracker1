import { useEffect, useState } from "react";
import { useCatalogScope } from "./catalog-scope-context";
import { getAdminGlobalUploadSheetCoverageByMarketplace } from "./admin-dashboard-data";
import { isDawgDataScope } from "./data-scope";
import { getLatestUploadSheetCoverageByMarketplace } from "./data";
import { useDataScope } from "./use-data-scope";

/** Latest `snapshot_date` per marketplace for the active catalog workspace. */
export function useLatestUploadSheetCoverageByMarketplace(): {
  amazon: string | null;
  flipkart: string | null;
} | null {
  const { workspace, isMarketplaceGlobalScope } = useCatalogScope();
  const dataScope = useDataScope();
  const uploadScope = isDawgDataScope(dataScope) ? "dawg" : workspace;
  const [coverage, setCoverage] = useState<{
    amazon: string | null;
    flipkart: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = isMarketplaceGlobalScope
      ? getAdminGlobalUploadSheetCoverageByMarketplace()
      : getLatestUploadSheetCoverageByMarketplace(uploadScope);
    void load
      .then((row) => {
        if (!cancelled) setCoverage(row);
      })
      .catch(() => {
        if (!cancelled) setCoverage({ amazon: null, flipkart: null });
      });
    return () => {
      cancelled = true;
    };
  }, [uploadScope, isMarketplaceGlobalScope]);

  return coverage;
}
