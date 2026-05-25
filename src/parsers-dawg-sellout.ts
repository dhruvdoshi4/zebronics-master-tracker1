import * as XLSX from "xlsx";
import type { ParsedUploadPayload } from "./types";
import { parseUploadFile } from "./parsers";
import { normalizeKey } from "./utils";

const ECOM_SELLOUT_SHEET = "Ecom Sellout";

export type DawgCombinedSelloutParseResult = {
  amazon: ParsedUploadPayload;
  flipkart: ParsedUploadPayload;
};

/** Tabs present in a daWg combined sellout workbook. */
export function detectDawgSelloutWorkbookChannels(sheetNames: string[]): {
  amazon: boolean;
  flipkart: boolean;
} {
  const keys = new Set(sheetNames.map((n) => normalizeKey(n)));
  return {
    amazon:
      keys.has("amazon") || keys.has(normalizeKey(ECOM_SELLOUT_SHEET)),
    flipkart:
      keys.has("flipkart") || keys.has(normalizeKey(ECOM_SELLOUT_SHEET)),
  };
}

/**
 * Parse Amazon + Flipkart tabs from one daWg sellout workbook (e.g. daWg Sellout Report…xlsx).
 */
export async function parseDawgCombinedSelloutFile(
  file: File,
  snapshotDate: string,
): Promise<DawgCombinedSelloutParseResult> {
  const buffer = await file.arrayBuffer();
  const sheetList = XLSX.read(buffer, { type: "array", bookSheets: true }).SheetNames;
  const channels = detectDawgSelloutWorkbookChannels(sheetList);
  if (!channels.amazon && !channels.flipkart) {
    throw new Error(
      `This workbook needs an Amazon and/or Flipkart tab. Found: ${sheetList.join(", ")}`,
    );
  }

  const parseOpts = { dawgWorkbook: true as const };
  const [amazon, flipkart] = await Promise.all([
    channels.amazon
      ? parseUploadFile(file, "amazon", snapshotDate, parseOpts)
      : Promise.resolve(emptyPayload()),
    channels.flipkart
      ? parseUploadFile(file, "flipkart", snapshotDate, parseOpts)
      : Promise.resolve(emptyPayload()),
  ]);

  if (amazon.validCount <= 0 && flipkart.validCount <= 0) {
    throw new Error(
      "No daWg sellout rows found — check Category is Gaming - daWg or Personal Audio on Amazon and Flipkart tabs.",
    );
  }

  return { amazon, flipkart };
}

function emptyPayload(): ParsedUploadPayload {
  return {
    products: [],
    metricInputs: [],
    dailySales: [],
    categoryMonthlySellout: [],
    errors: [],
    rawCount: 0,
    validCount: 0,
    ignoredCount: 0,
    cartridgeRowCount: 0,
    flipkartEolModelNames: [],
    flipkartEolFsns: [],
  };
}
