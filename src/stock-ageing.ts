/** Rolled-up ageing buckets shown in HO Stock (admin Ageing view). */
export type StockAgeingBuckets = {
  qty_0_90: number;
  qty_91_180: number;
  qty_181_365: number;
  qty_365_plus: number;
};

/** Fine-grained buckets from the Consolidated ageing sheet. */
export type StockAgeingFineBuckets = {
  qty_0_30: number;
  qty_31_90: number;
  qty_91_180: number;
  qty_181_270: number;
  qty_271_365: number;
  qty_366_547: number;
  qty_547_plus: number;
};

export type StockAgeingRow = StockAgeingBuckets & {
  prdcode: string;
  model_name: string;
  total_qty: number;
};

export const STOCK_AGEING_BUCKET_COLUMNS = [
  { key: "qty_0_90" as const, label: "0–90" },
  { key: "qty_91_180" as const, label: "91–180" },
  { key: "qty_181_365" as const, label: "181–365" },
  { key: "qty_365_plus" as const, label: "365+" },
] as const;

export function emptyStockAgeingBuckets(): StockAgeingBuckets {
  return {
    qty_0_90: 0,
    qty_91_180: 0,
    qty_181_365: 0,
    qty_365_plus: 0,
  };
}

export function emptyStockAgeingFineBuckets(): StockAgeingFineBuckets {
  return {
    qty_0_30: 0,
    qty_31_90: 0,
    qty_91_180: 0,
    qty_181_270: 0,
    qty_271_365: 0,
    qty_366_547: 0,
    qty_547_plus: 0,
  };
}

/** Roll fine sheet buckets into display buckets: 0–90, 91–180, 181–365, 365+. */
export function rollupStockAgeingBuckets(
  fine: Partial<StockAgeingFineBuckets>,
): StockAgeingBuckets {
  return {
    qty_0_90: (fine.qty_0_30 ?? 0) + (fine.qty_31_90 ?? 0),
    qty_91_180: fine.qty_91_180 ?? 0,
    qty_181_365: (fine.qty_181_270 ?? 0) + (fine.qty_271_365 ?? 0),
    qty_365_plus: (fine.qty_366_547 ?? 0) + (fine.qty_547_plus ?? 0),
  };
}

/** Read rolled-up buckets from DB row (new columns or legacy fine-grained columns). */
export function stockAgeingBucketsFromDbRow(
  row: Record<string, unknown>,
): StockAgeingBuckets {
  if (row.qty_0_90 != null || row.qty_181_365 != null || row.qty_365_plus != null) {
    return {
      qty_0_90: Number(row.qty_0_90 ?? 0),
      qty_91_180: Number(row.qty_91_180 ?? 0),
      qty_181_365: Number(row.qty_181_365 ?? 0),
      qty_365_plus: Number(row.qty_365_plus ?? 0),
    };
  }
  return rollupStockAgeingBuckets({
    qty_0_30: Number(row.qty_0_30 ?? 0),
    qty_31_90: Number(row.qty_31_90 ?? 0),
    qty_91_180: Number(row.qty_91_180 ?? 0),
    qty_181_270: Number(row.qty_181_270 ?? 0),
    qty_271_365: Number(row.qty_271_365 ?? 0),
    qty_366_547: Number(row.qty_366_547 ?? 0),
    qty_547_plus: Number(row.qty_547_plus ?? 0),
  });
}

export function stockAgeingTotalQty(buckets: StockAgeingBuckets): number {
  return STOCK_AGEING_BUCKET_COLUMNS.reduce((sum, col) => sum + (buckets[col.key] ?? 0), 0);
}
