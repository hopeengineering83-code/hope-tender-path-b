import { NextResponse } from "next/server";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { generateTenderDocuments } from "../../../../../lib/engine/generate-elite";
import { promoteBestAvailableReviewedMatchesForGeneration } from "../../../../../lib/engine/best-available-selection";
import { applyActiveUploadedLetterheadToTenderDocuments } from "../../../../../lib/engine/apply-active-letterhead";
import { rateLimit, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { buildSubmissionPlan, findExtraGeneratedDocuments, findMissingGeneratedDocuments, generatedDocumentSubmissionKey, hasExplicitSubmissionScope, plannedSubmissionTargetFiles, plannedSubmissionTargetKeys, type SubmissionPlanFile } from "../../../../../lib/engine/submission-plan";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";
import { polishBenchmarkOutput } from "../../../../../lib/engine/benchmark-output-polisher";
import { cleanTenderTitle, cleanClientName, formatRequirementLine } from "../../../../../lib/engine/proposal-labels";
import { logAction } from "../../../../../lib/audit";
import { extractRequestId } from "../../../../../lib/request-id";
import { createJob, advanceJob, completeJob, failJob } from "../../../../../lib/job-store";
import { generatedDocumentHasContent } from "../../../../../lib/generated-document-content";
import { createNotification } from "../../../../../lib/notifications";
import { childLogger, reportError, time } from "../../../../../lib/observability";
import { mapGenerationError } from "../../../../../lib/engine/structured-generation-error";
import { computeStoredMetadataPatch, listInvalidStoredFields } from "../../../../../lib/engine/sanitize-stored-metadata";
import { isValidClientName } from "../../../../../lib/engine/metadata-validators";
import { repairSourceGrounding } from "../../../../../lib/engine/repair-source-grounding";
import { assertAnalysisReadyForFinalGeneration, detectAnalysisSourceWithApproval } from "../../../../../lib/engine/analysis-source";
import { assessTenderMetadataCompleteness } from "../../../../../lib/engine/tender-metadata-completeness";
import { isExtractionAcceptableForGeneration } from "../../../../../lib/engine/extraction-quality-gate";
import { hasValidSubmissionPlan } from "../../../../../lib/engine/submission-plan-completeness";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { assessTenderAnalysisQuality } from "../../../../../lib/analysis-quality";
import { assessExtractionQualityPerPage } from "../../../../../lib/extraction-quality";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type SupportDocKind = "EXPERT_CV" | "PROJECT_REFERENCES" | "METHODOLOGY" | "COMPANY_PROFILE" | "FINANCIAL_PLACEHOLDER" | "LEGAL_PLACEHOLDER" | "FORM_PLACEHOLDER" | "DECLARATION_PLACEHOLDER" | "ANNEX_PLACEHOLDER" | "SUBMISSION_RULES_PLACEHOLDER" | "SECTOR_TECHNICAL_SCOPE" | "GENERIC";

function hasRealClientName(value?: string | null): boolean {
  return isValidClientName(value);
}

function criticalGapIsHardBlock(gap: { title: string; description: string; mitigationPlan: string | null }) {
  const text = `${gap.title} ${gap.description} ${gap.mitigationPlan ?? ""}`;
  return /(ineligible|debarred|blacklisted|deadline.*passed|late submission|missing required file name|missing exact file|tender not found|company profile required|no documents? have been generated|signature prohibited|branding prohibited)/i.test(text);
}

function clean(value?: string | null): string {
  return polishBenchmarkOutput(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/=+\s*PAGE\s+\d+\s*=+/gi, " ").replace(/<PARSED TEXT FOR PAGE:[^>]+>/gi, " ").replace(/ChatGPT|OpenAI|as an AI/gi, "").replace(/\s+/g, " ").trim();
}

function shortText(value?: string | null, max = 420): string {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function para(text: string, bold = false): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: clean(text), bold, size: 22, font: "Calibri" })], spacing: { after: 120, line: 276 } });
}
function heading(text: string): Paragraph { return new Paragraph({ text: clean(text), heading: HeadingLevel.HEADING_1, spacing: { before: 260, after: 140 } }); }
function bullet(text: string): Paragraph { return new Paragraph({ text: shortText(text, 560), bullet: { level: 0 }, spacing: { after: 80, line: 260 } }); }

function plannedRecordDocumentType(file: SubmissionPlanFile): string {
  const label = `${file.exactFileName} ${file.documentType}`.toLowerCase();
  if (/technical[-\s_]*proposal|methodology|technical approach/.test(label)) return "TECHNICAL_PROPOSAL";
  if (/financial|price|commercial/.test(label)) return "FINANCIAL_PROPOSAL";
  if (/expert|cv|personnel|staff/.test(label)) return "EXPERT_CV_PACKAGE";
  if (/project|experience|reference/.test(label)) return "PROJECT_REFERENCE_PACKAGE";
  if (/form|declaration|annex|schedule|certificate|compliance/.test(label)) return "FORM_OR_ANNEX";
  return file.documentType || "TENDER_REQUIRED_FILE";
}

async function ensurePlannedGeneratedDocumentRecords(tenderId: string, plannedFiles: SubmissionPlanFile[]): Promise<number> {
  if (plannedFiles.length === 0) return 0;
  let created = 0;
  for (const file of plannedFiles) {
    // Guard: skip files without an explicit exact filename — a Prisma lookup with
    // exactFileName: undefined would match ANY record regardless of filename (silent bug).
    if (!file.exactFileName || !file.exactFileName.trim()) continue;
    const key = generatedDocumentSubmissionKey({ exactFileName: file.exactFileName });
    const documentType = plannedRecordDocumentType(file);
    const summary = `Planned tender-required file from submission plan. Source requirements: ${file.sourceRequirementIds.join(", ") || "exact file naming/order instruction"}.`;
    const current = await prisma.generatedDocument.findFirst({
      where: { tenderId, exactFileName: file.exactFileName },
      select: { id: true, name: true, exactFileName: true, documentType: true, exactOrder: true, format: true, generationStatus: true, fileContent: true, storagePath: true },
    });
    if (!current) {
      try {
        await prisma.generatedDocument.create({ data: { tenderId, name: file.exactFileName.replace(/\.[a-z0-9]{2,5}$/i, ""), documentType, format: file.format, exactFileName: file.exactFileName, exactOrder: file.exactOrder, generationStatus: "PLANNED", validationStatus: "PENDING", reviewStatus: "PENDING", contentSummary: summary } });
        created += 1;
      } catch { /* race-condition guard: if a concurrent request created the row first, skip silently */ }
    } else if (current.generationStatus !== "GENERATED") {
      await prisma.generatedDocument.update({ where: { id: current.id }, data: { name: current.name || file.exactFileName.replace(/\.[a-z0-9]{2,5}$/i, ""), documentType, format: file.format, exactFileName: file.exactFileName, exactOrder: file.exactOrder, contentSummary: generatedDocumentHasContent(current) ? undefined : summary, updatedAt: new Date() } });
    }
    void key;
  }
  return created;
}

async function makeSupportDocx(tenderTitle: string, title: string, sections: Array<{ title: string; lines: string[] }>): Promise<string> {
  const children: Paragraph[] = [para(title, true), para(`Tender: ${shortText(tenderTitle, 200)}. Package item: ${title}.`)];
  for (const section of sections) {
    children.push(heading(section.title));
    for (const line of (section.lines.length ? section.lines : ["Applicable tender-issued forms, attachments or source evidence should be inserted under this section where required."])) children.push(bullet(line));
  }
  const buffer = await Packer.toBuffer(new Document({ sections: [{ properties: {}, children }], styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } } } }));
  return buffer.toString("base64");
}

