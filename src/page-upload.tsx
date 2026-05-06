import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ingestParsedUpload, getUploadHistory } from "./data";
import { useAuth } from "./use-auth";
import { parseUploadFile } from "./parsers";
import type { Marketplace } from "./types";
import { Button, Card, EmptyState, Input, InlineLoader, PageTitle, Select } from "./ui";

interface UploadHistoryRow {
  id: string;
  marketplace: Marketplace;
  file_name: string;
  uploaded_at: string;
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
        <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Recent Upload History
        </h3>
        {isLoadingHistory ? (
          <InlineLoader text="Loading history..." />
        ) : history.length === 0 ? (
          <p className="text-sm text-zinc-500">No uploads yet.</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500">
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Marketplace</th>
                  <th className="px-2 py-2">File</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Total Rows</th>
                  <th className="px-2 py-2">Tracked</th>
                  <th className="px-2 py-2">Skipped</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {history.map((row) => (
                  <tr key={row.id}>
                    <td className="px-2 py-2">
                      {format(new Date(row.uploaded_at), "dd MMM yyyy, hh:mm a")}
                    </td>
                    <td className="px-2 py-2 capitalize">{row.marketplace}</td>
                    <td className="px-2 py-2">{row.file_name}</td>
                    <td className="px-2 py-2 capitalize">{row.status}</td>
                    <td className="px-2 py-2">{row.raw_row_count}</td>
                    <td className="px-2 py-2">{row.valid_row_count}</td>
                    <td className="px-2 py-2">{row.rejected_row_count}</td>
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

