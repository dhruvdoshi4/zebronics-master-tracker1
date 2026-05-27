import type { CatalogWorkspace } from "./catalog-workspace";
import type { Marketplace, ParsedUploadPayload } from "./types";
import ParseUploadWorker from "./parse-upload.worker?worker";

export type ParseUploadProgress = {
  message: string;
};

export type ParseSelloutBufferInput = {
  fileName: string;
  marketplace: Marketplace;
  snapshotDate: string;
  catalogWorkspace?: CatalogWorkspace;
  dawgWorkbook?: boolean;
  flipkartEolFromDb: Set<string>;
  onProgress?: (update: ParseUploadProgress) => void;
};

/** Parse in a worker so the UI stays responsive (almost all sellout files qualify). */
const WORKER_MIN_BYTES = 8 * 1024;

export function shouldParseSelloutInWorker(fileSize: number): boolean {
  return typeof Worker !== "undefined" && fileSize >= WORKER_MIN_BYTES;
}

export function parseSelloutInWorker(
  buffer: ArrayBuffer,
  input: ParseSelloutBufferInput,
  onProgress?: (update: ParseUploadProgress) => void,
): Promise<ParsedUploadPayload> {
  return new Promise((resolve, reject) => {
    const worker = new ParseUploadWorker();

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type: "progress"; message: string }
        | { type: "success"; payload: ParsedUploadPayload }
        | { type: "error"; message: string };

      if (data.type === "progress") {
        onProgress?.({ message: data.message });
        return;
      }
      worker.terminate();
      if (data.type === "success") {
        resolve(data.payload);
        return;
      }
      reject(new Error(data.message));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("Workbook parsing failed in background thread."));
    };

    const { onProgress: _progress, ...workerInput } = input;
    /** Transfer a clone so the caller keeps a usable buffer for main-thread fallback. */
    const workerBuffer = buffer.slice(0);
    worker.postMessage(
      {
        buffer: workerBuffer,
        input: {
          ...workerInput,
          flipkartEolFromDb: [...input.flipkartEolFromDb],
        },
      },
      [workerBuffer],
    );
  });
}
