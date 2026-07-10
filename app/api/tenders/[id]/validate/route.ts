import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { checkFullExportReadinessWithQualityGate } from "../../../../../lib/engine/export-readiness";
import { buildTenderDocumentContext } from "../../../../../lib/document-generation/tender-document-context";
import { logAction } from "../../../../../lib/audit";
import { childLogger } from "../../../../../lib/observability";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function jsonError(message: string, status = 500) {
  return NextResponse.json(
    { ok: false, success: false, error: message, message },
    { status }
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const logger = childLogger({ route: "[validate]" });
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
    }

    await prismaReady;
    const { id } = await params;

    const tender = await prisma.tender.findUnique({
      where: { id },
      include: {
        files: true,
        requirements: { select: { title: true, description: true, priority: true, requirementType: true, sectionReference: true, exactFileName: true } },
        generatedDocuments: {
          where: { generationStatus: { not: "SUPERSEDED" } },
        },
      },
    });

    if (!tender) {
      logger.warn(`tender not found: ${id}`);
      return jsonError("Tender not found", 404);
    }

    if (tender.userId !== actor.id && actor.role !== "ADMIN") {
      logger.warn(`unauthorized access: user=${actor.id} tender=${id}`);
      return forbiddenResponse();
    }

    logger.info(`validating tender=${id}`);

    // Run export readiness check to validate all documents and tender state
    const docs = tender.generatedDocuments.map((doc) => ({
      id: doc.id,
      name: doc.name,
      exactFileName: doc.exactFileName,
      exactOrder: doc.exactOrder,
      documentType: doc.documentType,
      format: doc.format,
      generationStatus: doc.generationStatus,
      validationStatus: doc.validationStatus,
      reviewStatus: doc.reviewStatus,
      fileContent: doc.fileContent,
      storagePath: doc.storagePath,
    }));

    // Build the tender document generation context (for tender-type-aware
    // quality-gate checks). This is the same context used by the document
    // composer and the document-quality-check route.
    const ctx = buildTenderDocumentContext(
      {
        id: tender.id,
        title: tender.title,
        clientName: tender.clientName,
        reference: tender.reference,
        submissionMethod: tender.submissionMethod,
        deadline: tender.deadline,
        description: tender.description,
        intakeSummary: tender.intakeSummary,
        category: tender.category,
        country: tender.country,
      },
      tender.files,
      tender.requirements,
      [], // selectedExperts — not needed for quality-gate (only used for invented-evidence checks)
      [], // selectedProjects
      [], // selectedLegalDocuments
      [], // selectedCompanyAssets
      { name: "—", description: null, country: null, website: null, serviceLines: [], establishedYear: null },
    );

    // Use the quality-gate version: runs the standard export readiness
    // checks PLUS validateGeneratedDocumentQuality().okForFinal as a
    // final-approval blocker.
    //
    // Per spec rule 6 & 8: validation must not approve empty content,
    // placeholder content, AI traces, pricing leakage, or wrong envelope
    // files. The quality gate is what enforces these checks. If it throws,
    // we MUST fail closed — falling back to the weaker base readiness would
    // silently skip placeholder/AI-trace/pricing checks and could let an
    // invalid document pass validation. The previous .catch() fallback was
    // a real safety gap.
    let readiness;
    try {
      readiness = await checkFullExportReadinessWithQualityGate({
        tenderId: id,
        docs,
        requireFileContent: false,
        ctx,
      });
    } catch (err) {
      logger.error(`quality-gate check threw — failing closed to prevent invalid docs from passing validation: ${err instanceof Error ? err.message : String(err)}`);
      return NextResponse.json(
        {
          ok: false,
          success: false,
          error: "Validation quality gate failed. Documents cannot be safely validated at this time. Refresh to retry, or contact support if the problem persists.",
          code: "QUALITY_GATE_UNAVAILABLE",
          qualityGateDegraded: true,
        },
        { status: 500 },
      );
    }

    const validationResults = {
      documentCount: docs.length,
      failureCount: readiness.failures.length,
      documentFailures: readiness.failures.map((f) => ({
        documentId: f.documentId,
        name: f.name,
        reasons: f.reasons,
      })),
      tenderLevelBlockers: readiness.tenderLevelBlockers ?? [],
      advisoryWarnings: readiness.advisoryWarnings ?? [],
    };

    // ── PDF format coverage check ────────────────────────────────────────────
    // Per spec rule 5: PDF conversion unavailable must be a structured
    // blocker, not a vague warning. If the tender requires PDF output
    // (e.g., "Technical Proposal.pdf") but only DOCX files are generated,
    // surface a structured PDF_REQUIRED_CONVERSION_UNAVAILABLE blocker
    // BEFORE the user attempts export. This gives an earlier, clearer
    // error than waiting for the document output state machine to catch
    // the mismatch at download time.
    //
    // Defect 1 fix: Also check TenderRequirement.exactFileName values for
    // required PDF filenames — the tender-level exactFileNaming may be empty
    // while individual requirements specify "Technical Proposal.pdf".
    //
    // Defect 3 fix: Only count extensions from GENERATED docs with real content
    // or storage — PLANNED/PENDING rows must never satisfy format coverage.
    let pdfCoverageBlocker: { code: string; missing: string[]; reason: string } | null = null;
    try {
      const { detectTenderFormatPolicy, checkTenderFormatCoverage } = await import("../../../../../lib/engine/export-format-policy");

      // Collect requirement-level exact filenames that end in .pdf
      const requirementPdfNames = (tender.requirements ?? [])
        .map((r: { exactFileName?: string | null }) => r.exactFileName ?? "")
        .filter((name: string) => name.trim().toLowerCase().endsWith(".pdf"));

      // Combine tender-level + requirement-level filenames for policy detection
      const allRequiredNames = [
        ...(tender.exactFileNaming ? tender.exactFileNaming.split(/[;,\n]/).map((s: string) => s.trim()).filter(Boolean) : []),
        ...requirementPdfNames,
      ];
      const combinedFileNaming = allRequiredNames.length > 0 ? allRequiredNames.join("\n") : tender.exactFileNaming;

      const policy = detectTenderFormatPolicy({
        exactFileNaming: combinedFileNaming,
        exactFileOrder: tender.exactFileOrder,
      });

      // Defect 3: Only count extensions from GENERATED docs with real content/storage
      const generatedExtensions = docs
        .filter((d) => d.generationStatus === "GENERATED" && (d.fileContent || d.storagePath))
        .map((d) => (d.exactFileName ?? d.name ?? "").split(".").pop() ?? "")
        .filter(Boolean);
      const coverage = checkTenderFormatCoverage(policy, generatedExtensions);
      if (!coverage.ok && coverage.code === "PDF_REQUIRED_CONVERSION_UNAVAILABLE") {
        pdfCoverageBlocker = { code: coverage.code, missing: coverage.missing, reason: coverage.reason };
      }
    } catch (err) {
      logger.warn(`PDF format coverage check failed (non-fatal): ${err instanceof Error ? err.constructor.name : "UnknownError"}`);
    }

    // Log the validation action
    await logAction({
      userId: actor.id,
      action: "VALIDATE_DOCUMENTS",
      entityType: "Tender",
      entityId: id,
      description: `Validated ${docs.length} document(s) for export readiness${pdfCoverageBlocker ? " (PDF coverage blocked)" : ""}`,
      metadata: {
        documentCount: docs.length,
        validationOk: readiness.ok && !pdfCoverageBlocker,
        failureCount: readiness.failures.length,
        blockerCount: (readiness.tenderLevelBlockers?.length ?? 0) + (pdfCoverageBlocker ? 1 : 0),
        pdfCoverageBlocked: Boolean(pdfCoverageBlocker),
      },
    }).catch((err) => logger.warn(`failed to log action: ${err}`));

    if (!readiness.ok || pdfCoverageBlocker) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          error: pdfCoverageBlocker
            ? `Validation blocked: ${pdfCoverageBlocker.reason}`
            : `Validation found ${readiness.failures.length} document issue(s) and ${readiness.tenderLevelBlockers?.length ?? 0} tender-level blocker(s).`,
          ...(pdfCoverageBlocker ? { code: pdfCoverageBlocker.code, pdfCoverageBlocked: true, missingPdfFiles: pdfCoverageBlocker.missing } : {}),
          ...validationResults,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ok: true,
      success: true,
      message: "All documents validated successfully.",
      ...validationResults,
    });
  } catch (err) {
    logger.error("[validate] failed", { detail: err });
    return jsonError("Validation failed. Refresh to retry.", 500);
  }
}
