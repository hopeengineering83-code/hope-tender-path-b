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
import { isGenerated } from "../engine/document-output-state";

/**
 * Canonical validation outcome.
 *
 * `rejected` names the documents the validator actually refused and why.
 *
 * The counts alone produced a blocker the owner could not act on — "1
 * auto-finalized PDF(s) failed canonical validation" identifies neither the
 * document nor the defect — and the same opacity made an intermittent CI
 * failure in tests/owner-workflow-complete-postgres.test.ts impossible to
 * diagnose from the failure message. A blocker that cannot be acted on is not
 * a blocker, it is a dead end.
 */
export type CanonicalValidationOutcome = {
  validated: number;
  failed: number;
  pending: number;
  rejected: Array<{ documentId: string; fileName: string; reasons: string[] }>;
};

export type AutoFinalizeResult = {
  ok: boolean;
  sourceRepair: { checked: number; repaired: number; remaining: number };
  /**
   * The export-repair stage's own verdict, carried in full.
   *
   * This type used to declare only the three counters, while the value assigned
   * to it also carried `finalExportReady` and the remaining blocker counts —
   * the canonical answer to "can this tender export", computed by the very run
   * that was about to report convergence. Because the field was not declared,
   * the convergence evaluator could not see it, and so never asked. A run could
   * therefore report ok:true with finalExportReady:false beside it.
   */
  exportRepair: {
    repaired: number;
    skipped: number;
    manualRequired: number;
    finalExportReady?: boolean;
    remainingDocumentBlockers?: number;
    remainingTenderLevelBlockers?: number;
  };
  /**
   * The canonical export gate's verdict AFTER every stage of this run.
   * `evaluated` is false only when the check itself could not be run, in which
   * case convergence does not invent an answer either way.
   */
  finalReadiness: {
    evaluated: boolean;
    ok: boolean;
    documentBlockers: number;
    tenderLevelBlockers: number;
    /** Blocker categories, so the failure names what is wrong rather than counting it. */
    categories: string[];
  };
  validation: CanonicalValidationOutcome;
  pdfFinalization: { finalized: number; skipped: number; failed: number };
  /**
   * Second validation pass over the PDFs the finalization stage just created.
   * They are persisted validationStatus PENDING, and canonical validation had
   * already run one stage earlier, so without this every auto-finalized PDF
   * stayed unvalidated forever — and an unvalidated document is exactly what
   * the export gate refuses.
   */
  pdfValidation: CanonicalValidationOutcome;
  /**
   * Requirement coverage refreshed against the artifacts that now exist.
   *
   * Coverage is first computed during Run Engine, when the deliverables are
   * still promises: a requirement answered by the proposal's own document has
   * only a PARTIAL build-plan row, because `artifactBytesVerified` is false
   * until the bytes exist. Nothing recomputed it afterwards on this path, so
   * the export gate judged engine-time evidence and refused a package whose
   * documents were generated, validated and byte-verified.
   *
   * `refreshed: false` means the sync could not run; stored coverage is then
   * judged as-is, which fails closed.
   */
  coverageReconciliation: { refreshed: boolean; requirementsChecked: number };
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
/**
 * Render "…: Technical-Proposal.pdf (Placeholder or unresolved drafting
 * instruction is present)" when the outcome names its rejections, and nothing
 * when it does not.
 *
 * This is a summariser: it must degrade rather than throw when handed an
 * outcome without the field. Reading `.rejected.length` directly crashed on
 * every partial fixture, which is exactly the shape a caller building a
 * summary is entitled to pass.
 */
function namedRejections(outcome: Partial<CanonicalValidationOutcome> | undefined): string {
  const rejected = outcome?.rejected ?? [];
  if (rejected.length === 0) return "";
  return `: ${rejected.map((row) => `${row.fileName} (${row.reasons.join("; ")})`).join(", ")}`;
}

export function evaluateAutoFinalizeConvergence(
  result: Omit<AutoFinalizeResult, "ok" | "blockers">,
): string[] {
  const blockers: string[] = [];
  if (result.sourceRepair.remaining > 0) {
    blockers.push(`source grounding incomplete: ${result.sourceRepair.remaining} requirement(s) still have no current source trace`);
  }
  if (result.validation.failed > 0) {
    blockers.push(`readiness gate: ${result.validation.failed} document(s) failed canonical validation` + namedRejections(result.validation));
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
    blockers.push(`readiness gate: ${result.pdfValidation.failed} auto-finalized PDF(s) failed canonical validation` + namedRejections(result.pdfValidation));
  }
  if (result.pdfValidation.pending > 0) {
    blockers.push(`readiness gate: ${result.pdfValidation.pending} auto-finalized PDF(s) are still unvalidated`);
  }
  // The canonical export gate, consulted at the end of the run.
  //
  // Every check above could pass while the gate that actually decides whether a
  // ZIP can be produced said no: the job was recorded SUCCEEDED, the owner was
  // told the pipeline had converged, no further automatic stage ran, and the
  // download was then refused — a silent dead end at the last stage.
  //
  // This must be the FINAL verdict, not the snapshot the repair stage returns.
  // `exportRepair.finalExportReady` is computed part-way through, before
  // canonical validation has run, so freshly regenerated documents are still
  // PENDING when it is taken and it reports blockers that the very next stage
  // clears. Reading it here would fail every ordinary successful run.
  // Optional-chained: this evaluator is exported and is called with hand-built
  // results in its own suites. A caller that never ran the check asserts
  // nothing about readiness rather than crashing on a missing field.
  if (result.finalReadiness?.evaluated && !result.finalReadiness.ok) {
    blockers.push(
      `readiness gate: the export readiness check refuses this package — ${result.finalReadiness.documentBlockers ?? 0} document blocker(s) and ${result.finalReadiness.tenderLevelBlockers ?? 0} tender-level blocker(s) remain${(result.finalReadiness.categories ?? []).length > 0 ? `: ${result.finalReadiness.categories.join(", ")}` : ""}`,
    );
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
    finalReadiness: { evaluated: false, ok: false, documentBlockers: 0, tenderLevelBlockers: 0, categories: [] },
    validation: { validated: 0, failed: 0, pending: 0, rejected: [] },
    pdfFinalization: { finalized: 0, skipped: 0, failed: 0 },
    pdfValidation: { validated: 0, failed: 0, pending: 0, rejected: [] },
    coverageReconciliation: { refreshed: false, requirementsChecked: 0 },
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

  // Step 3b: refresh requirement coverage against the artifacts that now exist.
  //
  // lib/engine/validate.ts already does this, and its comment says doing it
  // there "covers every path that reaches a verdict, since both POST /validate
  // and POST /export come through this function". That is not true of this
  // path: runCanonicalValidation below imports checkFullExportReadiness from
  // export-readiness and validates documents directly, so the automatic
  // pipeline — the one the owner automation contract says must need no clicks —
  // reached the export gate having never refreshed coverage.
  //
  // The effect was a tender that cannot be finished. Coverage is computed at
  // Run Engine time, when a requirement answered by the proposal's own
  // deliverable has only a PARTIAL build-plan row. Generation then produces the
  // document, validation passes it, its bytes verify — and the export gate
  // still reads the engine-time PARTIAL and refuses the ZIP for
  // MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE. The only way past it was to know to
  // POST /api/tenders/{id}/requirement-coverage/auto-sync by hand.
  //
  // This calls the SAME canonical service, not another coverage rule: it is an
  // idempotent desired-state sync, so running it on an already-current tender
  // is a no-op. It cannot manufacture coverage either — a build-plan row only
  // reaches SUBSTANTIAL when artifactBytesVerified is true, and a generated
  // document only reaches FULL when it passed validation.
  try {
    await recordStep(jobId, {
      stepName: "auto-finalize.coverage-reconcile",
      message: "Refreshing requirement coverage against generated artifacts",
      status: "RUNNING",
    });
    const { reconcileAutomaticRequirementCoverage } = await import("../engine/reconcile-automatic-requirement-coverage");
    const coverage = await reconcileAutomaticRequirementCoverage(prisma, tenderId, userId);
    result.coverageReconciliation = {
      refreshed: coverage.ok === true,
      requirementsChecked: coverage.requirementsChecked ?? 0,
    };
    await recordStep(jobId, {
      stepName: "auto-finalize.coverage-reconcile.complete",
      message: `Requirement coverage refreshed: ${result.coverageReconciliation.requirementsChecked} requirement(s) checked`,
      status: "SUCCEEDED",
    });
  } catch (error) {
    // Never fail the run for this. Coverage that could not be refreshed is
    // simply not refreshed, and the gates below judge what is stored — which
    // blocks rather than releases, so the failure mode stays closed.
    logger.warn("[auto-finalize] requirement-coverage reconcile failed; judging stored coverage", {
      tenderId,
      jobId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    result.coverageReconciliation = { refreshed: false, requirementsChecked: 0 };
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
  // Ask the canonical gate whether this package can actually export, now that
  // every stage has run. This is the same entry point the export-readiness
  // route and the ZIP download use, so the job and the download cannot reach
  // opposite conclusions about the same tender.
  try {
    const { getFinalSubmissionReadiness } = await import("../engine/final-submission-readiness");
    // requireFileContent matches the ZIP download exactly. The job and the
    // download must reach the same conclusion about the same tender, and the
    // download is the authority that actually produces the archive.
    const readiness = await getFinalSubmissionReadiness(prisma, { tenderId, userId, requireFileContent: true });
    // A null verdict means the gate could not evaluate this tender at all.
    // Convergence then asserts nothing about readiness rather than inventing
    // either answer.
    if (readiness) {
      result.finalReadiness = {
        evaluated: true,
        ok: readiness.ok === true,
        documentBlockers: readiness.documentBlockers?.length ?? 0,
        tenderLevelBlockers: readiness.tenderLevelBlockers?.length ?? 0,
        categories: [
          ...(readiness.tenderLevelBlockers ?? []),
          ...(readiness.documentBlockers ?? []),
        ]
          .map((blocker) => String((blocker as { category?: unknown }).category ?? "UNKNOWN"))
          .filter((value, index, all) => all.indexOf(value) === index)
          .slice(0, 6),
      };
    }
  } catch (error) {
    logger.warn("[auto-finalize] final readiness evaluation failed; convergence will not assert readiness", {
      tenderId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
  }

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
): Promise<CanonicalValidationOutcome> {
  const { checkFullExportReadiness } = await import("../engine/export-readiness");

  // Gap B: verify tenant ownership before reading/writing documents.
  // Without this, a malicious AUTO_FINALIZE job with another tenant's
  // tenderId would read and write that tenant's documents.
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: { id: true },
  });
  if (!tender) {
    return { validated: 0, failed: 0, pending: 0, rejected: [] };
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
  // Name every document counted as failed, with the validator's own reasons,
  // so the blocker says what to fix instead of only how many.
  const rejectionReasons = new Map<string, string[]>();
  for (const failure of readiness.failures) {
    if (!failure.documentId) continue;
    const actionable = (failure.reasons ?? []).filter((reason) => !isReviewWorkflowReason(reason));
    if (actionable.length > 0) rejectionReasons.set(failure.documentId, actionable);
  }
  const rejected: CanonicalValidationOutcome["rejected"] = [];
  const recordRejection = (doc: { id: string; exactFileName: string | null; name: string | null }) => {
    rejected.push({
      documentId: doc.id,
      fileName: doc.exactFileName ?? doc.name ?? doc.id,
      reasons: rejectionReasons.get(doc.id) ?? ["validationStatus was already FAILED from an earlier pass"],
    });
  };

  for (const doc of docs) {
    // Only auto-validate documents that are currently PENDING (i.e. the
    // ones the export-gap repair just set). Don't touch documents that
    // are already VALIDATED, FAILED, or in a human-review state.
    if (doc.validationStatus !== "PENDING") {
      if (doc.validationStatus === "VALIDATED" || doc.validationStatus === "PASSED") validated++;
      else if (doc.validationStatus === "FAILED") { failed++; recordRejection(doc); }
      else pending++;
      continue;
    }

    // A fresh PLANNED row is an empty identity, not a deliverable yet — it
    // has no content for this pass to judge one way or the other. Most
    // PLANNED rows are already filled in by the missing-plan-file generation
    // stage that runs earlier in this same job, but a PLANNED row for a
    // required PDF is deliberately left empty here: PDF finalization (the
    // stage right after this one, in runAutoFinalizeAfterGeneration) fills
    // this exact row in place with the rendered bytes. Marking it FAILED
    // pre-judged a placeholder before finalization had the chance to fill
    // it, and — because AUTO_FINALIZE's identity is deterministic per
    // analysis revision — that FAILED verdict, once persisted, stood as a
    // terminal blocker even after finalization went on to fill and validate
    // the very same row two stages later in the same run. A PLANNED row
    // finalization does not end up filling is still caught downstream by
    // packageReconciliation's "N required file(s) are not in the package"
    // and by the final export-readiness gate's own
    // UNGENERATED_PLANNED_DOCUMENTS check, so nothing here lets a
    // genuinely-missing deliverable through — it only stops this pass from
    // prejudging one this run has not tried to produce yet.
    if (doc.generationStatus === "PLANNED") {
      pending++;
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
    else { failed++; recordRejection(doc); }
  }

  return { validated, failed, pending, rejected };
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
      updatedAt: true,
    },
  });

  let finalized = 0;
  let skipped = 0;
  let failed = 0;

  for (const requiredName of requiredPdfNames) {
    // Check if the required PDF has actually been PRODUCED.
    //
    // This asked whether a row with that name and format PDF exists, which is
    // not the same question. A required PDF the tender names but nothing has
    // rendered yet is carried as a PLANNED placeholder row — same exactFileName,
    // format PDF, no bytes — so the placeholder was mistaken for the finished
    // file, finalization was skipped, and the very same row was then reported
    // by canonical validation as CONTROL_RECORD_ONLY and by export readiness as
    // UNGENERATED_PLANNED_DOCUMENTS. AUTO_FINALIZE could not converge, and the
    // owner was told to "generate or attach the real final file" for a file the
    // pipeline had just declined to generate.
    //
    // Ask for real bytes instead, using the same GENERATED-and-exportable
    // predicate the export gate applies. A finalized PDF still short-circuits;
    // only a placeholder no longer pretends to be one.
    const existingPdf = docs.find(
      (d) => d.exactFileName?.toLowerCase() === requiredName.toLowerCase()
        && d.format === "PDF"
        && isGenerated(d.generationStatus)
        && Boolean(d.fileContent || d.storagePath),
    );
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
    if (existingPdf && existingPdf.updatedAt >= sourceDoc.updatedAt) {
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
        // Fill the PLANNED row in rather than adding a second one.
        //
        // A required PDF the tender names is carried as a PLANNED placeholder
        // until something renders it, and
        // GeneratedDocument_tenderId_exactFileName_active_key makes
        // (tenderId, exactFileName) unique across every non-superseded row. So
        // creating the finalized PDF beside its own placeholder violated that
        // constraint, the write threw, and the catch below counted a rendered,
        // byte-verified PDF as "failed to finalize" — while the untouched
        // placeholder went on being reported as CONTROL_RECORD_ONLY and
        // UNGENERATED_PLANNED_DOCUMENTS. The plan row IS the deliverable's
        // identity; finalization gives it its bytes.
        const plannedRow = docs.find(
          (d) => d.exactFileName?.toLowerCase() === requiredName.toLowerCase()
            && !isGenerated(d.generationStatus)
            && !d.fileContent
            && !d.storagePath,
        );
        const finalizedPdfData = {
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
        } as const;
        const targetRow = existingPdf ?? plannedRow;
        if (targetRow) {
          await prisma.generatedDocument.update({ where: { id: targetRow.id }, data: finalizedPdfData });
        } else {
          await prisma.generatedDocument.create({ data: finalizedPdfData });
        }

        // The DOCX this PDF was rendered from is an intermediate, not a second
        // deliverable. Left GENERATED it becomes a file the tender never named:
        // findExtraGeneratedDocuments counts every GENERATED row outside the
        // confirmed plan, export readiness reports EXTRA_FILES, and the final
        // ZIP refuses the package. SUPERSEDED is the status this codebase
        // already uses for "preserved history, not a current deliverable", and
        // that same function already excludes it, so the source stays auditable
        // without being shipped. Only a source that actually produced the
        // required PDF is superseded; a DOCX the tender itself asked for is
        // never a PDF source here, so it is untouched.
        await prisma.generatedDocument.update({
          where: { id: sourceDoc.id },
          data: {
            generationStatus: "SUPERSEDED",
            reviewNotes: `machine:auto-finalize-pdf — superseded by ${requiredName}, which was rendered from this source.`,
            updatedAt: new Date(),
          },
        }).catch((error: unknown) => {
          logger.warn("[auto-finalize] could not supersede PDF source document", {
            tenderId,
            requiredName,
            errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
          });
        });
        finalized++;
      } else {
        // Say WHY. The blocker code and its safe public message were dropped
        // here, so a required PDF that could not be rendered surfaced only as
        // the generic "could not be finalized from a validated source" and the
        // actual cause — an unreadable source, an unsupported format, an empty
        // extraction — was invisible in logs and in the job's own steps.
        logger.warn("[auto-finalize] required PDF was not finalized", {
          tenderId,
          requiredName,
          sourceDocumentId: sourceDoc.id,
          blockerCode: result.code,
          publicMessage: result.publicMessage,
        });
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
