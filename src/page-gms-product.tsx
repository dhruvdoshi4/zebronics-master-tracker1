import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Search } from "lucide-react";
import { findProductWithMetrics, searchProductSuggestions } from "./data";
import { getGmsProductRows, type GmsProductRow } from "./data-gms";
import {
  parseSubCategoryFilterParam,
  SUB_CATEGORY_FILTER_LABELS,
  type Marketplace,
  type SubCategoryFilter,
} from "./types";
import {
  Button,
  Card,
  DataAsOnBadge,
  EmptyState,
  FieldLabel,
  InlineLoader,
  Input,
  PageTitle,
  SortableTableHeader,
  SubCategoryFilterSelect,
} from "./ui";
import { useTableSort } from "./table-sort";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";
import { displayModelName } from "./product-display";
import { cn, formatInr } from "./utils";

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

function parseMarketplaceParam(raw: string | undefined): Marketplace | null {
  if (raw === "amazon" || raw === "flipkart") return raw;
  return null;
}

export function GmsProductPage() {
  const params = useParams<{ marketplace: string }>();
  const marketplace = parseMarketplaceParam(params.marketplace);

  if (!marketplace) {
    return (
      <EmptyState
        title="Unknown channel"
        description="Open GMS product tracker from Amazon or Flipkart."
      />
    );
  }

  return <GmsProductChannelPage marketplace={marketplace} />;
}

