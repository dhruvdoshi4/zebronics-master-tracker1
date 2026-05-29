import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import {
  deleteUploadRecord,
  getUploadHistory,
  ingestAdminConsolidatedAmazonSelloutUpload,
  ingestDawgCombinedSelloutUpload,
  ingestParsedUpload,
  retainLatestUploadsOnly,
} from "./data";
import {
  ADMIN_CONSOLIDATED_AMAZON_UPLOAD_VALUE,
  formatAdminConsolidatedIngestSummary,
} from "./admin-consolidated-sellout";
import {
  ADMIN_MANAGER_OPTIONS,
} from "./admin-realm";
import { useAdminRealm } from "./admin-realm-context";
import {
  CATALOG_WORKSPACE_PRAVIN,
  catalogWorkspaceManagerName,
  type CatalogWorkspace,
  uploadHistoryScopeFromWorkspace,
} from "./catalog-workspace";
import { useCatalogScope } from "./catalog-scope-context";
import { isDawgDataScope } from "./data-scope";
import { useAuth } from "./use-auth";
import { useDataScope } from "./use-data-scope";
import { parseUploadFile } from "./parsers";
import { parseBauPriceFile, parseGmsPlanFile } from "./parsers-gms";
import { ingestHoStockUpload } from "./data-ho-stock";
import { ingestRatingsRankingUpload } from "./data-ratings";
import { ingestBauUpload, ingestGmsPlanUpload } from "./data-gms";
import { parseRatingsRankingFile } from "./parsers-ratings";
import { parseHoStockFile } from "./parsers-ho-stock";
import type { UploadKind } from "./types";
import {
  isValidIsoDateString,
  parseCoverageDateFromUploadFileName,
  resolveUploadSnapshotDate,
} from "./utils";
import type { Marketplace } from "./types";
import { marketplaceLabel } from "./marketplace-labels";
import {
  Button,
  Card,
  DataAsOnDualChannelBadge,
  EmptyState,
  FieldLabel,
  GhostButton,
  Input,
  InlineLoader,
  PageTitle,
  Select,
  SortableTableHeader,
} from "./ui";
import { useTableSort } from "./table-sort";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

interface UploadHistoryRow {
  id: string;
  marketplace: Marketplace;
  upload_kind?: UploadKind;
  file_name: string;
  uploaded_at: string;
  snapshot_date?: string | null;
  status: string;
  raw_row_count: number;
  valid_row_count: number;
  rejected_row_count: number;
  notes: string | null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Upload failed.";
}

