/**
 * TEMPORARY — owner-authorized acceptance helper. Delete alongside the
 * temporary-preview-hosted-acceptance job in
 * .github/workflows/lockfile-refresh-artifact.yml.
 *
 * WHAT THIS ANSWERS
 * -----------------
 * Whether the numbers in the Company Vault reach the page the client reads.
 * The vault carries a contract value on 113 of 114 projects; the reference
 * proposal the owner benchmarks against cites 35 monetary figures. Every gate
 * in the acceptance run is blind to this, because an absent number breaks no
 * rule: readiness passes, hashes match, the ZIP verifies, and the document
 * still says nothing about the scale of the work behind it.
 *
 * WHY IT IS A SCRIPT AND NOT A REGEX IN THE WORKFLOW
 * -------------------------------------------------
 * The first version of this check was an inline pattern that treated any
 * three-letter token beside digits as a currency. On the real delivered PDF it
 * reported five "monetary figures": `2026`, `ISO 9001`, `ISO 21542`,
 * `TIN 0064637886` and a licence number. A measurement that reports a year and
 * a tax identifier as money cannot answer the question it was written for, and
 * would have been quoted as evidence that the enrichment had worked.
 *
 * Currency knowledge therefore comes from the one generic reference the
 * application itself uses, so "is this a currency" has a single answer
 * everywhere, and ISO standard numbers can never be mistaken for money.
 *
 * Informational only. It prints and exits 0; how persuasive a document is is
 * not a pass/fail contract.
 */

import { readFile } from "node:fs/promises";

import { resolveCurrencyToken } from "../lib/engine/currency-reference";

async function main(): Promise<void> {
  const [, , textPath] = process.argv;
  if (!textPath) {
    console.error("usage: npx tsx scripts/tmp-report-delivered-figures.ts <extracted-text-path>");
    process.exit(2);
  }

  let text = "";
  try {
    text = await readFile(textPath, "utf8");
  } catch {
    console.log("MONETARY FIGURES IN THE DELIVERED PDF: NOT MEASURED (no text dump)");
    process.exit(0);
  }

  /** A number beside a token. The four-digit / magnitude rule is applied below,
 * not in the pattern, so "USD 3.5M" is not lost for being short. */
  const CANDIDATE = /([A-Za-z$£€¥₦][A-Za-z$£€¥₦.]{0,24})?\s?([0-9][0-9,.]*)\s?(?:(million|billion|bn|M|B)\b)?\s?([A-Za-z]{1,24})?/g;

  const money: string[] = [];
  for (const match of text.matchAll(CANDIDATE)) {
    const [, before, amount, magnitude, after] = match;
    // A currency is a currency whichever side of the amount it sits.
    const code = resolveCurrencyToken((before ?? "").trim()) ?? resolveCurrencyToken((after ?? "").trim());
    if (!code) continue;
    const digits = amount.replace(/[^0-9]/g, "");
    // Four digits or a magnitude word. "USD 12" is a page reference, not a value.
    if (digits.length < 4 && !magnitude) continue;
    money.push(match[0].replace(/\s+/g, " ").trim());
  }

  console.log(`MONETARY FIGURES IN THE DELIVERED PDF: ${money.length}`);
  for (const sample of money.slice(0, 15)) console.log(`  ${sample}`);

  const areas = [...text.matchAll(/[0-9][0-9,]{2,}\s?m(?:2|²)/g)].map((m) => m[0]);
  console.log(`SCALE FIGURES (area) IN THE DELIVERED PDF: ${areas.length}`);
  for (const sample of areas.slice(0, 8)) console.log(`  ${sample}`);

  // What the client is actually told about value, in the document's own words.
  // A count alone cannot distinguish "no values were available" from "values were
  // available and the writer described them without numbers".
  const valueLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\b(contract value|construction value|project value|consultancy fee|aggregate value|value of (?:the )?(?:works|projects))\b/i.test(line))
    .slice(0, 12);
  console.log(`VALUE STATEMENTS IN THE DELIVERED PDF: ${valueLines.length}`);
  for (const line of valueLines) console.log(`  ${line.slice(0, 160)}`);
}

main().catch((error: unknown) => {
  console.error("delivered-figure report failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
