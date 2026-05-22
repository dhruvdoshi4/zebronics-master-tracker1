import { useEffect, useState } from "react";
import { useCatalogScope } from "./catalog-scope-context";
import { getLatestUploadSheetCoverageByMarketplace } from "./data";

/** Latest `snapshot_date` per marketplace for the active catalog workspace. */
export function useLatestUploadSheetCoverageByMarketplace(): {
  amazon: string | null;
  flipkart: string | null;
} | null {
  const { workspace } = useCatalogScope();
  const [coverage, setCoverage] = useState<{
    amazon: string | null;
    flipkart: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLatestUploadSheetCoverageByMarketplace(workspace)
      .then((row) => {
        if (!cancelled) setCoverage(row);
      })
      .catch(() => {
        if (!cancelled) setCoverage({ amazon: null, flipkart: null });
      });
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  return coverage;
}
