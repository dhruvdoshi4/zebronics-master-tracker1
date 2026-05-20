import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const path =
  process.argv[2] ??
  "c:\\Users\\Admin\\Downloads\\Quick-com Sell Out Report till 6th February 2026.xlsx";

const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
console.log("FILE:", path);
console.log("SHEETS:", wb.SheetNames.join(" | "));

function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  console.log("\n===", name, "===");
  console.log("rowCount:", rows.length);

  let headerRow = 0;
  for (let r = 0; r < Math.min(15, rows.length); r++) {
    const row = rows[r] ?? [];
    const joined = row.map((c) => norm(c)).join("|");
    if (
      joined.includes("asin") ||
      joined.includes("category") ||
      joined.includes("sell") ||
      joined.includes("sku")
    ) {
      headerRow = r;
      break;
    }
  }

  const headers = (rows[headerRow] ?? []).map((h) => norm(h));
  console.log("headerRow:", headerRow);
  console.log("headers:", headers.filter(Boolean).slice(0, 40).join(" | "));

  const categories = new Set();
  const asinIdx = headers.findIndex((h) => h.includes("asin") || h === "sku" || h.includes("product id"));
  const catIdx = headers.findIndex((h) => h === "category" || h.includes("category"));
  const nameIdx = headers.findIndex(
    (h) => h.includes("model") || h.includes("product name") || h.includes("name"),
  );

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (catIdx >= 0) {
      const c = String(row[catIdx] ?? "").trim();
      if (c) categories.add(c);
    }
  }

  if (categories.size) {
    console.log("categories:", [...categories].sort().join(", "));
  }

  if (asinIdx >= 0) {
    let withAsin = 0;
    for (let r = headerRow + 1; r < rows.length; r++) {
      const v = String((rows[r] ?? [])[asinIdx] ?? "").trim();
      if (v) withAsin++;
    }
    console.log("rowsWithCode:", withAsin, "codeColumn:", headers[asinIdx]);
  }

  console.log("sample rows:");
  for (let r = headerRow; r < Math.min(headerRow + 4, rows.length); r++) {
    const row = rows[r] ?? [];
    console.log(
      "R" + r + ":",
      row
        .slice(0, 20)
        .map((c) => String(c).slice(0, 30))
        .join(" | "),
    );
  }

  const monthCols = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => /^(apr|may|jun|jul|aug|sep|oct|nov|dec|jan|feb|mar)/i.test(h) || /\d{2}-\d{2}/.test(h));
  if (monthCols.length) {
    console.log(
      "monthLikeCols:",
      monthCols.slice(0, 15).map((x) => x.h).join(", "),
      monthCols.length > 15 ? `+${monthCols.length - 15} more` : "",
    );
  }
}
