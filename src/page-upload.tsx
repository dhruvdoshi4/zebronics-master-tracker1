import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import { deleteUploadRecord, ingestParsedUpload, getUploadHistory } from "./data";
import { useAuth } from "./use-auth";
import { parseUploadFile } from "./parsers";
import {
  isValidIsoDateString,
  parseCoverageDateFromUploadFileName,
  resolveUploadSnapshotDate,
} from "./utils";
import type { Marketplace } from "./types";
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
} from "./ui";
import { useLatestUploadSheetCoverageByMarketplace } from "./use-sheet-coverage";

interface UploadHistoryRow {
  id: string;
  marketplace: Marketplace;
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
  const channelCoverage = useLatestUploadSheetCoverageByMarketplace();
  const [marketplace, setMarketplace] = useState<Marketplace>("amazon");
  /** Calendar day the sheet represents (inventory/SO “as on”) — not the day you upload. */
  const [sheetCoverageDate, setSheetCoverageDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<UploadHistoryRow[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadHistory = () => {
    setIsLoadingHistory(true);
    void getUploadHistory()
      .then((rows) => setHistory(rows as UploadHistoryRow[]))
      .finally(() => setIsLoadingHistory(false));
  };

  useEffect(() => {
    loadHistory();
  }, []);

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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <PageTitle
            title="Upload Center"
            subtitle="Upload Amazon or Flipkart sheets to refresh dashboards and insights."
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
        <div className="grid gap-3 md:grid-cols-3">
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
          <div>
            <FieldLabel>Sheet file</FieldLabel>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
              }}
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">File name with a date auto-fills report date.</p>
          </div>
          <div>
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
        </div>

        <Button
          disabled={
            isUploading ||
            !file ||
            !user ||
            !isValidIsoDateString(
              resolveUploadSnapshotDate(file.name, sheetCoverageDate),
            )
          }
          onClick={() => {
            if (!file || !user) return;
            const resolved = resolveUploadSnapshotDate(file.name, sheetCoverageDate);
            if (!isValidIsoDateString(resolved)) {
              setMessage("Set report date or include a date in the file name.");
              return;
            }
            setIsUploading(true);
            setMessage("Reading your sheet...");

            const snapshotForIngest = resolved;
            void parseUploadFile(file, marketplace, resolved)
              .then((payload) => {
                setMessage(
                  `Found ${payload.validCount} tracked category rows. Saving...`,
                );
                return ingestParsedUpload({
                  payload,
                  marketplace,
                  fileName: file.name,
                  uploadedBy: user.id,
                  snapshotDate: snapshotForIngest,
                });
              })
              .then(() => {
                setMessage("Upload completed successfully.");
                setFile(null);
                loadHistory();
              })
              .catch((e: unknown) =>
                setMessage(`Upload failed: ${getErrorMessage(e)}`),
              )
              .finally(() => setIsUploading(false));
          }}
        >
          {isUploading ? "Uploading..." : "Upload Sheet"}
        </Button>

        {message ? (
          <p className="rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            {message}
          </p>
        ) : null}
      </Card>

      <Card>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Recent Upload History
          </h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Removing an upload rolls back its metrics. Product records stay.
          </p>
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
                  <th className="px-2 py-2">Uploaded</th>
                  <th className="px-2 py-2">Sheet date</th>
                  <th className="px-2 py-2">Channel</th>
                  <th className="px-2 py-2">File</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Total Rows</th>
                  <th className="px-2 py-2">Tracked</th>
                  <th className="px-2 py-2">Skipped</th>
                  <th className="px-2 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {history.map((row) => (
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
                    <td className="px-2 py-2 capitalize">{row.marketplace}</td>
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

