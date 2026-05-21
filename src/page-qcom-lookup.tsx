import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  browseUnifiedQcomProducts,
  listQcomCategories,
  listQcomSubCategories,
  QCOM_LOOKUP_FILTER_ALL,
  sampleRandomUnifiedQcomProducts,
  searchUnifiedQcomProducts,
  type QcomLookupFilters,
  type UnifiedQcomProductSuggestion,
} from "./data-qcom";
import { qcomProductHubPath } from "./qcom-paths";
import {
  Button,
  Card,
  EmptyState,
  FieldLabel,
  Input,
  PageTitle,
  Select,
} from "./ui";

function openUnifiedQcomProduct(
  navigate: ReturnType<typeof useNavigate>,
  row: UnifiedQcomProductSuggestion,
) {
  navigate(qcomProductHubPath(row.canonicalProductCode));
}

export function QcomLookupPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(QCOM_LOOKUP_FILTER_ALL);
  const [subCategory, setSubCategory] = useState(QCOM_LOOKUP_FILTER_ALL);
  const [categories, setCategories] = useState<string[]>([]);
  const [subCategories, setSubCategories] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<UnifiedQcomProductSuggestion[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const filters: QcomLookupFilters = useMemo(
    () => ({ category, subCategory }),
    [category, subCategory],
  );

  const isAllFilters =
    category === QCOM_LOOKUP_FILTER_ALL && subCategory === QCOM_LOOKUP_FILTER_ALL;

  useEffect(() => {
    void listQcomCategories().then(setCategories);
  }, []);

  useEffect(() => {
    setSubCategory(QCOM_LOOKUP_FILTER_ALL);
    void listQcomSubCategories(category).then(setSubCategories);
  }, [category]);

  const loadBrowseList = useCallback(async () => {
    setBrowseLoading(true);
    try {
      const rows = isAllFilters
        ? await sampleRandomUnifiedQcomProducts(10)
        : await browseUnifiedQcomProducts(filters, 20);
      setSuggestions(rows);
      setOpen(rows.length > 0);
    } catch {
      setSuggestions([]);
      setOpen(false);
    } finally {
      setBrowseLoading(false);
    }
  }, [filters, isAllFilters]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length >= 2) return;

    void loadBrowseList();
  }, [query, loadBrowseList]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    const timer = window.setTimeout(() => {
      void searchUnifiedQcomProducts(trimmed, 15, filters)
        .then((rows) => {
          setSuggestions(rows);
          setOpen(rows.length > 0);
        })
        .catch(() => setSuggestions([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query, filters]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function handleSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsLoading(true);
    setError(null);
    setOpen(false);
    void searchUnifiedQcomProducts(trimmed, 5, filters)
      .then((rows) => {
        const row = rows[0];
        if (!row) {
          setError("No matching product found for this category filter.");
          return;
        }
        openUnifiedQcomProduct(navigate, row);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Lookup failed.");
      })
      .finally(() => setIsLoading(false));
  }

  const listLabel =
    query.trim().length >= 2
      ? "Matching products"
      : isAllFilters
        ? "Sample products (random from master)"
        : "Products in selection";

  return (
    <div className="space-y-6">
      <PageTitle
        title="Product Lookup"
        subtitle="Filter by category and sub-category, then search or pick from the list — each product opens once, linked by ASIN across channels when available."
      />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1 sm:max-w-xs">
            <FieldLabel>Category</FieldLabel>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Category"
            >
              <option value={QCOM_LOOKUP_FILTER_ALL}>All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
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
              <option value={QCOM_LOOKUP_FILTER_ALL}>All sub-categories</option>
              {subCategories.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div ref={ref}>
          <FieldLabel>ASIN, listing code, or model name</FieldLabel>
          <Input
            value={query}
            placeholder="Type to search within the filters above…"
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              if (suggestions.length) setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim() && !isLoading) {
                e.preventDefault();
                handleSearch();
              }
              if (e.key === "Escape") setOpen(false);
            }}
            autoComplete="off"
          />

          {browseLoading && query.trim().length < 2 ? (
            <p className="mt-2 text-xs font-medium text-zinc-500">Loading products…</p>
          ) : null}

          {open && suggestions.length > 0 ? (
            <div className="mt-2">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-zinc-500">
                {listLabel}
              </p>
              <ul className="max-h-72 overflow-auto rounded-xl border border-zinc-200 bg-white shadow-lg">
                {suggestions.map((row) => (
                  <li key={row.key}>
                    <button
                      type="button"
                      className="block w-full px-4 py-3 text-left hover:bg-violet-50"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setOpen(false);
                        openUnifiedQcomProduct(navigate, row);
                      }}
                    >
                      <p className="font-semibold text-zinc-900">{row.modelName}</p>
                      {row.subtitle ? (
                        <p className="text-xs text-zinc-500">{row.subtitle}</p>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : query.trim().length >= 2 && !browseLoading && suggestions.length === 0 ? (
            <p className="mt-2 text-xs font-medium text-zinc-500">
              No products match this search in the selected category.
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={isLoading || query.trim().length < 2}
              onClick={handleSearch}
            >
              {isLoading ? "Opening…" : "Open product"}
            </Button>
            {query.trim().length < 2 && isAllFilters ? (
              <Button
                type="button"
                className="border border-zinc-300 bg-white text-zinc-800 shadow-none hover:bg-zinc-50"
                disabled={browseLoading}
                onClick={() => {
                  setOpen(true);
                  void loadBrowseList();
                }}
              >
                Shuffle sample
              </Button>
            ) : null}
            {suggestions.length > 0 ? (
              <Button
                type="button"
                className="border border-zinc-300 bg-white text-zinc-800 shadow-none hover:bg-zinc-50"
                onClick={() => setOpen((v) => !v)}
              >
                {open ? "Hide list" : "Show list"}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {error ? <EmptyState title="Lookup failed" description={error} /> : null}

      <EmptyState
        title="Tip"
        description="With All categories selected, the list shows 10 random models from the Consolidated master sheet. Narrow category or sub-category to see a focused catalogue, then type to search within that slice."
      />
    </div>
  );
}
