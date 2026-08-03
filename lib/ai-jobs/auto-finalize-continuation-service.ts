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
    pdfFinalization: { finalized: 0, skipped: 0, failed: 0 },
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
    result.warning = (result.warning ?? "") + " Canonical validation encountered an error. Documents remain PENDING.";
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
    result.warning = (result.warning ?? "") + " PDF finalization encountered an error. Eligible PDFs may need manual finalization.";
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

  // Get the list of required PDF names from exactFileNaming.
  const requiredPdfNames = (tender.exactFileNaming ?? "")
    .split(/[;,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.toLowerCase().endsWith(".pdf"))
    .filter(Boolean);

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
        const pdfBase64 = result.bytes.toString("base64");
        const { createHash } = await import("crypto");
        const contentSha256 = createHash("sha256").update(result.bytes).digest("hex");
        const contentByteLength = result.bytes.byteLength;
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
            contentSha256,
            contentByteLength,
            integrityStatus: "VERIFIED",
            contentMimeType: "application/pdf",
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
