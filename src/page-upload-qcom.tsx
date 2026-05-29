import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { format } from "date-fns";
import { deleteUploadRecord, getUploadHistory } from "./data";
import { ingestQcomMasterUpload, type IngestProgressUpdate } from "./data-qcom";
import { marketplaceLabel } from "./marketplace-labels";
import { useAuth } from "./use-auth";
import {
  isValidIsoDateString,
  parseCoverageDateFromUploadFileName,
  resolveUploadSnapshotDate,
} from "./utils";
import type { QcomMarketplace } from "./types";
import {
  Button,
  Card,
  EmptyState,
  FieldLabel,
  GhostButton,
  Input,
  InlineLoader,
  PageTitle,
  SortableTableHeader,
} from "./ui";
import { useTableSort } from "./table-sort";

interface UploadHistoryRow {
  id: string;
  marketplace: QcomMarketplace;
  file_name: string;
  uploaded_at: string;
  snapshot_date?: string | null;
  status: string;
  valid_row_count: number;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Upload failed.";
}

export function QcomUploadPage() {
  const { user, profile } = useAuth();
  const [sheetCoverageDate, setSheetCoverageDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<IngestProgressUpdate | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<UploadHistoryRow[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadHistory = () => {
    setIsLoadingHistory(true);
    void getUploadHistory("quickcommerce")
      .then((rows) => setHistory(rows as UploadHistoryRow[]))
      .finally(() => setIsLoadingHistory(false));
  };

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    if (!file) {
      setSheetCoverageDate("");
      return;
    }
    const parsed = parseCoverageDateFromUploadFileName(file.name);
    if (parsed) setSheetCoverageDate(parsed);
  }, [file]);

  const uploadSortAccessors = useMemo(
    () =>
      ({
        uploaded_at: (row: UploadHistoryRow) => row.uploaded_at,
        snapshot_date: (row: UploadHistoryRow) => row.snapshot_date ?? "",
        marketplace: (row: UploadHistoryRow) => row.marketplace,
        file_name: (row: UploadHistoryRow) => row.file_name,
        status: (row: UploadHistoryRow) => row.status,
        valid_row_count: (row: UploadHistoryRow) => row.valid_row_count,
      }) satisfies import("./table-sort").TableSortAccessors<UploadHistoryRow>,
    [],
  );

  const { sortedRows, sortKey, sortDirection, requestSort } = useTableSort(
    history,
    uploadSortAccessors,
    "uploaded_at",
    "desc",
  );

  if (profile?.role !== "admin") {
    return (
      <EmptyState
        title="Upload Center restricted"
        description="Only admin users can upload Quick Commerce master sheets."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Quick Commerce Upload Center"
        subtitle="Upload the full master workbook (Zepto, Blinkit, Swiggy/Instamart, BigBasket tabs plus Consolidated for ASIN links), or upload one channel sellout file at a time — e.g. Zepto Sell Out Report …xlsx with only a Consolidated tab. The channel is detected from the file name."
      />

      <Card className="space-y-4">
        <FieldLabel>Master sellout file (.xlsx)</FieldLabel>
        <Input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <FieldLabel>Sheet coverage date (data as on)</FieldLabel>
        <Input
          type="date"
          value={sheetCoverageDate}
          onChange={(e) => setSheetCoverageDate(e.target.value)}
        />
        <Button
          disabled={!file || !user || isUploading}
          onClick={() => {
            if (!file || !user) return;
            const snapshot = resolveUploadSnapshotDate(file.name, sheetCoverageDate);
            if (!isValidIsoDateString(snapshot)) {
              setMessage("Set a valid coverage date or include it in the file name.");
              return;
            }
            setIsUploading(true);
            setMessage(null);
            setUploadProgress({ message: "Starting upload…", percent: 0 });
            void ingestQcomMasterUpload({
              file,
              fileName: file.name,
              uploadedBy: user.id,
              snapshotDate: snapshot,
              onProgress: setUploadProgress,
            })
              .then(({ bundles }) =>
                setMessage(
                  `Uploaded ${bundles.length} channel(s): ${bundles.map((b) => marketplaceLabel(b.marketplace)).join(", ")}.`,
                ),
              )
              .catch((e: unknown) => setMessage(getErrorMessage(e)))
              .finally(() => {
                setIsUploading(false);
                setUploadProgress(null);
                loadHistory();
              });
          }}
        >
          {isUploading ? "Uploading…" : "Upload sellout file"}
        </Button>
        {isUploading && uploadProgress ? (
          <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/80 px-4 py-3">
            <div className="flex items-center justify-between gap-2 text-sm font-medium text-violet-950">
              <span>{uploadProgress.message}</span>
              {uploadProgress.percent != null ? (
                <span className="tabular-nums">{uploadProgress.percent}%</span>
              ) : null}
            </div>
            {uploadProgress.percent != null ? (
              <div className="h-2 overflow-hidden rounded-full bg-violet-100">
                <div
                  className="h-full rounded-full bg-violet-600 transition-all duration-300"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
            ) : null}
            <p className="text-xs text-violet-800/90">
              Large channel files (e.g. BigBasket) may pause on &quot;Reading workbook&quot; for up to
              a minute, then show daily row counts while saving. Only the latest day and YoY MTD
              days are stored — not every historical column.
            </p>
          </div>
        ) : null}
        {message ? (
          <p className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">{message}</p>
        ) : null}
      </Card>

      <Card className="overflow-auto">
        <h3 className="mb-4 text-lg font-bold">Upload history</h3>
        {isLoadingHistory ? (
          <InlineLoader />
        ) : sortedRows.length === 0 ? (
          <EmptyState title="No uploads yet" description="Upload your Quick Commerce master sheet." />
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase text-zinc-500">
                <SortableTableHeader label="When" sortKey="uploaded_at" activeKey={sortKey} activeDirection={sortDirection} onSort={requestSort} />
                <SortableTableHeader label="As on" sortKey="snapshot_date" activeKey={sortKey} activeDirection={sortDirection} onSort={requestSort} />
                <SortableTableHeader label="Channel" sortKey="marketplace" activeKey={sortKey} activeDirection={sortDirection} onSort={requestSort} />
                <SortableTableHeader label="File" sortKey="file_name" activeKey={sortKey} activeDirection={sortDirection} onSort={requestSort} />
                <SortableTableHeader label="Rows" sortKey="valid_row_count" activeKey={sortKey} activeDirection={sortDirection} onSort={requestSort} />
                <th />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id} className="border-t border-zinc-100">
                  <td className="py-2">{format(new Date(row.uploaded_at), "d MMM yyyy HH:mm")}</td>
                  <td className="py-2">{row.snapshot_date ?? "—"}</td>
                  <td className="py-2">{marketplaceLabel(row.marketplace)}</td>
                  <td className="py-2">{row.file_name}</td>
                  <td className="py-2">{row.valid_row_count}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      className="text-red-600"
                      disabled={deletingId === row.id}
                      onClick={() => {
                        setDeletingId(row.id);
                        void deleteUploadRecord(row.id)
                          .then(loadHistory)
                          .finally(() => setDeletingId(null));
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <p className="text-sm text-zinc-500">
        After upload, open a channel dashboard from the sidebar. Apply DB migration{" "}
        <code className="rounded bg-zinc-100 px-1">012_qcom_marketplaces.sql</code> in Supabase if
        upload fails on marketplace enum.
      </p>
    </div>
  );
}
