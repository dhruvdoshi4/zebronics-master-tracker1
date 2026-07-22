import { normalizeKey } from "./utils";

/** How a secondary sheet merges into the same marketplace product code. */
export type WorkbookSheetMergeMode = "store" | "additive";

export type WorkbookSheetSpec = {
  /** Normalized substring match against tab name (after normalizeKey). */
  match: string;
  merge: WorkbookSheetMergeMode;
  /** Lower = parsed first. */
  order: number;
};

/**
 * Pravin Amazon: Click_tect (renamed "CTRL") stores row metadata; Cocoblu adds units per ASIN.
 */
export const PRAVIN_AMAZON_SELL_OUT_SHEETS: WorkbookSheetSpec[] = [
  { match: "click tect", merge: "store", order: 0 },
  { match: "ctrl", merge: "store", order: 0 },
  { match: "cocoblu", merge: "additive", order: 1 },
];

export function pravinAmazonSheetMergeMode(sheetName: string): WorkbookSheetMergeMode {
  const key = normalizeKey(sheetName);
  for (const spec of PRAVIN_AMAZON_SELL_OUT_SHEETS) {
    if (key.includes(spec.match)) return spec.merge;
  }
  return "store";
}

export function sortPravinAmazonSelloutSheets(sheetNames: string[]): string[] {
  const orderFor = (name: string) => {
    const key = normalizeKey(name);
    for (const spec of PRAVIN_AMAZON_SELL_OUT_SHEETS) {
      if (key.includes(spec.match)) return spec.order;
    }
    return 99;
  };
  return [...sheetNames].sort((a, b) => orderFor(a) - orderFor(b) || a.localeCompare(b));
}