function classifySupportDoc(docName: string): SupportDocKind {
  const name = docName.toLowerCase();
  if (/\bexpert|\bcv\b|personnel|key staff/.test(name)) return "EXPERT_CV";
  if (/(experience|portfolio).*?(project|reference)|project reference|past performance/.test(name)) return "PROJECT_REFERENCES";
  if (/methodology|work plan|technical approach/.test(name)) return "METHODOLOGY";
  if (/company profile|capability statement/.test(name)) return "COMPANY_PROFILE";
  if (/financial|audited|turnover|bank/.test(name)) return "FINANCIAL_PLACEHOLDER";
  if (/legal|registration|licensing|tax/.test(name)) return "LEGAL_PLACEHOLDER";
  if (/declaration|certificate|compliance evidence/.test(name)) return "DECLARATION_PLACEHOLDER";
  if (/\bform|template/.test(name)) return "FORM_PLACEHOLDER";
  if (/annex|appendix/.test(name)) return "ANNEX_PLACEHOLDER";
  if (/submission|deadline|delivery|formatting|packaging|schedule|programme/.test(name)) return "SUBMISSION_RULES_PLACEHOLDER";
  if (/scope|water|solar|design|supervision|feasibility|technical requirement/.test(name)) return "SECTOR_TECHNICAL_SCOPE";
  return "GENERIC";
}

function isReplacementOriginalKind(kind: SupportDocKind): boolean {
  return kind.endsWith("_PLACEHOLDER") || kind === "GENERIC";
}

function placeholderIntro(): string[] {
  return ["PLACEHOLDER FOR TENDER-ISSUED ORIGINAL.", "This file in the submission package is reserved for the tender-issued original document(s) listed below. Replace this placeholder before final submission with the signed / stamped / certified original(s) — do not submit this generated placeholder file."];
}

function supportSections(docName: string, context: { tenderTitle: string; requirements: string[]; experts: string[]; projects: string[] }): Array<{ title: string; lines: string[] }> {
  const kind = classifySupportDoc(docName);
  if (kind === "EXPERT_CV") return [
    { title: "Expert CV Register", lines: context.experts.length ? context.experts.slice(0, 20) : ["Expert CVs are attached separately as individual files in this submission package. This document is the cover index for those CVs."] },
    { title: "Role-to-Requirement Mapping", lines: context.requirements.slice(0, 10) },
    { title: "CV Attachment Control", lines: ["Each proposed expert's CV, professional licence, and educational certificate is included as a separate file in this package or the appendix.", "Each CV is mapped to a specific role, qualification, comparable previous project, and assignment responsibility."] },
  ];
  if (kind === "PROJECT_REFERENCES") return [
    { title: "Relevant Project References", lines: context.projects.length ? context.projects.slice(0, 18) : ["Comparable project references are attached separately with completion certificates and client reference letters. This document is the cover index for those references."] },
    { title: "Evidence Attachment Control", lines: ["Project evidence: completion certificates, client testimony letters, contracts, photos and drawings, where required by the tender.", "Each reference is selected from the firm's reviewed portfolio for direct comparability to the tender scope."] },
  ];
  if (kind === "METHODOLOGY") return [
    { title: "Technical Methodology — Tender Requirements Addressed", lines: context.requirements.slice(0, 14) },
    { title: "Work Plan", lines: ["Each tender scope item is mapped to a deliverable, a responsible expert, a quality-review gate, and a submission milestone.", "Senior technical review and final compliance verification are applied before each deliverable issue.", "The detailed methodology, phasing, and deliverables are presented in the main Technical Proposal document; this support file is the methodology cover for package indexing."] },
  ];
  if (kind === "COMPANY_PROFILE") return [{ title: "Company Profile and Capability Statement — Tender Alignment", lines: context.requirements.slice(0, 12) }, { title: "Capability Evidence", lines: [...context.experts.slice(0, 8), ...context.projects.slice(0, 8)].filter(Boolean) }];
  if (kind === "SECTOR_TECHNICAL_SCOPE") return [{ title: "Tender Scope Items Addressed in This Package", lines: context.requirements.slice(0, 16) }, { title: "Linked Evidence", lines: [...context.experts.slice(0, 6), ...context.projects.slice(0, 6)].filter(Boolean) }];
  if (kind === "FINANCIAL_PLACEHOLDER") return [{ title: "Required Original Documents", lines: ["Audited financial statements for the years specified in the tender.", "Tax / VAT certificates valid at submission date.", "Bank reference letter or proof of liquid capacity if requested by the tender.", "Annual turnover declaration in the format the tender prescribes."] }, { title: "Insertion Instructions", lines: placeholderIntro() }, { title: "No Financial Offer Included", lines: ["This is a TECHNICAL submission. No financial offer, fee schedule, rate, or price is included in this file or anywhere in the technical package."] }];
  if (kind === "LEGAL_PLACEHOLDER") return [{ title: "Required Original Documents", lines: ["Business registration certificate.", "Tax Identification Number (TIN) certificate.", "VAT registration certificate.", "Trade / professional licence valid at submission date.", "Sector-specific authority registration (e.g., Construction Authority grade certificate).", "Any other eligibility documents the tender prescribes."] }, { title: "Insertion Instructions", lines: placeholderIntro() }];
  if (kind === "FORM_PLACEHOLDER") return [{ title: "Tender-Issued Forms / Templates", lines: ["The forms and templates issued with the tender RFP must be completed exactly as issued (do not retype, do not reformat).", "Each form is signed and stamped where the tender requires it.", "File names match the tender's exact-naming rule."] }, { title: "Insertion Instructions", lines: placeholderIntro() }];
  if (kind === "DECLARATION_PLACEHOLDER") return [{ title: "Required Declarations and Certificates", lines: ["Declaration of eligibility / no debarment.", "Declaration of no conflict of interest.", "Compliance certificates (ISO, sector-specific) where applicable.", "Any other declaration template prescribed by the tender."] }, { title: "Signature Control", lines: ["Each declaration is signed by an authorised representative of the firm and dated within the tender window.", "Stamps are applied where the tender prescribes."] }, { title: "Insertion Instructions", lines: placeholderIntro() }];
  if (kind === "ANNEX_PLACEHOLDER") return [{ title: "Annexes / Appendices Listed in the Tender", lines: context.requirements.slice(0, 8).length ? context.requirements.slice(0, 8) : ["Refer to the tender document for the exact annex / appendix list."] }, { title: "Insertion Instructions", lines: placeholderIntro() }];
  if (kind === "SUBMISSION_RULES_PLACEHOLDER") return [{ title: "Submission Rules Summary", lines: context.requirements.slice(0, 10).length ? context.requirements.slice(0, 10) : ["Refer to the tender document for the submission method, deadline, and packaging rules."] }, { title: "Pre-Submission Checklist", lines: ["File names match the tender's exact-naming rule.", "File order matches the tender's exact-order rule (where stated).", "All declarations are signed and stamped.", "Submission deadline is confirmed in the tender's stated time zone.", "Submission email recipients / portal address are taken verbatim from the tender."] }];
  return [{ title: "Tender Package Item", lines: ["This file corresponds to a tender-required submission item. Refer to the tender document for the exact content and format."] }, { title: "Linked Tender Requirements", lines: context.requirements.slice(0, 8) }, { title: "Insertion Instructions", lines: placeholderIntro() }];
}

function isMainProposalLike(doc: { name: string; exactFileName: string | null; documentType: string }): boolean {
  const label = `${doc.name} ${doc.exactFileName ?? ""}`.toLowerCase();
  return /\bclient-ready benchmark technical proposal\b|technical-proposal\.docx$/.test(label) || (doc.documentType === "TECHNICAL_PROPOSAL" && /feasibility, design and supervision technical scope/i.test(doc.name));
}

