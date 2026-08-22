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
  pdfFinalization: { finalized: number; skipped: number; failed: number };
  /**
   * Second validation pass over the PDFs the finalization stage just created.
   * They are persisted validationStatus PENDING, and canonical validation had
   * already run one stage earlier, so without this every auto-finalized PDF
   * stayed unvalidated forever — and an unvalidated document is exactly what
   * the export gate refuses.
   */
  pdfValidation: { validated: number; failed: number; pending: number };
  /**
   * Does the package actually contain every required file? The stages above
   * can each succeed while the plan is still short a document, so the run is
   * not converged until the manifest reconciles against the confirmed plan.
   */
  packageReconciliation: { requiredTotal: number; missing: number };
  /**
   * Planned files the package did not yet contain, produced automatically.
   *
   * The workflow UI tells the owner that missing planned documents are handled
   * automatically after Run Engine. They were not: every stage here repaired,
   * validated and finalised documents that ALREADY EXISTED, then reconciliation
   * reported the shortfall as a terminal blocker while the only thing that
   * could create those files was a button the owner had to find and press.
   *
   * `blocked` carries the fail-closed reason when generation could not run at
   * all (degraded analysis, no source-verified plan, an operation-gate blocker)
   * — those are real blockers and are surfaced, not swallowed.
   */
  missingFileGeneration: { generated: number; planned: number; skipped: number; blocked: string | null };
  /**
   * Tender-issued forms recovered from the user's own uploads. `stillMissing`
   * is not a blocker on its own — the export gate already refuses a document
   * left as REPLACE_WITH_ORIGINAL, and repeating it here would say the same
   * thing twice.
   */
  formReuse: { reused: number; stillMissing: number };
  /**
   * Why the tender did NOT converge to export-ready. Empty exactly when every
   * stage left nothing outstanding. `ok` is derived from this, never set
   * independently, so a stage cannot be added later that quietly leaves work
   * behind while the run still claims success.
   */
  blockers: string[];
  warning: string | null;
};

/**
 * Decide whether auto-finalize actually converged.
 *
 * Previously `ok` was initialised true and never falsified, so AUTO_FINALIZE
 * recorded SUCCEEDED with unresolved source grounding, failed or still-pending
 * validation, failed PDF finalization, or documents needing manual work. That
 * is the worst kind of false success: the pipeline reports the tender finished
 * while the export gate still refuses it, and nothing names the reason.
 *
 * Each blocker is phrased so lib/engine/stage-retry-policy.ts classifies it as
 * NON_RETRYABLE — these are states a retry cannot change, so the job must fail
 * terminally with the reason persisted rather than burn its retry budget.
 */
