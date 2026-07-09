import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { checkFullExportReadiness, checkFullExportReadinessWithQualityGate } from "../../../../../lib/engine/export-readiness";
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
        requirements: { select: { title: true, description: true, priority: true, requirementType: true, sectionReference: true } },
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
    const readiness = await checkFullExportReadinessWithQualityGate({
      tenderId: id,
      docs,
      requireFileContent: false,
      ctx,
    }).catch((err) => {
      logger.warn(`quality-gate check failed, falling back to base readiness: ${err instanceof Error ? err.message : String(err)}`);
      return checkFullExportReadiness({ tenderId: id, docs, requireFileContent: false });
    });

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

    // Log the validation action
    await logAction({
      userId: actor.id,
      action: "VALIDATE_DOCUMENTS",
      entityType: "Tender",
      entityId: id,
      description: `Validated ${docs.length} document(s) for export readiness`,
      metadata: {
        documentCount: docs.length,
        validationOk: readiness.ok,
        failureCount: readiness.failures.length,
        blockerCount: readiness.tenderLevelBlockers?.length ?? 0,
      },
    }).catch((err) => logger.warn(`failed to log action: ${err}`));

    if (!readiness.ok) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          error: `Validation found ${readiness.failures.length} document issue(s) and ${readiness.tenderLevelBlockers?.length ?? 0} tender-level blocker(s).`,
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
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`validation failed: ${message}`);
    return jsonError(`Validation error: ${message}`, 500);
  }
}
