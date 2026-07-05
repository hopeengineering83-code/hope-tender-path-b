// Targeted test: AI persistence transaction must not have nested global
// Prisma calls. The confirmed production blocker was that
// canPromoteToCanonical and promoteAnalysisToCanonical were called
// inside the transaction WITHOUT passing tx, so they used the global
// prisma client — opening separate connections that consumed the
// 10000ms transaction budget.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("AI persistence transaction — no nested global Prisma calls", () => {
  function getFinalizeJobTxBlock(src: string): string {
    const marker = "SHORT INTERACTIVE TRANSACTION";
    const markerIdx = src.indexOf(marker);
    assert.ok(markerIdx > 0, "must have SHORT INTERACTIVE TRANSACTION marker");
    const txStart = src.indexOf("await prisma.$transaction(async (tx) => {", markerIdx);
    assert.ok(txStart > 0, "must have $transaction after the marker");
    const txEnd = src.indexOf("}, {", txStart);
    assert.ok(txEnd > txStart, "transaction block must have closing }, {");
    return src.slice(txStart, txEnd);
  }

  it("canPromoteToCanonical is called WITH tx (not global prisma)", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    const txBlock = getFinalizeJobTxBlock(src);
    assert.ok(
      txBlock.includes("canPromoteToCanonical(jobId, job.tenderId!, tx)"),
      "canPromoteToCanonical must be called with tx as the store parameter — " +
        "previously it used global prisma, opening a separate connection inside the transaction",
    );
    // Must NOT call canPromoteToCanonical without tx
    assert.ok(
      !txBlock.includes("canPromoteToCanonical(jobId, job.tenderId!)"),
      "canPromoteToCanonical must NOT be called without tx — that uses global prisma",
    );
  });

  it("promoteAnalysisToCanonical is called WITH tx (not global prisma)", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    const txBlock = getFinalizeJobTxBlock(src);
    assert.ok(
      txBlock.includes("promoteAnalysisToCanonical(jobId,") && txBlock.includes(", tx)"),
      "promoteAnalysisToCanonical must be called with tx as the store parameter — " +
        "previously it used global prisma, opening a separate connection inside the transaction",
    );
  });

  it("transaction contains ONLY tx.* calls (no bare prisma.* calls)", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    const txBlock = getFinalizeJobTxBlock(src);
    // Every Prisma call inside the transaction must use tx, not prisma
    // Allow: tx.aiJob.update, tx.tender.update, tx.tenderRequirement, etc.
    // Forbid: prisma.aiJob, prisma.tender, prisma.$queryRaw, etc.
    const prismaCallPattern = /\bprisma\.\w+/g;
    const matches = txBlock.match(prismaCallPattern) || [];
    // The only allowed prisma reference is the $transaction call itself
    const disallowed = matches.filter(m => m !== "prisma.$transaction");
    assert.equal(
      disallowed.length,
      0,
      `Transaction must not contain global prisma calls (found: ${disallowed.join(", ")}). ` +
        "All calls must use tx to avoid nested connections that consume the transaction budget.",
    );
  });

  it("upsertRequirements uses createMany for batch inserts (not individual creates)", () => {
    const src = read("lib/engine/stable-requirements.ts");
    assert.ok(
      src.includes("createMany"),
      "upsertRequirements must use createMany for batch inserts — " +
        "previously it did individual create calls in a loop (50+ round-trips for large tenders)",
    );
  });

  it("upsertRequirements does NOT do sequential create calls in a loop", () => {
    const src = read("lib/engine/stable-requirements.ts");
    // The old code had: const createdReq = await tx.tenderRequirement.create({
    // inside a for loop. The new code uses createMany outside the loop.
    assert.ok(
      !src.includes("const createdReq = await tx.tenderRequirement.create("),
      "upsertRequirements must NOT do individual create calls — use createMany instead",
    );
  });

  it("durable worker restores provider health from DB before chunk analysis", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    assert.ok(
      src.includes("restoreHealthFromDb"),
      "Durable worker must call restoreHealthFromDb before chunk analysis — " +
        "without this, cold-start instances have empty in-memory state and " +
        "retry providers that are in cooldown",
    );
  });

  it("durable worker persists provider health to DB after chunk success", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    assert.ok(
      src.includes("persistAllHealthToDb"),
      "Durable worker must call persistAllHealthToDb after chunk processing — " +
        "without this, cooldown state is lost on worker restart",
    );
  });
});
