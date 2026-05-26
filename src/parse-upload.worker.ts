import { parseSelloutFromBuffer, type ParseSelloutBufferInput } from "./parsers";

type WorkerRequest = {
  buffer: ArrayBuffer;
  input: ParseSelloutBufferInput & { flipkartEolFromDb: string[] };
};

type WorkerResponse =
  | { type: "progress"; message: string }
  | { type: "success"; payload: ReturnType<typeof parseSelloutFromBuffer> }
  | { type: "error"; message: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { buffer, input } = event.data;
  try {
    const payload = parseSelloutFromBuffer(buffer, {
      ...input,
      flipkartEolFromDb: new Set(input.flipkartEolFromDb),
      onProgress: (update) => {
        const response: WorkerResponse = { type: "progress", message: update.message };
        self.postMessage(response);
      },
    });
    const response: WorkerResponse = { type: "success", payload };
    self.postMessage(response);
  } catch (error: unknown) {
    const response: WorkerResponse = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
