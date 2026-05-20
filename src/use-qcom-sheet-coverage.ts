import { useEffect, useState } from "react";
import { getLatestQcomUploadSheetCoverage } from "./data-qcom";
import type { QcomMarketplace } from "./types";

export function useLatestUploadSheetCoverageByQcom(): Record<
  QcomMarketplace,
  string | null
> | null {
  const [coverage, setCoverage] = useState<Record<QcomMarketplace, string | null> | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void getLatestQcomUploadSheetCoverage()
      .then((row) => {
        if (!cancelled) setCoverage(row);
      })
      .catch(() => {
        if (!cancelled) {
          setCoverage({
            zepto: null,
            blinkit: null,
            bigbasket: null,
            instamart: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return coverage;
}
