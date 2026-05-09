import type { Marketplace } from "./types";

const AMAZON_EOF_ASINS = new Set<string>([
  "B0DCS4TBYV",
  "B0DCS6W7LP",
  "B0DCS1N5XZ",
  "B0DCSJ5VVJ",
  "B0DCSMBBYH",
  "B0DCSQ6ZC2",
  "B0DCSPQRPY",
  "B0DCSMQ9LJ",
  "B0DCSKG3YF",
  "B0DCSQRBP1",
  "B0DGG56VZM",
  "B0DCS6V5CS",
  "B0D7Z8NQPP",
  "B0DPWQ5S7D",
  "B0C1SZ25H7",
  "B0FR28DHSG",
  "B0FH71VR4X",
  "B0C1T31FGN",
  "B0DFM8JL8C",
  "B0CLYCRRWV",
  "B09VDQ2QTL",
  "B0CGZRPCGT",
  "B0DBDSVVK8",
]);

const EOL_TOKEN = /\b(eol|end\s*of\s*life)\b/i;

export function isKnownEolProductCode(
  marketplace: Marketplace,
  productCode: string,
): boolean {
  if (marketplace !== "amazon") return false;
  return AMAZON_EOF_ASINS.has(productCode.trim().toUpperCase());
}

export function rowHasEolMarker(row: unknown[]): boolean {
  return row.some((cell) => EOL_TOKEN.test(String(cell ?? "").trim()));
}
