/**
 * TEMPORARY — owner-authorized acceptance diagnostic. Delete alongside the
 * temporary-preview-hosted-acceptance job in
 * .github/workflows/lockfile-refresh-artifact.yml.
 *
 * WHY THIS EXISTS
 * ---------------
 * The document audit reports:
 *
 *   ISSUE PRICING_LEAKAGE [HIGH] Possible financial/pricing language appears
 *   in a technical document
 *   (audit response carries no text excerpt for this document)
 *
 * A HIGH-severity finding with no excerpt is unactionable: it cannot be told
 * apart from a false positive, and two AUTO_FINALIZE failures in a row were
 * diagnosed by guessing which sentence might have tripped it. Approximating the
 * audit's view with a different extractor gave a different answer — the raw page
 * text reads clean and the reflowed text does not — so the only honest way to
 * see what the detector saw is to run the detector over the SAME text the audit
 * builds, from the SAME bytes.
 *
 * This runs the application's own pipeline over the delivered PDF:
 *   bytes -> generatedDocumentVisibleText -> containsPricingLeakage
 * and prints the fragments that trip it, so the next failure names its own
 * cause. Informational: it prints and exits 0.
 */

import { readFile } from "node:fs/promises";

import { generatedDocumentVisibleText } from "../lib/engine/generated-document-text";
import { containsPricingLeakage } from "../lib/engine/pricing-hygiene";

const DOC = {
  name: "Technical Proposal",
  exactFileName: "Technical Proposal.pdf",
  documentType: "TECHNICAL_PROPOSAL",
  format: "PDF",
} as Parameters<typeof containsPricingLeakage>[1];

async function main(): Promise<void> {
  const [, , pdfPath] = process.argv;
  if (!pdfPath) {
    console.error("usage: npx tsx scripts/tmp-report-pricing-leakage-fragments.ts <pdf-path>");
    process.exit(2);
  }

  let base64 = "";
  try {
    base64 = (await readFile(pdfPath)).toString("base64");
  } catch {
    console.log("PRICING LEAKAGE FRAGMENTS: NOT MEASURED (no delivered PDF)");
    return;
  }

  const visible = await generatedDocumentVisibleText({
    fileContent: base64,
    exactFileName: "Technical Proposal.pdf",
    name: "Technical Proposal",
    contentMimeType: "application/pdf",
  });

  if (visible === null) {
    console.log("PRICING LEAKAGE FRAGMENTS: NOT MEASURED (the audit's reader returned no text)");
    return;
  }

  const wholeDocument = containsPricingLeakage(visible, DOC);
  console.log(`PRICING LEAKAGE ON THE AUDIT'S OWN TEXT: ${wholeDocument}`);

  // Judge each fragment on its own to name the offenders. A fragment clean in
  // isolation but flagged in context is reported too, because that difference
  // is itself the finding — it means the surrounding text, not the sentence,
  // produced the verdict.
  const fragments = visible.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 2);
  const offenders = fragments.filter((line) => containsPricingLeakage(line, DOC));

  console.log(`FRAGMENTS THE DETECTOR FLAGS ON THEIR OWN: ${offenders.length} of ${fragments.length}`);
  for (const offender of offenders.slice(0, 10)) {
    console.log(`  > ${offender.slice(0, 300)}`);
  }
  if (wholeDocument && offenders.length === 0) {
    console.log("  NOTE: the document is flagged but no single fragment is — the verdict comes");
    console.log("  from context assembled across fragments, not from any sentence it contains.");
  }
}

main().catch((error: unknown) => {
  console.error("pricing-leakage fragment report failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
