import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  browseUnifiedProducts,
  findUnifiedProduct,
  searchUnifiedProducts,
  type UnifiedProductSuggestion,
} from "./data";
import { listAdminGlobalAnalysisCategoryTree } from "./admin-dashboard-data";
import { ANALYSIS_CATEGORY_ALL } from "./analysis-category-paths";
import { productIdHubPath, productWorkspacePath } from "./product-channel";
import { useCatalogScope } from "./catalog-scope-context";
import { productMatchesPravinTopCategory } from "./pravin-category-scope";
import {
  buildMarketplaceLookupScopeFilter,
  MARKETPLACE_LOOKUP_FILTER_ALL,
  marketplaceLookupCategoryOptions,
  marketplaceLookupFiltersActive,
  marketplaceLookupSubCategoryOptions,
  marketplaceLookupWorkspace,
  type MarketplaceLookupCategory,
} from "./marketplace-lookup-filters";
import { normalizeKey } from "./utils";
import {
  Button,
  Card,
  DataAsOnDualChannelBadge,
  EmptyState,
  FieldLabel,
  Input,
  PageTitle,
  Select,
} from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

function openUnifiedProduct(
  navigate: ReturnType<typeof useNavigate>,
  row: UnifiedProductSuggestion,
  routePrefix: string,
) {
  /** Listing-first: daWg / users without HO stock still have sellout by ASIN/FSN. */
  if (row.asin) {
    navigate(productWorkspacePath("amazon", row.asin, "sellout-growth", routePrefix));
    return;
  }
  if (row.fsn) {
    navigate(productWorkspacePath("flipkart", row.fsn, "sellout-growth", routePrefix));
    return;
  }
  if (row.erpProductId) {
    navigate(productIdHubPath(row.erpProductId, routePrefix));
  }
}

