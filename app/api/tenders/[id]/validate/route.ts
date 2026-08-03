import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { checkFullExportReadinessWithQualityGate } from "../../../../../lib/engine/export-readiness";
import { buildTenderDocumentContext } from "../../../../../lib/document-generation/tender-document-context";
import { getFinalPackageReadinessModel } from "../../../../../lib/engine/final-package-readiness-model";
import { buildPublicReadinessEnvelope } from "../../../../../lib/engine/public-readiness-envelope";
import { logAction } from "../../../../../lib/audit";
import { childLogger } from "../../../../../lib/observability";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function jsonError(message: string, status = 500) {
  return NextResponse.json(
    { ok: false, success: false, error: message, message },
    { status },
  );
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const logger = childLogger({ route: "[validate]" });
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      return message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
    }

    await prismaReady;
    const { id } = await params;

    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
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

    logger.info(`validating tender=${id}`);

    const finalPackage = await getFinalPackageReadinessModel(prisma, id, actor.id);
    const canonicalBlockers = [
      ...finalPackage.requirements.blockers,
      ...finalPackage.documents.blockers,
      ...finalPackage.export.blockers,
    ];

    const docs = tender.generatedDocuments.map((document) => ({
      id: document.id,
      name: document.name,
      exactFileName: document.exactFileName,
      exactOrder: document.exactOrder,
      documentType: document.documentType,
      format: document.format,
      generationStatus: document.generationStatus,
      validationStatus: document.validationStatus,
      reviewStatus: document.reviewStatus,
      fileContent: document.fileContent,
      storagePath: document.storagePath,
    }));

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
      [],
      [],
      [],
      [],
      { name: "—", description: null, country: null, website: null, serviceLines: [], establishedYear: null },
    );

    let readiness;
    try {
      readiness = await checkFullExportReadinessWithQualityGate({
        tenderId: id,
        docs,
        requireFileContent: false,
        ctx,
      });
    } catch (error) {
      logger.error(`quality-gate check threw — failing closed to prevent invalid docs from passing validation: ${error instanceof Error ? error.message : String(error)}`);
      return NextResponse.json(
        {
          ok: false,
          success: false,
          error: "Validation quality gate failed. Documents cannot be safely validated at this time. Contact support if the problem persists.",
          code: "QUALITY_GATE_UNAVAILABLE",
          qualityGateDegraded: true,
        },
        { status: 500 },
      );
    }

    let pdfCoverageBlocker: { code: string; missing: string[]; reason: string } | null = null;
    try {
      const { detectTenderFormatPolicy, checkTenderFormatCoverage } = await import("../../../../../lib/engine/export-format-policy");
      const requirementPdfNames = (tender.requirements ?? [])
        .map((requirement: { exactFileName?: string | null }) => requirement.exactFileName ?? "")
        .filter((name: string) => name.trim().toLowerCase().endsWith(".pdf"));
      const allRequiredNames = [
        ...(tender.exactFileNaming ? tender.exactFileNaming.split(/[;,\n]/).map((value: string) => value.trim()).filter(Boolean) : []),
        ...requirementPdfNames,
      ];
      const combinedFileNaming = allRequiredNames.length > 0 ? allRequiredNames.join("\n") : tender.exactFileNaming;
      const policy = detectTenderFormatPolicy({
        exactFileNaming: combinedFileNaming,
        exactFileOrder: tender.exactFileOrder,
      });
      const generatedExtensions = docs
        .filter((document) => document.generationStatus === "GENERATED" && (document.fileContent || document.storagePath))
        .map((document) => (document.exactFileName ?? document.name ?? "").split(".").pop() ?? "")
        .filter(Boolean);
      const coverage = checkTenderFormatCoverage(policy, generatedExtensions);
      if (!coverage.ok && coverage.code === "PDF_REQUIRED_CONVERSION_UNAVAILABLE") {
        pdfCoverageBlocker = { code: coverage.code, missing: coverage.missing, reason: coverage.reason };
      }
    } catch (error) {
      logger.warn(`PDF format coverage check failed (non-fatal): ${error instanceof Error ? error.constructor.name : "UnknownError"}`);
    }

    const validationResults = {
      documentCount: docs.length,
      failureCount: readiness.failures.length,
      documentFailures: readiness.failures.map((failure) => ({
        documentId: failure.documentId,
        name: failure.name,
        reasons: failure.reasons,
      })),
      tenderLevelBlockers: readiness.tenderLevelBlockers ?? [],
      canonicalPackageBlockers: canonicalBlockers,
      advisoryWarnings: readiness.advisoryWarnings ?? [],
      buildPlan: finalPackage.buildPlan,
    };

    const publicBlockers = [
      ...canonicalBlockers.map((blocker) => ({
        code: blocker.code,
        message: blocker.reason,
        nextAction: blocker.nextAction,
      })),
      ...readiness.failures.map((failure) => ({
        code: "DOCUMENT_VALIDATION_FAILED",
        message: `${failure.name}: ${failure.reasons.join("; ")}`,
        nextAction: "Repair and regenerate the document before validation.",
      })),
      ...(readiness.tenderLevelBlockers ?? []).map((blocker) => ({
        code: blocker.category ?? "TENDER_VALIDATION_BLOCKER",
        message: blocker.title ?? "Tender-level validation blocker remains.",
        nextAction: blocker.recommendedAction ?? "Resolve the tender-level blocker.",
        severity: blocker.severity,
      })),
      ...(pdfCoverageBlocker ? [{
        code: pdfCoverageBlocker.code,
        message: pdfCoverageBlocker.reason,
        nextAction: "Upload or attach the required final PDF files.",
      }] : []),
    ];
    const validationOk = readiness.ok
      && !pdfCoverageBlocker
      && canonicalBlockers.length === 0
      && finalPackage.buildPlan.confirmed;
    const envelope = buildPublicReadinessEnvelope({
      ok: validationOk,
      blockers: publicBlockers,
      warnings: readiness.advisoryWarnings ?? [],
      requiredDocumentsTotal: finalPackage.documents.required.length,
      generatedDocumentsTotal: finalPackage.documents.generated.length,
      exportReadyDocumentsTotal: finalPackage.documents.exportReady.length,
    });

    await logAction({
      userId: actor.id,
      action: "VALIDATE_DOCUMENTS",
      entityType: "Tender",
      entityId: id,
      description: `Validated ${docs.length} document(s) against canonical package readiness${pdfCoverageBlocker ? " (PDF coverage blocked)" : ""}`,
      metadata: {
        documentCount: docs.length,
        validationOk,
        failureCount: readiness.failures.length,
        canonicalBlockerCount: canonicalBlockers.length,
        blockerCount: publicBlockers.length,
        pdfCoverageBlocked: Boolean(pdfCoverageBlocker),
      },
    }).catch((error) => logger.warn(`failed to log action: ${error}`));

    if (!validationOk) {
      return NextResponse.json(
        {
          success: false,
          ...envelope,
          error: pdfCoverageBlocker
            ? `Validation blocked: ${pdfCoverageBlocker.reason}`
            : `Validation is blocked by ${publicBlockers.length} canonical or document issue(s).`,
          ...(pdfCoverageBlocker ? { code: pdfCoverageBlocker.code, pdfCoverageBlocked: true, missingPdfFiles: pdfCoverageBlocker.missing } : {}),
          ...validationResults,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      success: true,
      ...envelope,
      message: "All canonical package and document validation checks passed.",
      ...validationResults,
    });
  } catch (error) {
    logger.error("[validate] failed", { detail: error });
    return jsonError("Validation failed.", 500);
  }
}
