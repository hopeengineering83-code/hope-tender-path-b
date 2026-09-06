/**
 * CLI wrapper for the canonical TenderFactsLedger backfill service.
 *
 * Safety:
 * - dry-run unless --apply is explicit;
 * - --apply is refused in production;
 * - targeted staging filters are supported;
 * - Tender scalar columns are never modified;
 * - legacy facts without verified file/page/quote evidence remain
 *   CANDIDATE_NEEDS_REVIEW.
 */

import { backfillTenderFactsForTender } from "../lib/engine/tender-facts-ledger-service";
import { prisma, prismaReady } from "../lib/prisma";

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveIntegerFlag(name: string): number | undefined {
  const raw = flagValue(name);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer.`);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function dateFlag(name: string): Date | undefined {
  const raw = flagValue(name);
  if (raw === undefined) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${name} must be a valid ISO date.`);
  return parsed;
}

async function backfill(): Promise<void> {
  const isApply = process.argv.includes("--apply");
  const isProduction = process.env.NODE_ENV === "production";
  const tenderIdFlag = flagValue("--tender-id");
  const limitFlag = positiveIntegerFlag("--limit");
  const updatedAfter = dateFlag("--updated-after");

  console.log("=== TenderFactsLedger Backfill ===");
  console.log(`Mode: ${isApply ? "APPLY" : "DRY-RUN (no writes)"}`);
  console.log(`Environment: ${process.env.NODE_ENV ?? "(unset)"}`);

  if (isApply && isProduction) {
    console.error("REFUSED: --apply is not allowed in NODE_ENV=production");
    process.exitCode = 1;
    return;
  }

  await prismaReady;
  try {
    const result = await backfillTenderFactsForTender(prisma, {
      apply: isApply,
      tenderId: tenderIdFlag,
      limit: limitFlag,
      updatedAfter,
    });

    console.log(`Tenders scanned: ${result.totalTenders}`);
    console.log(`Candidate entries: ${result.totalCandidates}`);
    console.log(`Grounded entries: ${result.totalGrounded}`);
    console.log(`Review candidates: ${result.totalCandidate}`);
    console.log(`Rejected placeholders: ${result.totalRejected}`);
    console.log(`Skipped entries: ${result.totalSkipped}`);

    const summary = {
      timestamp: new Date().toISOString(),
      mode: isApply ? "APPLY" : "DRY-RUN",
      environment: process.env.NODE_ENV ?? "(unset)",
      filters: {
        tenderId: tenderIdFlag ?? null,
        limit: limitFlag ?? null,
        updatedAfter: updatedAfter?.toISOString() ?? null,
      },
      totals: result,
    };
    console.log("=== JSON Summary ===");
    console.log(JSON.stringify(summary, null, 2));

    if (!isApply) {
      console.log("To apply in a reviewed non-production environment, rerun with --apply.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

backfill().catch((error: unknown) => {
  console.error("Backfill failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
