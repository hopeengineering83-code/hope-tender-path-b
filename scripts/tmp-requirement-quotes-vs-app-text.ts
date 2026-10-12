// TEMPORARY read-only diagnostic for the inspection workflow.
//
// "Requirement … quote is not supported by active file text" is decided
// against the text the app extracted at upload, which no route returns. This
// re-runs the app's own extractor (extractTextFromBuffer) on the downloaded
// source bytes and, for every requirement, prints whether its quote is
// contained under the shared rule (normalizeForContainment), the app text
// around the passage it most resembles, and what the grounding matcher
// (groundRequirementInActiveFiles) would store. Nothing is written anywhere.
//
// usage: tsx scripts/tmp-requirement-quotes-vs-app-text.ts <requirements.json> <fileId>=<path> [...]

import { readFileSync } from "node:fs";
import { extractTextFromBuffer } from "../lib/extract-text";
import { normalizeForContainment } from "../lib/engine/evidence-grounding";
import { groundRequirementInActiveFiles } from "../lib/engine/repair-source-grounding";

function show(value: string, max = 420): string {
  return JSON.stringify(value.length > max ? `${value.slice(0, max)}…` : value);
}

/** The app-text window sharing the most quote words, to show what differs. */
function closestWindow(text: string, quote: string): string {
  const words = quote.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 5);
  if (words.length === 0) return "";
  const lower = text.toLowerCase();
  let best = 0;
  let bestAt = -1;
  for (let at = 0; at < lower.length; at += 40) {
    const window = lower.slice(at, at + quote.length + 80);
    const hits = words.filter((w) => window.includes(w)).length;
    if (hits > best) { best = hits; bestAt = at; }
  }
  return bestAt < 0 ? "" : text.slice(bestAt, bestAt + quote.length + 80);
}

async function main(): Promise<void> {
  const [reqPath, ...filePairs] = process.argv.slice(2);
  const files: Array<{ id: string; extractedText: string; totalPages: number | null }> = [];
  for (const pair of filePairs) {
    const [id, path] = pair.split("=");
    if (!id || !path) continue;
    const text = await extractTextFromBuffer(readFileSync(path), "application/pdf", path);
    const pages = (text.match(/\[Page \d+\]/g) ?? []).length || null;
    files.push({ id, extractedText: text, totalPages: pages });
    console.log(`app text for ${id}: ${text.length} chars, ${pages ?? "?"} page markers`);
  }
  const requirements = (JSON.parse(readFileSync(reqPath!, "utf8")).requirements ?? []) as Array<Record<string, any>>;
  console.log(`=== REQUIREMENT QUOTES vs APP-EXTRACTED TEXT (${requirements.length}) ===`);
  for (const r of requirements) {
    const quote = String(r.sourceExactQuote ?? "");
    const bound = files.find((f) => f.id === r.sourceTenderFileId);
    const contained = Boolean(bound && quote && normalizeForContainment(bound.extractedText).includes(normalizeForContainment(quote)));
    console.log(`  ${r.id} ${r.priority} p${r.sourcePageNumber} contained=${contained} title=${JSON.stringify(r.title)}`);
    if (contained || !bound) continue;
    console.log(`     quote:    ${show(quote)}`);
    console.log(`     app text: ${show(closestWindow(bound.extractedText, quote), 600)}`);
    const repair = groundRequirementInActiveFiles(
      { title: String(r.title ?? ""), description: String(r.description ?? ""), sourceTenderFileId: r.sourceTenderFileId, sourceQuote: quote },
      files,
    );
    console.log(`     matcher:  ${repair ? `p${repair.page} conf=${repair.confidence} ${show(repair.quote, 300)}` : "null"}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
