import { useEffect, useState } from "react";
import { getLatestUploadSheetCoverageByMarketplace } from "./data";

/** Latest `snapshot_date` per marketplace from Upload Center (sheet “as on”, not upload clock). */
export function useLatestUploadSheetCoverageByMarketplace(): {
  amazon: string | null;
  flipkart: string | null;
} | null {
  const [coverage, setCoverage] = useState<{
    amazon: string | null;
    flipkart: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLatestUploadSheetCoverageByMarketplace()
      .then((row) => {
        if (!cancelled) setCoverage(row);
      })
      .catch(() => {
        if (!cancelled) setCoverage({ amazon: null, flipkart: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return coverage;
}
