import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { runAuthorityReview, type ManifestEntry, type DocumentInput } from "../../../../../lib/engine/authority-review";
import { getFinalPackageReadinessModel } from "../../../../../lib/engine/final-package-readiness-model";
import { buildPublicReadinessEnvelope } from "../../../../../lib/engine/public-readiness-envelope";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

function jsonError(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "AUTHORITY_REVIEW_ERROR";
  return NextResponse.json({ ok: false, success: false, code, message, error: message, ...extra }, { status });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
      select: {
        id: true,
        generatedDocuments: {
          select: {
            id: true,
            name: true,
            documentType: true,
            contentSummary: true,
            reviewNotes: true,
            exactFileName: true,
            generationStatus: true,
          },
        },
      },
    });

    if (!tender) return jsonError("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    const finalPackage = await getFinalPackageReadinessModel(prisma, id, actor.id);
    const manifestEntries: ManifestEntry[] = finalPackage.documents.planned.map((document) => ({
      exactFileName: document.displayName,
      documentType: document.envelope === "financial"
        ? "FINANCIAL_PROPOSAL"
        : document.envelope === "common"
          ? "ADMIN"
          : "TECHNICAL_PROPOSAL",
    }));

    const documents: DocumentInput[] = tender.generatedDocuments
      .filter((document) => document.generationStatus === "GENERATED")
      .map((document) => ({
        id: document.id,
        name: document.name,
        documentType: document.documentType,
        contentSummary: document.contentSummary ?? null,
        reviewNotes: document.reviewNotes ?? null,
        exactFileName: document.exactFileName ?? null,
      }));

    const canonicalBlockers = [
      ...finalPackage.requirements.blockers,
      ...finalPackage.documents.blockers,
      ...finalPackage.export.blockers,
    ];

    // Authority Review is a document-level examination, not an early-stage
    // readiness score. It is unavailable until a confirmed Build Plan exists
    // and every required item has a generated, validated document. Returning
    // an explicit unavailable state avoids presenting a misleading 0/100 or
    // 10/100 score before there is anything legitimate to review.
    const requiredDocumentCount = finalPackage.documents.required.length;
    const authorityReviewAvailable = finalPackage.buildPlan.confirmed
      && requiredDocumentCount > 0
      && finalPackage.documents.missingRequired.length === 0
      && finalPackage.documents.valid.length >= requiredDocumentCount
      && documents.length > 0;

    if (!authorityReviewAvailable) {
      const unavailableReason = !finalPackage.buildPlan.confirmed
        ? "Confirm the Build Plan before Authority Review."
        : requiredDocumentCount === 0
          ? "Build the tender-controlled document plan before Authority Review."
          : finalPackage.documents.missingRequired.length > 0 || documents.length === 0
            ? "Generate every required document before Authority Review."
            : "Validate every required document before Authority Review.";
      const envelope = buildPublicReadinessEnvelope({
        ok: false,
        blockers: canonicalBlockers.map((blocker) => ({
          code: blocker.code,
          message: blocker.reason,
          nextAction: blocker.nextAction,
        })),
        warnings: [],
        requiredDocumentsTotal: requiredDocumentCount,
        generatedDocumentsTotal: finalPackage.documents.generated.length,
        exportReadyDocumentsTotal: finalPackage.documents.exportReady.length,
      });
      return NextResponse.json({
        success: true,
        available: false,
        unavailableReason,
        ...envelope,
        tenderId: id,
        authorityReview: null,
        buildPlan: finalPackage.buildPlan,
        finalPackageBlockers: canonicalBlockers,
        finalPackageFacts: {
          requiredDocumentsTotal: requiredDocumentCount,
          generatedDocumentsTotal: finalPackage.documents.generated.length,
          validDocumentsTotal: finalPackage.documents.valid.length,
          exportReadyDocumentsTotal: finalPackage.documents.exportReady.length,
        },
      });
    }

    const tenderRequiredSections = finalPackage.documents.required.map((document) => document.displayName);
    const result = runAuthorityReview(documents, manifestEntries, tenderRequiredSections);

    const publicBlockers = [
      ...canonicalBlockers.map((blocker) => ({
        code: blocker.code,
        message: blocker.reason,
        nextAction: blocker.nextAction,
      })),
      ...result.blockers.map((blocker) => ({
        code: blocker.code,
        message: blocker.detail,
        nextAction: blocker.recoveryAction,
        severity: blocker.severity,
      })),
    ];
    const ok = result.status === "AUTHORITY_READY"
      && canonicalBlockers.length === 0
      && finalPackage.buildPlan.confirmed;

    const envelope = buildPublicReadinessEnvelope({
      ok,
      blockers: publicBlockers,
      warnings: result.warnings,
      requiredDocumentsTotal: finalPackage.documents.required.length,
      generatedDocumentsTotal: finalPackage.documents.generated.length,
      exportReadyDocumentsTotal: finalPackage.documents.exportReady.length,
    });

    // result.recommendedFixes was computed by runAuthorityReview from its own
    // internal status (document-level blockers only) BEFORE canonicalBlockers
    // and finalPackage.buildPlan.confirmed are folded into the outer `ok`
    // gate below. When those add a blocker runAuthorityReview never saw, strip
    // any contradictory ready-for-export recommendation.
    const recommendedFixes = ok
      ? result.recommendedFixes
      : result.recommendedFixes.filter((fix) => fix !== "All authority review checks pass. Document is ready for final export.");

    return NextResponse.json({
      success: true,
      available: true,
      unavailableReason: null,
      ...envelope,
      tenderId: id,
      authorityReview: {
        ...result,
        status: ok ? "AUTHORITY_READY" : "BLOCKED",
        recommendedFixes,
      },
      buildPlan: finalPackage.buildPlan,
      finalPackageBlockers: canonicalBlockers,
      finalPackageFacts: {
        requiredDocumentsTotal: finalPackage.documents.required.length,
        generatedDocumentsTotal: finalPackage.documents.generated.length,
        validDocumentsTotal: finalPackage.documents.valid.length,
        exportReadyDocumentsTotal: finalPackage.documents.exportReady.length,
      },
    });
  } catch (error) {
    logger.error("Authority review route failed", { detail: error });
    return jsonError("Authority review failed.", 500, {
      code: "AUTHORITY_REVIEW_RUNTIME_ERROR",
    });
  }
}