// Kinds that represent company-produced deliverables and should have a real DOCX generated.
const COMPANY_PRODUCED_KINDS: ReadonlySet<SupportDocKind> = new Set<SupportDocKind>([
  "EXPERT_CV",
  "PROJECT_REFERENCES",
  "METHODOLOGY",
  "COMPANY_PROFILE",
  "SECTOR_TECHNICAL_SCOPE",
]);

async function fillPlannedSupportDocuments(tenderId: string, plannedFileKeys?: Set<string>): Promise<number> {
  const tender = await prisma.tender.findUnique({ where: { id: tenderId }, select: { title: true, clientName: true, procuringEntityName: true, description: true, requirements: true, expertMatches: { where: { isSelected: true }, include: { expert: true }, orderBy: { score: "desc" } }, projectMatches: { where: { isSelected: true }, include: { project: true }, orderBy: { score: "desc" } } } });
  if (!tender) return 0;
  const requirements = tender.requirements.map((r) => formatRequirementLine(r, 380));
  const experts = tender.expertMatches.filter((m) => m.expert && m.expert.trustLevel === "REVIEWED").map((m) => `${m.expert.fullName}${m.expert.title ? ` — ${m.expert.title}` : ""}${m.expert.yearsExperience ? ` | ${m.expert.yearsExperience}+ years` : ""}${m.expert.profile ? ` | ${shortText(m.expert.profile, 260)}` : ""}`);
  const projects = tender.projectMatches.filter((m) => m.project && m.project.trustLevel === "REVIEWED").map((m) => `${m.project.name}${m.project.clientName ? ` — ${m.project.clientName}` : ""}${m.project.country ? ` | ${m.project.country}` : ""}${m.project.summary ? ` | ${shortText(m.project.summary, 300)}` : ""}`);
  const docs = await prisma.generatedDocument.findMany({ where: { tenderId, generationStatus: { not: "SUPERSEDED" } }, select: { id: true, name: true, exactFileName: true, documentType: true, generationStatus: true, storagePath: true } });
  // Deduplicate by filename before filling: if multiple non-superseded records share the same
  // exactFileName (from prior generation runs), only fill the first one encountered to avoid
  // generating duplicate support documents for the same logical file.
  const seenFillKeys = new Set<string>();
  const dedupedDocs = docs.filter((doc) => {
    const key = (doc.exactFileName ?? doc.name ?? "").trim().toLowerCase();
    if (seenFillKeys.has(key)) return false;
    seenFillKeys.add(key);
    return true;
  });
  const incomplete = dedupedDocs.filter((doc) => !isMainProposalLike(doc) && !(doc.generationStatus === "GENERATED" && generatedDocumentHasContent(doc)) && (!plannedFileKeys || plannedFileKeys.has(generatedDocumentSubmissionKey(doc))));
  let filled = 0;
  for (const doc of incomplete) {
    const title = clean(doc.exactFileName || doc.name);
    const kind = classifySupportDoc(title);
    const cleanTitle = cleanTenderTitle(tender.title, { clientName: cleanClientName(tender.clientName || tender.procuringEntityName, tender.description), description: tender.description });

    if (COMPANY_PRODUCED_KINDS.has(kind)) {
      // Company-produced deliverable: generate a real DOCX with company evidence content.
      const fileContent = await makeSupportDocx(cleanTitle, title, supportSections(title, { tenderTitle: cleanTitle, requirements, experts, projects }));
      await prisma.generatedDocument.update({
        where: { id: doc.id },
        data: {
          fileContent,
          generationStatus: "GENERATED",
          validationStatus: "PENDING",
          reviewStatus: "PENDING",
          contentSummary: `Generated supporting package document for ${title} with distinct tender-specific content. Review before final submission.`,
          updatedAt: new Date(),
        },
      });
      filled += 1;
    } else {
      // Placeholder / form / legal / financial / declaration / annex / submission-rules / generic:
      // Do NOT generate a fake DOCX. Mark as PLANNED stub so the user knows to attach the real document.
      // Only update if the record is not already in the correct placeholder state.
      if (doc.generationStatus !== "PLANNED" || !generatedDocumentHasContent(doc)) {
        await prisma.generatedDocument.update({
          where: { id: doc.id },
          data: {
            generationStatus: "PLANNED",
            validationStatus: "PENDING",
            reviewStatus: "REPLACE_WITH_ORIGINAL",
            reviewNotes: "Attach the tender-issued original / signed / stamped / certified document before final export. Do not submit a generated file in place of this item.",
            contentSummary: `Placeholder for ${title}. Replace with the tender-issued original before final export. Do not submit this stub.`,
            updatedAt: new Date(),
          },
        });
        filled += 1;
      }
    }
  }
  return filled;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  const userId = actor.id;
  const rl = rateLimit(`gen:${userId}`, AI_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded — too many generation requests. Please wait a minute and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    include: {
      requirements: true,
      files: {
        select: { id: true, originalFileName: true, extractedText: true, extractionScore: true, totalPages: true, extractedPages: true, ocrPages: true, failedPages: true },
      },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const invalidFields = listInvalidStoredFields(tender);
  if (invalidFields.length > 0) {
    const patch = computeStoredMetadataPatch(tender);
    await prisma.tender.update({ where: { id: tender.id }, data: patch });
    console.warn(`[generate] tender=${tender.id} sanitised ${invalidFields.length} invalid stored field(s) before generation: ${invalidFields.join(", ")}`);
    for (const field of invalidFields) {
      (tender as Record<string, unknown>)[field] = null;
    }
  }

  const company = await prisma.company.findUnique({ where: { userId }, select: { id: true } });
  if (!company) return NextResponse.json({
    errorCode: "COMPANY_PROFILE_REQUIRED",
    error: "Company profile required before generation.",
    blockers: ["Company profile has not been created."],
    nextAction: "OPEN_COMPANY_READINESS",
    diagnosticId: `no-company-${id}`,
  }, { status: 422 });
  const requiresExperts = tender.requirements.some((req) => req.requirementType === "EXPERT");
  const requiresProjects = tender.requirements.some((req) => req.requirementType === "PROJECT_EXPERIENCE");
  const readiness = await getCompanyIngestionReadiness(company.id, { requireDocuments: true, requireReviewedExperts: requiresExperts, requireReviewedProjects: requiresProjects });
  if (!readiness.ingestionReady) return NextResponse.json({
    errorCode: "INGESTION_NOT_READY",
    error: "Generation blocked: company knowledge is not ready.",
    blockers: readiness.blockers,
    warnings: readiness.warnings,
    totals: readiness.totals,
    nextAction: "OPEN_COMPANY_READINESS",
    diagnosticId: `ingestion-not-ready-${id}`,
  }, { status: 422 });
  // Accept procuringEntityName as a fallback for clientName — AI Analyze may set
  // procuringEntityName without back-filling clientName on older tenders.
  const effectiveClientName = tender.clientName || (tender as Record<string, unknown>).procuringEntityName as string | null | undefined;
  if (!hasRealClientName(effectiveClientName)) return NextResponse.json({
    errorCode: "CLIENT_NAME_REQUIRED",
    error: "Generation blocked: client name is not set. Edit the tender and fill the Client Name field before generating proposal documents.",
    blockers: ["Client name is missing or invalid."],
    nextAction: "EDIT_TENDER",
    diagnosticId: `no-client-name-${id}`,
  }, { status: 422 });

  // ── Contaminated metadata hard block ─────────────────────────────────────
  // metadataContaminated is set by detectMetadataContamination() during AI
  // Analyze when portal navigation text, status banners, or unrelated tender
  // alerts were detected inside the extracted client/procuring entity name.
  // Generating a proposal with a contaminated client name produces cover pages,
  // addressing blocks, and reference letters with garbage in the "To:" field.
  if (tender.metadataContaminated) {
    return NextResponse.json({
      errorCode: "METADATA_CONTAMINATED",
      error: "Generation blocked: client/procuring entity metadata is contaminated with portal navigation text, status banners, or unrelated tender alerts. Open the tender, correct the Client Name field, and re-run AI Analyze before generating documents.",
      blockers: ["metadataContaminated: client name was extracted from portal noise — requires manual correction before generation is allowed"],
      nextAction: "EDIT_TENDER_METADATA",
      diagnosticId: `metadata-contaminated-${id}`,
    }, { status: 422 });
  }

  // ── Extraction quality gate ───────────────────────────────────────────────
  // Block generation when extraction quality is too poor to produce reliable
  // documents (REGEX_FALLBACK_FROM_WEAK_EXTRACTION — average score < 45 with
  // failed pages). Partial extraction is allowed with a warning.
  const effectiveExtractionFiles = tender.files.map((file) => {
    const quality = assessExtractionQuality(file.extractedText, file.originalFileName);
    return { ...file, extractionScore: Math.min(file.extractionScore ?? quality.score, quality.score), quality };
  });
  const corruptedExtractionFiles = effectiveExtractionFiles.filter((file) => file.quality.corrupted).map((file) => file.originalFileName ?? file.id);
  if (!isExtractionAcceptableForGeneration(effectiveExtractionFiles)) {
    return NextResponse.json({
      errorCode: "EXTRACTION_NOT_READY",
      error: "Page extraction quality is too poor to generate reliable documents. Re-upload the tender file or run OCR before generating.",
      code: corruptedExtractionFiles.length > 0 ? "EXTRACTION_CORRUPTED_GENERATION_BLOCKED" : "EXTRACTION_QUALITY_INSUFFICIENT",
      blockers: corruptedExtractionFiles.length > 0
        ? corruptedExtractionFiles.map((fileName) => `Extraction corrupted / OCR required: ${fileName}`)
        : ["Tender file extraction quality is below the minimum threshold for generation."],
      nextAction: corruptedExtractionFiles.length > 0 ? "RUN_OCR_OR_UPLOAD_CLEARER_SCAN" : "OPEN_EXTRACTION_QUALITY",
      diagnosticId: `extraction-insufficient-${id}`,
    }, { status: 422 });
  }

  if (tender.status === "NO_BID") return NextResponse.json({
    errorCode: "NO_BID_BLOCK",
    error: "Generation blocked: this tender is marked NO_BID. Apply a BID or BID_WITH_CONDITIONS decision before generating proposal documents.",
    blockers: ["Tender is marked NO_BID."],
    nextAction: "CHANGE_BID_DECISION",
    diagnosticId: `no-bid-${id}`,
  }, { status: 409 });
  if (tender.requirements.length === 0) {
    return NextResponse.json({
      errorCode: "NO_REQUIREMENTS",
      error: "Generation blocked: no tender requirements were extracted yet. Run AI Analyze / Run Engine first, or add requirements manually before generating documents.",
      blockers: ["No tender requirements have been extracted."],
      nextAction: "RUN_ENGINE",
      diagnosticId: `no-requirements-${id}`,
    }, { status: 422 });
  }

  // ── Critical content-page gate ────────────────────────────────────────────
  // Per CLAUDE.md: generation is blocked unless submission instructions AND
  // required documents were detected in the extracted text. Evaluation criteria
  // absence is a warning only (documents can still be generated without it, but
  // the plan may under-score sections).
  {
    const reqUrl = new URL(req.url);
    if (reqUrl.searchParams.get("planOnly") !== "true") {
      let anySubmission = false;
      let anyRequiredDocs = false;
      let anyEvaluation = false;
      let totalDetected = 0;
      for (const file of effectiveExtractionFiles) {
        const pp = assessExtractionQualityPerPage(file.extractedText);
        totalDetected += pp.totalDetectedPages;
        if (pp.submissionInstructionPages.length > 0) anySubmission = true;
        if (pp.requiredDocumentPages.length > 0) anyRequiredDocs = true;
        if (pp.evaluationCriteriaPages.length > 0) anyEvaluation = true;
      }
      if (totalDetected > 0) {
        const contentBlockers: string[] = [];
        if (!anySubmission) contentBlockers.push("No submission instruction pages were detected in the extracted text. Submission deadlines, addresses, and methods cannot be verified.");
        if (!anyRequiredDocs) contentBlockers.push("No required documents/forms pages were detected. The generated proposal may be missing mandatory annexures or official forms.");
        if (contentBlockers.length > 0) {
          return NextResponse.json({
            errorCode: "CRITICAL_CONTENT_PAGES_MISSING",
            error: "Generation blocked: critical tender sections (submission instructions or required documents) were not found in the extracted text. Re-extract the PDF or run OCR to ensure these sections are readable before generating documents.",
            blockers: contentBlockers,
            evaluationCriteriaMissing: !anyEvaluation,
            nextAction: "OPEN_EXTRACTION_QUALITY",
            diagnosticId: `content-pages-missing-${id}`,
          }, { status: 422 });
        }
      }
    }
  }

  const approvedAnalysisSource = await detectAnalysisSourceWithApproval(prisma, id, tender).catch(() => null);
  const analysisQuality = assessTenderAnalysisQuality({
    requirements: tender.requirements,
    analysisSummary: tender.analysisSummary,
    evaluationMethodology: tender.evaluationMethodology,
    submissionNotes: [tender.notes, tender.intakeSummary].filter(Boolean).join("\n\n"),
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    clientName: effectiveClientName,
    referenceNumber: tender.reference,
    country: tender.country,
    clientContactName: tender.clientContactName,
    extractedTextLength: effectiveExtractionFiles.reduce((sum, file) => sum + (file.extractedText?.length ?? 0), 0),
    totalPageCount: effectiveExtractionFiles.reduce((sum, file) => sum + (file.totalPages ?? 0), 0),
    deadline: tender.deadline,
    submissionMethod: tender.submissionMethod,
    submissionAddress: tender.submissionAddress,
    submissionEmails: tender.submissionEmails,
    analysisExtractionStatus: tender.analysisExtractionStatus,
    analysisSource: approvedAnalysisSource,
  });
  if (analysisQuality.severity === "POOR" || analysisQuality.severity === "UNSAFE") {
    return NextResponse.json({
      errorCode: "ANALYSIS_QUALITY_NOT_READY",
      error: `Generation blocked: tender analysis is ${analysisQuality.severity.toLowerCase()} (${analysisQuality.score}/100).`,
      blockers: analysisQuality.warnings.slice(0, 10),
      nextAction: "OPEN_ANALYSIS_QUALITY",
      diagnosticId: `analysis-quality-${id}`,
      quality: { severity: analysisQuality.severity, score: analysisQuality.score },
    }, { status: 422 });
  }

  // ── Critical metadata gate — deadline + submission method ─────────────────
  // Per CLAUDE.md: deadline and submission method are critical fields that must
  // block final generation when missing or invalid. The analysis quality gate
  // above checks their content but only blocks at POOR/UNSAFE severity; this
  // explicit gate blocks regardless of overall analysis quality so the generator
  // never produces documents without a known deadline or submission endpoint.
  {
    const reqUrl = new URL(req.url);
    if (reqUrl.searchParams.get("planOnly") !== "true") {
      const missingCritical: string[] = [];
      if (!tender.deadline) missingCritical.push("Submission deadline is not set.");
      if (!tender.submissionMethod) missingCritical.push("Submission method is not set.");
      // Only require submissionEmails when the method clearly indicates email
      // delivery — not when "email" appears in a prohibition phrase like
      // "no email submissions" or "hard copy only; email not accepted".
      if (
        tender.submissionMethod &&
        /email/i.test(tender.submissionMethod) &&
        !/no.{0,30}email|email.{0,30}not.{0,10}(accepted|allowed)|hard.{0,10}copy.{0,30}only/i.test(tender.submissionMethod) &&
        !tender.submissionEmails
      ) {
        missingCritical.push("Submission email address is missing for email-based submission.");
      }
      if (missingCritical.length > 0) {
        return NextResponse.json({
          errorCode: "CRITICAL_METADATA_MISSING",
          error: "Generation blocked: critical submission metadata (deadline or submission method/endpoint) is missing. Fill these fields before generating documents.",
          blockers: missingCritical,
          nextAction: "EDIT_TENDER_METADATA",
          diagnosticId: `critical-metadata-${id}`,
        }, { status: 422 });
      }
    }
  }

  // ── Submission plan gate ──────────────────────────────────────────────────
  // A valid submission plan (at least one non-SUPERSEDED GeneratedDocument row
  // with a recognised reviewStatus) MUST exist before any full generation run.
  // This gate runs unconditionally — regardless of requirement count — so it is
  // impossible to bypass it by having fewer than 5 requirements.
  // planOnly requests are exempt because they ARE the plan-building step itself.
  {
    const reqUrl = new URL(req.url);
    if (reqUrl.searchParams.get("planOnly") !== "true") {
      const planCheck = await hasValidSubmissionPlan(prisma, tender.id);
      if (!planCheck.valid) {
        return NextResponse.json({
          errorCode: "NO_SUBMISSION_PLAN",
          error: "No submission plan exists. Build the submission plan before generating documents.",
          blockers: ["Submission plan has not been built. Run Build Plan before generating documents."],
          nextAction: "BUILD_SUBMISSION_PLAN",
          diagnosticId: `no-plan-${tender.id}`,
          plannedCount: planCheck.plannedCount,
        }, { status: 400 });
      }

      // Advisory block: all planned rows are unconfirmed derived-draft heuristics.
      const allDerivedUnconfirmed = await prisma.generatedDocument.count({
        where: {
          tenderId: tender.id,
          generationStatus: { not: "SUPERSEDED" },
          reviewStatus: { in: ["PLANNED", "PENDING", "APPROVED", "CONFIRMED", "READY_FOR_EXPORT", "REPLACE_WITH_ORIGINAL"] },
          contentSummary: { contains: "DERIVED_DRAFT_UNCONFIRMED" },
        },
      });
      const totalPlanned = planCheck.plannedCount;
      if (allDerivedUnconfirmed > 0 && allDerivedUnconfirmed === totalPlanned && totalPlanned > 0) {
        return NextResponse.json({
          errorCode: "DERIVED_PLAN_UNCONFIRMED",
          error: "The submission plan was automatically derived from requirement keywords and has not been confirmed against the actual tender document. Review the plan, verify each required document, and confirm before generating.",
          blockers: ["All submission plan rows are unconfirmed derived drafts — confirm file names/order against the tender before generating."],
          nextAction: "CONFIRM_SUBMISSION_PLAN",
          diagnosticId: `derived-plan-${tender.id}`,
          isDerivedDraft: true,
        }, { status: 422 });
      }
    }
  }

  // ── Metadata completeness gate ────────────────────────────────────────────
  // Blocks generation when critical metadata is missing or placeholder-filled
  // (e.g. client name "Bid-Team to confirm", no submission endpoint, no deadline).
  // overallRatio < 0.3 is a hard block; missingCritical / invalidFields always block.
  // Load any user overrides — these allow NOT_APPLICABLE / USER_CONFIRMED /
  // USER_EDITED / IGNORED_WITH_REASON to unblock specific missing fields.
  // Load metadata overrides — wrapped in a guard so an unmigrated DB (missing
  // TenderMetadataOverride table) falls back to an empty list instead of 500-ing.
  // Only P2021 (table does not exist) and P2010 (raw query / missing relation)
  // are swallowed; all other errors re-throw so real DB failures are visible.
  let metadataOverrides: Array<{ field: string; fieldState: string; overrideValue: string | null }> = [];
  let metadataOverrideLookupFailed = false;
  try {
    metadataOverrides = await prisma.tenderMetadataOverride.findMany({
      where: { tenderId: id },
      select: { field: true, fieldState: true, overrideValue: true },
    });
  } catch (overrideErr) {
    const code = (overrideErr as { code?: string })?.code;
    if (code === "P2021" || code === "P2010") {
      console.warn(`[generate] TenderMetadataOverride table not available (${code}) — proceeding with empty overrides. Run database migration to resolve.`);
      metadataOverrides = [];
      metadataOverrideLookupFailed = true;
    } else {
      throw overrideErr;
    }
  }
  const metadataReport = assessTenderMetadataCompleteness({
    clientName: effectiveClientName,
    procuringEntityName: (tender as Record<string, unknown>).procuringEntityName as string | null | undefined,
    title: tender.title,
    reference: tender.reference ?? null,
    country: tender.country ?? null,
    submissionMethod: tender.submissionMethod ?? null,
    submissionAddress: tender.submissionAddress ?? null,
    submissionEmails: tender.submissionEmails ?? null,
    deadline: tender.deadline ?? null,
    clientContactName: tender.clientContactName ?? null,
    clientContactEmail: tender.clientContactEmail ?? null,
    clientContactPhone: tender.clientContactPhone ?? null,
    pageLimit: tender.pageLimit ?? null,
    budget: tender.budget ?? null,
    currency: tender.currency ?? null,
    validityDays: tender.validityDays ?? null,
    bidBondAmount: tender.bidBondAmount ?? null,
    bidBondCurrency: tender.bidBondCurrency ?? null,
    mandatorySiteVisit: tender.mandatorySiteVisit ?? null,
    numberOfCopiesRequired: tender.numberOfCopiesRequired ?? null,
    preBidMeetingDate: tender.preBidMeetingDate ?? null,
    preBidMeetingLocation: tender.preBidMeetingLocation ?? null,
    clientCity: tender.clientCity ?? null,
    clientWebsite: tender.clientWebsite ?? null,
    submissionEmailSubject: tender.submissionEmailSubject ?? null,
    preBidChannel: tender.preBidChannel ?? null,
    clientRepresentative: tender.clientRepresentative ?? null,
    requirementCount: tender.requirements.length,
    hasEvaluationMethodology: Boolean((tender.evaluationMethodology ?? "").trim()),
    hasSubmissionRules: Boolean(tender.submissionMethod || tender.submissionEmails || tender.submissionAddress),
  }, metadataOverrides);
  if (metadataReport.blockingForGeneration) {
    // Name the actual missing fields so the user knows exactly what's wrong,
    // and nudge them to the one-click repair button. The endpoint behind that
    // button never invents — it returns NOT_FOUND when no source quote matches.
    const missingNames = metadataReport.missingCritical.map((f) => f.field).slice(0, 5);
    const placeholderNames = metadataReport.invalidFields.map((f) => f.field).slice(0, 5);
    const parts: string[] = [];
    if (missingNames.length > 0) parts.push(`${missingNames.length} critical field(s) missing (${missingNames.join(", ")})`);
    if (placeholderNames.length > 0) parts.push(`${placeholderNames.length} field(s) contain placeholder language (${placeholderNames.join(", ")})`);
    const contaminatedExtra = (tender as { metadataContaminated?: boolean }).metadataContaminated ? " Client/procuring entity metadata is flagged as contaminated — correct it before generating." : "";
    return NextResponse.json({
      errorCode: "METADATA_INCOMPLETE",
      error: `Generation blocked: ${parts.join("; ")}.${contaminatedExtra} First try the "Repair all empty fields from source" button — the deterministic extractor pulls verifiable values from the uploaded tender files when present. If a field is genuinely absent from the tender source, edit the tender and confirm it manually.`,
      blockers: [
        ...metadataReport.missingCritical.map((f) => `Critical field missing: ${f.field}`),
        ...metadataReport.invalidFields.map((f) => `Field contains placeholder: ${f.field}`),
      ].slice(0, 10),
      nextAction: "REPAIR_OR_EDIT_TENDER",
      diagnosticId: `metadata-incomplete-${id}`,
      missingCritical: metadataReport.missingCritical.map((f) => ({ field: f.field, reason: f.reason })),
      invalidFields: metadataReport.invalidFields.map((f) => ({ field: f.field, reason: f.reason })),
      // missingFields is a flat list of field names for convenient client-side
      // rendering of per-field guidance without needing to merge two arrays.
      missingFields: [
        ...metadataReport.missingCritical.map((f) => f.field),
        ...metadataReport.invalidFields.map((f) => f.field),
      ],
      overallRatio: metadataReport.overallRatio,
      metadataContaminated: Boolean((tender as { metadataContaminated?: boolean }).metadataContaminated),
      deadlinePassed: metadataReport.deadlinePassed,
    }, { status: 422 });
  }

  // ── Standalone contamination gate ─────────────────────────────────────────
  // metadataReport.blockingForGeneration only fires when required fields are
  // missing or placeholder-filled. A contaminated client name can pass that
  // check (the field is non-empty and not a placeholder) yet still be wrong.
  // Block unconditionally when contamination is flagged, regardless of whether
  // other metadata is present.
  if ((tender as { metadataContaminated?: boolean }).metadataContaminated) {
    return NextResponse.json({
      errorCode: "METADATA_CONTAMINATED",
      error: "Generation blocked: client/procuring entity metadata is flagged as contaminated. The extracted client name may be polluted by unrelated tender portal text or navigation content. Correct the client name before generating documents.",
      blockers: ["Client/procuring entity name is contaminated — review and correct before generating."],
      nextAction: "REPAIR_OR_EDIT_TENDER",
      diagnosticId: `metadata-contaminated-${id}`,
      metadataContaminated: true,
    }, { status: 422 });
  }

  // ── Plan-only mode: build submission plan stubs without running full AI generation ──
  const url = new URL(req.url);
  if (url.searchParams.get("planOnly") === "true") {
    const plan = buildSubmissionPlan(tender);
    const alreadyInProgress = await prisma.generatedDocument.count({
      where: { tenderId: id, generationStatus: { in: ["GENERATING", "QUEUED"] } },
    });
    if (alreadyInProgress > 0) {
      return NextResponse.json({ error: "Generation already in progress — cannot build plan while documents are generating.", code: "GENERATION_IN_PROGRESS" }, { status: 409 });
    }
    const plannedFiles = plannedSubmissionTargetFiles(plan);
    if (plannedFiles.length === 0) {
      return NextResponse.json({
        ok: false,
        planBuilt: false,
        error: "Submission plan build produced zero required files. Review extraction/analysis output or manually confirm required submission documents before generation.",
        code: "SUBMISSION_PLAN_EMPTY_REVIEW_REQUIRED",
        nextAction: "REVIEW_REQUIREMENTS_OR_ADD_MANUAL_PLAN",
        blockers: plan.warnings.length > 0 ? plan.warnings : ["No required submission files could be derived from tender requirements or exact file naming instructions."],
      }, { status: 422 });
    }
    const planRowsCreated = await ensurePlannedGeneratedDocumentRecords(id, plannedFiles);
    await logAction({ userId, action: "TENDER_PLAN_BUILT", entityType: "Tender", entityId: id, description: `Submission plan built: ${planRowsCreated} planned document stub(s) created.`, metadata: { tenderId: id, planRowsCreated, plannedFileCount: plannedFiles.length } });
    return NextResponse.json({ planBuilt: true, planRowsCreated, plannedFileCount: plannedFiles.length, message: `Submission plan built — ${planRowsCreated} planned document stub(s) created from ${plannedFiles.length} required file(s).` });
  }

  // ── Regex-fallback analysis gate (Part 4) ────────────────────────────────
  // If the last engine run fell back to regex analysis because AI providers
  // failed, do not produce a final proposal unless a senior engineer has
  // explicitly approved the fallback analysis via
  // POST /api/tenders/[id]/approve-analysis. This is what prevents the
  // screenshot regression where regex-fallback analysis quietly produced
  // PASSED/APPROVED final proposal documents.
  const analysisGate = await assertAnalysisReadyForFinalGeneration(prisma, id, tender);
  if (!analysisGate.ok) {
    await logAction({
      userId,
      action: "GENERATION_BLOCKED_REGEX_FALLBACK",
      entityType: "Tender",
      entityId: id,
      description: "Final generation blocked: analysis source is regex fallback and has not been human-approved.",
      requestId,
    });
    return NextResponse.json({
      errorCode: analysisGate.code,
      error: analysisGate.message,
      code: analysisGate.code,
      blockers: [analysisGate.message],
      nextAction: analysisGate.nextAction,
      diagnosticId: `analysis-source-${id}`,
      details: "Re-run AI Analyze with healthy providers, or POST /api/tenders/[id]/approve-analysis to explicitly approve the current regex-fallback analysis.",
    }, { status: 409 });
  }
  // ── Source traceability gate ──────────────────────────────────────────────
  // Block when ALL mandatory requirements completely lack source traceability
  // (none of: sourceConfidence, sourceTenderFileId, sourcePageNumber,
  // sourceExactQuote). This means AI Analyze has never been run or failed to
  // attach any source signal. Only fires when ≥ 3 mandatory requirements exist
  // so it does not block small manually-entered tenders.
  {
    const mandatoryReqs = tender.requirements.filter((req) => req.priority === "MANDATORY");
    if (mandatoryReqs.length >= 3) {
      const fullyUntracedCount = mandatoryReqs.filter(
        (req) =>
          (req.sourceConfidence ?? 0) <= 0 &&
          req.sourceTenderFileId == null &&
          req.sourcePageNumber == null &&
          (!req.sourceExactQuote || req.sourceExactQuote.trim().length === 0),
      ).length;
      if (fullyUntracedCount === mandatoryReqs.length) {
        return NextResponse.json({
          ok: false,
          error: "Cannot generate documents: no mandatory requirements have source page/quote traceability. Run AI Analyze first to extract requirements from the tender.",
          code: "REQUIREMENTS_NO_SOURCE_TRACEABILITY",
          nextAction: "RUN_ENGINE",
        }, { status: 422 });
      }
    }
  }

  const untracedInitial = tender.requirements.filter((req) => req.priority === "MANDATORY" && ((req.sourceConfidence ?? 0) <= 0));
  if (untracedInitial.length > 0) {
    // Attempt one automatic repair pass using uploaded tender file text before hard-blocking.
    const repairResult = await repairSourceGrounding(id).catch((err) => {
      console.warn(`[generate] source-grounding repair attempt failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    // Reload requirements to see the updated confidence values after repair.
    const mandatoryAfterRepair = repairResult === null
      ? [] // repair call threw — don't block on source-grounding when repair is unavailable
      : repairResult.repairedCount > 0
        ? await prisma.tenderRequirement.findMany({
            where: { tenderId: id, priority: "MANDATORY" },
            select: { id: true, title: true, sourceConfidence: true },
          }).then((rows) => rows.filter((r) => (r.sourceConfidence ?? 0) <= 0))
        : untracedInitial;
    if (mandatoryAfterRepair.length > 0) {
      return NextResponse.json({
        error: `Generation blocked: ${mandatoryAfterRepair.length} mandatory requirement(s) are not source-grounded yet.`,
        code: "UNTRACED_MANDATORY_REQUIREMENTS",
        requirements: mandatoryAfterRepair.slice(0, 20).map((req) => ({ id: req.id, title: req.title })),
        nextAction: "REPAIR_SOURCE_GROUNDING",
        hint: "Use the 'Repair source grounding' button or POST /api/tenders/{id}/repair-source-grounding, then retry generation.",
      }, { status: 422 });
    }
  }

  const submissionPlan = buildSubmissionPlan({ id: tender.id, title: tender.title, exactFileNaming: tender.exactFileNaming, exactFileOrder: tender.exactFileOrder, pageLimit: tender.pageLimit, requirements: tender.requirements });
  const explicitSubmissionScope = hasExplicitSubmissionScope(tender);
  const plannedTargetFiles = explicitSubmissionScope ? plannedSubmissionTargetFiles(submissionPlan) : [];
  const plannedFileKeys = explicitSubmissionScope ? plannedSubmissionTargetKeys(submissionPlan) : undefined;

  if (explicitSubmissionScope) {
    const generatedDocsForPlanGate = await prisma.generatedDocument.findMany({
      where: { tenderId: id, generationStatus: { not: "SUPERSEDED" } },
      select: { id: true, name: true, exactFileName: true, exactOrder: true, documentType: true, format: true, generationStatus: true },
    });
    const missingPlanFilesForGate = findMissingGeneratedDocuments(submissionPlan, generatedDocsForPlanGate);
    if (missingPlanFilesForGate.length > 0) {
      return NextResponse.json({
        errorCode: "SUBMISSION_PLAN_INCOMPLETE",
        error: "Generation blocked: the built submission plan is incomplete. Re-run Build Plan and confirm all tender-required files before generating.",
        blockers: missingPlanFilesForGate.slice(0, 20).map((file) => `Missing planned file: ${file.exactFileName}`),
        nextAction: "BUILD_SUBMISSION_PLAN",
        diagnosticId: `plan-incomplete-${id}`,
        missing: missingPlanFilesForGate.map((file) => file.exactFileName),
      }, { status: 422 });
    }
  }

  const criticalGaps = await prisma.complianceGap.findMany({ where: { tenderId: id, severity: "CRITICAL", isResolved: false }, select: { title: true, description: true, mitigationPlan: true } });
  const hardBlocks = criticalGaps.filter(criticalGapIsHardBlock);
  const seniorReviewCriticals = criticalGaps.filter((gap) => !criticalGapIsHardBlock(gap));
  if (hardBlocks.length > 0) return NextResponse.json({ error: `Generation blocked: ${hardBlocks.length} hard blocker(s) remain. ${hardBlocks.map((g) => g.title).join("; ")}`, code: "HARD_BLOCKERS" }, { status: 422 });

  const promotion = await promoteBestAvailableReviewedMatchesForGeneration({ tenderId: id, requirements: tender.requirements });
  const selectedExpertMatches = await prisma.tenderExpertMatch.findMany({ where: { tenderId: id, isSelected: true }, include: { expert: { select: { fullName: true, trustLevel: true } } } });
  const selectedProjectMatches = await prisma.tenderProjectMatch.findMany({ where: { tenderId: id, isSelected: true }, include: { project: { select: { name: true, trustLevel: true } } } });
  const [totalExpertMatches, totalProjectMatches] = await Promise.all([
    prisma.tenderExpertMatch.count({ where: { tenderId: id } }),
    prisma.tenderProjectMatch.count({ where: { tenderId: id } }),
  ]);
  const draftExperts = selectedExpertMatches.filter((m) => m.expert.trustLevel !== "REVIEWED");
  const draftProjects = selectedProjectMatches.filter((m) => m.project.trustLevel !== "REVIEWED");
  const reviewedExpertCount = selectedExpertMatches.length - draftExperts.length;
  const reviewedProjectCount = selectedProjectMatches.length - draftProjects.length;
  const expertRequirementExists = await prisma.tenderRequirement.count({ where: { tenderId: id, requirementType: "EXPERT" } });
  const projectRequirementExists = await prisma.tenderRequirement.count({ where: { tenderId: id, requirementType: "PROJECT_EXPERIENCE" } });
  if (expertRequirementExists > 0 && selectedExpertMatches.length === 0) {
    if (totalExpertMatches > 0) {
      return NextResponse.json({ error: "Generation blocked: tender requires experts but no expert matches are selected. Run Engine and review/select expert matches before generating.", code: "NO_EXPERT_MATCHES_SELECTED", totalExpertMatches, nextAction: "REVIEW_MATCHES" }, { status: 422 });
    }
    return NextResponse.json({ error: "Generation blocked: tender requires experts but no tender-specific expert match rows exist yet. Run Engine first to create tender expert match rows, then review/select expert matches.", code: "ENGINE_NOT_RUN_OR_NO_EXPERT_MATCH_ROWS", totalExpertMatches: 0, nextAction: "RUN_ENGINE" }, { status: 422 });
  }
  if (projectRequirementExists > 0 && selectedProjectMatches.length === 0) {
    if (totalProjectMatches > 0) {
      return NextResponse.json({ error: "Generation blocked: tender requires project references but no project matches are selected. Run Engine and review/select project matches before generating.", code: "NO_PROJECT_MATCHES_SELECTED", totalProjectMatches, nextAction: "REVIEW_MATCHES" }, { status: 422 });
    }
    return NextResponse.json({ error: "Generation blocked: tender requires project references but no tender-specific project match rows exist yet. Run Engine first to create tender project match rows, then review/select project matches.", code: "ENGINE_NOT_RUN_OR_NO_PROJECT_MATCH_ROWS", totalProjectMatches: 0, nextAction: "RUN_ENGINE" }, { status: 422 });
  }
  if (selectedExpertMatches.length > 0 && reviewedExpertCount === 0 && expertRequirementExists > 0) return NextResponse.json({ error: `Generation blocked: ${selectedExpertMatches.length} expert(s) are selected but NONE have been reviewed. Go to the Knowledge Review page and review at least one expert before generating.`, code: "ALL_EXPERTS_UNREVIEWED", draftExperts: draftExperts.map((m) => m.expert.fullName) }, { status: 422 });
  if (selectedProjectMatches.length > 0 && reviewedProjectCount === 0 && projectRequirementExists > 0) return NextResponse.json({ error: `Generation blocked: ${selectedProjectMatches.length} project reference(s) are selected but NONE have been reviewed. Go to the Knowledge Review page and review at least one project before generating.`, code: "ALL_PROJECTS_UNREVIEWED", draftProjects: draftProjects.map((m) => m.project.name) }, { status: 422 });

  const warnings: string[] = [...readiness.warnings, ...promotion.warnings];
  if (explicitSubmissionScope) warnings.push(`Submission plan target scope detected: ${plannedTargetFiles.length} tender-required file(s) will control generation reconciliation.`);
  if (seniorReviewCriticals.length > 0) warnings.push(`${seniorReviewCriticals.length} critical evidence/review gap(s) were carried into the proposal as senior bid-review items instead of blocking draft generation.`);
  if (draftExperts.length > 0) warnings.push(`${draftExperts.length} selected expert(s) are unreviewed drafts: ${draftExperts.map((m) => m.expert.fullName).join(", ")}. Review them in the Knowledge Review page for more accurate proposals.`);
  if (draftProjects.length > 0) warnings.push(`${draftProjects.length} selected project(s) are unreviewed drafts: ${draftProjects.map((m) => m.project.name).join(", ")}. Review them in the Knowledge Review page for more accurate proposals.`);

  const log = childLogger({ tenderId: id, userId, route: "/api/tenders/[id]/generate" });
  log.info("generation_started", { reviewedExpertCount, draftExpertCount: draftExperts.length, reviewedProjectCount, draftProjectCount: draftProjects.length, promotedExpertCount: promotion.promotedExpertCount, promotedProjectCount: promotion.promotedProjectCount, readinessTotals: readiness.totals });
  const job = createJob({ userId, tenderId: id, type: "GENERATE", steps: ["FETCH", "AI_GENERATE", "SAVE", "LETTERHEAD", "VALIDATE"] });
  advanceJob(job.id, "FETCH");

  try {
    const plannedRecordCount = 0;
    // Full Generate Docs is not allowed to mutate the submission plan. Missing
    // plan rows are blocked above so repeated generation cannot create duplicate
    // active document records or silently expand the final-export scope.
    advanceJob(job.id, "AI_GENERATE");
    await time("generate.tender_documents", () => generateTenderDocuments(id, userId), { tenderId: id });
    advanceJob(job.id, "SAVE");
    const supportDocumentCount = await time("generate.fill_support_docs", () => fillPlannedSupportDocuments(id, plannedFileKeys), { tenderId: id });
    if (supportDocumentCount > 0) warnings.push(explicitSubmissionScope ? `${supportDocumentCount} planned package document(s) were generated or marked for original replacement.` : `${supportDocumentCount} remaining package document(s) were generated or marked for original replacement.`);
    advanceJob(job.id, "LETTERHEAD");
    const letterheadAppliedCount = await applyActiveUploadedLetterheadToTenderDocuments(id, userId);
    if (letterheadAppliedCount > 0) warnings.push(`Uploaded Word letterhead applied to ${letterheadAppliedCount} generated DOCX file(s).`);

    const generatedDocsForPlan = explicitSubmissionScope ? await prisma.generatedDocument.findMany({ where: { tenderId: id }, select: { id: true, name: true, exactFileName: true, exactOrder: true, documentType: true, format: true, generationStatus: true } }) : [];
    const missingPlanFiles = explicitSubmissionScope ? findMissingGeneratedDocuments(submissionPlan, generatedDocsForPlan) : [];
    const extraGeneratedDocs = explicitSubmissionScope ? findExtraGeneratedDocuments(submissionPlan, generatedDocsForPlan) : [];
    if (missingPlanFiles.length > 0) warnings.push(`Submission plan still has ${missingPlanFiles.length} missing tender-required file(s): ${missingPlanFiles.map((file) => file.exactFileName).join(", ")}.`);
    if (extraGeneratedDocs.length > 0) warnings.push(`Generation produced ${extraGeneratedDocs.length} generated file(s) outside the explicit submission plan: ${extraGeneratedDocs.map((doc) => doc.exactFileName ?? doc.name ?? doc.documentType ?? doc.id ?? "document").join(", ")}. Final ZIP export will block until reconciled.`);

    advanceJob(job.id, "VALIDATE");
    if (reviewedExpertCount > 0 || draftExperts.length > 0 || reviewedProjectCount > 0 || draftProjects.length > 0) await prisma.generatedDocument.updateMany({ where: { tenderId: id }, data: { reviewedExpertCount, draftExpertCount: draftExperts.length, reviewedProjectCount, draftProjectCount: draftProjects.length, updatedAt: new Date() } });
    // Advance tender stage to GENERATION so the header stage pill reflects progress.
    await prisma.tender.update({ where: { id }, data: { stage: "GENERATION" } }).catch(() => {});
    await logAction({ userId, action: "TENDER_GENERATED", entityType: "Tender", entityId: id, description: `Generated benchmark-quality documents for tender "${tender.title}" — ${reviewedExpertCount} reviewed experts, ${draftExperts.length} draft experts, ${reviewedProjectCount} reviewed projects, ${draftProjects.length} draft projects, ${supportDocumentCount} supporting/replacement-control package documents, ${letterheadAppliedCount} uploaded letterhead overlays, ${seniorReviewCriticals.length} senior-review gaps`, metadata: { tenderId: id, reviewedExpertCount, draftExpertCount: draftExperts.length, reviewedProjectCount, draftProjectCount: draftProjects.length, promotedExpertCount: promotion.promotedExpertCount, promotedProjectCount: promotion.promotedProjectCount, plannedRecordCount, supportDocumentCount, letterheadAppliedCount, seniorReviewGapCount: seniorReviewCriticals.length, explicitSubmissionScope, plannedTargetCount: plannedTargetFiles.length, missingPlanFileCount: missingPlanFiles.length, extraGeneratedFileCount: extraGeneratedDocs.length, readiness: readiness.totals, warnings }, requestId });
    const updatedTender = await prisma.tender.findFirst({
      where: { id, userId },
      include: {
        generatedDocuments: {
          orderBy: { exactOrder: "asc" },
          select: { id: true, name: true, documentType: true, generationStatus: true, validationStatus: true, reviewStatus: true, reviewNotes: true, exactFileName: true, exactOrder: true, contentSummary: true, reviewedExpertCount: true, draftExpertCount: true, reviewedProjectCount: true, draftProjectCount: true },
        },
      },
    });
    const jobResult = { warnings, supportDocumentCount, letterheadAppliedCount, promotedExpertCount: promotion.promotedExpertCount, promotedProjectCount: promotion.promotedProjectCount };
    completeJob(job.id, jobResult);
    void createNotification({ userId, type: "TENDER_GENERATED", title: `Documents generated for "${tender.title}"`, body: `${(updatedTender?.generatedDocuments ?? []).length} document(s) ready for review.`, entityType: "Tender", entityId: id, link: `/dashboard/tenders/${id}` });
    // Extract quality score and axis scores from contentSummary so the UI
    // doesn't need to parse a text string — structured fields are more reliable.
    const proposalDoc = updatedTender?.generatedDocuments?.find((d) => d.documentType === "TECHNICAL_PROPOSAL");
    const qMatch = proposalDoc?.contentSummary?.match(/Quality score:\s*(\d+)\/100/);
    const aMatch = proposalDoc?.contentSummary?.match(/AXIS_SCORES:\s*(\{[^}]+\})/);
    const qualityScoreValue = qMatch ? parseInt(qMatch[1], 10) : null;
    let axisScoresValue: Record<string, number> | null = null;
    try { axisScoresValue = aMatch ? JSON.parse(aMatch[1]) as Record<string, number> : null; } catch { axisScoresValue = null; }
    return NextResponse.json({ success: true, jobId: job.id, tender: updatedTender, warnings, readiness: readiness.totals, plannedRecordCount, supportDocumentCount, letterheadAppliedCount, promotedExpertCount: promotion.promotedExpertCount, promotedProjectCount: promotion.promotedProjectCount, qualityScore: qualityScoreValue, axisScores: axisScoresValue, submissionPlan: explicitSubmissionScope ? { plannedTargetCount: plannedTargetFiles.length, missing: missingPlanFiles.map((file) => file.exactFileName), extras: extraGeneratedDocs.map((doc) => doc.exactFileName ?? doc.name ?? doc.documentType ?? doc.id ?? "document") } : null, ...(metadataOverrideLookupFailed ? { metadataOverrideLookupFailed: true, metadataOverrideLookupWarning: "TenderMetadataOverride table is not yet available — run database migration." } : {}) });
  } catch (error) {
    failJob(job.id, error instanceof Error ? error.message : String(error));
    void reportError(error, { tenderId: id, userId, route: "/api/tenders/[id]/generate" });
    const mapped = mapGenerationError(error, { failedStage: "GENERATION_PIPELINE" });
    return NextResponse.json(
      { ...mapped.body, error: mapped.body.message, jobId: job.id },
      { status: mapped.status },
    );
  }
}
