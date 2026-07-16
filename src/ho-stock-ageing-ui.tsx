import { STOCK_AGEING_BUCKET_COLUMNS, type StockAgeingBuckets } from "./stock-ageing";
import type { StockAgeingByPrdcode } from "./data-stock-ageing";
import { splitFsnCell } from "./parsers-ho-stock";
import type { SortDirection } from "./table-sort";
import { SortableTableHeader } from "./ui";
import { formatInteger, formatSelloutDrr } from "./utils";

export function HoStockAgeingBucketHeaders({
  sortKey,
  sortDirection,
  onSort,
}: {
  sortKey: string | null;
  sortDirection: SortDirection;
  onSort: (key: string, direction: SortDirection) => void;
}) {
  return (
    <>
      {STOCK_AGEING_BUCKET_COLUMNS.map((col) => (
        <SortableTableHeader
          key={col.key}
          label={col.label}
          sortKey={col.key}
          activeKey={sortKey}
          activeDirection={sortDirection}
          onSort={onSort}
          align="right"
          className="py-2.5"
        />
      ))}
    </>
  );
}

export function HoStockAgeingBucketCells({
  ageing,
}: {
  ageing: StockAgeingByPrdcode | StockAgeingBuckets | null | undefined;
}) {
  return (
    <>
      {STOCK_AGEING_BUCKET_COLUMNS.map((col) => (
        <td key={col.key} className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
          {ageing && ageing[col.key] > 0 ? formatInteger(ageing[col.key]) : "—"}
        </td>
      ))}
    </>
  );
}

export function hoStockAgeingSortValue(
  ageing: StockAgeingByPrdcode | null | undefined,
  key: string,
): number {
  if (!ageing) return 0;
  if (key in ageing) return Number((ageing as StockAgeingBuckets)[key as keyof StockAgeingBuckets] ?? 0);
  return 0;
}

export type HoStockCumulativeDrrRow = {
  asin?: string;
  fsn?: string;
  amazon_drr_units?: number | null;
  flipkart_drr_units?: number | null;
  qcom_drr_units?: number | null;
  qcom_channel_linked?: boolean;
};

/** Amazon + Flipkart + QCom DRR for listings on each channel. */
export function hoStockCumulativeDrrUnits(row: HoStockCumulativeDrrRow): number {
  let total = 0;
  const asin = String(row.asin ?? "").trim().toUpperCase();
  if (asin) total += row.amazon_drr_units ?? 0;
  if (splitFsnCell(row.fsn ?? "").length > 0) total += row.flipkart_drr_units ?? 0;
  if (row.qcom_channel_linked) {
    total += row.qcom_drr_units ?? 0;
  }
  return total;
}

export function formatHoStockCumulativeDrr(row: HoStockCumulativeDrrRow): string {
  const asin = String(row.asin ?? "").trim();
  const hasFlipkart = splitFsnCell(row.fsn ?? "").length > 0;
  const hasQcom = Boolean(row.qcom_channel_linked);
  if (!asin && !hasFlipkart && !hasQcom) return "—";
  return formatSelloutDrr(hoStockCumulativeDrrUnits(row));
}