export function UploadPage() {
  const { user, profile } = useAuth();
  const dataScope = useDataScope();
  const isDawgScope = isDawgDataScope(dataScope);
  const { isMarketplaceGlobal } = useAdminRealm();
  const { uploadHistoryScope: scopeFromContext, workspace } = useCatalogScope();
  const [uploadForWorkspace, setUploadForWorkspace] = useState<
    CatalogWorkspace | typeof ADMIN_CONSOLIDATED_AMAZON_UPLOAD_VALUE | ""
  >("");
  const [uploadKind, setUploadKind] = useState<UploadKind>("sellout");
  const isConsolidatedAmazonUpload =
    isMarketplaceGlobal &&
    uploadForWorkspace === ADMIN_CONSOLIDATED_AMAZON_UPLOAD_VALUE &&
    uploadKind === "sellout";
  const ingestWorkspace =
    isMarketplaceGlobal &&
    uploadForWorkspace &&
    uploadForWorkspace !== ADMIN_CONSOLIDATED_AMAZON_UPLOAD_VALUE
      ? uploadForWorkspace
      : workspace;
  const uploadHistoryScope =
    isMarketplaceGlobal &&
    uploadForWorkspace &&
    uploadForWorkspace !== ADMIN_CONSOLIDATED_AMAZON_UPLOAD_VALUE
      ? uploadHistoryScopeFromWorkspace(uploadForWorkspace)
      : scopeFromContext;
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();
  const [marketplace, setMarketplace] = useState<Marketplace>("amazon");

  useEffect(() => {
    if (isConsolidatedAmazonUpload) {
      setMarketplace("amazon");
    }
  }, [isConsolidatedAmazonUpload]);
  /** Calendar day the sheet represents (inventory/SO “as on”) — not the day you upload. */
  const [sheetCoverageDate, setSheetCoverageDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<UploadHistoryRow[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isTrimmingHistory, setIsTrimmingHistory] = useState(false);

  const clearFile = () => {
    setFile(null);
    setFileInputKey((k) => k + 1);
  };

  const loadHistory = () => {
    setIsLoadingHistory(true);
    void getUploadHistory(uploadHistoryScope)
      .then((rows) => setHistory(rows as UploadHistoryRow[]))
      .finally(() => setIsLoadingHistory(false));
  };

  useEffect(() => {
    loadHistory();
  }, [uploadHistoryScope]);

  /** Whenever a file is chosen, sheet coverage is filled from its name when we can parse it (same logic as ingest). */
  useEffect(() => {
    if (!file) {
      setSheetCoverageDate("");
      return;
    }
    const parsed = parseCoverageDateFromUploadFileName(file.name);
    if (parsed) setSheetCoverageDate(parsed);
  }, [file]);

  const parsedFromFileName = useMemo(
    () => (file ? parseCoverageDateFromUploadFileName(file.name) : null),
    [file],
  );
  const coverageFilledFromFileName = Boolean(
    parsedFromFileName &&
      sheetCoverageDate &&
      parsedFromFileName === sheetCoverageDate,
  );

  const uploadSortAccessors = useMemo(
    () =>
      ({
        uploaded_at: (row: UploadHistoryRow) => row.uploaded_at,
        snapshot_date: (row: UploadHistoryRow) => row.snapshot_date ?? "",
        marketplace: (row: UploadHistoryRow) => row.marketplace,
        upload_kind: (row: UploadHistoryRow) => row.upload_kind ?? "sellout",
        file_name: (row: UploadHistoryRow) => row.file_name,
        status: (row: UploadHistoryRow) => row.status,
        raw_row_count: (row: UploadHistoryRow) => row.raw_row_count,
        valid_row_count: (row: UploadHistoryRow) => row.valid_row_count,
        rejected_row_count: (row: UploadHistoryRow) => row.rejected_row_count,
        actions: (row: UploadHistoryRow) => row.uploaded_at,
      }) satisfies import("./table-sort").TableSortAccessors<UploadHistoryRow>,
    [],
  );

  const { sortedRows: sortedHistory, sortKey, sortDirection, requestSort } = useTableSort(
    history,
    uploadSortAccessors,
    "uploaded_at",
    "desc",
  );

  if (profile?.role !== "admin") {
    return (
      <EmptyState
        title="Upload Center restricted"
        description="Only admin users can upload marketplace sheets."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Upload Center"
            subtitle="Each new upload replaces the previous file of the same type (latest Amazon, Flipkart, BAU, GMS plan, HO stock only)."
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
        {isMarketplaceGlobal ? (
          <div className="rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-3 text-sm text-violet-950 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
            <p className="font-semibold">Admin upload</p>
            <p className="mt-1 text-violet-900/90 dark:text-violet-200/90">
              Choose a manager, or use <strong>Consolidated Amazon master</strong> to split one
              company Ecom Sellout file across Hari, Karan, Rithika, Pravin, and Rishabh. HO stock
              is shared for all managers. daWg is not available in this mode.
            </p>
          </div>
        ) : null}
        <div
          className={
            uploadKind === "sellout" ||
            uploadKind === "ho_stock" ||
            uploadKind === "ratings_ranking"
              ? "grid gap-3 md:grid-cols-2"
              : "space-y-3"
          }
        >
          {isMarketplaceGlobal && uploadKind !== "ho_stock" ? (
            <div>
              <FieldLabel>Upload for (manager)</FieldLabel>
              <Select
                value={uploadForWorkspace}
                onChange={(event) =>
                  setUploadForWorkspace(
                    event.target.value as
                      | CatalogWorkspace
                      | typeof ADMIN_CONSOLIDATED_AMAZON_UPLOAD_VALUE,
                  )
                }
              >
                <option value="">Select manager…</option>
                {uploadKind === "sellout" ? (
                  <option value={ADMIN_CONSOLIDATED_AMAZON_UPLOAD_VALUE}>
                    Consolidated Amazon master (all managers)
                  </option>
                ) : null}
                {ADMIN_MANAGER_OPTIONS.map((option) => (
                  <option key={option.workspace} value={option.workspace}>
                    {option.managerName} — {option.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div>
            <FieldLabel>Upload type</FieldLabel>
            <Select
              value={uploadKind}
              onChange={(event) => setUploadKind(event.target.value as UploadKind)}
            >
              <option value="sellout">Sellout master (per channel)</option>
              <option value="bau">BAU price sheet (Amazon + Flipkart)</option>
              <option value="gms_plan">GMS plan sheet (Amazon + Flipkart)</option>
              <option value="ho_stock">HO stock report (consolidated)</option>
              <option value="ratings_ranking">Ratings &amp; ranking (Amazon + Flipkart)</option>
            </Select>
          </div>
          {uploadKind === "sellout" ? (
            isDawgScope ? (
              <p className="rounded-xl border border-violet-200 bg-violet-50/80 px-3 py-2 text-sm text-violet-950 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
                Combined workbook — <strong>Amazon</strong> and <strong>Flipkart</strong> tabs
                (categories <strong>Gaming - daWg</strong> and <strong>Personal Audio</strong>). One
                upload updates both channels.
              </p>
            ) : isConsolidatedAmazonUpload ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
                Sheet <strong>Ecom Sellout</strong> — rows are routed by Category, Sub Category,
                and <strong>KAM</strong> into each manager&apos;s Amazon dashboard (same rules as
                individual uploads).
              </p>
            ) : (
              <div>
                <FieldLabel>Marketplace</FieldLabel>
                <Select
                  value={marketplace}
                  onChange={(event) => setMarketplace(event.target.value as Marketplace)}
                >
                  <option value="amazon">Amazon</option>
                  <option value="flipkart">Flipkart</option>
                </Select>
              </div>
            )
          ) : uploadKind === "ratings_ranking" ? (
            <p className="rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 py-2 text-sm text-indigo-950">
              Combined workbook — sheets <strong>AZ_Rating&amp;Ranking</strong> (Amazon) and{" "}
              <strong>FSN_Ranking&amp;Rating</strong> (Flipkart). First-time: run{" "}
              <code className="rounded bg-white/80 px-1">supabase/run-ratings-ranking.sql</code> in
              Supabase SQL Editor.
            </p>
          ) : uploadKind === "ho_stock" ? (
            <p className="rounded-xl border border-sky-200 bg-sky-50/80 px-3 py-2 text-sm text-sky-950">
              Consolidated workbook — sheet <strong>Consolidated HO Stock Report</strong> (ASIN, FSN, HO,
              Gurgaon, Total). First-time: run{" "}
              <code className="rounded bg-white/80 px-1">supabase/run-ho-stock.sql</code> in Supabase SQL
              Editor.
            </p>
          ) : (
            <p className="rounded-xl border border-violet-200 bg-violet-50/80 px-3 py-2 text-sm text-violet-950">
              One file with <strong>Amazon</strong> and <strong>Flipkart</strong> tabs (ASIN / FSN +{" "}
              <strong>BAU SP</strong>). First-time setup: run{" "}
              <code className="rounded bg-white/80 px-1">supabase/run-gms-tracker.sql</code> in Supabase
              SQL Editor. Large workbooks parse in a few seconds — do not close the tab.
            </p>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div
            className={
              uploadKind === "sellout" ||
              uploadKind === "ho_stock" ||
              uploadKind === "ratings_ranking"
                ? ""
                : "md:col-span-2"
            }
          >
            <FieldLabel>Sheet file</FieldLabel>
            <Input
              key={fileInputKey}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
              }}
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {uploadKind === "sellout" ||
              uploadKind === "ho_stock" ||
              uploadKind === "ratings_ranking"
                ? "File name with a date auto-fills report date (e.g. as on 19th May 2026)."
                : uploadKind === "bau"
                  ? "Tabs: Amazon (ASIN + BAU SP) and Flipkart (FSN + BAU SP). Same BAU per model on both channels."
                  : "Model + ASIN + FSN + GMS columns (combined sheet) or month columns (May-26) / Planned GMS."}
            </p>
          </div>
          {uploadKind === "sellout" ||
          uploadKind === "ho_stock" ||
          uploadKind === "ratings_ranking" ? (
          <div className="md:col-span-2">
            <FieldLabel>Report date</FieldLabel>
            <Input
              type="date"
              value={sheetCoverageDate}
              onChange={(event) => setSheetCoverageDate(event.target.value)}
            />
            {coverageFilledFromFileName ? (
              <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">From file name</p>
            ) : (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Data-through date if not in file name</p>
            )}
          </div>
          ) : null}
        </div>

        <Button
          disabled={
            isUploading ||
            !file ||
            !user ||
            (isMarketplaceGlobal && uploadKind !== "ho_stock" && !uploadForWorkspace) ||
            (isConsolidatedAmazonUpload && marketplace !== "amazon") ||
            ((uploadKind === "sellout" ||
              uploadKind === "ho_stock" ||
              uploadKind === "ratings_ranking") &&
              !isValidIsoDateString(
                resolveUploadSnapshotDate(file?.name ?? "", sheetCoverageDate),
              ))
          }
          onClick={() => {
            if (!file || !user) return;
            setIsUploading(true);
            setMessage(
              uploadKind === "bau"
                ? "Parsing BAU workbook (Amazon + Flipkart tabs)…"
                : uploadKind === "gms_plan"
                  ? "Parsing GMS plan workbook…"
                  : uploadKind === "ho_stock"
                    ? "Parsing consolidated HO stock sheet…"
                    : uploadKind === "ratings_ranking"
                      ? "Parsing ratings & ranking workbook…"
                      : "Reading your sheet...",
            );

            if (uploadKind === "ratings_ranking") {
              const resolved = resolveUploadSnapshotDate(file.name, sheetCoverageDate);
              if (!isValidIsoDateString(resolved)) {
                setMessage("Set report date or include a date in the file name.");
                setIsUploading(false);
                return;
              }
              void parseRatingsRankingFile(file)
                .then(async (payload) => {
                  if (payload.errors.length) {
                    throw new Error(payload.errors.join(" "));
                  }
                  const countNote =
                    payload.amazonWithReviewCounts > 0
                      ? ` · ${payload.amazonWithReviewCounts} Amazon rows with review counts`
                      : " · warning: no Amazon review counts detected — check sheet headers";
                  setMessage(
                    `Parsed Amazon ${payload.amazonCount} · Flipkart ${payload.flipkartCount}${countNote} — saving…`,
                  );
                  await ingestRatingsRankingUpload({
                    payload,
                    fileName: file.name,
                    uploadedBy: user.id,
                    snapshotDate: resolved,
                    catalogWorkspace: isMarketplaceGlobal
                      ? ingestWorkspace
                      : undefined,
                  });
                  const note =
                    payload.amazonWithReviewCounts > 0
                      ? ` Amazon review counts on ${payload.amazonWithReviewCounts} SKUs.`
                      : " Re-upload if review counts still show blank.";
                  setMessage(
                    `Ratings & ranking saved.${note} Older ratings files were removed.`,
                  );
                  clearFile();
                  loadHistory();
                })
                .catch((e: unknown) =>
                  setMessage(`Upload failed: ${getErrorMessage(e)}`),
                )
                .finally(() => setIsUploading(false));
              return;
            }

            if (uploadKind === "ho_stock") {
              const resolved = resolveUploadSnapshotDate(file.name, sheetCoverageDate);
              if (!isValidIsoDateString(resolved)) {
                setMessage("Set report date or include a date in the file name.");
                setIsUploading(false);
                return;
              }
              void parseHoStockFile(file)
                .then((payload) => {
                  setMessage(`Parsed ${payload.rows.length} SKUs — saving HO stock…`);
                  return ingestHoStockUpload({
                    payload,
                    fileName: file.name,
                    uploadedBy: user.id,
                    snapshotDate: resolved,
                  });
                })
                .then(() => {
                  setMessage("HO stock report uploaded. Older HO stock files were removed.");
                  clearFile();
                  loadHistory();
                })
                .catch((e: unknown) =>
                  setMessage(`Upload failed: ${getErrorMessage(e)}`),
                )
                .finally(() => setIsUploading(false));
              return;
            }

            if (uploadKind === "sellout") {
              const resolved = resolveUploadSnapshotDate(file.name, sheetCoverageDate);
              if (!isValidIsoDateString(resolved)) {
                setMessage("Set report date or include a date in the file name.");
                setIsUploading(false);
                return;
              }
              if (isConsolidatedAmazonUpload) {
                void ingestAdminConsolidatedAmazonSelloutUpload({
                  file,
                  fileName: file.name,
                  uploadedBy: user.id,
                  snapshotDate: resolved,
                  onProgress: (update) => setMessage(update.message),
                })
                  .then((summary) => {
                    setMessage(
                      `Consolidated Amazon sellout saved — ${formatAdminConsolidatedIngestSummary(summary)}.`,
                    );
                    clearFile();
                    loadHistory();
                  })
                  .catch((e: unknown) =>
                    setMessage(`Upload failed: ${getErrorMessage(e)}`),
                  )
                  .finally(() => setIsUploading(false));
                return;
              }
              if (isDawgScope) {
                void ingestDawgCombinedSelloutUpload({
                  file,
                  fileName: file.name,
                  uploadedBy: user.id,
                  snapshotDate: resolved,
                  onProgress: (update) => setMessage(update.message),
                })
                  .then(({ amazonValid, flipkartValid }) => {
                    setMessage(
                      `Sellout saved — Amazon ${amazonValid} SKU${amazonValid === 1 ? "" : "s"}, Flipkart ${flipkartValid} SKU${flipkartValid === 1 ? "" : "s"}. Refresh HO Stock.`,
                    );
                    clearFile();
                    loadHistory();
                  })
                  .catch((e: unknown) =>
                    setMessage(`Upload failed: ${getErrorMessage(e)}`),
                  )
                  .finally(() => setIsUploading(false));
                return;
              }
              const isPravinScope = ingestWorkspace === CATALOG_WORKSPACE_PRAVIN;
              void parseUploadFile(file, marketplace, resolved, {
                catalogWorkspace: ingestWorkspace,
                ...(isPravinScope ? { pravinWorkbook: true as const } : {}),
                onProgress: (update) => setMessage(update.message),
              })
                .then((payload) => {
                  const cart = payload.cartridgeRowCount ?? 0;
                  const valid = payload.validCount;
                  const skuCount = payload.products.length;
                  const metricCount = payload.metricInputs.length;
                  if (skuCount === 0) {
                    throw new Error(
                      isDawgScope
                        ? 'No daWg SKUs found. Select the correct marketplace (Amazon or Flipkart) and use the matching tab in your daWg Sellout workbook.'
                        : "No tracked rows found in this sheet.",
                    );
                  }
                  if (metricCount === 0) {
                    throw new Error(
                      "Sheet rows were read but no sellout KPIs were parsed. Check that the file matches the ROMA & PowerBank template (Cocoblu_SO / Click_tect_SO / Flipkart tabs) and try again.",
                    );
                  }
                  setMessage(
                    isDawgScope
                      ? `Found ${valid} daWg SKU${valid === 1 ? "" : "s"}. Saving…`
                      : isMarketplaceGlobal
                        ? `Found ${valid} rows for ${catalogWorkspaceManagerName(ingestWorkspace)}. Saving…`
                        : workspace === "personal_audio"
                        ? `Found ${valid} Karan-scope rows. Saving...`
                        : isPravinScope
                          ? marketplace === "amazon"
                            ? `Found ${skuCount} Amazon SKU${skuCount === 1 ? "" : "s"} with ${metricCount} KPI rows (Cocoblu_SO + Click_tect_SO). Saving…`
                            : `Found ${skuCount} Flipkart SKU${skuCount === 1 ? "" : "s"} with ${metricCount} KPI rows. Saving…`
                          : cart > 0
                          ? `Found ${valid} tracked rows (${cart} Cartridge). Saving...`
                          : `Found ${valid} tracked rows (no Cartridge rows — check Ecom Sellout Category column). Saving...`,
                  );
                  return ingestParsedUpload({
                    payload,
                    marketplace,
                    fileName: file.name,
                    uploadedBy: user.id,
                    snapshotDate: resolved,
                    catalogWorkspace: ingestWorkspace,
                    dataScope: "default",
                  }).then(() => ({ cart, valid, skuCount }));
                })
                .then(({ valid, skuCount }) => {
                  const count = isPravinScope ? skuCount : valid;
                  setMessage(
                    isMarketplaceGlobal
                      ? `Sellout saved for ${catalogWorkspaceManagerName(ingestWorkspace)} (${count} SKU${count === 1 ? "" : "s"}). They will see it on their next refresh.`
                      : isDawgScope
                      ? `Sellout upload completed (${count} SKU${count === 1 ? "" : "s"}). Refresh the ${marketplace === "amazon" ? "Amazon" : "Flipkart"} dashboard.`
                      : workspace === "personal_audio"
                        ? `Sellout upload completed (${count} SKUs). Refresh the ${marketplace === "amazon" ? "Amazon" : "Flipkart"} dashboard.`
                        : isPravinScope
                          ? `Sellout upload completed (${skuCount} unique ROMA / PowerBank SKU${skuCount === 1 ? "" : "s"} from ${valid} sheet rows). Refresh the ${marketplace === "amazon" ? "Amazon" : "Flipkart"} dashboard.`
                          : `Sellout upload completed (${count} SKUs). Refresh the ${marketplace === "amazon" ? "Amazon" : "Flipkart"} dashboard.`,
                  );
                  clearFile();
                  loadHistory();
                })
                .catch((e: unknown) =>
                  setMessage(`Upload failed: ${getErrorMessage(e)}`),
                )
                .finally(() => setIsUploading(false));
              return;
            }

            if (uploadKind === "bau") {
              void parseBauPriceFile(file)
                .then((payload) => {
                  setMessage(
                    `Parsed ${payload.rows.length} rows — saving to database (Amazon + Flipkart)…`,
                  );
                  return ingestBauUpload({
                    payload,
                    fileName: file.name,
                    uploadedBy: user.id,
                  });
                })
                .then(() => {
                  setMessage("BAU price sheet uploaded. Older BAU files were removed.");
                  clearFile();
                  loadHistory();
                })
                .catch((e: unknown) =>
                  setMessage(`Upload failed: ${getErrorMessage(e)}`),
                )
                .finally(() => setIsUploading(false));
              return;
            }

            if (uploadKind === "gms_plan") {
              void parseGmsPlanFile(file)
                .then((payload) => {
                  setMessage(`Saving ${payload.rows.length} GMS plan rows (both channels)…`);
                  return ingestGmsPlanUpload({
                    payload,
                    fileName: file.name,
                    uploadedBy: user.id,
                  });
                })
                .then(() => {
                  setMessage("GMS plan sheet uploaded. Older GMS plan files were removed.");
                  clearFile();
                  loadHistory();
                })
                .catch((e: unknown) =>
                  setMessage(`Upload failed: ${getErrorMessage(e)}`),
                )
                .finally(() => setIsUploading(false));
            }
          }}
        >
          {isUploading
            ? "Uploading..."
            : uploadKind === "sellout"
              ? "Upload sellout sheet"
              : uploadKind === "bau"
                ? "Upload BAU sheet"
                : uploadKind === "ho_stock"
                  ? "Upload HO stock report"
                  : uploadKind === "ratings_ranking"
                    ? "Upload ratings & ranking"
                    : "Upload GMS plan"}
        </Button>

        {message ? (
          <p className="rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            {message}
          </p>
        ) : null}
      </Card>

      <Card>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Upload history
            </h3>
          </div>
          <GhostButton
            type="button"
            disabled={isTrimmingHistory || isUploading}
            className="shrink-0"
            onClick={() => {
              const ok = window.confirm(
                [
                  "Remove all older uploads and keep only the newest file per type?",
                  "",
                  "Amazon sellout, Flipkart sellout, BAU, GMS plan, HO stock, and Ratings — one latest each.",
                ].join("\n"),
              );
              if (!ok) return;
              setIsTrimmingHistory(true);
              setMessage(null);
              void retainLatestUploadsOnly()
                .then((removed) => {
                  setMessage(
                    removed > 0
                      ? `Trimmed ${removed} older upload(s). Only the latest file per type remains.`
                      : "Already trimmed — only the latest file per type is stored.",
                  );
                  loadHistory();
                })
                .catch((e: unknown) =>
                  setMessage(`Trim failed: ${getErrorMessage(e)}`),
                )
                .finally(() => setIsTrimmingHistory(false));
            }}
          >
            {isTrimmingHistory ? "Trimming…" : "Trim to latest only"}
          </GhostButton>
        </div>
        {isLoadingHistory ? (
          <InlineLoader text="Loading history..." />
        ) : history.length === 0 ? (
          <p className="text-sm text-zinc-500">No uploads yet.</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500">
                  <SortableTableHeader
                    label="Uploaded"
                    sortKey="uploaded_at"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    className="px-2 py-2"
                  />
                  <SortableTableHeader
                    label="Sheet date"
                    sortKey="snapshot_date"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    className="px-2 py-2"
                  />
                  <SortableTableHeader
                    label="Channel"
                    sortKey="marketplace"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    className="px-2 py-2"
                  />
                  <SortableTableHeader
                    label="Type"
                    sortKey="upload_kind"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    className="px-2 py-2"
                  />
                  <SortableTableHeader
                    label="File"
                    sortKey="file_name"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    className="px-2 py-2"
                  />
                  <SortableTableHeader
                    label="Status"
                    sortKey="status"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    className="px-2 py-2"
                  />
                  <SortableTableHeader
                    label="Total Rows"
                    sortKey="raw_row_count"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    className="px-2 py-2"
                  />
                  <SortableTableHeader
                    label="Tracked"
                    sortKey="valid_row_count"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    className="px-2 py-2"
                  />
                  <SortableTableHeader
                    label="Skipped"
                    sortKey="rejected_row_count"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    className="px-2 py-2"
                  />
                  <SortableTableHeader
                    label="Actions"
                    sortKey="actions"
                    activeKey={sortKey}
                    activeDirection={sortDirection}
                    onSort={requestSort}
                    align="right"
                    className="px-2 py-2"
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {sortedHistory.map((row) => (
                  <tr key={row.id}>
                    <td className="px-2 py-2">
                      {format(new Date(row.uploaded_at), "dd MMM yyyy, hh:mm a")}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap font-mono text-xs">
                      {row.snapshot_date
                        ? format(
                            new Date(`${row.snapshot_date}T12:00:00`),
                            "dd MMM yyyy",
                          )
                        : "—"}
                    </td>
                    <td className="px-2 py-2">
                      {row.marketplace === "amazon" || row.marketplace === "flipkart"
                        ? marketplaceLabel(row.marketplace)
                        : row.marketplace}
                    </td>
                    <td className="px-2 py-2 capitalize">
                      {(row.upload_kind ?? "sellout").replace("_", " ")}
                    </td>
                    <td className="px-2 py-2">{row.file_name}</td>
                    <td className="px-2 py-2 capitalize">{row.status}</td>
                    <td className="px-2 py-2">{row.raw_row_count}</td>
                    <td className="px-2 py-2">{row.valid_row_count}</td>
                    <td className="px-2 py-2">{row.rejected_row_count}</td>
                    <td className="px-2 py-2 text-right">
                      <GhostButton
                        type="button"
                        disabled={deletingId === row.id}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                        aria-label={`Remove upload ${row.file_name}`}
                        onClick={() => {
                          const sheetDateStr =
                            row.snapshot_date ??
                            format(new Date(row.uploaded_at), "yyyy-MM-dd");
                          const sheetLabel = format(
                            new Date(`${sheetDateStr}T12:00:00`),
                            "d MMMM yyyy",
                          );
                          const channelLabel =
                            row.marketplace === "amazon" ? "Amazon" : "Flipkart";
                          const ok = window.confirm(
                            [
                              `Remove the numbers from this upload?`,
                              ``,
                              `${channelLabel} — sheet date ${sheetLabel}`,
                              ``,
                              `Your dashboards will update. Pictures and names you added for products stay.`,
                              ``,
                              `Tip: If you uploaded twice for the same sheet date, deleting may clear numbers from both.`,
                            ].join("\n"),
                          );
                          if (!ok) return;
                          setDeletingId(row.id);
                          void deleteUploadRecord(row.id)
                            .then(() => {
                              setMessage("That upload and its numbers were removed.");
                              loadHistory();
                            })
                            .catch((e: unknown) =>
                              setMessage(
                                `Delete failed: ${getErrorMessage(e)}`,
                              ),
                            )
                            .finally(() => setDeletingId(null));
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingId === row.id ? "…" : "Delete"}
                      </GhostButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