function GmsProductChannelPage({ marketplace }: { marketplace: Marketplace }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();
  const sheetAsOn =
    marketplace === "amazon" ? channelCoverage?.amazon : channelCoverage?.flipkart;

  const [subCategory, setSubCategory] = useState<SubCategoryFilter>(
    () => parseSubCategoryFilterParam(searchParams.get("sub")) ?? "all",
  );

  useEffect(() => {
    const fromUrl = parseSubCategoryFilterParam(searchParams.get("sub"));
    if (fromUrl) setSubCategory(fromUrl);
  }, [searchParams]);
  const [code, setCode] = useState("");
  const [suggestions, setSuggestions] = useState<
    Array<{ productCode: string; productName: string }>
  >([]);
  const [rows, setRows] = useState<GmsProductRow[]>([]);
  const [isLoadingTable, setIsLoadingTable] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");

  const codeLabel = getCodeLabel(marketplace);
  const channelLabel = marketplace === "amazon" ? "Amazon" : "Flipkart";
  const inputListId = `gms-product-suggestions-${marketplace}`;

  useEffect(() => {
    const query = code.trim();
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchProductSuggestions(marketplace, query)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [marketplace, code]);

  useEffect(() => {
    setIsLoadingTable(true);
    setError(null);
    void getGmsProductRows(marketplace, subCategory)
      .then(setRows)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load GMS table."),
      )
      .finally(() => setIsLoadingTable(false));
  }, [marketplace, subCategory]);

  const filteredRows = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.product_code.toLowerCase().includes(q) ||
        row.product_name.toLowerCase().includes(q),
    );
  }, [rows, tableFilter]);

  const gmsSortAccessors = useMemo(
    () =>
      ({
        model: (row: GmsProductRow) => displayModelName(row.product_name, row.product_code),
        product_code: (row: GmsProductRow) => row.product_code,
        bau_price: (row: GmsProductRow) => row.bau_price,
        planned_gms: (row: GmsProductRow) => row.planned_gms,
        actual_gms_mtd: (row: GmsProductRow) => row.actual_gms_mtd,
        gap_gms: (row: GmsProductRow) => row.gap_gms,
        gap_units: (row: GmsProductRow) => row.gap_units,
      }) satisfies import("./table-sort").TableSortAccessors<GmsProductRow>,
    [],
  );

  const { sortedRows, sortKey, sortDirection, requestSort } = useTableSort(
    filteredRows,
    gmsSortAccessors,
    "gap_gms",
    "desc",
  );

  function openProduct(productCode: string) {
    navigate(
      `/app/gms/product/${marketplace}/${encodeURIComponent(productCode)}`,
    );
  }

  function handleSearch() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setIsSearching(true);
    setError(null);
    void findProductWithMetrics(marketplace, trimmed)
      .then((data) => {
        if (!data) {
          setError(`No matching ${channelLabel} product found.`);
          return;
        }
        openProduct(data.product.product_code);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Search failed.");
      })
      .finally(() => setIsSearching(false));
  }

  return (
    <div className="space-y-6">
      <Link
        to="/app/gms/product"
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Product GMS
      </Link>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <PageTitle
          title={`GMS — ${channelLabel}`}
          subtitle={`${channelLabel} only · planned vs MTD GMS · search by ${codeLabel} or model.`}
        />
        {sheetAsOn ? <DataAsOnBadge isoDate={sheetAsOn} className="self-start" /> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/app/gms/product/amazon"
          className={cn(
            "rounded-full px-4 py-2 text-sm font-bold transition",
            marketplace === "amazon"
              ? "bg-orange-600 text-white shadow"
              : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300",
          )}
        >
          Amazon
        </Link>
        <Link
          to="/app/gms/product/flipkart"
          className={cn(
            "rounded-full px-4 py-2 text-sm font-bold transition",
            marketplace === "flipkart"
              ? "bg-blue-600 text-white shadow"
              : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300",
          )}
        >
          Flipkart
        </Link>
      </div>

      <Card className="space-y-4">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <FieldLabel>{codeLabel} or model name</FieldLabel>
            <Input
              placeholder={`Search ${channelLabel} — ${codeLabel} or model`}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.trim() && !isSearching) {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              list={inputListId}
            />
            <datalist id={inputListId}>
              {suggestions.map((item) => (
                <option
                  key={`${item.productCode}-name`}
                  value={item.productName}
                  label={`${item.productName} (${item.productCode})`}
                />
              ))}
              {suggestions.map((item) => (
                <option
                  key={`${item.productCode}-code`}
                  value={item.productCode}
                  label={`${item.productCode} — ${item.productName}`}
                />
              ))}
            </datalist>
          </div>
          <Button
            type="button"
            disabled={isSearching || !code.trim()}
            onClick={handleSearch}
            className="h-[42px] shrink-0"
          >
            {isSearching ? "Opening…" : "Open GMS charts"}
          </Button>
        </div>

        <SubCategoryFilterSelect value={subCategory} onChange={setSubCategory} />
      </Card>

      {error ? (
        <Card className="border-red-200 bg-red-50 text-sm text-red-800">{error}</Card>
      ) : null}

      <Card className="overflow-auto">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-bold text-zinc-900">
            {channelLabel} · {SUB_CATEGORY_FILTER_LABELS[subCategory]} — current month
            <span className="mt-1 block text-xs font-normal text-zinc-500">
              Sorted by gap — most behind plan first
            </span>
          </h3>
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              className="pl-9"
              placeholder="Filter table…"
              value={tableFilter}
              onChange={(event) => setTableFilter(event.target.value)}
            />
          </div>
        </div>

        {isLoadingTable ? (
          <InlineLoader text={`Loading ${channelLabel} GMS rows…`} />
        ) : sortedRows.length === 0 ? (
          <EmptyState
            title={`No ${channelLabel} products in this category`}
            description={`Upload ${channelLabel} sellout + combined BAU + GMS plan sheets, then refresh.`}
          />
        ) : (
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-zinc-500">
                <SortableTableHeader
                  label="Model"
                  sortKey="model"
                  activeKey={sortKey}
                  activeDirection={sortDirection}
                  onSort={requestSort}
                />
                <SortableTableHeader
                  label={codeLabel}
                  sortKey="product_code"
                  activeKey={sortKey}
                  activeDirection={sortDirection}
                  onSort={requestSort}
                />
                <SortableTableHeader
                  label="BAU"
                  sortKey="bau_price"
                  activeKey={sortKey}
                  activeDirection={sortDirection}
                  onSort={requestSort}
                />
                <SortableTableHeader
                  label="Planned GMS"
                  sortKey="planned_gms"
                  activeKey={sortKey}
                  activeDirection={sortDirection}
                  onSort={requestSort}
                />
                <SortableTableHeader
                  label="MTD GMS"
                  sortKey="actual_gms_mtd"
                  activeKey={sortKey}
                  activeDirection={sortDirection}
                  onSort={requestSort}
                />
                <SortableTableHeader
                  label="Gap"
                  sortKey="gap_gms"
                  activeKey={sortKey}
                  activeDirection={sortDirection}
                  onSort={requestSort}
                />
                <SortableTableHeader
                  label="Behind by"
                  sortKey="gap_units"
                  activeKey={sortKey}
                  activeDirection={sortDirection}
                  onSort={requestSort}
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {sortedRows.map((row) => (
                <tr
                  key={row.product_code}
                  className="cursor-pointer hover:bg-violet-50/70"
                  onClick={() => openProduct(row.product_code)}
                >
                  <td className="px-3 py-2 font-medium text-zinc-900">
                    {displayModelName(row.product_name, row.product_code)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{row.product_code}</td>
                  <td className="px-3 py-2">{formatInr(row.bau_price)}</td>
                  <td className="px-3 py-2">{formatInr(row.planned_gms)}</td>
                  <td className="px-3 py-2">{formatInr(row.actual_gms_mtd)}</td>
                  <td
                    className={cn(
                      "px-3 py-2 font-semibold",
                      row.gap_gms > 0 ? "text-amber-700" : row.gap_gms < 0 ? "text-emerald-700" : "",
                    )}
                  >
                    {formatInr(row.gap_gms)}
                  </td>
                  <td className="px-3 py-2">
                    {row.gap_gms > 0 && row.gap_units > 0 ? (
                      <span className="text-base font-bold text-amber-800">
                        {row.gap_units.toLocaleString("en-IN")} units
                      </span>
                    ) : (
                      <span className="text-sm text-zinc-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
