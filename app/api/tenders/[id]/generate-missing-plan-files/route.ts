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
import { resolveTenderOperationGate } from "../../../../../lib/engine/tender-operation-gate";
import { logger } from "../../../../../lib/observability";

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
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
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
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });

  // Contamination is NO LONGER a hard block for draft support-file generation.
  // Per the source-driven model (PRs #968-#972), metadata contamination is a
  // warning, not a blocker, for draft work. Final Submission Check remains
  // strict (enforced via getFinalSubmissionReadiness / canonical resolver).
  // The route logs contamination for observability but proceeds with generation.

  // Never generate onto analysis produced from corrupted/weak extraction.
  const analysisStatus = tender.analysisExtractionStatus;
  if (analysisStatus === "OCR_REQUIRED") {
    return NextResponse.json({ success: false, ok: false, code: "ANALYSIS_FROM_CORRUPTED_EXTRACTION", error: "AI analysis was skipped due to corrupted extraction; re-run AI Analyze before generating plan files.", nextAction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN" }, { status: 422 });
  }
  if (analysisStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED" || analysisStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION") {
    return NextResponse.json({ success: false, ok: false, code: "ANALYSIS_FROM_WEAK_EXTRACTION", error: "AI analysis was produced from weak extraction; re-run AI Analyze before generating plan files.", nextAction: "RERUN_AI_ANALYZE" }, { status: 422 });
  }

  // Client/procuring entity must be present (a document set with no client is
  // never exportable).
  const clientDisplayName = tender.clientName || tender.procuringEntityName;
  if (!clientDisplayName) {
    return NextResponse.json({ success: false, ok: false, code: "MISSING_CLIENT_DETAILS", error: "Document generation requires a client or procuring entity name. Run AI Analyze or enter the client name first.", nextAction: "EDIT_TENDER_METADATA" }, { status: 422 });
  }

  // Central generation gate — this route is NOT a chicken-and-egg escape hatch.
  // It must fail closed on every blocker (including BUILD_PLAN_MISSING /
  // BUILD_PLAN_NOT_CONFIRMED); there is no SUBMISSION_PLAN_MISSING carve-out.
  const centralGate = await assertTenderReadyForGenerationAndExport({
    prisma,
    tenderId: id,
    userId: actor.id,
    purpose: "generate-missing-plan-files",
  });
  if (!centralGate.ok) {
    return NextResponse.json({
      success: false, ok: false,
      code: centralGate.blockerCode,
      error: centralGate.blockerDetail,
      nextAction: "Resolve the analysis readiness blocker before generating missing plan files.",
    }, { status: 422 });
  }

  // "Missing plan files" are the files the CONFIRMED BuildPlan already specifies
  // but which have not yet been generated — scope strictly to confirmedPlan.items,
  // never a recomputed requirements plan (that would be an escape hatch).
  const confirmedPlan = await getCurrentConfirmedBuildPlan(prisma, id, actor.id);
  if (!confirmedPlan.ok) {
    return NextResponse.json({ success: false, ok: false, code: "BUILD_PLAN_NOT_CONFIRMED", error: `Cannot generate missing plan files: ${confirmedPlan.blocker}`, nextAction: "CONFIRM_BUILD_PLAN" }, { status: 422 });
  }
  const plan = { files: confirmedPlan.items };

  // ── Operation gate (SUPPORT_PACKAGE_GENERATION) — authoritative metadata check ──
  // For SUPPORT_PACKAGE_GENERATION, metadata NEVER blocks. The gate surfaces
  // warnings for the UI. Defensive blocker check catches regressions.
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
    requirements: tender.requirements.map((r: any) => ({
      priority: r.priority,
      sourceTenderFileId: r.sourceTenderFileId,
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
    // ACTIVE rows only: matching a SUPERSEDED historical row would mutate
    // preserved history back to GENERATED — and collide with the partial
    // unique index on (tenderId, exactFileName) WHERE non-SUPERSEDED.
    const existing = existingByExactName ?? await prisma.generatedDocument.findFirst({
      where: { tenderId: id, exactFileName: file.exactFileName, generationStatus: { not: "SUPERSEDED" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    const data = {
      name: file.exactFileName.replace(/\.[a-z0-9]{2,5}$/i, ""),
      documentType,
      format: generated.format,
      exactFileName: file.exactFileName,
      exactOrder: file.exactOrder,
      fileContent: generated.fileContent,
      generationStatus: "GENERATED",
      validationStatus: generated.validationStatus,
      reviewStatus: generated.reviewStatus,
      contentSummary: generated.contentSummary,
      updatedAt: new Date(),
    };
    if (existing) {
      await prisma.generatedDocument.update({ where: { id: existing.id }, data });
      updated.push(file.exactFileName);
    } else {
      try {
        await prisma.generatedDocument.create({ data: { tenderId: id, ...data } });
        created.push(file.exactFileName);
      } catch (createErr) {
        // P2002 = the partial unique index caught a concurrent creator making
        // the same active file between our check and this create. Converge
        // idempotently: update the row the winner created instead of failing
        // the whole route partway through.
        if ((createErr as { code?: string })?.code === "P2002") {
          const winner = await prisma.generatedDocument.findFirst({
            where: { tenderId: id, exactFileName: file.exactFileName, generationStatus: { not: "SUPERSEDED" } },
            orderBy: { updatedAt: "desc" },
            select: { id: true },
          });
          if (winner) {
            await prisma.generatedDocument.update({ where: { id: winner.id }, data });
            updated.push(file.exactFileName);
          } else {
            // Winner was deleted between the failed create and this lookup.
            // Push to skipped so the user has visibility (no silent drop).
            skipped.push(`${file.exactFileName} (P2002 convergence failed: winner deleted)`);
          }
        } else {
          throw createErr;
        }
      }
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
