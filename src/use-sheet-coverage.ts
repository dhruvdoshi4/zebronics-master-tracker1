import { useEffect, useState } from "react";
import { useCatalogScope } from "./catalog-scope-context";
import { isDawgDataScope } from "./data-scope";
import { getLatestUploadSheetCoverageByMarketplace } from "./data";
import { useDataScope } from "./use-data-scope";

/** Latest `snapshot_date` per marketplace for the active catalog workspace. */
export function useLatestUploadSheetCoverageByMarketplace(): {
  amazon: string | null;
  flipkart: string | null;
} | null {
  const { workspace } = useCatalogScope();
  const dataScope = useDataScope();
  const uploadScope = isDawgDataScope(dataScope) ? "dawg" : workspace;
  const [coverage, setCoverage] = useState<{
    amazon: string | null;
    flipkart: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLatestUploadSheetCoverageByMarketplace(uploadScope)
      .then((row) => {
        if (!cancelled) setCoverage(row);
      })
      .catch(() => {
        if (!cancelled) setCoverage({ amazon: null, flipkart: null });
      });
    return () => {
      cancelled = true;
    };
  }, [uploadScope]);

  return coverage;
}
