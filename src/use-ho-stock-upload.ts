import { useEffect, useState } from "react";
import { getLatestHoStockUpload } from "./data-ho-stock";
import { useDataScope } from "./use-data-scope";
import { formatCoverageDataAsOf } from "./utils";

export function useHoStockUploadMeta() {
  const dataScope = useDataScope();
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => {
    void getLatestHoStockUpload(dataScope)
      .then((row) => {
        setSnapshotDate(row?.snapshot_date ?? null);
        setFileName(row?.file_name ?? null);
      })
      .catch(() => {
        setSnapshotDate(null);
        setFileName(null);
      });
  }, [dataScope]);

  return {
    snapshotDate,
    fileName,
    label: snapshotDate ? formatCoverageDataAsOf(snapshotDate) : null,
  };
}
