// Missing planned-file generation — shared implementation.
//
// Extracted from POST /api/tenders/[id]/generate-missing-plan-files so the
// route and the auto-finalize continuation worker run ONE implementation, the
// same way runSafeExportRepairs is shared with /repair-export-gaps.
//
// WHY: the workflow UI tells the owner that missing planned documents and safe
// repairs are handled automatically after Run Engine, but the automatic chain
// (lib/ai-jobs/auto-finalize-continuation-service.ts) only repaired, validated
// and finalised documents that ALREADY EXISTED. It reconciled the package
// against the confirmed plan and reported
// "package reconciliation incomplete — N of M required file(s) are not in the
// package" as a terminal blocker, while the only thing that could create those
// files was a button the owner had to find and press. The work the UI promises
// is automatic is now actually automatic.
//
// Every gate this path enforced as an HTTP 422 is preserved exactly and
// returned as a structured blocker instead: degraded/partial/weak analysis,
// missing client details, the central generation-and-export gate, a current
// source-verified confirmed Build Plan, and the SUPPORT_PACKAGE_GENERATION
// operation gate. Persistence still runs inside withTransactionalGenerationGate
// with the plan-fingerprint re-check and the P2002 convergence retry.
//
// It never invents a file the app must not produce: a tender-issued form, a
// priced financial proposal or an official original is written as a PLANNED row
// awaiting its original, exactly as before. A requirement that states a
// submission RULE rather than a deliverable is not in the confirmed plan at all
// (see lib/engine/financial-separation-rule.ts).

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { PrismaClient } from "@prisma/client";
import { logAction } from "../audit";
import { findMissingGeneratedDocuments } from "./submission-plan";
import { getCurrentConfirmedBuildPlan } from "./build-plan";
import { assertTenderReadyForGenerationAndExport } from "./generation-readiness-gate";
import { verifiedIntegrityDataFromBase64 } from "./persisted-byte-integrity";
import { resolveTenderOperationGate } from "./tender-operation-gate";
import {
  GenerationPersistenceBlockedError,
  withTransactionalGenerationGate,
} from "./transactional-generation-gate";
import { logger } from "../observability";
import { canUseVaultRecord, VAULT_REVIEW_CONSUMER_SELECT } from "../vault-review-provenance";

export type MissingPlanFileGenerationResult = {
  ok: boolean;
  /** Blocker code when ok is false; absent on success. */
  code?: string;
  /** Human-readable blocker detail when ok is false. */
  error?: string;
  /** Suggested next step for the caller/UI when ok is false. */
  nextAction?: string;
  /** HTTP status the route should use. 200 on success. */
  status: number;
  created: string[];
  updated: string[];
  convertedFromPlanned: string[];
  /** Rows created as PLANNED because the file must arrive as an official original. */
  plannedCreated: string[];
  skipped: string[];
  /** True when there was nothing missing to begin with. */
  nothingMissing: boolean;
};

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

/**
 * Source-verified company evidence for a document this function is about to
 * write, or an empty set when the vault holds none it may quote.
 *
 * The same guard the generate route uses — canUseVaultRecord(..., "GENERATION")
 * rather than a raw trustLevel check — so a stale or never-provenance-backed
 * record cannot be quoted as evidence in a submittable document, and a
 * soft-deleted one never surfaces at all.
 */
