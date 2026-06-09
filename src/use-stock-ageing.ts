import { useEffect, useState } from "react";
import {
  getLatestStockAgeingUpload,
  getStockAgeingMapByPrdcode,
  type StockAgeingByPrdcode,
} from "./data-stock-ageing";
import { formatCoverageDataAsOf } from "./utils";

export function useStockAgeingData(enabled: boolean) {
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [byPrdcode, setByPrdcode] = useState<Map<string, StockAgeingByPrdcode>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setByPrdcode(new Map());
      return;
    }
    setIsLoading(true);
    void getLatestStockAgeingUpload()
      .then(async (upload) => {
        setSnapshotDate(upload?.snapshot_date ?? null);
        setFileName(upload?.file_name ?? null);
        if (!upload) {
          setByPrdcode(new Map());
          return;
        }
        return getStockAgeingMapByPrdcode();
      })
      .then((map) => {
        if (map) setByPrdcode(map);
      })
      .catch(() => {
        setSnapshotDate(null);
        setFileName(null);
        setByPrdcode(new Map());
      })
      .finally(() => setIsLoading(false));
  }, [enabled]);

  return {
    snapshotDate,
    fileName,
    label: snapshotDate ? formatCoverageDataAsOf(snapshotDate) : null,
    byPrdcode,
    isLoading,
    hasAgeing: byPrdcode.size > 0,
  };
}
