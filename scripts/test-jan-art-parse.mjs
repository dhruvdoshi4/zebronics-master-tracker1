import { readFileSync } from "fs";
import { parseProductPricingBauFile } from "../src/parsers-pricing.ts";

const buf = readFileSync(
  process.argv[2] || "C:/Users/Admin/Downloads/Jan ART_HA_2026____ (7).xlsx",
);
const payload = await parseProductPricingBauFile(new File([buf], "Jan ART.xlsx"));
console.log("Jan row0", payload.rows[0]);
console.log(
  "Jan margins",
  payload.rows.filter((r) => r.bau_margin_amazon > 0).length,
);
