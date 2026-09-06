import { NextResponse } from "next/server";
import { requireUser, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getStorageAdapter } from "../../../../../lib/storage";
import { extractDocxVisibleText } from "../../../../../lib/engine/export-readiness";
import { childLogger } from "../../../../../lib/observability";
import { validateGeneratedDocumentQuality } from "../../../../../lib/document-generation/generated-document-quality-validator";
import { buildTenderDocumentContext, type TenderDocumentGenerationContext, type SelectedExpertForDocument, type SelectedProjectForDocument, type SelectedLegalDocumentForDocument, type SelectedCompanyAssetForDocument, type CompanyProfileForDocument } from "../../../../../lib/document-generation/tender-document-context";
import { classifyTender } from "../../../../../lib/engine/tender-classification";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function jsonError(message: string, status = 500) {
  return NextResponse.json(
    { ok: false, success: false, error: message, message },
    { status },
  );
}

/**
 * POST /api/tenders/[id]/document-quality-check
 *
 * Runs the new lib/document-generation/ quality validator against every
 * non-SUPERSEDED generated document for the tender and returns a per-document
 * quality report (missing sections, placeholders, AI traces, invented-evidence
 * risks, final-blockers, okForDraft, okForFinal, score).
 *
 * Read-only — does NOT modify the document records and does NOT block export.
 * The existing /api/tenders/[id]/validate route is the source of truth for
 * export blocking; this route is an advisory quality surface for the bid team.
 *
 * Role gate: ADMIN / PROPOSAL_MANAGER / REVIEWER / VIEWER (read-only roles).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const logger = childLogger({ route: "[document-quality-check]" });
  try {
    let actor;
    try {
      actor = await requireUser();
    } catch {
      return unauthorizedResponse();
    }
    const canRead = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"].includes(actor.role);
    if (!canRead) return forbiddenResponse();

    await prismaReady;
    const { id: tenderId } = await params;

    const tender = await prisma.tender.findUnique({
      where: { id: tenderId },
      include: {
        files: { select: { extractedText: true } },
        generatedDocuments: {
          where: { generationStatus: { not: "SUPERSEDED" } },
          select: {
            id: true,
            name: true,
            exactFileName: true,
            documentType: true,
            generationStatus: true,
            fileContent: true,
            storagePath: true,
          },
        },
        requirements: {
          select: {
            title: true,
            description: true,
            priority: true,
            requirementType: true,
            sectionReference: true,
          },
        },
      },
    });

    if (!tender) {
      logger.warn(`tender not found: ${tenderId}`);
      return jsonError("Tender not found", 404);
    }

    if (tender.userId !== actor.id && actor.role !== "ADMIN") {
      logger.warn(`unauthorized access: user=${actor.id} tender=${tenderId}`);
      return forbiddenResponse();
    }

    // Build the TenderDocumentGenerationContext (best-effort — this route is
    // advisory and should not crash if some inputs are missing).
    const combinedText = (tender.files ?? []).map((f) => f.extractedText ?? "").join("\n\n");
    const classification = classifyTender(combinedText);

    const selectedExperts: SelectedExpertForDocument[] = [];
    const selectedProjects: SelectedProjectForDocument[] = [];
    const selectedLegalDocuments: SelectedLegalDocumentForDocument[] = [];
    const selectedCompanyAssets: SelectedCompanyAssetForDocument[] = [];
    const companyProfile: CompanyProfileForDocument = {
      name: "—",
      description: null,
      country: null,
      website: null,
      serviceLines: [],
      establishedYear: null,
    };

    const ctx: TenderDocumentGenerationContext = buildTenderDocumentContext(
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
      tender.files ?? [],
      tender.requirements ?? [],
      selectedExperts,
      selectedProjects,
      selectedLegalDocuments,
      selectedCompanyAssets,
      companyProfile,
    );

    // Required sections per document type — derived from the section planner.
    // We re-derive here rather than importing the planner's section list to
    // keep this route decoupled from the planner's internal shape.
    const requiredSectionsByType: Record<string, string[]> = {
      TECHNICAL_PROPOSAL: ["Cover Letter", "Understanding of the Assignment", "Technical Approach and Methodology", "Work Plan", "Team Composition", "Compliance Matrix", "Submission Checklist"],
      EXPRESSION_OF_INTEREST: ["Cover Letter", "Expression of Interest", "Company Profile", "Understanding of the Assignment", "Submission Checklist"],
      QUOTATION: ["Quotation Cover Letter", "Price Schedule", "Submission Checklist"],
      FINANCIAL_PROPOSAL: ["Financial Proposal", "Price Schedule"],
    };

    // For each generated document, extract its visible text and run the
    // quality validator.
    const storage = getStorageAdapter();
    const perDocument = [];
    for (const doc of tender.generatedDocuments) {
      const fileName = doc.exactFileName ?? `${doc.name.replace(/[^a-zA-Z0-9]/g, "-")}.docx`;
      let content: string | null = doc.fileContent ?? null;
      if (!content && doc.storagePath) {
        try {
          const bytes = await storage.getFile({ storagePath: doc.storagePath, fileContent: doc.fileContent ?? null, fileName });
          content = bytes.toString("base64");
        } catch {
          perDocument.push({
            documentId: doc.id,
            name: doc.name,
            fileName,
            documentType: doc.documentType,
            ok: false,
            error: "Unable to load document content from storage",
          });
          continue;
        }
      }

      let documentText: string | null = null;
      if (content) {
        try {
          documentText = await extractDocxVisibleText(content, fileName);
        } catch {
          documentText = null;
        }
      }

      if (!documentText) {
        perDocument.push({
          documentId: doc.id,
          name: doc.name,
          fileName,
          documentType: doc.documentType,
          ok: false,
          error: "Document content is empty or could not be parsed as DOCX visible text",
        });
        continue;
      }

      const requiredSections = requiredSectionsByType[doc.documentType] ?? [];
      const result = validateGeneratedDocumentQuality(
        documentText,
        doc.documentType,
        ctx,
        requiredSections,
        ctx.mandatoryRequirements,
      );

      perDocument.push({
        documentId: doc.id,
        name: doc.name,
        fileName,
        documentType: doc.documentType,
        ok: result.okForFinal,
        okForDraft: result.okForDraft,
        okForFinal: result.okForFinal,
        score: result.score,
        missingSections: result.missingSections,
        missingRequirements: result.missingRequirements,
        placeholderViolations: result.placeholderViolations,
        aiTraceViolations: result.aiTraceViolations,
        inventedEvidenceRisks: result.inventedEvidenceRisks,
        formattingWarnings: result.formattingWarnings,
        finalBlockers: result.finalBlockers,
      });
    }

    const totalOk = perDocument.filter((d) => d.ok).length;
    const totalBlockers = perDocument.reduce((sum, d) => sum + (d.finalBlockers?.length ?? 0), 0);

    logger.info(`document-quality-check tender=${tenderId} docs=${perDocument.length} ok=${totalOk} blockers=${totalBlockers}`);

    return NextResponse.json({
      ok: true,
      success: true,
      tenderId,
      tenderType: classification.tenderType,
      documentCount: perDocument.length,
      okCount: totalOk,
      totalBlockers,
      documents: perDocument,
    });
  } catch (err) {
    logger.error("[document-quality-check] failed", { detail: err });
    return jsonError("Document quality check failed.", 500);
  }
}