async function companyEvidenceFor(
  prisma: PrismaClient,
  tenderId: string,
): Promise<{ experts: string[]; projects: string[] }> {
  try {
    const tender = await prisma.tender.findUnique({
      where: { id: tenderId },
      select: {
        expertMatches: {
          where: { isSelected: true },
          include: { expert: { select: { ...VAULT_REVIEW_CONSUMER_SELECT.EXPERT, profile: true, deletedAt: true } } },
          orderBy: { score: "desc" },
        },
        projectMatches: {
          where: { isSelected: true },
          include: { project: { select: { ...VAULT_REVIEW_CONSUMER_SELECT.PROJECT, summary: true, deletedAt: true } } },
          orderBy: { score: "desc" },
        },
      },
    });
    if (!tender) return { experts: [], projects: [] };
    const experts = tender.expertMatches
      .filter((m) => m.expert && !m.expert.deletedAt && canUseVaultRecord(m.expert, "GENERATION"))
      .map((m) => `${m.expert!.fullName}${m.expert!.title ? ` — ${m.expert!.title}` : ""}${m.expert!.yearsExperience ? ` | ${m.expert!.yearsExperience}+ years` : ""}`);
    const projects = tender.projectMatches
      .filter((m) => m.project && !m.project.deletedAt && canUseVaultRecord(m.project, "GENERATION"))
      .map((m) => `${m.project!.name}${m.project!.clientName ? ` — ${m.project!.clientName}` : ""}${m.project!.country ? ` | ${m.project!.country}` : ""}`);
    return { experts, projects };
  } catch {
    // Evidence is additive here. A failure to read it must not stop the
    // automatic chain from producing the file the confirmed plan requires.
    return { experts: [], projects: [] };
  }
}

/**
 * A company-produced narrative file for the confirmed plan.
 *
 * This document ships. It used to carry an internal worksheet — "Draft
 * technical response … Proposed response structure … Reviewer completion
 * checklist … Replace this draft with the final generated narrative or
 * complete the draft manually before marking READY_FOR_EXPORT" — and on the
 * automatic path that text reached the procuring entity inside the Final ZIP,
 * proven by driving Run AI Analyze and Run Engine and downloading what came
 * out.
 *
 * The generate route already had this fixed for the path an owner clicks
 * through: it materialises the planned rows so they are written from vault
 * evidence, and its own comment calls the worksheet "worse than nothing". The
 * automatic chain calls this module directly and never reaches that code, so
 * the fix existed on one path and not on the one the owner contract makes
 * normal.
 *
 * Instructions addressed to the bid team or a reviewer are removed rather than
 * reworded: there is no version of "replace this draft" that belongs in a
 * document an evaluator opens. What remains is the tender's own requirements
 * and the company's own source-verified evidence — real content, or an honest
 * statement that a section has none yet.
 */
async function narrativeDraftContent(
  tenderTitle: string,
  fileName: string,
  documentType: string,
  requirements: RequirementLike[],
  evidence: { experts: string[]; projects: string[] } = { experts: [], projects: [] },
) {
  const related = matchingRequirements(fileName, requirements);
  const children: Paragraph[] = [
    para(fileName, true),
    para(`Tender: ${tenderTitle}`),
    subheading("Tender requirements addressed"),
  ];
  if (related.length === 0) {
    children.push(para("No requirement from the tender source is currently linked to this file."));
  } else {
    for (const requirement of related) {
      children.push(bullet(`${requirement.title}${requirement.description ? ` — ${requirement.description}` : ""}`.slice(0, 700)));
    }
  }
  if (evidence.experts.length > 0) {
    children.push(subheading("Key personnel"));
    for (const expert of evidence.experts.slice(0, 20)) children.push(bullet(expert));
  }
  if (evidence.projects.length > 0) {
    children.push(subheading("Relevant project experience"));
    for (const project of evidence.projects.slice(0, 20)) children.push(bullet(project));
  }
  if (evidence.experts.length === 0 && evidence.projects.length === 0) {
    children.push(para("No source-verified personnel or project evidence has been linked to this tender yet."));
  }
  const buffer = await Packer.toBuffer(new Document({ sections: [{ properties: {}, children }] }));
  return buffer.toString("base64");
}

