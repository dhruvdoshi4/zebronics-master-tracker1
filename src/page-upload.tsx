import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import { deleteUploadRecord, ingestParsedUpload, getUploadHistory } from "./data";
import { useAuth } from "./use-auth";
import { parseUploadFile } from "./parsers";
import type { Marketplace } from "./types";
import {
  Button,
  Card,
  EmptyState,
  GhostButton,
  Input,
  InlineLoader,
  PageTitle,
  Select,
} from "./ui";

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
  const [marketplace, setMarketplace] = useState<Marketplace>("amazon");
  const [snapshotDate, setSnapshotDate] = useState(format(new Date(), "yyyy-MM-dd"));
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
      <PageTitle
        title="Upload Center"
        subtitle="Drop your daily Amazon or Flipkart sheet here to refresh the dashboards."
      />

      <Card className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="mb-1 text-xs text-zinc-500">Marketplace</p>
            <Select
              value={marketplace}
              onChange={(event) => setMarketplace(event.target.value as Marketplace)}
            >
              <option value="amazon">Amazon</option>
              <option value="flipkart">Flipkart</option>
            </Select>
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-500">Snapshot Date</p>
            <Input
              type="date"
              value={snapshotDate}
              onChange={(event) => setSnapshotDate(event.target.value)}
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-500">Sheet File</p>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setFile(nextFile);
              }}
            />
          </div>
        </div>

        <Button
          disabled={isUploading || !file || !user}
          onClick={() => {
            if (!file || !user) return;
            setIsUploading(true);
            setMessage("Reading your sheet...");

            void parseUploadFile(file, marketplace, snapshotDate)
              .then((payload) => {
                setMessage(
                  `Found ${payload.validCount} monitor and projector rows. Saving...`,
                );
                return ingestParsedUpload({
                  payload,
                  marketplace,
                  fileName: file.name,
                  uploadedBy: user.id,
                  snapshotDate,
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
            <strong className="font-semibold text-zinc-700 dark:text-zinc-300">
              Delete removes data from the database:
            </strong>{" "}
            all dashboard metrics for that marketplace and snapshot date are deleted,
            then this upload row. Product Master (names and images) is kept.
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
                  <th className="px-2 py-2">Snapshot</th>
                  <th className="px-2 py-2">Marketplace</th>
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
                        aria-label={`Delete upload ${row.file_name}`}
                        onClick={() => {
                          const snap =
                            row.snapshot_date ??
                            format(new Date(row.uploaded_at), "yyyy-MM-dd");
                          const ok = window.confirm(
                            `Remove all saved metrics for ${row.marketplace} on ${snap}? This deletes dashboard numbers for that snapshot date (and this history row). Product catalog is kept. If you uploaded twice for the same snapshot date, metrics for that whole day on this marketplace are removed.`,
                          );
                          if (!ok) return;
                          setDeletingId(row.id);
                          void deleteUploadRecord(row.id)
                            .then(() => {
                              setMessage("Upload and its metrics for that date were removed.");
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

