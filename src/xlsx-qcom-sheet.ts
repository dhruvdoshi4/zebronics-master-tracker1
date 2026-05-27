import * as XLSX from "xlsx";

/**
 * BigBasket exports often declare !ref A1:RN1048576 (full Excel grid) with a stray
 * cell on the last row. SheetJS then walks ~1M rows and the upload hangs at 2%.
 */
export function tightenWorksheetRange(ws: XLSX.WorkSheet): void {
  let maxR = 0;
  let maxC = 0;
  for (const key of Object.keys(ws)) {
    if (key[0] === "!") continue;
    const cell = XLSX.utils.decode_cell(key);
    if (cell.r >= 100_000) continue;
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c > maxC) maxC = cell.c;
  }
  if (maxC < 0) return;
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxR, c: maxC },
  });
}

export function sheetRowsFromWorksheet(ws: XLSX.WorkSheet): unknown[][] {
  tightenWorksheetRange(ws);
  return XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
}
