import { NextResponse } from "next/server";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { logAction } from "../../../../../lib/audit";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { findMissingGeneratedDocuments } from "../../../../../lib/engine/submission-plan";
import { getCurrentConfirmedBuildPlan } from "../../../../../lib/engine/build-plan";
import { MUTATION_RATE_LIMIT, rateLimit } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import { assertTenderReadyForGenerationAndExport } from "../../../../../lib/engine/generation-readiness-gate";
import { verifiedIntegrityDataFromBase64 } from "../../../../../lib/engine/persisted-byte-integrity";
import { resolveTenderOperationGate } from "../../../../../lib/engine/tender-operation-gate";
import {
  GenerationPersistenceBlockedError,
  withTransactionalGenerationGate,
} from "../../../../../lib/engine/transactional-generation-gate";
import { logger } from "../../../../../lib/observability";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RequirementLike = {
  title: string;
  description?: string | null;
  requirementType?: string | null;
  priority?: string | null;
};

type PreparedDocument = {
  fileName: string;
  documentType: string;
  fileContent: string;
  format: string;
  validationStatus: string;
  reviewStatus: string;
  contentSummary: string;
  exactOrder?: number | null;
  plannedRowId?: string;
  keepPlanned?: boolean;
  // The file is required by the plan but cannot be auto-drafted: the row is
  // created in PLANNED state so an original can be attached to it.
  awaitingOriginal?: boolean;
};

function clean(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function para(text: string, bold = false) {
  return new Paragraph({
    children: [new TextRun({ text: clean(text), bold, size: 22, font: "Calibri" })],
    spacing: { after: 120, line: 276 },
  });
}

function heading(text: string) {
  return new Paragraph({
    text: clean(text),
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 260, after: 140 },
  });
}

function subheading(text: string) {
  return new Paragraph({
    text: clean(text),
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 180, after: 100 },
  });
}

function bullet(text: string) {
  return new Paragraph({
    text: clean(text),
    bullet: { level: 0 },
    spacing: { after: 80, line: 260 },
  });
}

function documentTypeFor(fileName: string, fallback: string) {
  const label = fileName.toLowerCase();
  if (/financial|audited|capacity|bank|turnover/.test(label)) return "FINANCIAL_EVIDENCE";
  if (/legal|eligibility|registration|licen[cs]ing|tax|certificate/.test(label)) return "LEGAL_EVIDENCE";
  if (/submission formatting|packaging rules|submission rules|delivery instruction|submission method|submission deadline/.test(label)) return "SUBMISSION_RULES";
  if (/\bform\b|template/.test(label)) return "FORM_OR_TEMPLATE";
  if (/submission|deadline|delivery|method|rules/.test(label)) return "SUBMISSION_RULES";
  return fallback || "TENDER_REQUIRED_FILE";
}

function needsOriginalReplacement(fileName: string, documentType: string) {
  const label = `${fileName} ${documentType}`.toLowerCase();
  const type = documentType.toUpperCase();
  if (["FINANCIAL_EVIDENCE", "LEGAL_EVIDENCE", "FORM_OR_TEMPLATE", "BID_FORM", "TENDER_FORM"].includes(type)) return true;
  return /\bform\b|template|annex\s*[a-z0-9]+\s*\(?official\)?|audited|financial\s+statement|tax\s+clearance|business\s+licen|trade\s+licen|registration\s+cert|tin\s+cert|vat\s+cert/i.test(label);
}

function isNarrativeDraft(fileName: string, documentType: string) {
  const label = `${fileName} ${documentType}`.toLowerCase();
  if (needsOriginalReplacement(fileName, documentType)) return false;
  if (/submission formatting|packaging rules|submission rules|delivery instruction|submission method|submission deadline/.test(label)) return false;
  // Company-produced narrative deliverables. The app already treats these as
  // documents it can write from vault evidence — COMPANY_PRODUCED_KINDS in the
  // generate route lists company profile, methodology, project references and
  // sector/technical scope — but this predicate did not, so a planned
  // "02-Company-Profile.docx" or "03-Capability-Statement.docx" fell through to
  // replacementControlContent and was packaged as a ~58-word "generated support
  // control" stub telling the operator to replace it, even though the vault
  // holds exactly the material those files need.
  return /technical|methodology|approach|work\s*plan|strategic|proposal|narrative|scope|requirement|company\s*[-_]?\s*profile|capability\s*[-_]?\s*statement|expression[-\s_]*of[-\s_]*interest|\beoi\b|experience|track\s*record|project\s*[-_]?\s*reference/.test(label);
}

