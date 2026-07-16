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
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
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
    const manifestEntries: ManifestEntry[] = finalPackage.documents.required.map((required) => ({
      exactFileName: required.displayName,
      documentType: "TENDER_REQUIRED_FILE",
    }));

    // Only check GENERATED documents (not PLANNED stubs)
    const documents: DocumentInput[] = tender.generatedDocuments
      .filter((d) => d.generationStatus === "GENERATED")
      .map((d) => ({
        id: d.id,
        name: d.name,
        documentType: d.documentType,
        contentSummary: d.contentSummary ?? null,
        reviewNotes: d.reviewNotes ?? null,
        exactFileName: d.exactFileName ?? null,
      }));

    const tenderRequiredSections = finalPackage.documents.required.map((required) => required.displayName);

    const result = runAuthorityReview(documents, manifestEntries, tenderRequiredSections);
    const authorityBlockers = result.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.detail,
      nextAction: blocker.recoveryAction,
      severity: blocker.severity,
    }));
    const blockers = [
      ...finalPackage.documents.blockers,
      ...finalPackage.export.blockers,
      ...authorityBlockers,
    ];
    const envelope = buildPublicReadinessEnvelope({
      ok: result.status === "AUTHORITY_READY" && finalPackage.export.zipReady,
      blockers,
      warnings: [],
      requiredDocumentsTotal: finalPackage.documents.required.length,
      generatedDocumentsTotal: finalPackage.documents.generated.length,
      exportReadyDocumentsTotal: finalPackage.documents.exportReady.length,
    });

    return NextResponse.json({
      ...envelope,
      success: true,
      tenderId: id,
      authorityReview: result,
    });
  } catch (error) {
    logger.error("Authority review route failed", { detail: error });
    return jsonError("Authority review failed.", 500, {
      code: "AUTHORITY_REVIEW_RUNTIME_ERROR",
    });
  }
}
