import { NextResponse } from "next/server";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { logAction } from "../../../../../lib/audit";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { buildSubmissionPlan, buildSubmissionPlanWithDerivedFallback, findMissingGeneratedDocuments } from "../../../../../lib/engine/submission-plan";
import { MUTATION_RATE_LIMIT, rateLimit } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import { isExtractionAcceptableForGeneration } from "../../../../../lib/engine/extraction-quality-gate";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "../../../../../lib/extraction-quality";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RequirementLike = { title: string; description?: string | null; requirementType?: string | null; priority?: string | null };

function clean(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function para(text: string, bold = false) {
  return new Paragraph({ children: [new TextRun({ text: clean(text), bold, size: 22, font: "Calibri" })], spacing: { after: 120, line: 276 } });
}

function heading(text: string) {
  return new Paragraph({ text: clean(text), heading: HeadingLevel.HEADING_1, spacing: { before: 260, after: 140 } });
}

function subheading(text: string) {
  return new Paragraph({ text: clean(text), heading: HeadingLevel.HEADING_2, spacing: { before: 180, after: 100 } });
}

function bullet(text: string) {
  return new Paragraph({ text: clean(text), bullet: { level: 0 }, spacing: { after: 80, line: 260 } });
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
  return /technical|methodology|approach|work\s*plan|strategic|proposal|narrative|scope|requirement/.test(label);
}

function matchingRequirements(fileName: string, requirements: RequirementLike[]): RequirementLike[] {
  const labelWords = new Set(fileName.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((word) => word.length >= 4));
  const scored = requirements.map((requirement) => {
    const text = `${requirement.title} ${requirement.description ?? ""} ${requirement.requirementType ?? ""}`.toLowerCase();
    const score = Array.from(labelWords).reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0) + ((requirement.priority ?? "").toUpperCase() === "MANDATORY" ? 1 : 0);
    return { requirement, score };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, 8).map((entry) => entry.requirement);
  return picked.length > 0 ? picked : requirements.filter((r) => (r.priority ?? "").toUpperCase() === "MANDATORY").slice(0, 8);
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

async function narrativeDraftContent(tenderTitle: string, fileName: string, documentType: string, requirements: RequirementLike[]) {
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

async function buildPlannedRowContent(args: { tenderTitle: string; fileName: string; documentType: string; requirements: RequirementLike[] }) {
  const replaceWithOriginal = needsOriginalReplacement(args.fileName, args.documentType);
  const isSubmissionRules = args.documentType === "SUBMISSION_RULES" || /submission formatting|packaging rules|submission rules|delivery instruction/i.test(args.fileName);
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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const rl = rateLimit(`generate-missing-plan-files:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, ok: false, code: "RATE_LIMITED", error: "Too many missing-plan generation requests. Wait and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
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
      files: {
        select: {
          id: true,
          originalFileName: true,
          extractedText: true,
          extractionScore: true,
          totalPages: true,
          extractedPages: true,
          ocrPages: true,
          failedPages: true,
          pageStatusJson: true,
        },
      },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });

  // ── Pre-flight gates (CLAUDE.md: Generate Docs gate — all 6 conditions) ────

  // Gate 1: Extraction quality must be acceptable
  if (tender.files.length > 0) {
    const effectiveFiles = tender.files.map((file) => {
      const quality = assessExtractionQuality(file.extractedText, file.originalFileName);
      return { ...file, extractionScore: Math.min(file.extractionScore ?? quality.score, quality.score) };
    });
    if (!isExtractionAcceptableForGeneration(effectiveFiles)) {
      const corruptedFiles = effectiveFiles
        .filter((f) => assessExtractionQuality(f.extractedText, f.originalFileName).corrupted)
        .map((f) => f.originalFileName ?? f.id);
      return NextResponse.json({
        success: false, ok: false,
        code: corruptedFiles.length > 0 ? "EXTRACTION_CORRUPTED_GENERATE_BLOCKED" : "EXTRACTION_QUALITY_INSUFFICIENT",
        error: "Document generation is blocked because page extraction quality is too low. Re-extract or run OCR before generating documents.",
        nextAction: corruptedFiles.length > 0 ? "RUN_OCR_OR_UPLOAD_CLEARER_SCAN" : "OPEN_EXTRACTION_QUALITY",
        corruptedFiles,
      }, { status: 422 });
    }
  }

  // Gate 2: Client/procuring entity must be present and not contaminated
  if (tender.metadataContaminated) {
    return NextResponse.json({
      success: false, ok: false,
      code: "METADATA_CONTAMINATED",
      error: "Document generation is blocked because the client/procuring entity metadata appears contaminated. Review and correct the client name before generating documents.",
      nextAction: "EDIT_TENDER_METADATA",
    }, { status: 422 });
  }
  const clientDisplayName = tender.clientName || tender.procuringEntityName;
  if (!clientDisplayName) {
    return NextResponse.json({
      success: false, ok: false,
      code: "MISSING_CLIENT_DETAILS",
      error: "Document generation requires a client or procuring entity name. Run AI Analyze or manually enter the client name before generating documents.",
      nextAction: "EDIT_TENDER_METADATA",
    }, { status: 422 });
  }

  // Gate 3: Requirements or explicit file lists must exist
  const hasExplicitFiles =
    ((tender as any).exactFileNaming ?? "").trim().length > 2 ||
    ((tender as any).exactFileOrder ?? "").trim().length > 2;
  if (tender.requirements.length === 0 && !hasExplicitFiles) {
    return NextResponse.json({
      success: false, ok: false,
      code: "NO_REQUIREMENTS",
      error: "Document generation requires extracted requirements or explicit submission file instructions. Run AI Analyze before generating documents.",
      nextAction: "RERUN_AI_ANALYZE",
    }, { status: 422 });
  }

  // Gates 4 & 5: Submission instructions and required documents pages.
  //
  // Two-tier check:
  //   Tier 1 (PAGE_MARKERS available): enforce based on per-page content detection.
  //   Tier 2 (no PAGE_MARKERS — e.g. DOCX or short single-block extraction):
  //     fall back to checking whether AI Analyze stored the resulting submission
  //     metadata (submissionMethod/submissionAddress/submissionEmails). If AI was
  //     run but none of those fields are populated, submission instructions were
  //     effectively not extracted.
  if (tender.files.length > 0) {
    let anySubmission = false;
    let anyRequiredDocs = false;
    let hasPageMarkers = false;
    for (const file of tender.files) {
      const pp = assessExtractionQualityPerPage(file.extractedText);
      if (pp.detectionMode !== "PAGE_MARKERS") continue;
      hasPageMarkers = true;
      if (pp.submissionInstructionPages.length > 0) anySubmission = true;
      if (pp.requiredDocumentPages.length > 0) anyRequiredDocs = true;
    }
    if (hasPageMarkers) {
      // Tier 1: strict page-marker check
      if (!anySubmission) {
        return NextResponse.json({
          success: false, ok: false,
          code: "MISSING_SUBMISSION_INSTRUCTIONS",
          error: "No submission instruction pages were detected in the extracted text. Submission deadlines, addresses, and methods may be missing. Review extraction quality or re-run AI Analyze before generating documents.",
          nextAction: "OPEN_EXTRACTION_QUALITY",
        }, { status: 422 });
      }
      const mandatoryRequirements = tender.requirements.filter((r) => (r.priority ?? "").toUpperCase() === "MANDATORY");
      if (!anyRequiredDocs && mandatoryRequirements.length === 0) {
        return NextResponse.json({
          success: false, ok: false,
          code: "MISSING_REQUIRED_DOCUMENTS_PAGES",
          error: "No required documents/forms pages were detected and no mandatory requirements are defined. The submission plan may be missing mandatory annexures. Review extraction quality before generating documents.",
          nextAction: "OPEN_EXTRACTION_QUALITY",
        }, { status: 422 });
      }
    } else {
      // Tier 2: no page markers — check stored submission metadata as proxy.
      // Only apply when AI Analyze has already run (analysisExtractionStatus is set),
      // because for a fresh upload without analysis the check would always fail.
      const analysisRan = !!(tender as any).analysisExtractionStatus;
      if (analysisRan) {
        const hasStoredSubmissionDetails =
          !!((tender as any).submissionMethod ?? "").trim() ||
          !!((tender as any).submissionAddress ?? "").trim() ||
          !!((tender as any).submissionEmails ?? "").trim();
        if (!hasStoredSubmissionDetails) {
          return NextResponse.json({
            success: false, ok: false,
            code: "MISSING_SUBMISSION_INSTRUCTIONS",
            error: "AI Analyze ran but no submission method, address, or email was extracted. Submission instructions are missing. Re-run AI Analyze or manually enter the submission details before generating documents.",
            nextAction: "EDIT_TENDER_METADATA",
          }, { status: 422 });
        }
        // Gate 5 fallback: require mandatory requirements when no page markers
        const mandatoryRequirements = tender.requirements.filter((r) => (r.priority ?? "").toUpperCase() === "MANDATORY");
        if (tender.requirements.length > 0 && mandatoryRequirements.length === 0 && !hasExplicitFiles) {
          return NextResponse.json({
            success: false, ok: false,
            code: "MISSING_REQUIRED_DOCUMENTS_PAGES",
            error: "No mandatory requirements are defined. The submission plan may be missing required documents. Review requirements before generating documents.",
            nextAction: "RERUN_AI_ANALYZE",
          }, { status: 422 });
        }
      }
    }
  }

  // Gate 6: Submission plan must have been built (PLANNED rows must exist)
  // when requirements are present and no explicit file list overrides the plan.
  if (tender.requirements.length > 0 && !hasExplicitFiles) {
    const plannedCount = await prisma.generatedDocument.count({
      where: { tenderId: id, generationStatus: "PLANNED" },
    });
    if (plannedCount === 0) {
      return NextResponse.json({
        success: false, ok: false,
        code: "SUBMISSION_PLAN_NOT_BUILT",
        error: "No submission plan has been built for this tender. Run 'Build Submission Plan' first to define which documents are required before generating them.",
        nextAction: "BUILD_SUBMISSION_PLAN",
      }, { status: 422 });
    }
  }

  const plan = buildSubmissionPlanWithDerivedFallback({
    id: tender.id,
    title: tender.title,
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    pageLimit: tender.pageLimit,
    submissionMethod: tender.submissionMethod,
    tenderCategory: (tender as any).category,
    analysisExtractionStatus: (tender as any).analysisExtractionStatus,
    requirements: tender.requirements,
  });
  const missing = findMissingGeneratedDocuments(plan, tender.generatedDocuments);
  const plannedRows = await prisma.generatedDocument.findMany({
    where: { tenderId: id, generationStatus: "PLANNED" },
    select: { id: true, name: true, exactFileName: true, documentType: true, format: true, exactOrder: true },
  });

  if (missing.length === 0 && plannedRows.length === 0) {
    await logAction({ userId: actor.id, action: "DOCUMENT_GENERATE", entityType: "Tender", entityId: id, description: `${actor.email} checked missing planned files for "${tender.title}"; none were missing.`, metadata: { tenderId: id, created: 0, updated: 0, convertedFromPlanned: 0 }, requestId });
    return NextResponse.json({ success: true, created: 0, updated: 0, convertedFromPlanned: 0, message: "No missing planned files remain." });
  }

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  for (const file of missing) {
    const documentType = documentTypeFor(file.exactFileName, file.documentType);
    const existingByExactName = await prisma.generatedDocument.findFirst({
      where: {
        tenderId: id,
        exactFileName: { equals: file.exactFileName, mode: "insensitive" },
        generationStatus: { not: "SUPERSEDED" },
      },
      select: { id: true, generationStatus: true },
    });
    if (existingByExactName && existingByExactName.generationStatus !== "PLANNED") {
      skipped.push(file.exactFileName);
      continue;
    }

    const generated = await buildPlannedRowContent({ tenderTitle: tender.title, fileName: file.exactFileName, documentType, requirements: tender.requirements });
    const existing = existingByExactName ?? await prisma.generatedDocument.findFirst({ where: { tenderId: id, exactFileName: file.exactFileName }, select: { id: true } });
    const data = {
      name: file.exactFileName.replace(/\.[a-z0-9]{2,5}$/i, ""),
      documentType,
      format: generated.format,
      exactFileName: file.exactFileName,
      exactOrder: file.exactOrder,
      fileContent: generated.fileContent,
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: generated.reviewStatus,
      contentSummary: [generated.contentSummary, file.notes?.includes("DERIVED_DRAFT_UNCONFIRMED") ? "DERIVED_DRAFT_UNCONFIRMED" : ""].filter(Boolean).join(" ").trim(),
      updatedAt: new Date(),
    };
    if (existing) {
      await prisma.generatedDocument.update({ where: { id: existing.id }, data });
      updated.push(file.exactFileName);
    } else {
      await prisma.generatedDocument.create({ data: { tenderId: id, ...data } });
      created.push(file.exactFileName);
    }
  }

  const convertedFromPlanned: string[] = [];
  for (const row of plannedRows) {
    const fileName = row.exactFileName ?? row.name ?? "Unnamed document";
    const documentType = documentTypeFor(fileName, row.documentType ?? "");
    const generated = await buildPlannedRowContent({ tenderTitle: tender.title, fileName, documentType, requirements: tender.requirements });
    await prisma.generatedDocument.update({
      where: { id: row.id },
      data: {
        name: row.name ?? fileName.replace(/\.[a-z0-9]{2,5}$/i, ""),
        exactFileName: row.exactFileName ?? fileName,
        documentType,
        format: generated.format,
        fileContent: generated.fileContent,
        generationStatus: "GENERATED",
        validationStatus: generated.validationStatus,
        reviewStatus: generated.reviewStatus,
        contentSummary: generated.contentSummary,
        updatedAt: new Date(),
      },
    });
    convertedFromPlanned.push(fileName);
  }

  await logAction({
    userId: actor.id,
    action: "DOCUMENT_GENERATE",
    entityType: "Tender",
    entityId: id,
    description: `${actor.email} generated ${created.length} and updated ${updated.length} missing planned file record(s), converted ${convertedFromPlanned.length} PLANNED rows, skipped ${skipped.length} duplicates, for "${tender.title}".`,
    metadata: { tenderId: id, createdCount: created.length, updatedCount: updated.length, created, updated, convertedFromPlanned, skipped, warning: "Narrative drafts and replacement controls are not final until validated and approved." },
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
