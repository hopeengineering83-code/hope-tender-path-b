// TEMPORARY read-only diagnostic for the inspection workflow: which lines of
// the stored proposal markdown the technical-envelope price detector counts
// (countOwnPriceMentions), so a "financial content detected" warning can be
// traced to its sentences. Nothing is written.
//
// usage: tsx scripts/tmp-own-price-mentions.ts <proposal-version.json>
import { readFileSync } from "node:fs";
import { countOwnPriceMentions } from "../lib/engine/detection-patterns";

const version = (JSON.parse(readFileSync(process.argv[2]!, "utf8")) ?? {}).version ?? {};
const markdown = String(version.markdown ?? "");
console.log(`=== OWN-PRICE MENTIONS: total=${countOwnPriceMentions(markdown)} (warning above 3) ===`);
markdown.split("\n").forEach((line, i) => {
  const n = countOwnPriceMentions(line);
  if (n > 0) console.log(`  L${i + 1} x${n}: ${line.slice(0, 400)}`);
});
