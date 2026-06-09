import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  getAdminGlobalProductMaster,
  adminGlobalSubCategoryFiltersFromTree,
  listAdminGlobalAnalysisCategoryTree,
  productMasterMatchesAdminGlobalSubCategory,
} from "./admin-dashboard-data";
import { useAdminRealm } from "./admin-realm-context";
import { useCatalogScope } from "./catalog-scope-context";
import type { CatalogWorkspace } from "./catalog-workspace";
import { getProductMaster } from "./data";
import {
  enrichProductPricingView,
  getPricingScopeDefaults,
  getPricingSupplementalMetrics,
  getProductPricingForCodes,
  indexPricingScopeDefaults,
  savePricingScopeDefaults,
  saveProductPricingEdit,
  type PricingScopeDefaultRecord,
  type ProductMasterPricingRow,
  type ProductPricingView,
} from "./data-product-pricing";
import { exportProductMasterTableToExcel } from "./product-master-export";
import { useAuth } from "./use-auth";
import { isDawgDataScope } from "./data-scope";
import { productMatchesDawgScope } from "./dawg-scope";
import { useDataScope } from "./use-data-scope";
import { displayModelName } from "./product-display";
import {
  normalizeNetRealFactor,
  parseMarginPercentInput,
  roundPricingInr,
} from "./pricing";
import {
  type LegacyMarketplace,
  type ProductMaster,
  type SubCategoryFilter,
  getSubCategoryLabel,
  isLegacyMarketplace,
} from "./types";
import {
  Button,
  Card,
  DataAsOnDualChannelBadge,
  EmptyState,
  FieldLabel,
  InlineLoader,
  Input,
  PageTitle,
  Select,
  SortableTableHeader,
  SubCategoryFilterSelect,
} from "./ui";
import { useTableSort } from "./table-sort";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";
import { cn, formatInr } from "./utils";

