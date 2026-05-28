import XLSX from "xlsx";

const workbookPath = process.argv[2];
if (!workbookPath) {
  console.error("Usage: node scripts/analyze-workbook.mjs <workbook-path>");
  process.exit(1);
}

const wb = XLSX.readFile(workbookPath, { cellDates: false });
console.log("SHEETS", wb.SheetNames.join(" | "));

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws["!ref"] || "A1:A1";
  const range = XLSX.utils.decode_range(ref);
  const maxR = Math.min(range.e.r, 24);
  const maxC = Math.min(range.e.c, 120);

  let best = -1;
  let headerRow = 0;
  for (let rr = 0; rr <= maxR; rr += 1) {
    let score = 0;
    for (let c = 0; c <= maxC; c += 1) {
      const addr = XLSX.utils.encode_cell({ r: rr, c });
      const value = String(ws[addr]?.v ?? "").toLowerCase().trim();
      if (!value) continue;
      if (value.includes("asin") || value.includes("fsn")) score += 3;
      if (value.includes("sub category") || value.includes("sub-category")) score += 2;
      if (value.includes("category")) score += 1;
      if (value.includes("mtd") || value.includes("so") || value.includes("drr")) score += 1;
    }
    if (score > best) {
      best = score;
      headerRow = rr;
    }
  }

  const headers = [];
  for (let c = 0; c <= maxC; c += 1) {
    const addr = XLSX.utils.encode_cell({ r: headerRow, c });
    const value = String(ws[addr]?.v ?? "").trim();
    if (value) headers.push(value);
  }

  const fyCols = headers.filter((h) =>
    /fy\s*\d{2,4}\s*[-–]?\s*\d{2,4}|\b\d{2,4}\s*[-–]\s*\d{2,4}\b/i.test(h),
  );
  const kpiCols = headers.filter((h) =>
    /mtd|\bapr\b|\bmay\b|\bso\b|drr|28\s*days/i.test(h),
  );

  console.log(`\n--- ${name} headerRow ${headerRow + 1}`);
  console.log("FY cols:", fyCols.join(" || ") || "(none)");
  console.log("KPI cols:", kpiCols.join(" || ") || "(none)");
}
