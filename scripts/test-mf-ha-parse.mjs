import { readFileSync } from "fs";
import { parseProductPricingBauFile } from "../src/parsers-pricing.ts";

const buf = readFileSync(process.argv[2] || "C:/Users/Admin/Downloads/MF_HA.xlsx");
const file = new File([buf], "MF_HA.xlsx");
const payload = await parseProductPricingBauFile(file);
console.log("rows", payload.rows.length);
const sample = payload.rows.find((x) => x.fsn === "ACCGNHWUNZZ3B8GS");
console.log("MOVING MONSTER", sample);
console.log(
  "with margins",
  payload.rows.filter((x) => x.bau_margin_amazon > 0 || x.bau_margin_flipkart > 0).length,
);