function getCodeLabel(marketplace: LegacyMarketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

function matchesSearch(product: ProductMaster, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return (
    product.product_code.toLowerCase().includes(q) ||
    product.product_name.toLowerCase().includes(q) ||
    (product.sub_category ?? "").toLowerCase().includes(q) ||
    (product.category ?? "").toLowerCase().includes(q)
  );
}

function emptyPricingRecord(
  marketplace: LegacyMarketplace,
  productCode: string,
): ProductPricingView {
  return {
    marketplace,
    product_code: productCode,
    catalog_workspace: null,
    bau_sp: 0,
    bau_margin_pct: 0,
    event_sp: 0,
    event_margin_pct: 0,
    is_flat_price: false,
    top_up_ibd: 0,
    net_real_factor: null,
    coupon_value: null,
    coupon_support_pct: null,
    upload_id: null,
    updated_at: "",
    basic_sp: 0,
    event_basic: 0,
    basic_support_pu: 0,
    base_ibd: 0,
    top_up_ibd_support: 0,
    nep: 0,
    net_realisation: 0,
    coupon_deduction: 0,
    resolved_net_real_factor: 0.95,
    resolved_coupon_value: 0,
    resolved_coupon_support_pct: 0,
  };
}

function enrichEmptyPricing(
  marketplace: LegacyMarketplace,
  productCode: string,
  product: Pick<ProductMaster, "category" | "sub_category">,
  scopeMap: Map<string, PricingScopeDefaultRecord>,
  catalogWorkspace: Parameters<typeof enrichProductPricingView>[3],
): ProductPricingView {
  return enrichProductPricingView(
    emptyPricingRecord(marketplace, productCode),
    product,
    scopeMap,
    catalogWorkspace,
  );
}

export type { ProductMasterPricingRow } from "./data-product-pricing";

function formatNumInput(value: number): string {
  return value > 0 ? String(value) : "";
}

function formatMarginInput(marginFraction: number): string {
  if (marginFraction <= 0) return "";
  const pct = marginFraction > 1 ? marginFraction : marginFraction * 100;
  return String(Math.round(pct * 10000) / 10000);
}

function formatNetRealFactorInput(factor: number): string {
  if (factor <= 0) return "";
  const pct = factor <= 1 ? factor * 100 : factor;
  return String(Math.round(pct * 10000) / 10000);
}

function parseNetRealFactorInput(raw: string): number | null {
  const cleaned = String(raw ?? "").replace(/%/g, "").trim();
  if (!cleaned) return null;
  return normalizeNetRealFactor(Number(cleaned));
}

function formatOptionalNumInput(value: number | null): string {
  return value != null && value > 0 ? String(value) : "";
}

function formatOptionalMarginInput(value: number | null): string {
  if (value == null || value <= 0) return "";
  return formatMarginInput(value);
}

function hasEventPricing(eventSp: number): boolean {
  return eventSp > 0;
}

function formatCalcInr(value: number, active: boolean, showZero = false): string {
  if (!active) return "—";
  if (value <= 0 && !showZero) return "—";
  return formatInr(value);
}

function formatCalcUnits(value: number): string {
  if (value <= 0) return "—";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function scopeDefaultsForFilter(
  scopeDefaults: Map<string, PricingScopeDefaultRecord>,
  catalogWorkspace: string,
  marketplace: LegacyMarketplace,
  categoryFilter: string,
  subCategoryFilter: SubCategoryFilter,
): {
  level: "sub_category" | "category" | "workspace";
  key: string;
  label: string;
  row: PricingScopeDefaultRecord | null;
} | null {
  if (subCategoryFilter !== "all") {
    const key = subCategoryFilter;
    const row =
      scopeDefaults.get(`${marketplace}|sub_category|${key}`) ??
      scopeDefaults.get(`all|sub_category|${key}`) ??
      null;
    return {
      level: "sub_category",
      key,
      label: getSubCategoryLabel(subCategoryFilter),
      row,
    };
  }
  if (categoryFilter !== "all") {
    const key = categoryFilter;
    const row =
      scopeDefaults.get(`${marketplace}|category|${key}`) ??
      scopeDefaults.get(`all|category|${key}`) ??
      null;
    return { level: "category", key, label: key, row };
  }
  const row =
    scopeDefaults.get(`${marketplace}|workspace|${catalogWorkspace}`) ??
    scopeDefaults.get(`all|workspace|${catalogWorkspace}`) ??
    null;
  return {
    level: "workspace",
    key: catalogWorkspace,
    label: "Workspace default",
    row,
  };
}

function PricingScopeDefaultsCard({
  catalogWorkspace,
  marketplace,
  categoryFilter,
  subCategoryFilter,
  scopeDefaults,
  onSaved,
  onError,
}: {
  catalogWorkspace: CatalogWorkspace;
  marketplace: LegacyMarketplace;
  categoryFilter: string;
  subCategoryFilter: SubCategoryFilter;
  scopeDefaults: Map<string, PricingScopeDefaultRecord>;
  onSaved: (row: PricingScopeDefaultRecord) => void;
  onError: (message: string) => void;
}) {
  const target = scopeDefaultsForFilter(
    scopeDefaults,
    catalogWorkspace,
    marketplace,
    categoryFilter,
    subCategoryFilter,
  );
  const [netReal, setNetReal] = useState("");
  const [couponSupport, setCouponSupport] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    const row = target.row;
    setNetReal(
      row?.net_real_factor != null
        ? formatNetRealFactorInput(row.net_real_factor)
        : "",
    );
    setCouponSupport(
      row?.coupon_support_pct != null && row.coupon_support_pct > 0
        ? formatMarginInput(row.coupon_support_pct)
        : "",
    );
  }, [target?.key, target?.level, target?.row, marketplace]);

  if (!target) return null;

  const scopeHint =
    subCategoryFilter !== "all"
      ? "Net real % and coupon support % for this sub-category. Coupon value is entered per SKU in the table."
      : categoryFilter !== "all"
        ? "Net real % and coupon support % for this category. Coupon value is per SKU."
        : "Workspace-wide net real % and coupon support %. Coupon value is per SKU.";

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/50 dark:bg-violet-950/20">
      <p className="text-sm font-semibold text-violet-900 dark:text-violet-100">
        Scope defaults — {target.label}
      </p>
      <p className="mt-1 text-xs text-violet-700/90 dark:text-violet-300/80">{scopeHint}</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <FieldLabel>Net real %</FieldLabel>
          <Input
            className="h-9 w-24 text-right tabular-nums"
            placeholder="95"
            value={netReal}
            onChange={(e) => setNetReal(e.target.value)}
          />
        </div>
        <div>
          <FieldLabel>Coupon support %</FieldLabel>
          <Input
            className="h-9 w-24 text-right tabular-nums"
            placeholder="50"
            value={couponSupport}
            onChange={(e) => setCouponSupport(e.target.value)}
          />
        </div>
        <Button
          type="button"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            const level = target.level === "workspace" ? "workspace" : target.level;
            const scopeKey = target.key;
            void savePricingScopeDefaults({
              catalogWorkspace,
              marketplace,
              scopeLevel: level,
              scopeKey,
              patch: {
                net_real_factor: netReal.trim()
                  ? parseNetRealFactorInput(netReal)
                  : null,
                coupon_support_pct: couponSupport.trim()
                  ? parseMarginPercentInput(couponSupport)
                  : null,
              },
            })
              .then(onSaved)
              .catch((e: unknown) =>
                onError(e instanceof Error ? e.message : "Save failed."),
              )
              .finally(() => setSaving(false));
          }}
        >
          {saving ? "Saving…" : "Save scope defaults"}
        </Button>
      </div>
    </div>
  );
}