async function buildPlannedRowContent(args: {
  tenderTitle: string;
  fileName: string;
  documentType: string;
  requirements: RequirementLike[];
  evidence?: { experts: string[]; projects: string[] };
}) {
  const replaceWithOriginal = needsOriginalReplacement(args.fileName, args.documentType);
  const isSubmissionRules = args.documentType === "SUBMISSION_RULES"
    || /submission formatting|packaging rules|submission rules|delivery instruction/i.test(args.fileName);
  if (isNarrativeDraft(args.fileName, args.documentType)) {
    return {
      fileContent: await narrativeDraftContent(args.tenderTitle, args.fileName, args.documentType, args.requirements, args.evidence),
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
/**
 * Generate every planned file the confirmed Build Plan requires that the
 * package does not yet contain, and fill in rows still sitting at PLANNED.
 *
 * Returns a structured result rather than an HTTP response so the API route and
 * the auto-finalize continuation worker share one implementation and one set of
 * gates. `status` carries the HTTP status the route should use.
 */
export async function generateMissingPlanFiles(args: {
  prisma: PrismaClient;
  tenderId: string;
  userId: string;
  /** Label recorded in the audit entry — an email for a user action, a marker for automation. */
  actorLabel: string;
  requestId?: string;
}): Promise<MissingPlanFileGenerationResult> {
  const { prisma, tenderId, userId, actorLabel, requestId } = args;
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: true,
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: { id: true, name: true, exactFileName: true, documentType: true, format: true, exactOrder: true, generationStatus: true },
      },
    },
  });
  if (!tender) return {
      ok: false, status: 404,
      code: "TENDER_NOT_FOUND",
      error: "Tender not found",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };

  const analysisStatus = tender.analysisExtractionStatus;
  if (analysisStatus === "OCR_REQUIRED") {
    return {
      ok: false, status: 422,
      code: "ANALYSIS_FROM_CORRUPTED_EXTRACTION",
      error: "AI analysis was skipped due to corrupted extraction; re-run AI Analyze before generating plan files.",
      nextAction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };
  }
  if (analysisStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED" || analysisStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION") {
    return {
      ok: false, status: 422,
      code: "ANALYSIS_FROM_WEAK_EXTRACTION",
      error: "AI analysis was produced from weak extraction; re-run AI Analyze before generating plan files.",
      nextAction: "RERUN_AI_ANALYZE",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };
  }
  if (analysisStatus === "PARTIAL_EXTRACTION_AI_ANALYZED") {
    return {
      ok: false, status: 422,
      code: "ANALYSIS_FROM_PARTIAL_EXTRACTION",
      error: "AI analysis ran on partial extraction; re-extract and re-run AI Analyze before generating plan files.",
      nextAction: "RERUN_AI_ANALYZE",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };
  }
  if (!(tender.clientName || tender.procuringEntityName)) {
    return {
      ok: false, status: 422,
      code: "MISSING_CLIENT_DETAILS",
      error: "Document generation requires a client or procuring entity name. Run AI Analyze or enter the client name first.",
      nextAction: "EDIT_TENDER_METADATA",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };
  }

  const centralGate = await assertTenderReadyForGenerationAndExport({
    prisma,
    tenderId,
    userId: userId,
    purpose: "generate-missing-plan-files",
  });
  if (!centralGate.ok) {
    return {
      ok: false, status: 422,
      code: centralGate.blockerCode,
      error: centralGate.blockerDetail,
      nextAction: "Resolve the analysis readiness blocker before generating missing plan files.",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };
  }

  const confirmedPlan = await getCurrentConfirmedBuildPlan(prisma, tenderId, userId);
  if (!confirmedPlan.ok) {
    return {
      ok: false, status: 422,
      code: "BUILD_PLAN_NOT_SOURCE_VERIFIED",
      error: `Automatic document generation is waiting for a current source-verified Build Plan: ${confirmedPlan.blocker}`,
      nextAction: "RUN_ENGINE",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };
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
    logger.info(`[generate-missing-plan-files] tender=${tenderId} operation-gate warnings: ${operationGate.warnings.join("; ")}`);
  }
  if (operationGate.blockers.length > 0) {
    return {
      ok: false, status: 422,
      code: "OPERATION_GATE_BLOCKED",
      error: `Missing-plan generation blocked by operation gate (SUPPORT_PACKAGE_GENERATION): ${operationGate.blockers.join("; ")}`,
      nextAction: "RESOLVE_OPERATION_GATE_BLOCKERS",
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
    };
  }

  const missing = findMissingGeneratedDocuments({ files: confirmedPlan.items }, tender.generatedDocuments);
  const plannedRows = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: "PLANNED" },
    select: { id: true, name: true, exactFileName: true, documentType: true, format: true, exactOrder: true },
  });

  if (missing.length === 0 && plannedRows.length === 0) {
    await logAction({
      userId: userId,
      action: "DOCUMENT_GENERATE",
      entityType: "Tender",
      entityId: tenderId,
      description: `${actorLabel} checked missing planned files for "${tender.title}"; none were missing.`,
      metadata: { tenderId, created: 0, updated: 0, convertedFromPlanned: 0 },
      requestId,
    });
    return {
      ok: true, status: 200,
      created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [],
      nothingMissing: true,
    };
  }

  const preparedMissing: PreparedDocument[] = [];
  const skipped: string[] = [];
  // Read once for every file this run writes: a company-produced narrative
  // carries the firm's own source-verified personnel and project evidence,
  // which is the material those files exist to present.
  const evidence = await companyEvidenceFor(prisma, tenderId);
  for (const file of missing) {
    const documentType = documentTypeFor(file.exactFileName, file.documentType);
    const generated = await buildPlannedRowContent({
      tenderTitle: tender.title,
      fileName: file.exactFileName,
      documentType,
      requirements: tender.requirements,
      evidence,
    });
    // A file the app must not invent — a priced financial proposal, a
    // tender-issued form — still needs a row, as PLANNED awaiting its official
    // original.
    //
    // This used to `continue`, creating nothing. The export gate then required
    // the file, generation reported it "skipped", and POST
    // .../documents/{id}/attach-original had no {id} to address because no row
    // existed: the owner was required to supply a document with nowhere to put
    // it. The already-PLANNED branch below has always handled this correctly
    // with keepPlanned; the missing-file branch simply did not, so whether the
    // tender could be finished depended on whether a row happened to exist
    // already.
    const requiresOriginal = generated.format !== "DOCX" || !file.exactFileName.toLowerCase().endsWith(".docx");
    preparedMissing.push({
      keepPlanned: requiresOriginal,
      fileName: file.exactFileName,
      documentType,
      exactOrder: file.exactOrder,
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
      evidence,
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
  // Rows created as PLANNED because the file must be an official original.
  // Reported separately so "created" keeps meaning "produced bytes".
  const plannedCreated: string[] = [];

  const persistBatch = async () => {
    await prisma.$transaction(async (tx) => {
      await withTransactionalGenerationGate({
        prisma,
        tx,
        tenderId,
        userId: userId,
        purpose: "generate-missing-plan-files",
        write: async (lockedTx) => {
          const currentPlan = await getCurrentConfirmedBuildPlan(prisma, tenderId, userId);
          if (!currentPlan.ok || planFingerprint(currentPlan.items as Array<Record<string, unknown>>) !== expectedPlanFingerprint) {
            throw new GenerationPersistenceBlockedError("BUILD_PLAN_CHANGED_BEFORE_PERSISTENCE");
          }

          for (const document of preparedMissing) {
            const existing = await lockedTx.generatedDocument.findFirst({
              where: {
                tenderId,
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

            // Mirrors the already-PLANNED branch below: no bytes, integrity
            // explicitly unknown, and a failure code naming what is awaited, so
            // this row can never be mistaken for a finished document.
            const data = document.keepPlanned
              ? {
                name: document.fileName.replace(/\.[a-z0-9]{2,5}$/i, ""),
                documentType: document.documentType,
                format: document.format,
                exactFileName: document.fileName,
                exactOrder: document.exactOrder,
                fileContent: null,
                generationStatus: "PLANNED",
                validationStatus: "PENDING",
                reviewStatus: document.reviewStatus,
                reviewedBy: null,
                reviewedAt: null,
                contentSummary: document.contentSummary,
                integrityStatus: "UNKNOWN",
                integrityVerifiedAt: null,
                integrityFailureCode: "REQUIRES_ORIGINAL_OR_FORMAT_FINALIZATION",
                updatedAt: new Date(),
              }
              : {
                name: document.fileName.replace(/\.[a-z0-9]{2,5}$/i, ""),
                documentType: document.documentType,
                format: document.format,
                exactFileName: document.fileName,
                exactOrder: document.exactOrder,
                fileContent: document.fileContent,
                ...verifiedIntegrityDataFromBase64({
                  fileContent: document.fileContent,
                  filename: document.fileName,
                  claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                }),
                generationStatus: "GENERATED",
                validationStatus: document.validationStatus,
                reviewStatus: document.reviewStatus,
                reviewedBy: null,
                reviewedAt: null,
                contentSummary: document.contentSummary,
                updatedAt: new Date(),
              };
            if (existing) {
              await lockedTx.generatedDocument.update({ where: { id: existing.id }, data });
              if (document.keepPlanned) plannedCreated.push(document.fileName);
              else updated.push(document.fileName);
            } else {
              await lockedTx.generatedDocument.create({ data: { tenderId, ...data } });
              if (document.keepPlanned) plannedCreated.push(document.fileName);
              else created.push(document.fileName);
            }
          }

          for (const document of preparedPlanned) {
            const row = await lockedTx.generatedDocument.findFirst({
              where: { id: document.plannedRowId, tenderId, generationStatus: "PLANNED" },
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
            tenderId,
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
      return {
        ok: false, status: 409,
        code: error.code,
        error: "Missing-plan generation readiness changed before persistence. No batch document writes were committed.",
        nextAction: "The durable worker will retry from current canonical state; intervene only if a specific fail-closed blocker appears.",
        created: [], updated: [], convertedFromPlanned: [], plannedCreated: [], skipped: [], nothingMissing: false,
      };
    }
    throw error;
  }

  await logAction({
    userId: userId,
    action: "DOCUMENT_GENERATE",
    entityType: "Tender",
    entityId: tenderId,
    description: `${actorLabel} generated ${created.length} and updated ${updated.length} missing planned file record(s), converted ${convertedFromPlanned.length} PLANNED rows, skipped ${skipped.length} duplicates, for "${tender.title}".`,
    metadata: {
      tenderId,
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

  // A run that changed nothing is not a success.
  //
  // This response used to be unconditionally {success: true, created: 0,
  // updated: 0}, and the button rendered it as "0 missing planned file records
  // created/updated" — a cheerful message describing a complete no-op, with no
  // reason and nothing different to try. Clicking again produced the same
  // thing. When there were targets and none of them moved, say so and name the
  // reason for each, so the next step is a fact rather than another click.
  // Planning a row for a file that must arrive as an official original IS
  // progress: it is what gives the owner somewhere to upload it. Counting it
  // as "nothing changed" would fail the call that just created the only route
  // forward.
  const changedCount = created.length + updated.length + convertedFromPlanned.length + plannedCreated.length;
  if (changedCount === 0) {
    return {
      ok: false, status: 422,
      code: "NO_PLANNED_FILE_COULD_BE_GENERATED",
      error: skipped.length > 0
        ? `No planned file could be generated. ${skipped.length} target(s) were skipped, each for the reason listed.`
        : "No planned file could be generated, and no target reported a reason. Re-run the Engine to rebuild the submission plan.",
      nextAction: skipped.length > 0 ? "REVIEW_SKIPPED_TARGETS" : "RUN_ENGINE",
      created, updated, convertedFromPlanned, plannedCreated, skipped,
      nothingMissing: false,
    };
  }

  return {
    ok: true, status: 200,
    created, updated, convertedFromPlanned, plannedCreated, skipped,
    nothingMissing: false,
  };
}
