/**
 * Auto-finalize continuation service.
 *
 * After PROPOSAL_GENERATION succeeds, this service runs the safe repairs
 * and validation steps that were previously manual button clicks in the
 * Export Readiness panel. The goal: zero-click pipeline from upload to
 * export-ready.
 *
 * Steps (all idempotent, all fail-safe):
 *   1. repairSourceGrounding — re-grounds any requirement whose source
 *      trace is stale, so the app never says "source reference not found".
 *   2. repairExportGaps — runs the safe DOCX hygiene repairs (strip AI
 *      traces, placeholders, pricing leakage). Writes
 *      validationStatus=PENDING + machine-marker reviewNotes only (Gap 1).
 *   3. runCanonicalValidation — sends every PENDING document through the
 *      canonical Document Validator (checkFullExportReadiness). Persists
 *      validationStatus=VALIDATED ONLY for documents with zero failures
 *      (Gap 2). Documents with failures stay PENDING/FAILED — never
 *      fabricated.
 *   4. The actual ZIP export remains user-triggered (it's a download),
 *      but the tender reaches export-ready state automatically.
 *
 * This service is called from /api/ai-jobs/run-next after a successful
 * PROPOSAL_GENERATION job. It never throws — failures are logged and the
 * tender remains in its current state for manual retry.
 */

import { repairSourceGrounding } from "../engine/repair-source-grounding";
import { prisma } from "../prisma";
import { logger } from "../observability";
import { recordStep } from "../ai-jobs";

export type AutoFinalizeResult = {
  ok: boolean;
  sourceRepair: { checked: number; repaired: number; remaining: number };
  exportRepair: { repaired: number; skipped: number; manualRequired: number };
  validation: { validated: number; failed: number; pending: number };
  warning: string | null;
};

/**
 * Run safe auto-finalize repairs for a tender after proposal generation.
 * Called from run-next when PROPOSAL_GENERATION succeeds.
 *
 * Does NOT throw — logs warnings and returns a result so the run-next
 * worker never crashes on a continuation failure.
 */
