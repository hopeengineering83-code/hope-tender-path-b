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
 *      traces, placeholders, pricing leakage) and marks repaired documents
 *      VALIDATED + READY_FOR_EXPORT.
 *   3. The actual ZIP export remains user-triggered (it's a download),
 *      but the tender reaches export-ready state automatically.
 *
 * This service is called from /api/ai-jobs/run-next after a successful
 * PROPOSAL_GENERATION job. It never throws — failures are logged and the
 * tender remains in its current state for manual retry.
 */

import { repairSourceGrounding } from "../engine/repair-source-grounding";
import { logger } from "../observability";
import { recordStep } from "../ai-jobs";

export type AutoFinalizeResult = {
  ok: boolean;
  sourceRepair: { checked: number; repaired: number; remaining: number };
  exportRepair: { repaired: number; skipped: number; manualRequired: number };
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
  // pricing leakage; mark repaired documents VALIDATED + READY_FOR_EXPORT).
  // This is the same logic as /api/tenders/:id/repair-export-gaps, invoked
  // here without the HTTP layer so the worker can call it directly.
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
  // Lazy import to avoid pulling DOCX into the worker module graph when
  // this path is not reached.
  const { runExportGapRepair } = await import("../engine/export-gap-repair");
  return runExportGapRepair(tenderId, userId);
}