function MarketplaceToggle({
  value,
  onChange,
}: {
  value: LegacyMarketplace;
  onChange: (next: LegacyMarketplace) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-900">
      {(["amazon", "flipkart"] as const).map((channel) => (
        <button
          key={channel}
          type="button"
          onClick={() => onChange(channel)}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-semibold capitalize transition",
            value === channel
              ? "bg-white text-violet-700 shadow-sm dark:bg-zinc-800 dark:text-violet-200"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
          )}
        >
          {channel}
        </button>
      ))}
    </div>
  );
}

export function ProductMasterPage() {
  const { isLoading: authLoading } = useAuth();
  const { isMarketplaceGlobal, impersonatedWorkspace } = useAdminRealm();
  const useAdminGlobalCatalog =
    !authLoading && isMarketplaceGlobal && impersonatedWorkspace == null;
  const dataScope = useDataScope();
  const isDawgScope = isDawgDataScope(dataScope);
  const {
    workspace,
    matchesDashboardScopeForMarketplace,
    matchesCategoryRollup,
    isManagerWorkspace,
    isAdminGlobalView,
    filterOptions,
    filterLabels,
  } = useCatalogScope();
  const catalogWorkspace = impersonatedWorkspace ?? workspace;
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();
  const [marketplace, setMarketplace] = useState<LegacyMarketplace>("amazon");
  const [products, setProducts] = useState<ProductMasterPricingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [subCategoryFilter, setSubCategoryFilter] =
    useState<SubCategoryFilter>("all");
  const [adminSubFilters, setAdminSubFilters] = useState<{
    options: readonly SubCategoryFilter[];
    labels: Record<string, string>;
  } | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [scopeDefaults, setScopeDefaults] = useState<
    Map<string, PricingScopeDefaultRecord>
  >(new Map());

  const sortAccessors = useMemo(
    () => ({
      product_code: (row: ProductMasterPricingRow) => row.product_code,
      product_name: (row: ProductMasterPricingRow) => row.product_name,
    }),
    [],
  );

  useEffect(() => {
    if (!useAdminGlobalCatalog) {
      setAdminSubFilters(null);
      return;
    }
    let cancelled = false;
    void listAdminGlobalAnalysisCategoryTree()
      .then((tree) => {
        if (!cancelled) setAdminSubFilters(adminGlobalSubCategoryFiltersFromTree(tree));
      })
      .catch(() => {
        if (!cancelled) setAdminSubFilters(null);
      });
    return () => {
      cancelled = true;
    };
  }, [useAdminGlobalCatalog]);

  const subFilterOptions =
    useAdminGlobalCatalog && adminSubFilters
      ? adminSubFilters.options
      : isAdminGlobalView || isManagerWorkspace
        ? filterOptions
        : undefined;
  const subFilterLabels =
    useAdminGlobalCatalog && adminSubFilters
      ? adminSubFilters.labels
      : isAdminGlobalView || isManagerWorkspace
        ? filterLabels
        : undefined;

  const loadData = useCallback(
    (nextMarketplace: LegacyMarketplace) => {
      setIsLoading(true);
      void (useAdminGlobalCatalog
        ? getAdminGlobalProductMaster(nextMarketplace)
        : getProductMaster(nextMarketplace, catalogWorkspace))
        .then(async (rows) => {
          const scoped = rows.filter((p) => isLegacyMarketplace(p.marketplace));
          const codes = scoped.map((row) => row.product_code);
          const productsByCode = new Map(
            scoped.map((row) => [
              row.product_code,
              { category: row.category, sub_category: row.sub_category },
            ]),
          );
          const scopeRows = await getPricingScopeDefaults(catalogWorkspace);
          const scopeMap = indexPricingScopeDefaults(scopeRows);
          const [priceMap, supplemental] = await Promise.all([
            getProductPricingForCodes(
              nextMarketplace,
              codes,
              productsByCode,
              scopeMap,
              catalogWorkspace,
            ),
            getPricingSupplementalMetrics(nextMarketplace, scoped, catalogWorkspace),
          ]);
          setScopeDefaults(scopeMap);
          return scoped.map((row) => {
            const record = priceMap.get(row.product_code);
            const pricing =
              record ??
              enrichEmptyPricing(
                nextMarketplace,
                row.product_code,
                row,
                scopeMap,
                catalogWorkspace,
              );
            const sup = supplemental.get(row.product_code);
            return {
              ...row,
              pricing,
              drr_units: sup?.drr_units ?? 0,
              atp_units: sup?.atp_units ?? 0,
              ho_stock_units: sup?.ho_stock_units ?? 0,
              sellout_as_of: sup?.sellout_as_of ?? null,
              ho_stock_as_of: sup?.ho_stock_as_of ?? null,
            };
          });
        })
        .then(setProducts)
        .finally(() => setIsLoading(false));
    },
    [catalogWorkspace, useAdminGlobalCatalog],
  );

  useEffect(() => {
    if (authLoading) return;
    loadData(marketplace);
  }, [marketplace, catalogWorkspace, useAdminGlobalCatalog, authLoading, loadData]);

  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    for (const p of products) {
      const c = (p.category ?? "").trim();
      if (c) cats.add(c);
    }
    return ["all", ...[...cats].sort((a, b) => a.localeCompare(b, "en-IN"))];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const legacyMarketplace = marketplace as LegacyMarketplace;
    return products
      .filter((product) => {
        if (isDawgScope) return productMatchesDawgScope(product);
        if (useAdminGlobalCatalog) {
          return productMasterMatchesAdminGlobalSubCategory(
            product,
            subCategoryFilter,
            legacyMarketplace,
          );
        }
        if (subCategoryFilter !== "all") {
          return matchesCategoryRollup(subCategoryFilter, product, legacyMarketplace);
        }
        return matchesDashboardScopeForMarketplace(product, legacyMarketplace);
      })
      .filter((product) => {
        if (categoryFilter === "all") return true;
        return (product.category ?? "").trim() === categoryFilter;
      })
      .filter((product) => matchesSearch(product, search));
  }, [
    products,
    search,
    categoryFilter,
    subCategoryFilter,
    isDawgScope,
    marketplace,
    matchesDashboardScopeForMarketplace,
    matchesCategoryRollup,
    useAdminGlobalCatalog,
  ]);

  const { sortedRows: tableRows, sortKey, sortDirection, requestSort } = useTableSort(
    filteredProducts,
    sortAccessors,
    "product_name",
    "asc",
    { naturalTextSortKeys: ["product_name"] },
  );

  const persistPricing = useCallback(
    async (
      product: ProductMasterPricingRow,
      patch: Parameters<typeof saveProductPricingEdit>[0]["patch"],
    ) => {
      setSavingCode(product.product_code);
      setSaveError(null);
      try {
        const updated = await saveProductPricingEdit({
          marketplace,
          productCode: product.product_code,
          patch,
          catalogWorkspace,
          product,
        });
        setProducts((prev) =>
          prev.map((row) =>
            row.product_code === product.product_code ? { ...row, pricing: updated } : row,
          ),
        );
      } catch (e: unknown) {
        setSaveError(e instanceof Error ? e.message : "Save failed.");
      } finally {
        setSavingCode(null);
      }
    },
    [marketplace, catalogWorkspace],
  );

  const supplementalAsOf = useMemo(() => {
    const row = products[0];
    if (!row) return null;
    return {
      sellout: row.sellout_as_of,
      ho: row.ho_stock_as_of,
    };
  }, [products]);

  const codeLabel = getCodeLabel(marketplace);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Product Master"
            subtitle="MF_HA has BAU + margins only (no Event SP). Set net-real % and coupon defaults per sub-category; override individual SKUs when needed."
          />
        </div>
        <div className="flex flex-col items-end gap-2">
          {channelCoverage ? (
            <DataAsOnDualChannelBadge
              amazon={channelCoverage.amazon}
              flipkart={channelCoverage.flipkart}
            />
          ) : null}
          {supplementalAsOf?.sellout || supplementalAsOf?.ho ? (
            <p className="text-right text-[11px] text-zinc-500 dark:text-zinc-400">
              {supplementalAsOf.sellout
                ? `DRR/ATP: sellout ${supplementalAsOf.sellout}`
                : null}
              {supplementalAsOf.sellout && supplementalAsOf.ho ? " · " : null}
              {supplementalAsOf.ho ? `HO: stock ${supplementalAsOf.ho}` : null}
            </p>
          ) : null}
        </div>
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <FieldLabel>Marketplace</FieldLabel>
            <MarketplaceToggle value={marketplace} onChange={setMarketplace} />
          </div>
          <div className="min-w-[160px]">
            <FieldLabel>Category</FieldLabel>
            <Select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              {categoryOptions.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === "all" ? "All categories" : cat}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-[200px] flex-1">
            <FieldLabel>Search</FieldLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                className="pl-9"
                placeholder={`Search ${codeLabel}, model, category`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div>
            <FieldLabel>Total</FieldLabel>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              {filteredProducts.length} of {products.length}
            </div>
          </div>
          <div className="ml-auto">
            <Button
              type="button"
              disabled={filteredProducts.length === 0}
              className="bg-zinc-800 hover:bg-zinc-900"
              onClick={() =>
                exportProductMasterTableToExcel(tableRows, marketplace)
              }
            >
              Export Excel
            </Button>
          </div>
        </div>

        {!isDawgScope ? (
          <SubCategoryFilterSelect
            value={subCategoryFilter}
            onChange={setSubCategoryFilter}
            options={subFilterOptions}
            labels={subFilterLabels}
          />
        ) : null}

        <PricingScopeDefaultsCard
          catalogWorkspace={catalogWorkspace}
          marketplace={marketplace}
          categoryFilter={categoryFilter}
          subCategoryFilter={subCategoryFilter}
          scopeDefaults={scopeDefaults}
          onSaved={(row) => {
            setScopeDefaults((prev) => {
              const next = new Map(prev);
              next.set(
                `${row.marketplace}|${row.scope_level}|${row.scope_key}`,
                row,
              );
              return next;
            });
            loadData(marketplace);
          }}
          onError={setSaveError}
        />

        {saveError ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {saveError}
          </p>
        ) : null}
      </Card>

      {isLoading ? (
        <InlineLoader text="Loading products..." />
      ) : filteredProducts.length === 0 ? (
        <EmptyState
          title="No products found"
          description={
            products.length === 0
              ? "Upload a sellout sheet first, then upload the BAU pricing sheet from Upload Center."
              : "Clear filters or change category / sub-category."
          }
        />
      ) : (
        <div className="overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-[1400px] divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/80">
              <tr>
                <SortableTableHeader
                  label={codeLabel}
                  sortKey="product_code"
                  activeKey={sortKey}
                  activeDirection={sortDirection}
                  onSort={requestSort}
                  className="sticky left-0 z-10 bg-zinc-50 py-2.5 pl-3 dark:bg-zinc-900/80"
                />
                <SortableTableHeader
                  label="Model"
                  sortKey="product_name"
                  activeKey={sortKey}
                  activeDirection={sortDirection}
                  onSort={requestSort}
                  className="py-2.5"
                />
                <th className="px-2 py-2.5">Sub</th>
                <th className="px-2 py-2.5">BAU SP</th>
                <th className="px-2 py-2.5">Margin %</th>
                <th className="px-2 py-2.5 text-right">Basic SP</th>
                <th className="px-2 py-2.5">Event SP</th>
                <th className="px-2 py-2.5">Ev. margin %</th>
                <th className="px-2 py-2.5 text-right">Ev. basic</th>
                <th className="px-2 py-2.5 text-center">Flat</th>
                <th className="px-2 py-2.5 text-right">Basic sup.</th>
                <th className="px-2 py-2.5 text-right">Base IBD</th>
                <th className="px-2 py-2.5">Top up IBD</th>
                <th className="px-2 py-2.5 text-right">NEP</th>
                <th className="px-2 py-2.5">Net real %</th>
                <th className="px-2 py-2.5">Coupon</th>
                <th className="px-2 py-2.5">Cpn sup %</th>
                <th className="px-2 py-2.5 text-right">Net real.</th>
                <th className="px-2 py-2.5 text-right">DRR</th>
                <th className="px-2 py-2.5 text-right">ATP</th>
                <th className="px-2 py-2.5 pr-3 text-right">HO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {tableRows.map((product) => {
                const p = product.pricing;
                const isSaving = savingCode === product.product_code;
                const pricingKey = `${product.product_code}-${p.updated_at}-${p.bau_sp}-${p.event_sp}-${p.is_flat_price}-${p.bau_margin_pct}`;
                return (
                  <tr
                    key={pricingKey}
                    className={cn(
                      "bg-white dark:bg-zinc-950",
                      isSaving && "opacity-70",
                    )}
                  >
                    <td className="sticky left-0 z-[1] bg-white px-3 py-2 font-mono text-xs dark:bg-zinc-950">
                      {product.product_code}
                    </td>
                    <td className="max-w-[160px] truncate px-2 py-2 font-medium">
                      {displayModelName(product.product_name, product.product_code)}
                    </td>
                    <td className="max-w-[100px] truncate px-2 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                      {product.sub_category
                        ? getSubCategoryLabel(product.sub_category)
                        : "—"}
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="h-8 w-24 text-right tabular-nums"
                        defaultValue={formatNumInput(p.bau_sp)}
                        onBlur={(e) => {
                          const v = roundPricingInr(Number(e.target.value));
                          if (v !== p.bau_sp) void persistPricing(product, { bau_sp: v });
                        }}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="h-8 w-20 text-right tabular-nums"
                        defaultValue={formatMarginInput(p.bau_margin_pct)}
                        placeholder="%"
                        onBlur={(e) => {
                          const v = parseMarginPercentInput(e.target.value);
                          if (v !== p.bau_margin_pct) {
                            void persistPricing(product, { bau_margin_pct: v });
                          }
                        }}
                      />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-zinc-500">
                      {p.basic_sp > 0 ? formatInr(p.basic_sp) : "—"}
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="h-8 w-24 text-right tabular-nums"
                        defaultValue={formatNumInput(p.event_sp)}
                        onBlur={(e) => {
                          const v = roundPricingInr(Number(e.target.value));
                          if (v !== p.event_sp) void persistPricing(product, { event_sp: v });
                        }}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="h-8 w-20 text-right tabular-nums"
                        defaultValue={formatMarginInput(p.event_margin_pct)}
                        placeholder="%"
                        onBlur={(e) => {
                          const v = parseMarginPercentInput(e.target.value);
                          if (v !== p.event_margin_pct) {
                            void persistPricing(product, { event_margin_pct: v });
                          }
                        }}
                      />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-zinc-500">
                      {formatCalcInr(p.event_basic, hasEventPricing(p.event_sp))}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-zinc-300"
                        checked={p.is_flat_price}
                        onChange={(e) => {
                          void persistPricing(product, {
                            is_flat_price: e.target.checked,
                          });
                        }}
                      />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-zinc-500">
                      {formatCalcInr(
                        p.basic_support_pu,
                        hasEventPricing(p.event_sp),
                        p.is_flat_price,
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-zinc-500">
                      {formatCalcInr(p.base_ibd, hasEventPricing(p.event_sp), true)}
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="h-8 w-24 text-right tabular-nums"
                        defaultValue={formatNumInput(p.top_up_ibd)}
                        onBlur={(e) => {
                          const v = roundPricingInr(Number(e.target.value));
                          if (v !== p.top_up_ibd) {
                            void persistPricing(product, { top_up_ibd: v });
                          }
                        }}
                      />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-zinc-500">
                      {formatCalcInr(p.nep, hasEventPricing(p.event_sp))}
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="h-8 w-16 text-right tabular-nums"
                        key={`nr-${pricingKey}-${p.net_real_factor}`}
                        defaultValue={
                          p.net_real_factor != null
                            ? formatNetRealFactorInput(p.net_real_factor)
                            : ""
                        }
                        placeholder={formatNetRealFactorInput(p.resolved_net_real_factor)}
                        title={
                          p.net_real_factor == null
                            ? `Inherited: ${formatNetRealFactorInput(p.resolved_net_real_factor)}%`
                            : "SKU override"
                        }
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const v = raw ? parseNetRealFactorInput(raw) : null;
                          const current = p.net_real_factor;
                          if (v !== current && (v != null || current != null)) {
                            void persistPricing(product, { net_real_factor: v });
                          }
                        }}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="h-8 w-16 text-right tabular-nums"
                        key={`cv-${pricingKey}-${p.coupon_value}`}
                        defaultValue={formatOptionalNumInput(p.coupon_value)}
                        placeholder="0"
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const v = raw ? roundPricingInr(Number(raw)) : null;
                          if (v !== p.coupon_value) {
                            void persistPricing(product, { coupon_value: v });
                          }
                        }}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="h-8 w-16 text-right tabular-nums"
                        key={`cs-${pricingKey}-${p.coupon_support_pct}`}
                        defaultValue={formatOptionalMarginInput(p.coupon_support_pct)}
                        placeholder={formatMarginInput(p.resolved_coupon_support_pct)}
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const v = raw ? parseMarginPercentInput(raw) : null;
                          if (v !== p.coupon_support_pct) {
                            void persistPricing(product, { coupon_support_pct: v });
                          }
                        }}
                      />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-zinc-500">
                      {formatCalcInr(p.net_realisation, p.basic_sp > 0)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-zinc-600">
                      {formatCalcUnits(product.drr_units)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-zinc-600">
                      {formatCalcUnits(product.atp_units)}
                    </td>
                    <td className="px-2 py-2 pr-3 text-right tabular-nums text-zinc-600">
                      {formatCalcUnits(product.ho_stock_units)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