export function evaluateAutoFinalizeConvergence(
  result: Omit<AutoFinalizeResult, "ok" | "blockers">,
): string[] {
  const blockers: string[] = [];
  if (result.sourceRepair.remaining > 0) {
    blockers.push(`source grounding incomplete: ${result.sourceRepair.remaining} requirement(s) still have no current source trace`);
  }
  if (result.validation.failed > 0) {
    blockers.push(`readiness gate: ${result.validation.failed} document(s) failed canonical validation`);
  }
  if (result.validation.pending > 0) {
    blockers.push(`readiness gate: ${result.validation.pending} document(s) are still unvalidated`);
  }
  if (result.pdfFinalization.failed > 0) {
    blockers.push(`INTEGRITY: ${result.pdfFinalization.failed} required PDF(s) could not be finalized from a validated source`);
  }
  if (result.exportRepair.manualRequired > 0) {
    blockers.push(`AUTHORITY: ${result.exportRepair.manualRequired} document(s) need manual attention and cannot be repaired automatically`);
  }
  if (result.pdfValidation.failed > 0) {
    blockers.push(`readiness gate: ${result.pdfValidation.failed} auto-finalized PDF(s) failed canonical validation`);
  }
  if (result.pdfValidation.pending > 0) {
    blockers.push(`readiness gate: ${result.pdfValidation.pending} auto-finalized PDF(s) are still unvalidated`);
  }
  if (result.packageReconciliation.missing > 0) {
    // Name WHY the package is still short. A shortfall that survives the
    // automatic generation stage is either a file the app must not invent (an
    // official original) or a fail-closed gate — reporting the count alone left
    // the owner with a number and no next step.
    const reason = result.missingFileGeneration.blocked
      ? ` — automatic generation could not run: ${result.missingFileGeneration.blocked}`
      : result.missingFileGeneration.planned > 0
        ? ` — ${result.missingFileGeneration.planned} awaiting the tender-issued original`
        : "";
    blockers.push(`INTEGRITY: package reconciliation incomplete — ${result.packageReconciliation.missing} of ${result.packageReconciliation.requiredTotal} required file(s) are not in the package${reason}`);
  }
  return blockers;
}

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
    pdfFinalization: { finalized: 0, skipped: 0, failed: 0 },
    pdfValidation: { validated: 0, failed: 0, pending: 0 },
    packageReconciliation: { requiredTotal: 0, missing: 0 },
    missingFileGeneration: { generated: 0, planned: 0, skipped: 0, blocked: null },
    formReuse: { reused: 0, stillMissing: 0 },
    blockers: [],
    warning: null,
  };

  // Step 0: reuse tender-issued forms from the uploaded Tender Intake files.
  //
  // Generation already tries this for every form it plans, but a user who
  // uploads the missing annex AFTER the first run would otherwise stay blocked
  // on "attach the tender-issued original" forever — the run that could have
  // used it already happened. Retrying discovery here is what makes the second
  // upload enough, with no re-upload of anything the app already holds.
  try {
    await recordStep(jobId, {
      stepName: "auto-finalize.form-reuse",
      message: "Looking for tender-issued forms in the uploaded Tender Intake files",
      status: "RUNNING",
    });
    result.formReuse = await reuseAvailableTenderIssuedForms(tenderId, userId);
    await recordStep(jobId, {
      stepName: "auto-finalize.form-reuse.complete",
      message: `Tender-issued forms: ${result.formReuse.reused} reused from uploads, ${result.formReuse.stillMissing} still awaiting the original`,
      status: "SUCCEEDED",
    });
  } catch (error) {
    logger.warn("[auto-finalize] tender-issued form reuse failed", {
      tenderId,
      jobId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    throw error;
  }

  // Step 0.5: produce the planned files the package does not yet contain.
  //
  // This runs BEFORE the repair, validation and PDF stages so a file created
  // here is repaired, validated and finalised in the SAME run — otherwise the
  // chain would create a document and immediately report it unvalidated.
  //
  // Runs the same implementation, with the same gates, as
  // POST /api/tenders/[id]/generate-missing-plan-files. It never invents a file
  // the app must not produce: a tender-issued form, a priced financial proposal
  // or an official original is written as a PLANNED row awaiting its original,
  // and a requirement that states a submission RULE rather than a deliverable
  // is not in the confirmed plan at all (see
  // lib/engine/financial-separation-rule.ts).
  try {
    await recordStep(jobId, {
      stepName: "auto-finalize.missing-file-generation",
      message: "Generating planned files the package does not yet contain",
      status: "RUNNING",
    });
    const { generateMissingPlanFiles } = await import("../engine/missing-plan-file-generation");
    const generation = await generateMissingPlanFiles({
      prisma,
      tenderId,
      userId,
      actorLabel: "machine:auto-finalize",
    });
    result.missingFileGeneration = {
      generated: generation.created.length + generation.updated.length + generation.convertedFromPlanned.length,
      planned: generation.plannedCreated.length,
      skipped: generation.skipped.length,
      // NOTHING_MISSING and "nothing could be generated because every target
      // was skipped for a stated reason" are not blockers of this stage — the
      // reconciliation step below is the authority on whether the package is
      // actually short a file, and it names the shortfall once.
      blocked: generation.ok || generation.code === "NO_PLANNED_FILE_COULD_BE_GENERATED"
        ? null
        : `${generation.code}: ${generation.error}`,
    };
    await recordStep(jobId, {
      stepName: "auto-finalize.missing-file-generation.complete",
      message: result.missingFileGeneration.blocked
        ? `Missing-file generation blocked: ${result.missingFileGeneration.blocked}`
        : `Missing planned files: ${result.missingFileGeneration.generated} generated, ${result.missingFileGeneration.planned} awaiting an official original, ${result.missingFileGeneration.skipped} skipped`,
      status: result.missingFileGeneration.blocked ? "FAILED" : "SUCCEEDED",
    });
  } catch (error) {
    logger.warn("[auto-finalize] missing planned-file generation failed", {
      tenderId,
      jobId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    throw error;
  }

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
    throw error;
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
    throw error;
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
    const validation = await runCanonicalValidation(tenderId, userId);
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
    throw error;
  }

  // Step 4 (Gap 4+5): auto-finalize eligible PDFs from VALIDATED source
  // documents. Per Gap 5, PDFs are finalized ONLY from current, validated,
  // tenant-owned, integrity-verified sources — never fabricated. The
  // finalizeRequiredPdf function already enforces all these checks.
  // Per Gap 1, automation does not write reviewStatus=READY_FOR_EXPORT;
  // per Gap 5, VALIDATED is sufficient for the automatic PDF path.
  try {
    await recordStep(jobId, {
      stepName: "auto-finalize.pdf-finalization",
      message: "Auto-finalizing eligible PDFs from validated source documents",
      status: "RUNNING",
    });
    const pdfResult = await runPdfFinalization(tenderId, userId);
    result.pdfFinalization = pdfResult;
    await recordStep(jobId, {
      stepName: "auto-finalize.pdf-finalization.complete",
      message: `PDF finalization: ${pdfResult.finalized} finalized, ${pdfResult.skipped} skipped, ${pdfResult.failed} failed`,
      status: "SUCCEEDED",
    });
  } catch (error) {
    logger.warn("[auto-finalize] PDF finalization failed", {
      tenderId,
      jobId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    throw error;
  }

  // Step 5: validate the PDFs step 4 just created. They are persisted
  // validationStatus PENDING with a "awaiting canonical validation" note, and
  // canonical validation ran in step 3 — before they existed. Without this
  // pass every auto-finalized PDF stayed PENDING forever, and the export gate
  // refuses unvalidated documents, so the automatic chain could never actually
  // reach export-ready. Re-running the same canonical validator keeps one
  // validation authority rather than adding a PDF-specific one.
  if (result.pdfFinalization.finalized > 0) {
    try {
      await recordStep(jobId, {
        stepName: "auto-finalize.pdf-validation",
        message: `Validating ${result.pdfFinalization.finalized} newly finalized PDF(s)`,
        status: "RUNNING",
      });
      const pdfValidation = await runCanonicalValidation(tenderId, userId);
      result.pdfValidation = pdfValidation;
      await recordStep(jobId, {
        stepName: "auto-finalize.pdf-validation.complete",
        message: `PDF validation: ${pdfValidation.validated} validated, ${pdfValidation.failed} failed, ${pdfValidation.pending} pending`,
        status: "SUCCEEDED",
      });
    } catch (error) {
      logger.warn("[auto-finalize] PDF validation failed", {
        tenderId,
        jobId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
      throw error;
    }
  }

  // Step 6: reconcile the package against the confirmed plan. Every stage
  // above can succeed while the package is still short a required file — a
  // document that was never generated is not something any repair, validation
  // or PDF pass would notice. Reconciling here is what makes "export ready"
  // mean the package is actually complete.
  try {
    await recordStep(jobId, {
      stepName: "auto-finalize.package-reconciliation",
      message: "Reconciling package manifest against the confirmed Build Plan",
      status: "RUNNING",
    });
    result.packageReconciliation = await reconcilePackageManifest(tenderId, userId);
    await recordStep(jobId, {
      stepName: "auto-finalize.package-reconciliation.complete",
      message: `Package reconciliation: ${result.packageReconciliation.requiredTotal - result.packageReconciliation.missing}/${result.packageReconciliation.requiredTotal} required file(s) present`,
      status: "SUCCEEDED",
    });
  } catch (error) {
    logger.warn("[auto-finalize] package reconciliation failed", {
      tenderId,
      jobId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    throw error;
  }

  // Convergence is decided from what the stages actually left behind, not
  // assumed from "no stage threw". A stage that completes while leaving
  // unresolved grounding, unvalidated documents, an unfinalizable PDF, or
  // manual-only work has not finished the job the user was promised.
  result.blockers = evaluateAutoFinalizeConvergence(result);
  result.ok = result.blockers.length === 0;

  await recordStep(jobId, {
    stepName: "auto-finalize.convergence",
    message: result.ok
      ? "Auto-finalize converged: no outstanding blockers"
      : `Auto-finalize did not converge: ${result.blockers.join("; ")}`,
    status: result.ok ? "SUCCEEDED" : "FAILED",
  });

  return result;
}

/**
 * How many required plan files are still absent from the package.
 *
 * Reads the same canonical resolver the Build Plan panel and the export gate
 * read, so auto-finalize cannot disagree with what the user is shown or with
 * what the final ZIP will accept. A tender with no confirmed Build Plan has
 * nothing to reconcile against — that is reported as zero required rather than
 * invented as a blocker, because the missing plan is already the Engine's
 * blocker upstream and duplicating it here would just be noise.
 */
/**
 * Retry tender-issued form discovery for every document still waiting on an
 * original, and report how many are still waiting afterwards.
 *
 * Reuses the same discovery authority the generation route calls, so a form
 * recovered here is byte-identical and carries the same provenance as one
 * recovered during generation. Discovery fails closed per document, so a
 * document whose form genuinely is not in the uploads simply stays as it was.
 */
async function reuseAvailableTenderIssuedForms(
  tenderId: string,
  userId: string,
): Promise<{ reused: number; stillMissing: number }> {
  const { reuseTenderIssuedForm } = await import("../engine/tender-issued-form-discovery");
  const { getStorageAdapter } = await import("../storage");

  const awaiting = await prisma.generatedDocument.findMany({
    where: {
      tenderId,
      tender: { userId },
      reviewStatus: "REPLACE_WITH_ORIGINAL",
      generationStatus: { not: "SUPERSEDED" },
    },
    select: { id: true, name: true, exactFileName: true },
  });
  if (awaiting.length === 0) return { reused: 0, stillMissing: 0 };

  const storage = getStorageAdapter();
  let reused = 0;
  for (const doc of awaiting) {
    const outcome = await reuseTenderIssuedForm({
      client: prisma,
      storage,
      tenderId,
      userId,
      documentId: doc.id,
      plannedFileName: doc.exactFileName ?? doc.name,
    });
    if (outcome.reused) reused += 1;
  }

  return { reused, stillMissing: awaiting.length - reused };
}

async function reconcilePackageManifest(
  tenderId: string,
  userId: string,
): Promise<{ requiredTotal: number; missing: number }> {
  const { loadSubmissionPlanCompleteness } = await import("../engine/submission-plan-completeness");

  const loaded = await loadSubmissionPlanCompleteness(prisma, tenderId, userId);
  if (!loaded || !loaded.hasConfirmedPlan) return { requiredTotal: 0, missing: 0 };

  return { requiredTotal: loaded.report.totalRequired, missing: loaded.report.totalMissing };
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
  userId: string,
): Promise<{ validated: number; failed: number; pending: number }> {
  const { checkFullExportReadiness } = await import("../engine/export-readiness");

  // Gap B: verify tenant ownership before reading/writing documents.
  // Without this, a malicious AUTO_FINALIZE job with another tenant's
  // tenderId would read and write that tenant's documents.
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: { id: true },
  });
  if (!tender) {
    return { validated: 0, failed: 0, pending: 0 };
  }

  // Load all non-superseded documents with their content for validation.
  //
  // The persisted byte-integrity columns are part of this select because
  // checkFullExportReadiness re-verifies bytes through verifyPersistedFileBytes,
  // which compares the persisted contentSha256, contentByteLength,
  // contentMimeType and detectedFormat against a fresh inspection. Omitting
  // them did not skip that check — Prisma simply returned the fields as
  // undefined, so `persisted.integrityStatus !== "VERIFIED"` was always true
  // and every document, including intact ones, came back
  // FILE_BYTES_NOT_VERIFIED: LEGACY_INTEGRITY_UNKNOWN. This function then
  // persisted validationStatus FAILED for documents whose bytes were fine.
  //
  // Selecting them makes the existing verification run against real data; it
  // does not relax it. A document whose bytes genuinely fail still fails.
  const docs = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
    orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, name: true, exactFileName: true, exactOrder: true,
      documentType: true, format: true, generationStatus: true,
      validationStatus: true, reviewStatus: true,
      fileContent: true, storagePath: true,
      contentSha256: true, contentByteLength: true, contentMimeType: true,
      detectedFormat: true, integrityStatus: true,
    },
  });

  // Run the canonical validator (same function the /validate route uses).
  const readiness = await checkFullExportReadiness({
    tenderId,
    docs: docs as any[],
    requireFileContent: false,
  });

  // Collect the documentIds the validator actually REJECTS.
  //
  // Not every readiness failure is a rejection. checkFullExportReadiness also
  // reports workflow states — "reviewStatus is PENDING, expected
  // READY_FOR_EXPORT or VALIDATED" — for a document that is perfectly valid
  // and merely awaiting review. Treating those as rejections wrote
  // validationStatus FAILED onto a freshly finalized required PDF whose bytes
  // were verified and whose content was fine, which contradicts this
  // function's own contract below (FAILED only when "the validator explicitly
  // rejects them") and left the tender showing a failed required deliverable.
  //
  // Export readiness is NOT relaxed by this: checkFullExportReadiness still
  // reports the review-status failure and still blocks export until the
  // document is reviewed. Only the persisted validationStatus changes — a
  // document awaiting review stays PENDING instead of being recorded FAILED.
  // `validationStatus is ...` is circular here — this function is what decides
  // validationStatus, so a document being PENDING (or already FAILED from an
  // earlier pass) is not evidence that its content is bad.
  const isReviewWorkflowReason = (reason: string) =>
    /^reviewStatus is /.test(reason) || /^validationStatus is /.test(reason);
  const failedDocIds = new Set(
    readiness.failures
      .filter((f) => (f.reasons ?? []).some((reason) => !isReviewWorkflowReason(reason)))
      .map((f) => f.documentId)
      .filter(Boolean),
  );

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

/**
 * Gap 4+5: Auto-finalize eligible PDFs from VALIDATED source documents.
 *
 * Per Gap 5, PDFs are finalized ONLY from:
 *   - current (non-superseded) source documents
 *   - validated (validationStatus = VALIDATED or PASSED)
 *   - tenant-owned (the tender belongs to the user)
 *   - integrity-verified (byte integrity = VERIFIED)
 *
 * Never fabricate official forms, originals, evidence, approvals, or PDFs.
 * The finalizeRequiredPdf function enforces all source-eligibility checks.
 *
 * This function finds required PDF file names (from the tender's
 * exactFileNaming + requirements), finds the matching validated DOCX
 * source document for each, and calls finalizeRequiredPdf to render the
 * PDF. PDFs that already exist are skipped.
 */
async function runPdfFinalization(
  tenderId: string,
  userId: string,
): Promise<{ finalized: number; skipped: number; failed: number }> {
  const { finalizeRequiredPdf } = await import("../engine/workflow/pdf-finalizer");
  const { detectTenderFormatPolicy } = await import("../engine/export-format-policy");

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true, title: true, clientName: true, reference: true,
      submissionEmailSubject: true, exactFileNaming: true, exactFileOrder: true,
      user: { select: { company: { select: { name: true, legalName: true, address: true, phone: true, email: true, website: true } } } },
    },
  });
  if (!tender) return { finalized: 0, skipped: 0, failed: 0 };

  // Determine which required PDF file names are needed.
  const policy = detectTenderFormatPolicy({
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
  });

  // Reuse the canonical format parser so JSON-array storage (the normal
  // analysis representation) and legacy plain-text lists resolve identically.
  const requiredPdfNames = policy.perFile
    .filter((entry) => entry.format === "pdf")
    .map((entry) => entry.exactFileName);

  if (requiredPdfNames.length === 0 && !policy.requiresPdf) {
    return { finalized: 0, skipped: 0, failed: 0 };
  }

  // Load all non-superseded generated documents.
  const docs = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
    select: {
      id: true, name: true, exactFileName: true, documentType: true,
      format: true, generationStatus: true, validationStatus: true,
      reviewStatus: true, fileContent: true, storagePath: true,
      contentSha256: true, contentByteLength: true, integrityStatus: true,
    },
  });

  let finalized = 0;
  let skipped = 0;
  let failed = 0;

  for (const requiredName of requiredPdfNames) {
    // Check if a PDF with this exact name already exists.
    const existingPdf = docs.find(
      (d) => d.exactFileName?.toLowerCase() === requiredName.toLowerCase() && d.format === "PDF",
    );
    if (existingPdf) {
      skipped++;
      continue;
    }

    // Find the matching DOCX source (by base name, ignoring extension).
    const baseName = requiredName.replace(/\.pdf$/i, "");
    const sourceDoc = docs.find((d) => {
      const docBase = (d.exactFileName ?? d.name ?? "").replace(/\.docx$/i, "");
      return docBase.toLowerCase() === baseName.toLowerCase()
        && d.format === "DOCX"
        && (d.validationStatus === "VALIDATED" || d.validationStatus === "PASSED");
    });

    if (!sourceDoc) {
      // No validated source — skip (don't fabricate).
      skipped++;
      continue;
    }

    try {
      const result = await finalizeRequiredPdf({
        requiredFileName: requiredName,
        tender: {
          title: tender.title,
          clientName: tender.clientName,
          reference: tender.reference,
          submissionEmailSubject: tender.submissionEmailSubject,
        },
        company: tender.user?.company,
        sourceDocument: {
          id: sourceDoc.id,
          name: sourceDoc.name,
          exactFileName: sourceDoc.exactFileName,
          documentType: sourceDoc.documentType,
          format: sourceDoc.format,
          generationStatus: sourceDoc.generationStatus,
          validationStatus: sourceDoc.validationStatus,
          reviewStatus: sourceDoc.reviewStatus,
          fileContent: sourceDoc.fileContent,
          storagePath: sourceDoc.storagePath,
          contentSha256: sourceDoc.contentSha256,
          contentByteLength: sourceDoc.contentByteLength,
          integrityStatus: sourceDoc.integrityStatus,
        } as any,
      });

      if (result.ok) {
        // Persist the finalized PDF as a new GeneratedDocument.
        //
        // Integrity is DERIVED from the rendered bytes by the same canonical
        // producer normal generation uses (generate-elite.ts), not asserted.
        //
        // This block previously hand-rolled the integrity columns: it computed
        // contentSha256/contentByteLength itself, hardcoded
        // integrityStatus: "VERIFIED", and left detectedFormat and
        // integrityVerifiedAt unset. verifyPersistedFileBytes compares the
        // persisted contentSha256, contentByteLength, contentMimeType AND
        // detectedFormat against a fresh inspection of the same bytes, so a
        // null detectedFormat could never match the "PDF" it derives — every
        // auto-finalized PDF failed byte verification the moment it was
        // written. runCanonicalValidation then persisted validationStatus
        // FAILED on a PDF whose bytes were in fact intact, and the next
        // AUTO_FINALIZE attempt (the job is durably retried) went on to
        // clobber the row, leaving the tender with no usable required PDF.
        //
        // verifiedIntegrityDataFromBase64 inspects the actual bytes and throws
        // unless they genuinely verify, so this is strictly stronger than the
        // hardcoded assertion it replaces: unknown or corrupt bytes now fail
        // closed into the surrounding catch (failed++) instead of being
        // recorded as VERIFIED.
        const pdfBase64 = result.bytes.toString("base64");
        const { verifiedIntegrityDataFromBase64 } = await import("../engine/persisted-byte-integrity");
        const pdfIntegrity = verifiedIntegrityDataFromBase64({
          fileContent: pdfBase64,
          filename: requiredName,
          claimedMimeType: "application/pdf",
        });
        await prisma.generatedDocument.create({
          data: {
            tenderId,
            name: requiredName,
            exactFileName: requiredName,
            documentType: "PDF",
            format: "PDF",
            fileContent: pdfBase64,
            generationStatus: "GENERATED",
            validationStatus: "PENDING",
            reviewStatus: "PENDING",
            reviewNotes: "machine:auto-finalize-pdf — rendered from validated DOCX source. Awaiting canonical validation.",
            ...pdfIntegrity,
          },
        });
        finalized++;
      } else {
        failed++;
      }
    } catch (error) {
      logger.warn("[auto-finalize] PDF finalization failed for required file", {
        tenderId,
        requiredName,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
      failed++;
    }
  }

  return { finalized, skipped, failed };
}