export function AsinLookupPage() {
  const navigate = useNavigate();
  const {
    routePrefix,
    isDawg,
    isPersonalAudio,
    isPravin,
    isMarketplaceGlobalScope,
    filterOptions,
    filterLabels,
    matchesDashboardScope,
  } = useCatalogScope();
  const lookupWorkspace = marketplaceLookupWorkspace({ isDawg, isPersonalAudio });
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MarketplaceLookupCategory>(
    MARKETPLACE_LOOKUP_FILTER_ALL,
  );
  const [subCategory, setSubCategory] = useState(MARKETPLACE_LOOKUP_FILTER_ALL);
  const [suggestions, setSuggestions] = useState<UnifiedProductSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const browseRequestId = useRef(0);
  const searchRequestId = useRef(0);

  const [globalSheetCategories, setGlobalSheetCategories] = useState<string[]>([]);

  useEffect(() => {
    if (!isMarketplaceGlobalScope) {
      setGlobalSheetCategories([]);
      return;
    }
    void listAdminGlobalAnalysisCategoryTree().then((tree) => {
      setGlobalSheetCategories(
        tree.categories.filter((c) => c !== ANALYSIS_CATEGORY_ALL),
      );
    });
  }, [isMarketplaceGlobalScope]);

  const categoryOptions = useMemo(
    () => {
      if (isMarketplaceGlobalScope) {
        return [
          { value: MARKETPLACE_LOOKUP_FILTER_ALL, label: "All categories" },
          ...globalSheetCategories.map((cat) => ({
            value: cat as MarketplaceLookupCategory,
            label: cat,
          })),
        ];
      }
      if (isPravin) {
        return [
          { value: MARKETPLACE_LOOKUP_FILTER_ALL, label: "All categories" },
          { value: "pravin_roma" as MarketplaceLookupCategory, label: "ROMA" },
          { value: "pravin_powerbank" as MarketplaceLookupCategory, label: "PowerBank" },
        ];
      }
      return marketplaceLookupCategoryOptions(lookupWorkspace);
    },
    [isMarketplaceGlobalScope, globalSheetCategories, isPravin, lookupWorkspace],
  );

  const subCategoryOptions = useMemo(
    () => {
      if (!isPravin) return marketplaceLookupSubCategoryOptions(lookupWorkspace, category);
      const all = [{ value: MARKETPLACE_LOOKUP_FILTER_ALL, label: "All sub-categories" }];
      const rawSubs = filterOptions.filter((value) => value !== "all");
      const scopedSubs = rawSubs.filter((value) => {
        const key = normalizeKey(value);
        const isPowerBank = key === "powerbank" || key === "power bank";
        if (category === "pravin_powerbank") return isPowerBank;
        if (category === "pravin_roma") return !isPowerBank;
        return true;
      });
      return [
        ...all,
        ...scopedSubs.map((value) => ({
          value,
          label: filterLabels[value] ?? value,
        })),
      ];
    },
    [isPravin, lookupWorkspace, category, filterOptions, filterLabels],
  );

  useEffect(() => {
    setSubCategory(MARKETPLACE_LOOKUP_FILTER_ALL);
  }, [category]);

  const scopeFilter = useMemo(
    () => {
      if (isMarketplaceGlobalScope) {
        return (row: {
          category?: string | null;
          sub_category?: string | null;
          product_name?: string | null;
        }) => {
          if (!matchesDashboardScope(row)) return false;
          if (
            category !== MARKETPLACE_LOOKUP_FILTER_ALL &&
            normalizeKey(row.category ?? "") !== normalizeKey(String(category))
          ) {
            return false;
          }
          if (
            subCategory !== MARKETPLACE_LOOKUP_FILTER_ALL &&
            normalizeKey(row.sub_category ?? "") !== normalizeKey(subCategory)
          ) {
            return false;
          }
          return true;
        };
      }
      if (!isPravin) {
        return buildMarketplaceLookupScopeFilter({
          workspace: lookupWorkspace,
          category,
          subCategory,
          matchesDashboardScope,
        });
      }
      return (row: { category?: string | null; sub_category?: string | null; product_name?: string | null }) => {
        if (!matchesDashboardScope(row)) return false;
        const normalizedRow = {
          category: row.category ?? null,
          sub_category: row.sub_category ?? null,
          product_name: row.product_name ?? null,
        };
        if (
          category === "pravin_roma" &&
          !productMatchesPravinTopCategory("ROMA", normalizedRow)
        ) {
          return false;
        }
        if (
          category === "pravin_powerbank" &&
          !productMatchesPravinTopCategory("PowerBank", normalizedRow)
        ) {
          return false;
        }
        if (subCategory !== MARKETPLACE_LOOKUP_FILTER_ALL) {
          return normalizeKey(row.sub_category ?? "") === normalizeKey(subCategory);
        }
        return true;
      };
    },
    [isMarketplaceGlobalScope, isPravin, lookupWorkspace, category, subCategory, matchesDashboardScope],
  );

  const searchOptions = useMemo(() => ({ scopeFilter }), [scopeFilter]);

  const filtersActive = marketplaceLookupFiltersActive(category, subCategory);

  const loadBrowseList = useCallback(async () => {
    const requestId = ++browseRequestId.current;
    setBrowseLoading(true);
    setError(null);
    try {
      const rows = await browseUnifiedProducts(scopeFilter, 10);
      if (requestId !== browseRequestId.current) return;
      setSuggestions(rows);
      setSuggestionsOpen(true);
      if (rows.length === 0 && filtersActive) {
        setError("No products in this category — try another filter or upload sellout data.");
      }
    } catch (e: unknown) {
      if (requestId !== browseRequestId.current) return;
      setSuggestions([]);
      setSuggestionsOpen(false);
      setError(e instanceof Error ? e.message : "Could not load products.");
    } finally {
      if (requestId === browseRequestId.current) setBrowseLoading(false);
    }
  }, [scopeFilter, filtersActive]);

  useEffect(() => {
    if (query.trim().length >= 2) return;
    void loadBrowseList();
  }, [query, loadBrowseList]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    browseRequestId.current += 1;
    const requestId = ++searchRequestId.current;

    const timer = window.setTimeout(() => {
      void searchUnifiedProducts(trimmed, searchOptions)
        .then((rows) => {
          if (requestId !== searchRequestId.current) return;
          setSuggestions(rows);
          setSuggestionsOpen(true);
          setError(rows.length === 0 ? "No matching products in this filter." : null);
        })
        .catch(() => {
          if (requestId !== searchRequestId.current) return;
          setSuggestions([]);
          setSuggestionsOpen(false);
        });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [query, searchOptions]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setSuggestionsOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function handleSearch() {
    setError(null);
    const trimmed = query.trim();
    if (!trimmed) {
      void loadBrowseList();
      return;
    }
    setIsLoading(true);
    browseRequestId.current += 1;
    const requestId = ++searchRequestId.current;

    void (async () => {
      try {
        const exact = await findUnifiedProduct(trimmed, searchOptions);
        if (requestId !== searchRequestId.current) return;

        const asinMatch =
          exact?.asin?.toLowerCase() === trimmed.toLowerCase() ||
          exact?.fsn?.toLowerCase() === trimmed.toLowerCase() ||
          exact?.erpProductId === trimmed;

        if (exact && (asinMatch || trimmed.length >= 10)) {
          openUnifiedProduct(navigate, exact, routePrefix);
          return;
        }

        const rows = await searchUnifiedProducts(trimmed, searchOptions);
        if (requestId !== searchRequestId.current) return;

        if (rows.length === 0) {
          setError(
            filtersActive
              ? "No matching product in this category. Try All, another filter, or pick from the list."
              : "No matching product found on Amazon or Flipkart.",
          );
          setSuggestions([]);
          setSuggestionsOpen(false);
          return;
        }

        if (rows.length === 1) {
          openUnifiedProduct(navigate, rows[0]!, routePrefix);
          return;
        }

        setSuggestions(rows);
        setSuggestionsOpen(true);
      } catch (e: unknown) {
        if (requestId !== searchRequestId.current) return;
        setError(
          e instanceof Error ? e.message : "Failed to fetch product details.",
        );
      } finally {
        if (requestId === searchRequestId.current) setIsLoading(false);
      }
    })();
  }

  const listLabel =
    query.trim().length >= 2
      ? "Matching products"
      : filtersActive
        ? "Products in selection"
        : "Sample products";

  const searchDisabled = isLoading;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Product Lookup"
            subtitle="Filter by category and sub-category, search by ASIN/FSN/model, or pick from the list (up to 10 products)."
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
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1 sm:max-w-xs">
            <FieldLabel>Category</FieldLabel>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as MarketplaceLookupCategory)}
              aria-label="Category"
            >
              {categoryOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-[180px] flex-1 sm:max-w-xs">
            <FieldLabel>Sub-category</FieldLabel>
            <Select
              value={subCategory}
              onChange={(e) => setSubCategory(e.target.value)}
              aria-label="Sub-category"
            >
              {subCategoryOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div ref={containerRef} className="relative">
            <FieldLabel>ASIN, FSN, product ID, or model name</FieldLabel>
            <Input
              placeholder="Optional — leave blank to browse by category"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSuggestionsOpen(true);
              }}
              onFocus={() => {
                if (suggestions.length > 0) setSuggestionsOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !searchDisabled) {
                  e.preventDefault();
                  handleSearch();
                }
                if (e.key === "Escape") setSuggestionsOpen(false);
              }}
              autoComplete="off"
            />
            {suggestionsOpen && suggestions.length > 0 ? (
              <div className="absolute z-20 mt-1 w-full rounded-xl border border-zinc-200 bg-white shadow-lg">
                <p className="border-b border-zinc-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {listLabel}
                </p>
                <ul className="max-h-72 overflow-auto py-1">
                  {suggestions.map((row) => (
                    <li key={row.key}>
                      <button
                        type="button"
                        className="flex w-full flex-col gap-0.5 px-4 py-3 text-left transition hover:bg-violet-50"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setQuery(row.modelName);
                          setSuggestionsOpen(false);
                          openUnifiedProduct(navigate, row, routePrefix);
                        }}
                      >
                        <span className="text-sm font-semibold text-zinc-900">{row.modelName}</span>
                        {row.subtitle ? (
                          <span className="text-xs font-medium text-zinc-500">{row.subtitle}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            disabled={searchDisabled}
            onClick={handleSearch}
            className="h-[42px] shrink-0 md:self-end"
          >
            {isLoading || browseLoading ? "Loading..." : "Search"}
          </Button>
        </div>
      </Card>

      {error ? <EmptyState title="Lookup" description={error} /> : null}
    </div>
  );
}
