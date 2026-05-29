import { useEffect, useMemo, useRef, useState } from "react";
import { ImageIcon, Search, Upload } from "lucide-react";
import { useCatalogScope } from "./catalog-scope-context";
import {
  getProductMaster,
  updateProductImage,
  uploadProductImageFile,
} from "./data";
import { getAdminGlobalProductMaster } from "./admin-dashboard-data";
import { isDawgDataScope } from "./data-scope";
import { productMatchesDawgScope } from "./dawg-scope";
import { useDataScope } from "./use-data-scope";
import { updateProductBauPrice } from "./data-gms";
import { displayModelName } from "./product-display";
import { useAuth } from "./use-auth";
import {
  type LegacyMarketplace,
  type Marketplace,
  type ProductMaster,
  type SubCategoryFilter,
  getSubCategoryLabel,
} from "./types";
import {
  Button,
  Card,
  DataAsOnDualChannelBadge,
  EmptyState,
  FieldLabel,
  Input,
  InlineLoader,
  PageTitle,
  Select,
  SubCategoryFilterSelect,
} from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";
import { cn, formatInr } from "./utils";

function getCodeLabel(marketplace: Marketplace) {
  return marketplace === "amazon" ? "ASIN" : "FSN";
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

export function ProductMasterPage() {
  const { profile } = useAuth();
  const dataScope = useDataScope();
  const isDawgScope = isDawgDataScope(dataScope);
  const {
    workspace,
    matchesDashboardScopeForMarketplace,
    matchesCategoryRollup,
    isManagerWorkspace,
    isMarketplaceGlobalScope,
    filterOptions,
    filterLabels,
  } = useCatalogScope();
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();
  const [marketplace, setMarketplace] = useState<Marketplace>("amazon");
  const [products, setProducts] = useState<ProductMaster[]>([]);
  const [draftImages, setDraftImages] = useState<Record<string, string>>({});
  const [draftBau, setDraftBau] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [subCategoryFilter, setSubCategoryFilter] =
    useState<SubCategoryFilter>("all");
  const [uploadingCode, setUploadingCode] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const loadData = (nextMarketplace: Marketplace) => {
    setIsLoading(true);
    const load = isMarketplaceGlobalScope
      ? getAdminGlobalProductMaster(nextMarketplace)
      : getProductMaster(nextMarketplace, workspace);
    void load
      .then((rows) => {
        setProducts(rows);
        const drafts: Record<string, string> = {};
        const bauDrafts: Record<string, string> = {};
        rows.forEach((row) => {
          drafts[row.product_code] = row.image_url ?? "";
          bauDrafts[row.product_code] =
            row.bau_price != null && row.bau_price > 0 ? String(row.bau_price) : "";
        });
        setDraftImages(drafts);
        setDraftBau(bauDrafts);
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadData(marketplace);
  }, [marketplace, workspace]);

  const filteredProducts = useMemo(
    () =>
      products
        .filter((product) => {
          if (isDawgScope) {
            return productMatchesDawgScope(product);
          }
          if (subCategoryFilter === "all") {
            return matchesDashboardScopeForMarketplace(
              product,
              marketplace as LegacyMarketplace,
            );
          }
          return matchesCategoryRollup(
            subCategoryFilter,
            product,
            marketplace as LegacyMarketplace,
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
    ],
  );

  if (profile?.role !== "admin") {
    return (
      <EmptyState
        title="Product Master restricted"
        description="Only admin users can update product images."
      />
    );
  }

  const codeLabel = getCodeLabel(marketplace);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Product Master"
            subtitle="Catalog, images and metadata by marketplace."
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
            options={isManagerWorkspace ? filterOptions : undefined}
            labels={isManagerWorkspace ? filterLabels : undefined}
          />
        ) : null}
      </Card>

      {message ? (
        <Card className="border-emerald-200 bg-emerald-50 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          {message}
        </Card>
      ) : null}

      {isLoading ? (
        <InlineLoader text="Loading products..." />
      ) : filteredProducts.length === 0 ? (
        <EmptyState
          title="No products found"
          description={
            products.length === 0
              ? "Upload a sheet from Upload Center first."
              : "Clear search or change sub-category filter."
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filteredProducts.map((product) => {
            const draftValue = draftImages[product.product_code] ?? "";
            const draftBauValue = draftBau[product.product_code] ?? "";
            const isDirty =
              (product.image_url ?? "") !== draftValue ||
              String(product.bau_price ?? "") !== draftBauValue;
            const isSaving = savingCode === product.product_code;

            return (
              <Card key={product.product_code} className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-gradient-to-br from-zinc-50 to-zinc-100 text-zinc-400 dark:border-zinc-700 dark:from-zinc-900 dark:to-zinc-950">
                    {draftValue || product.image_url ? (
                      <img
                        src={draftValue || product.image_url || ""}
                        alt={product.product_name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-5 w-5" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
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
                </div>

                <div className="space-y-2">
                  <div>
                    <FieldLabel>BAU override (INR)</FieldLabel>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder="Empty = shared BAU from combined sheet"
                      value={draftBauValue}
                      onChange={(event) =>
                        setDraftBau((prev) => ({
                          ...prev,
                          [product.product_code]: event.target.value,
                        }))
                      }
                    />
                    {product.bau_price != null && product.bau_price > 0 ? (
                      <p className="mt-1 text-[11px] text-violet-700">
                        Active override: {formatInr(product.bau_price)} — this listing only (sheet BAU is shared by model).
                      </p>
                    ) : null}
                  </div>
                  <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                    <Input
                      placeholder="https://...image.jpg"
                      value={draftValue}
                      onChange={(event) =>
                        setDraftImages((prev) => ({
                          ...prev,
                          [product.product_code]: event.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      disabled={uploadingCode === product.product_code}
                      onClick={() =>
                        fileInputRefs.current[product.product_code]?.click()
                      }
                      className={cn(
                        "inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800",
                        uploadingCode === product.product_code &&
                          "cursor-not-allowed opacity-60",
                      )}
                    >
                      <Upload className="h-4 w-4" />
                      {uploadingCode === product.product_code
                        ? "Uploading..."
                        : "Upload"}
                    </button>
                    <Button
                      disabled={!isDirty || isSaving}
                      onClick={() => {
                        const imageUrl = draftValue.trim();
                        const bauNum = draftBauValue.trim()
                          ? Number(draftBauValue)
                          : 0;
                        setSavingCode(product.product_code);
                        void Promise.all([
                          updateProductImage(
                            marketplace,
                            product.product_code,
                            imageUrl,
                          ),
                          updateProductBauPrice(
                            marketplace,
                            product.product_code,
                            bauNum,
                          ),
                        ])
                          .then(() => {
                            setMessage(
                              `Saved ${product.product_code}.`,
                            );
                            loadData(marketplace);
                          })
                          .catch((e: unknown) =>
                            setMessage(
                              e instanceof Error
                                ? e.message
                                : "Image update failed.",
                            ),
                          )
                          .finally(() => setSavingCode(null));
                      }}
                    >
                      {isSaving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                  <input
                    ref={(node) => {
                      fileInputRefs.current[product.product_code] = node;
                    }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      if (file.size > 5 * 1024 * 1024) {
                        setMessage(
                          `Image too large. Keep it under 5 MB (${product.product_code}).`,
                        );
                        return;
                      }
                      setUploadingCode(product.product_code);
                      void uploadProductImageFile(
                        marketplace,
                        product.product_code,
                        file,
                      )
                        .then((publicUrl) =>
                          updateProductImage(
                            marketplace,
                            product.product_code,
                            publicUrl,
                          ).then(() => publicUrl),
                        )
                        .then((publicUrl) => {
                          setDraftImages((prev) => ({
                            ...prev,
                            [product.product_code]: publicUrl,
                          }));
                          setMessage(
                            `Uploaded image for ${product.product_code}.`,
                          );
                          loadData(marketplace);
                        })
                        .catch((error: unknown) =>
                          setMessage(
                            error instanceof Error
                              ? error.message
                              : "Image upload failed.",
                          ),
                        )
                        .finally(() => setUploadingCode(null));
                    }}
                  />
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Paste a URL or click Upload to pick an image (PNG / JPG, &lt; 5 MB).
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