export async function runAutoFinalizeAfterGeneration(
  tenderId: string,
  userId: string,
  jobId: string,
): Promise<AutoFinalizeResult> {
  const result: AutoFinalizeResult = {
    ok: true,
    sourceRepair: { checked: 0, repaired: 0, remaining: 0 },
    exportRepair: { repaired: 0, skipped: 0, manualRequired: 0 },
    validation: { validated: 0, failed: 0, pending: 0 },
    warning: null,
  };

  // Step 1: repair source grounding so "source reference not found" never
  // appears in the UI. This re-grounds any requirement whose source trace
  // became stale after the latest source revision.
  try {
    await recordStep(jobId, {
      stepName: "auto-finalize.source-repair",
      message: "Auto-repairing source grounding for mandatory requirements",
      status: "RUNNING",
    });
    const sourceRepair = await repairSourceGrounding(tenderId, { userId });
    result.sourceRepair = {
      checked: sourceRepair.checkedCount,
      repaired: sourceRepair.repairedCount,
      remaining: sourceRepair.remainingCount,
    };
    await recordStep(jobId, {
      stepName: "auto-finalize.source-repair.complete",
      message: `Source grounding: ${sourceRepair.repairedCount} repaired, ${sourceRepair.remainingCount} remaining`,
      status: sourceRepair.remainingCount > 0 ? "RUNNING" : "SUCCEEDED",
    });
  } catch (error) {
    logger.warn("[auto-finalize] source grounding repair failed", {
      tenderId,
      jobId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    result.warning = "Source grounding auto-repair encountered an error. Manual repair may be needed.";
  }

  // Step 2: run safe export-gap repairs (strip AI traces, placeholders,
  // pricing leakage). Per Gap 1, this writes validationStatus=PENDING +
  // machine-marker reviewNotes only — never VALIDATED/reviewedBy.
  try {
    await recordStep(jobId, {
      stepName: "auto-finalize.export-repair",
      message: "Auto-repairing export gaps (AI traces, placeholders, pricing leakage)",
      status: "RUNNING",
    });
    const exportRepair = await runSafeExportRepairs(tenderId, userId);
    result.exportRepair = exportRepair;
    await recordStep(jobId, {
      stepName: "auto-finalize.export-repair.complete",
      message: `Export repair: ${exportRepair.repaired} repaired, ${exportRepair.skipped} skipped, ${exportRepair.manualRequired} manual-required`,
      status: "SUCCEEDED",
    });
  } catch (error) {
    logger.warn("[auto-finalize] export gap repair failed", {
      tenderId,
      jobId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    result.warning = (result.warning ?? "") + " Export gap auto-repair encountered an error. Manual repair may be needed.";
  }

  // Step 3 (Gap 2): run the canonical Document Validator on every PENDING
  // document. Persist validationStatus=VALIDATED ONLY for documents with
  // zero failures. Documents with failures stay PENDING (or FAILED if the
  // validator explicitly rejects them). Never fabricate VALIDATED.
  try {
    await recordStep(jobId, {
      stepName: "auto-finalize.canonical-validation",
      message: "Running canonical Document Validator on repaired documents",
      status: "RUNNING",
    });
    const validation = await runCanonicalValidation(tenderId);
    result.validation = validation;
    await recordStep(jobId, {
      stepName: "auto-finalize.canonical-validation.complete",
      message: `Canonical validation: ${validation.validated} validated, ${validation.failed} failed, ${validation.pending} pending`,
      status: "SUCCEEDED",
    });
  } catch (error) {
    logger.warn("[auto-finalize] canonical validation failed", {
      tenderId,
      jobId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    result.warning = (result.warning ?? "") + " Canonical validation encountered an error. Documents remain PENDING.";
  }

  return result;
}

/**
 * Run the safe export-gap repairs directly (no HTTP layer). Extracted from
 * /api/tenders/:id/repair-export-gaps so both the route and the auto-
 * finalize worker share one implementation.
 */
async function runSafeExportRepairs(
  tenderId: string,
  userId: string,
): Promise<{ repaired: number; skipped: number; manualRequired: number }> {
  const { runExportGapRepair } = await import("../engine/export-gap-repair");
  return runExportGapRepair(tenderId, userId);
}

/**
 * Gap 2: Run the canonical Document Validator on every PENDING document.
 * Persist validationStatus=VALIDATED ONLY for documents that have zero
 * failures in checkFullExportReadiness. Documents with failures are left
 * at PENDING (or set to FAILED if the validator explicitly rejects them).
 *
 * This is the SINGLE authority for validationStatus=VALIDATED. No other
 * code path may write it.
 */
async function runCanonicalValidation(
  tenderId: string,
): Promise<{ validated: number; failed: number; pending: number }> {
  const { checkFullExportReadiness } = await import("../engine/export-readiness");

  // Load all non-superseded documents with their content for validation.
  const docs = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
    orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, name: true, exactFileName: true, exactOrder: true,
      documentType: true, format: true, generationStatus: true,
      validationStatus: true, reviewStatus: true,
      fileContent: true, storagePath: true,
    },
  });

  // Run the canonical validator (same function the /validate route uses).
  const readiness = await checkFullExportReadiness({
    tenderId,
    docs: docs as any[],
    requireFileContent: false,
  });

  // Collect the set of documentIds that have validation failures.
  const failedDocIds = new Set(readiness.failures.map((f) => f.documentId).filter(Boolean));

  // Persist VALIDATED for documents that pass, FAILED for documents with
  // failures, and leave PENDING for documents that were not checked.
  // Only write to documents that are currently PENDING (don't overwrite
  // a human VALIDATED or a prior FAILED without reason).
  let validated = 0;
  let failed = 0;
  let pending = 0;

  for (const doc of docs) {
    // Only auto-validate documents that are currently PENDING (i.e. the
    // ones the export-gap repair just set). Don't touch documents that
    // are already VALIDATED, FAILED, or in a human-review state.
    if (doc.validationStatus !== "PENDING") {
      if (doc.validationStatus === "VALIDATED" || doc.validationStatus === "PASSED") validated++;
      else if (doc.validationStatus === "FAILED") failed++;
      else pending++;
      continue;
    }

    const passes = !failedDocIds.has(doc.id);
    await prisma.generatedDocument.update({
      where: { id: doc.id },
      data: {
        validationStatus: passes ? "VALIDATED" : "FAILED",
        updatedAt: new Date(),
      },
    });
    if (passes) validated++;
    else failed++;
  }

  return { validated, failed, pending };
}
