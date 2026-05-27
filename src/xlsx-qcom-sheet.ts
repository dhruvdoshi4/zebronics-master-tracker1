import * as XLSX from "xlsx";
import { tightenWorksheetRange } from "./xlsx-fast";

export { tightenWorksheetRange };

export function sheetRowsFromWorksheet(ws: XLSX.WorkSheet): unknown[][] {
  tightenWorksheetRange(ws);
  return XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
}
