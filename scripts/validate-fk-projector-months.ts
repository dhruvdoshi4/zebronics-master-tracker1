import fs from "node:fs";
import { parseUploadFile } from "../src/parsers";

const path =
  "c:/Users/Admin/Downloads/FK SO Report - Monitors & Projectors till 4th May 2026.xlsx";

async function main() {
  if (!fs.existsSync(path)) {
    console.error("File not found:", path);
    process.exit(1);
  }
  const buf = fs.readFileSync(path);
  const file = new File([buf], "FK.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const payload = await parseUploadFile(file, "flipkart", "2026-05-04");
  const proj = new Set(
    payload.products.filter((x) => x.sub_category === "projector").map((x) => x.product_code),
  );
  const sum = (prefix: string) =>
    payload.dailySales
      .filter((d) => proj.has(d.product_code) && d.sale_date.startsWith(prefix))
      .reduce((s, d) => s + d.units_sold, 0);

  console.log({
    projectorSkus: proj.size,
    apr25: sum("2025-04"),
    mar26: sum("2026-03"),
    dailySalesRows: payload.dailySales.length,
    validCount: payload.validCount,
  });
}

void main();