function matchingRequirements(fileName: string, requirements: RequirementLike[]) {
  const labelWords = new Set(
    fileName.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((word) => word.length >= 4),
  );
  const scored = requirements
    .map((requirement) => {
      const text = `${requirement.title} ${requirement.description ?? ""} ${requirement.requirementType ?? ""}`.toLowerCase();
      const score = Array.from(labelWords).reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0)
        + ((requirement.priority ?? "").toUpperCase() === "MANDATORY" ? 1 : 0);
      return { requirement, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, 8).map((entry) => entry.requirement);
  return picked.length > 0
    ? picked
    : requirements.filter((requirement) => (requirement.priority ?? "").toUpperCase() === "MANDATORY").slice(0, 8);
}

async function replacementControlContent(tenderTitle: string, fileName: string, replaceWithOriginal: boolean) {
  const children: Paragraph[] = [
    para(fileName, true),
    para(`Tender: ${tenderTitle}`),
    heading(replaceWithOriginal ? "Replacement control" : "Generated support control"),
  ];
  if (replaceWithOriginal) {
    children.push(
      bullet("Do not submit this generated control document as the final tender attachment."),
      bullet("Replace this record with the tender-issued original, signed/stamped/certified document, or verified source evidence before final export."),
      bullet("Keep the exact tender-required file name and order when replacing the file."),
    );
  } else {
    children.push(
      bullet("This package item was created from the tender submission plan so the missing file is visible in the generated document register."),
      bullet("Review and replace or complete this support document before final export if the tender requires a prescribed original/template."),
    );
  }
  const buffer = await Packer.toBuffer(new Document({ sections: [{ properties: {}, children }] }));
  return buffer.toString("base64");
}

async function narrativeDraftContent(
  tenderTitle: string,
  fileName: string,
  documentType: string,
  requirements: RequirementLike[],
) {
  const related = matchingRequirements(fileName, requirements);
  const children: Paragraph[] = [
    para(fileName, true),
    para(`Tender: ${tenderTitle}`),
    heading("Draft technical response"),
    para("This document has been generated from the current tender analysis and submission plan. It is a working draft for review, validation, and final approval before export."),
    subheading("Tender requirements addressed"),
  ];
  if (related.length === 0) {
    children.push(bullet("No requirement text is currently linked to this planned document. Re-run AI Analyze or repair requirement extraction before final approval."));
  } else {
    for (const requirement of related) {
      children.push(bullet(`${requirement.title}${requirement.description ? ` — ${requirement.description}` : ""}`.slice(0, 700)));
    }
  }
  children.push(
    subheading("Proposed response structure"),
    bullet("Confirm the assignment objectives, client priorities, location, and required deliverables using the tender source text."),
    bullet("Describe the methodology in the same order as the tender scope, including responsibility assignment, quality gates, and deliverable controls."),
    bullet("Reference only reviewed company evidence, selected experts, and selected projects approved in the Knowledge Vault."),
    bullet("Keep technical and financial content separated. Pricing, rates, BOQ, and commercial terms must not appear in a technical-envelope document."),
    subheading("Reviewer completion checklist"),
    bullet("Replace this draft with the final generated narrative or complete the draft manually before marking READY_FOR_EXPORT."),
    bullet("Validate that every mandatory requirement covered by this file has confirmed evidence and source traceability."),
    bullet("Run document validation again after editing and before final ZIP packaging."),
    para(`Document type: ${documentType}`),
  );
  const buffer = await Packer.toBuffer(new Document({ sections: [{ properties: {}, children }] }));
  return buffer.toString("base64");
}

async function buildPlannedRowContent(args: {
  tenderTitle: string;
  fileName: string;
  documentType: string;
  requirements: RequirementLike[];
}) {
  const replaceWithOriginal = needsOriginalReplacement(args.fileName, args.documentType);
  const isSubmissionRules = args.documentType === "SUBMISSION_RULES"
    || /submission formatting|packaging rules|submission rules|delivery instruction/i.test(args.fileName);
  if (isNarrativeDraft(args.fileName, args.documentType)) {
    return {
      fileContent: await narrativeDraftContent(args.tenderTitle, args.fileName, args.documentType, args.requirements),
      format: "DOCX",
      validationStatus: "NEEDS_REVALIDATION",
      reviewStatus: "NEEDS_REVIEW",
      contentSummary: `Generated narrative draft for tender-required file ${args.fileName}. Reviewer must validate and approve before export.`,
    };
  }
  return {
    fileContent: await replacementControlContent(args.tenderTitle, args.fileName, replaceWithOriginal),
    format: replaceWithOriginal || isSubmissionRules ? "CONTROL" : "DOCX",
    validationStatus: "PENDING",
    reviewStatus: replaceWithOriginal ? "REPLACE_WITH_ORIGINAL" : "PENDING",
    contentSummary: replaceWithOriginal
      ? `Replacement-control record for tender-required file ${args.fileName}. This internal control record is intentionally non-final and must be replaced with the original before export.`
      : `Generated support-control record for tender-required file ${args.fileName}. Review before final export.`,
  };
}

function planFingerprint(items: Array<Record<string, unknown>>) {
  return JSON.stringify(
    items
      .map((item) => ({
        exactFileName: String(item.exactFileName ?? ""),
        documentType: String(item.documentType ?? ""),
        exactOrder: Number(item.exactOrder ?? 0),
        required: Boolean(item.required ?? true),
      }))
      .sort((left, right) => left.exactOrder - right.exactOrder || left.exactFileName.localeCompare(right.exactFileName)),
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const rl = rateLimit(`generate-missing-plan-files:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { success: false, ok: false, code: "RATE_LIMITED", error: "Too many missing-plan generation requests. Wait and retry.", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    include: {
      requirements: true,
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: { id: true, name: true, exactFileName: true, documentType: true, format: true, exactOrder: true, generationStatus: true },
      },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });

  const analysisStatus = tender.analysisExtractionStatus;
  if (analysisStatus === "OCR_REQUIRED") {
    return NextResponse.json({ success: false, ok: false, code: "ANALYSIS_FROM_CORRUPTED_EXTRACTION", error: "AI analysis was skipped due to corrupted extraction; re-run AI Analyze before generating plan files.", nextAction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN" }, { status: 422 });
  }
  if (analysisStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED" || analysisStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION") {
    return NextResponse.json({ success: false, ok: false, code: "ANALYSIS_FROM_WEAK_EXTRACTION", error: "AI analysis was produced from weak extraction; re-run AI Analyze before generating plan files.", nextAction: "RERUN_AI_ANALYZE" }, { status: 422 });
  }
  if (analysisStatus === "PARTIAL_EXTRACTION_AI_ANALYZED") {
    return NextResponse.json({ success: false, ok: false, code: "ANALYSIS_FROM_PARTIAL_EXTRACTION", error: "AI analysis ran on partial extraction; re-extract and re-run AI Analyze before generating plan files.", nextAction: "RERUN_AI_ANALYZE" }, { status: 422 });
  }
  if (!(tender.clientName || tender.procuringEntityName)) {
    return NextResponse.json({ success: false, ok: false, code: "MISSING_CLIENT_DETAILS", error: "Document generation requires a client or procuring entity name. Run AI Analyze or enter the client name first.", nextAction: "EDIT_TENDER_METADATA" }, { status: 422 });
  }

  const centralGate = await assertTenderReadyForGenerationAndExport({
    prisma,
    tenderId: id,
    userId: actor.id,
    purpose: "generate-missing-plan-files",
  });
  if (!centralGate.ok) {
    return NextResponse.json({
      success: false,
      ok: false,
      code: centralGate.blockerCode,
      error: centralGate.blockerDetail,
      nextAction: "Resolve the analysis readiness blocker before generating missing plan files.",
    }, { status: 422 });
  }

  const confirmedPlan = await getCurrentConfirmedBuildPlan(prisma, id, actor.id);
  if (!confirmedPlan.ok) {
    return NextResponse.json({ success: false, ok: false, code: "BUILD_PLAN_NOT_CONFIRMED", error: `Cannot generate missing plan files: ${confirmedPlan.blocker}`, nextAction: "CONFIRM_BUILD_PLAN" }, { status: 422 });
  }

  const operationGate = resolveTenderOperationGate({
    tender: {
      id: tender.id,
      title: tender.title,
      reference: tender.reference,
      clientName: tender.clientName,
      deadline: tender.deadline,
      submissionMethod: tender.submissionMethod,
      submissionEmails: tender.submissionEmails,
      submissionAddress: tender.submissionAddress,
      country: tender.country,
      metadataContaminated: tender.metadataContaminated,
      analysisExtractionStatus: tender.analysisExtractionStatus,
    },
    requirements: tender.requirements.map((requirement: any) => ({
      priority: requirement.priority,
      sourceTenderFileId: requirement.sourceTenderFileId,
    })),
    overrides: [],
    buildPlan: { ok: confirmedPlan.ok, items: confirmedPlan.items },
    operation: "SUPPORT_PACKAGE_GENERATION",
  });
  if (operationGate.warnings.length > 0) {
    logger.info(`[generate-missing-plan-files] tender=${id} operation-gate warnings: ${operationGate.warnings.join("; ")}`);
  }
  if (operationGate.blockers.length > 0) {
    return NextResponse.json({
      error: "Missing-plan generation blocked by operation gate (SUPPORT_PACKAGE_GENERATION).",
      code: "OPERATION_GATE_BLOCKED",
      blockers: operationGate.blockers,
      warnings: operationGate.warnings,
    }, { status: 422 });
  }

  const missing = findMissingGeneratedDocuments({ files: confirmedPlan.items }, tender.generatedDocuments);
  const plannedRows = await prisma.generatedDocument.findMany({
    where: { tenderId: id, generationStatus: "PLANNED" },
    select: { id: true, name: true, exactFileName: true, documentType: true, format: true, exactOrder: true },
  });

  if (missing.length === 0 && plannedRows.length === 0) {
    await logAction({
      userId: actor.id,
      action: "DOCUMENT_GENERATE",
      entityType: "Tender",
      entityId: id,
      description: `${actor.email} checked missing planned files for "${tender.title}"; none were missing.`,
      metadata: { tenderId: id, created: 0, updated: 0, convertedFromPlanned: 0 },
      requestId,
    });
    return NextResponse.json({ success: true, created: 0, updated: 0, convertedFromPlanned: 0, message: "No missing planned files remain." });
  }

  const preparedMissing: PreparedDocument[] = [];
  const skipped: string[] = [];
  for (const file of missing) {
    const documentType = documentTypeFor(file.exactFileName, file.documentType);
    const generated = await buildPlannedRowContent({
      tenderTitle: tender.title,
      fileName: file.exactFileName,
      documentType,
      requirements: tender.requirements,
    });
    const awaitingOriginal = generated.format !== "DOCX" || !file.exactFileName.toLowerCase().endsWith(".docx");
    preparedMissing.push({
      fileName: file.exactFileName,
      documentType,
      exactOrder: file.exactOrder,
      // A required plan file that cannot be auto-drafted (a priced financial
      // offer, an official form, a third-party certificate) still needs a ROW.
      // Previously this branch pushed to `skipped` and created nothing, so the
      // file existed in the confirmed plan and nowhere else: export-readiness
      // reported PLANNED_DOCUMENT_MISSING forever and there was no document id
      // for POST /documents/{docId}/attach-original to target, leaving the
      // operator no way to supply the original at all. Note the existing
      // asymmetry this repairs — an ALREADY-PLANNED row hitting the same
      // condition is deliberately preserved via `keepPlanned` below, which is
      // exactly the state a missing file should be created in.
      awaitingOriginal,
      ...generated,
    });
  }

  const preparedPlanned: PreparedDocument[] = [];
  for (const row of plannedRows) {
    const fileName = row.exactFileName ?? row.name ?? "Unnamed document";
    const documentType = documentTypeFor(fileName, row.documentType ?? "");
    const generated = await buildPlannedRowContent({
      tenderTitle: tender.title,
      fileName,
      documentType,
      requirements: tender.requirements,
    });
    preparedPlanned.push({
      fileName,
      documentType,
      exactOrder: row.exactOrder,
      plannedRowId: row.id,
      keepPlanned: generated.format !== "DOCX" || !fileName.toLowerCase().endsWith(".docx"),
      ...generated,
    });
  }

  const expectedPlanFingerprint = planFingerprint(confirmedPlan.items as Array<Record<string, unknown>>);
  const created: string[] = [];
  const updated: string[] = [];
  const convertedFromPlanned: string[] = [];

  const persistBatch = async () => {
    await prisma.$transaction(async (tx) => {
      await withTransactionalGenerationGate({
        prisma,
        tx,
        tenderId: id,
        userId: actor.id,
        purpose: "generate-missing-plan-files",
        write: async (lockedTx) => {
          const currentPlan = await getCurrentConfirmedBuildPlan(prisma, id, actor.id);
          if (!currentPlan.ok || planFingerprint(currentPlan.items as Array<Record<string, unknown>>) !== expectedPlanFingerprint) {
            throw new GenerationPersistenceBlockedError("BUILD_PLAN_CHANGED_BEFORE_PERSISTENCE");
          }

          for (const document of preparedMissing) {
            const existing = await lockedTx.generatedDocument.findFirst({
              where: {
                tenderId: id,
                exactFileName: { equals: document.fileName, mode: "insensitive" },
                generationStatus: { not: "SUPERSEDED" },
              },
              orderBy: { updatedAt: "desc" },
              select: { id: true, generationStatus: true },
            });
            if (existing && existing.generationStatus !== "PLANNED") {
              skipped.push(document.fileName);
              continue;
            }

            const integrity = verifiedIntegrityDataFromBase64({
              fileContent: document.fileContent,
              filename: document.fileName,
              claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            });
            const data = {
              name: document.fileName.replace(/\.[a-z0-9]{2,5}$/i, ""),
              documentType: document.documentType,
              format: document.format,
              exactFileName: document.fileName,
              exactOrder: document.exactOrder,
              // A row awaiting its original carries no bytes and stays PLANNED,
              // so it can never be mistaken for an exportable document: the
              // final-ZIP scope only accepts GENERATED rows with content.
              fileContent: document.awaitingOriginal ? null : document.fileContent,
              ...(document.awaitingOriginal ? {} : integrity),
              generationStatus: document.awaitingOriginal ? "PLANNED" : "GENERATED",
              validationStatus: document.awaitingOriginal ? "PENDING" : document.validationStatus,
              reviewStatus: document.reviewStatus,
              reviewedBy: null,
              reviewedAt: null,
              contentSummary: document.contentSummary,
              updatedAt: new Date(),
            };
            if (existing) {
              await lockedTx.generatedDocument.update({ where: { id: existing.id }, data });
              updated.push(document.fileName);
            } else {
              await lockedTx.generatedDocument.create({ data: { tenderId: id, ...data } });
              if (document.awaitingOriginal) {
                skipped.push(`${document.fileName} (awaiting original — attach the official file to this planned document)`);
              } else {
                created.push(document.fileName);
              }
            }
          }

          for (const document of preparedPlanned) {
            const row = await lockedTx.generatedDocument.findFirst({
              where: { id: document.plannedRowId, tenderId: id, generationStatus: "PLANNED" },
              select: { id: true, name: true, exactFileName: true },
            });
            if (!row) continue;

            if (document.keepPlanned) {
              await lockedTx.generatedDocument.update({
                where: { id: row.id },
                data: {
                  generationStatus: "PLANNED",
                  validationStatus: "PENDING",
                  reviewStatus: document.reviewStatus,
                  reviewedBy: null,
                  reviewedAt: null,
                  fileContent: null,
                  contentSummary: document.contentSummary,
                  integrityStatus: "UNKNOWN",
                  integrityVerifiedAt: null,
                  integrityFailureCode: "REQUIRES_ORIGINAL_OR_FORMAT_FINALIZATION",
                  updatedAt: new Date(),
                },
              });
              skipped.push(`${document.fileName} (kept PLANNED; requires original or format-specific finalization)`);
              continue;
            }

            const integrity = verifiedIntegrityDataFromBase64({
              fileContent: document.fileContent,
              filename: document.fileName,
              claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            });
            await lockedTx.generatedDocument.update({
              where: { id: row.id },
              data: {
                name: row.name ?? document.fileName.replace(/\.[a-z0-9]{2,5}$/i, ""),
                exactFileName: row.exactFileName ?? document.fileName,
                documentType: document.documentType,
                format: document.format,
                fileContent: document.fileContent,
                ...integrity,
                generationStatus: "GENERATED",
                validationStatus: document.validationStatus,
                reviewStatus: document.reviewStatus,
                reviewedBy: null,
                reviewedAt: null,
                contentSummary: document.contentSummary,
                updatedAt: new Date(),
              },
            });
            convertedFromPlanned.push(document.fileName);
          }
        },
      });
    });
  };

  try {
    try {
      await persistBatch();
    } catch (createErr) {
      if ((createErr as { code?: string })?.code === "P2002") {
        // Converge by retrying the entire atomic batch after the competing
        // creator commits. The first transaction rolled back completely.
        const activeWinners = await prisma.generatedDocument.findMany({
          where: {
            tenderId: id,
            generationStatus: { not: "SUPERSEDED" },
            exactFileName: { in: preparedMissing.map((document) => document.fileName) },
          },
          select: { id: true },
        });
        if (activeWinners.length === 0) {
          throw new Error("P2002 convergence failed: winner deleted");
        }
        created.length = 0;
        updated.length = 0;
        convertedFromPlanned.length = 0;
        await persistBatch();
      } else {
        throw createErr;
      }
    }
  } catch (error) {
    if (error instanceof GenerationPersistenceBlockedError) {
      return NextResponse.json({
        success: false,
        ok: false,
        code: error.code,
        error: "Missing-plan generation readiness changed before persistence. No batch document writes were committed.",
        nextAction: "Refresh the tender, reconfirm the Build Plan, and retry.",
      }, { status: 409 });
    }
    throw error;
  }

  await logAction({
    userId: actor.id,
    action: "DOCUMENT_GENERATE",
    entityType: "Tender",
    entityId: id,
    description: `${actor.email} generated ${created.length} and updated ${updated.length} missing planned file record(s), converted ${convertedFromPlanned.length} PLANNED rows, skipped ${skipped.length} duplicates, for "${tender.title}".`,
    metadata: {
      tenderId: id,
      createdCount: created.length,
      updatedCount: updated.length,
      created,
      updated,
      convertedFromPlanned,
      skipped,
      warning: "Narrative drafts and replacement controls are not final until validated and approved.",
    },
    requestId,
  });

  return NextResponse.json({
    success: true,
    created: created.length,
    updated: updated.length,
    convertedFromPlanned: convertedFromPlanned.length,
    skipped: skipped.length,
    files: { created, updated, convertedFromPlanned, skipped },
    warning: "Generated narrative drafts/replacement controls require validation and reviewer approval before export. Replace official originals where reviewStatus is REPLACE_WITH_ORIGINAL.",
  });
}
