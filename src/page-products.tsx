import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  getAdminGlobalProductMaster,
  adminGlobalSubCategoryFiltersFromTree,
  listAdminGlobalAnalysisCategoryTree,
  productMasterMatchesAdminGlobalSubCategory,
} from "./admin-dashboard-data";
import { useAdminRealm } from "./admin-realm-context";
import { useCatalogScope } from "./catalog-scope-context";
import { getProductMaster } from "./data";
import { useAuth } from "./use-auth";
import { isDawgDataScope } from "./data-scope";
import { getBauMapsForCodes } from "./data-gms";
import { productMatchesDawgScope } from "./dawg-scope";
import { useDataScope } from "./use-data-scope";
import { displayModelName } from "./product-display";
import {
  type LegacyMarketplace,
  type Marketplace,
  type ProductMaster,
  type SubCategoryFilter,
  getSubCategoryLabel,
} from "./types";
import {
  Card,
  DataAsOnDualChannelBadge,
  EmptyState,
  FieldLabel,
  InlineLoader,
  Input,
  PageTitle,
  Select,
  SubCategoryFilterSelect,
} from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";
import { cn, formatInr } from "./utils";

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
}

function formatSheetPrice(value: number): string {
  return value > 0 ? formatInr(value) : "—";
}

function matchesSearch(product: ProductMaster, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return (
    product.product_code.toLowerCase().includes(q) ||
    product.product_name.toLowerCase().includes(q) ||
    (product.sub_category ?? "").toLowerCase().includes(q)
  );
}

export type ProductMasterCatalogRow = ProductMaster & {
  sheet_bau_price: number;
  sheet_event_price: number;
};

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
  const [marketplace, setMarketplace] = useState<Marketplace>("amazon");
  const [products, setProducts] = useState<ProductMasterCatalogRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [subCategoryFilter, setSubCategoryFilter] =
    useState<SubCategoryFilter>("all");
  const [adminSubFilters, setAdminSubFilters] = useState<{
    options: readonly SubCategoryFilter[];
    labels: Record<string, string>;
  } | null>(null);

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

  const loadData = (nextMarketplace: Marketplace) => {
    setIsLoading(true);
    void (useAdminGlobalCatalog
      ? getAdminGlobalProductMaster(nextMarketplace)
      : getProductMaster(nextMarketplace, catalogWorkspace))
      .then(async (rows) => {
        const codes = rows.map((row) => row.product_code);
        const priceMap = await getBauMapsForCodes(nextMarketplace, codes);
        return rows.map((row) => {
          const prices = priceMap.get(row.product_code) ?? { bau: 0, event: 0 };
          return {
            ...row,
            sheet_bau_price: prices.bau,
            sheet_event_price: prices.event,
          };
        });
      })
      .then(setProducts)
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    if (authLoading) return;
    loadData(marketplace);
  }, [marketplace, catalogWorkspace, useAdminGlobalCatalog, authLoading]);

  const filteredProducts = useMemo(
    () =>
      products
        .filter((product) => {
          if (isDawgScope) {
            return productMatchesDawgScope(product);
          }
          const legacyMarketplace = marketplace as LegacyMarketplace;
          if (useAdminGlobalCatalog) {
            return productMasterMatchesAdminGlobalSubCategory(
              product,
              subCategoryFilter,
              legacyMarketplace,
            );
          }
          if (subCategoryFilter === "all") {
            return matchesDashboardScopeForMarketplace(
              product,
              legacyMarketplace,
            );
          }
          return matchesCategoryRollup(
            subCategoryFilter,
            product,
            legacyMarketplace,
          );
        })
        .filter((product) => matchesSearch(product, search)),
    [
      products,
      search,
      subCategoryFilter,
      isDawgScope,
      marketplace,
      matchesDashboardScopeForMarketplace,
      matchesCategoryRollup,
      useAdminGlobalCatalog,
    ],
  );

  const codeLabel = getCodeLabel(marketplace);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Product Master"
            subtitle={
              useAdminGlobalCatalog
                ? "All manager catalogs (Amazon + Flipkart) with BAU and event prices from the latest BAU sheet upload."
                : "Catalog SKUs with BAU and event prices from the latest BAU sheet upload."
            }
          />
        </div>
        {channelCoverage ? (
          <DataAsOnDualChannelBadge
            amazon={channelCoverage.amazon}
            flipkart={channelCoverage.flipkart}
          />
        ) : null}
      </div>

      <Card className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
          <div>
            <FieldLabel>Marketplace</FieldLabel>
            <Select
              value={marketplace}
              onChange={(event) =>
                setMarketplace(event.target.value as Marketplace)
              }
            >
              <option value="amazon">Amazon</option>
              <option value="flipkart">Flipkart</option>
            </Select>
          </div>
          <div>
            <FieldLabel>Search</FieldLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                className="pl-9"
                placeholder={`Search by ${codeLabel}, model, or sub-category`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          <div>
            <FieldLabel>Total</FieldLabel>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              {filteredProducts.length} of {products.length}
            </div>
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
      </Card>

      {isLoading ? (
        <InlineLoader text="Loading products..." />
      ) : filteredProducts.length === 0 ? (
        <EmptyState
          title="No products found"
          description={
            products.length === 0
              ? "Upload a sellout sheet from Upload Center first. For prices, upload the BAU price sheet (Amazon + Flipkart tabs)."
              : "Clear search or change sub-category filter."
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filteredProducts.map((product) => (
            <Card key={product.product_code} className="space-y-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                    {codeLabel}
                  </span>
                  <span className="truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    {product.product_code}
                  </span>
                  {product.sub_category ? (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                      {getSubCategoryLabel(product.sub_category)}
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-1 truncate font-semibold text-zinc-900 dark:text-zinc-100">
                  {displayModelName(product.product_name, product.product_code)}
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900/50">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    BAU price
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-lg font-semibold tabular-nums",
                      product.sheet_bau_price > 0
                        ? "text-zinc-900 dark:text-zinc-100"
                        : "text-zinc-400",
                    )}
                  >
                    {formatSheetPrice(product.sheet_bau_price)}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900/50">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Event price
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-lg font-semibold tabular-nums",
                      product.sheet_event_price > 0
                        ? "text-zinc-900 dark:text-zinc-100"
                        : "text-zinc-400",
                    )}
                  >
                    {formatSheetPrice(product.sheet_event_price)}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
