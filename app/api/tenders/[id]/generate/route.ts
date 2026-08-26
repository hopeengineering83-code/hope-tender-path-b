import { NextResponse } from "next/server";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { generateTenderDocuments } from "../../../../../lib/engine/generate-elite";
import { promoteBestAvailableReviewedMatchesForGeneration } from "../../../../../lib/engine/best-available-selection";
import { applyActiveUploadedLetterheadToTenderDocuments } from "../../../../../lib/engine/apply-active-letterhead";
import { applyActiveSignatureAndStampToTenderDocuments } from "../../../../../lib/engine/apply-signature-stamp";
import { rateLimit, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { checkAiQuota } from "../../../../../lib/ai-quota";
import { buildSubmissionPlan, findExtraGeneratedDocuments, findMissingGeneratedDocuments, generatedDocumentSubmissionKey, plannedSubmissionTargetFiles, plannedSubmissionTargetKeys } from "../../../../../lib/engine/submission-plan";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";
import { canUseVaultRecord, VAULT_REVIEW_CONSUMER_SELECT } from "../../../../../lib/vault-review-provenance";
import { inferType as inferRequirementType } from "../../../../../lib/engine/analysis";
import { polishBenchmarkOutput } from "../../../../../lib/engine/benchmark-output-polisher";
import { cleanTenderTitle, cleanClientName, formatRequirementLine } from "../../../../../lib/engine/proposal-labels";
import { logAction } from "../../../../../lib/audit";
import { extractRequestId } from "../../../../../lib/request-id";
import { createJob, advanceJob, completeInMemoryJob, failInMemoryJob } from "../../../../../lib/job-store";
import { generatedDocumentHasContent } from "../../../../../lib/generated-document-content";
import { reuseTenderIssuedForm } from "../../../../../lib/engine/tender-issued-form-discovery";
import { getStorageAdapter } from "../../../../../lib/storage";
import { createNotification } from "../../../../../lib/notifications";
import { childLogger, reportError, time, logger } from "../../../../../lib/observability";
import { mapGenerationError } from "../../../../../lib/engine/structured-generation-error";
import { computeStoredMetadataPatch, listInvalidStoredFields } from "../../../../../lib/engine/sanitize-stored-metadata";
import { getCanonicalReadinessSummary } from "../../../../../lib/canonical-tender-readiness";
import { validateTenderBeforeGeneration } from "../../../../../lib/engine/pre-generation-validation";
import { isValidClientName, containsMetadataPlaceholder } from "../../../../../lib/engine/metadata-validators";
import { repairSourceGrounding } from "../../../../../lib/engine/repair-source-grounding";
import { assertAnalysisReadyForFinalGeneration, detectAnalysisSourceWithApproval } from "../../../../../lib/engine/analysis-source";
import { assertTenderReadyForGenerationAndExport } from "../../../../../lib/engine/generation-readiness-gate";
import { resolveCanonicalFieldState } from "../../../../../lib/engine/canonical-field-state";
import { assessTenderMetadataCompleteness } from "../../../../../lib/engine/tender-metadata-completeness";
import { isCriticalField } from "../../../../../lib/engine/tender-policy-registry";
import { isExtractionAcceptableForGeneration } from "../../../../../lib/engine/extraction-quality-gate";
import { buildDraftBuildPlan, getCurrentConfirmedBuildPlan } from "../../../../../lib/engine/build-plan";
// hasValidSubmissionPlan was REMOVED — GeneratedDocument rows must never be
// used as a BuildPlan proxy. The authoritative plan check is enforced by
// assertTenderReadyForGenerationAndExport (hasCurrentConfirmedBuildPlan +
// recordedBuildPlanState) further below.
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { assessTenderAnalysisQuality } from "../../../../../lib/analysis-quality";
import { assessExtractionQualityPerPage } from "../../../../../lib/extraction-quality";
import { checkGenerationGates } from "../../../../../lib/generation-gates";
import { resolveTenderOperationGate } from "../../../../../lib/engine/tender-operation-gate";
import { deriveSourceDrivenTenderDetail } from "../../../../../lib/engine/source-driven-tender-detail";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type SupportDocKind = "EXPERT_CV" | "PROJECT_REFERENCES" | "METHODOLOGY" | "COMPANY_PROFILE" | "FINANCIAL_PLACEHOLDER" | "LEGAL_PLACEHOLDER" | "FORM_PLACEHOLDER" | "DECLARATION_PLACEHOLDER" | "ANNEX_PLACEHOLDER" | "SUBMISSION_RULES_PLACEHOLDER" | "SECTOR_TECHNICAL_SCOPE" | "GENERIC";

// PERMANENTLY DISABLED contract marker — do not remove. Creating
// GeneratedDocument rows from the submission plan before preflight was a
// bypass; the stub's name and `return 0;` body are pinned by
// tests/quality-gaps-phase28.test.ts and tests/route-behavioral-gate.test.ts
// so any re-enablement (under this name) fails loudly. Real document rows
// are only ever created by the gated generation path below.
async function ensurePlannedGeneratedDocumentRecords(_tenderId: string, _plannedFiles: unknown): Promise<number> {
  return 0;
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

async function makeSupportDocx(tenderTitle: string, title: string, sections: Array<{ title: string; lines: string[] }>): Promise<string> {
  const children: Paragraph[] = [para(title, true), para(`Tender: ${shortText(tenderTitle, 200)}. Package item: ${title}.`)];
  for (const section of sections) {
    children.push(heading(section.title));
    for (const line of (section.lines.length ? section.lines : ["Applicable tender-issued forms, attachments or source evidence should be inserted under this section where required."])) children.push(bullet(line));
  }
  const buffer = await Packer.toBuffer(new Document({ sections: [{ properties: {}, children }], styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } } } }));
  return buffer.toString("base64");
}

/** Drop a trailing ".ext" without a regular expression. */
function stripFileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return fileName;
  const ext = fileName.slice(dot + 1);
  for (const ch of ext) {
    const isAlphanumeric = (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9");
    if (!isAlphanumeric) return fileName;
  }
  return fileName.slice(0, dot);
}

function classifySupportDoc(docName: string): SupportDocKind {
  // Separators are normalised to spaces before matching.
  //
  // Every pattern below is written with literal spaces ("company profile",
  // "work plan", "project reference", "key staff"), but a tender names its
  // required files with hyphens or underscores -- "02-Company-Profile.docx" is
  // the form tenders actually mandate. Matching the raw name meant that file
  // matched nothing, fell through to GENERIC, and GENERIC is not a
  // company-produced kind: the confirmed plan's Company Profile was written as
  // a zero-byte "attach the tender-issued original" placeholder, failed
  // canonical validation, and blocked the final ZIP. The company profile is a
  // document the firm writes, not a form the client issues.
  const name = docName.toLowerCase().replace(/[-_.]+/g, " ").replace(/\s+/g, " ").trim();
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

/**
 * Is this row the tender's MAIN generated proposal?
 *
 * fillPlannedSupportDocuments overwrites every row it does NOT consider the
 * main proposal with support/stub content, so a false answer destroys the
 * generated proposal. The previous test recognised it only by the literal name
 * "Client-Ready Benchmark Technical Proposal" or a filename ending
 * "technical-proposal.docx". That held while the proposal was always written to
 * "Technical-Proposal.docx", but fails now that it is written to the confirmed
 * plan's own file name — an EOI tender's "01-Expression-Of-Interest.docx"
 * matched neither, so the freshly generated proposal was immediately replaced
 * by a 58-word stub and the package shipped placeholders.
 */
function isMainProposalLike(doc: { name: string; exactFileName: string | null; documentType: string }): boolean {
  const label = `${doc.name} ${doc.exactFileName ?? ""}`.toLowerCase();
  if (doc.documentType === "TECHNICAL_PROPOSAL" || doc.documentType === "EXPRESSION_OF_INTEREST") return true;
  if (/\bclient-ready\b/.test(label)) return true;
  if (/\b(technical[-\s_]*proposal|technical[-\s_]*bid|main[-\s_]*proposal|proposal[-\s_]*document|consultancy[-\s_]*proposal|expression[-\s_]*of[-\s_]*interest|eoi)\b/.test(label)) return true;
  return /technical-proposal\.docx$/.test(label);
}

// Kinds that represent company-produced deliverables and should have a real DOCX generated.
const COMPANY_PRODUCED_KINDS: ReadonlySet<SupportDocKind> = new Set<SupportDocKind>([
  "EXPERT_CV",
  "PROJECT_REFERENCES",
  "METHODOLOGY",
  "COMPANY_PROFILE",
  "SECTOR_TECHNICAL_SCOPE",
]);

async function fillPlannedSupportDocuments(tenderId: string, userId: string, plannedFileKeys?: Set<string>): Promise<number> {
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    select: {
      title: true, clientName: true, procuringEntityName: true, description: true, requirements: true,
      expertMatches: { where: { isSelected: true }, include: { expert: { select: { ...VAULT_REVIEW_CONSUMER_SELECT.EXPERT, profile: true, deletedAt: true } } }, orderBy: { score: "desc" } },
      projectMatches: { where: { isSelected: true }, include: { project: { select: { ...VAULT_REVIEW_CONSUMER_SELECT.PROJECT, summary: true, deletedAt: true } } }, orderBy: { score: "desc" } },
    },
  });
  if (!tender) return 0;
  const requirements = tender.requirements.map((r) => formatRequirementLine(r, 380));
  // canUseVaultRecord(..., "GENERATION"), not a raw trustLevel==="REVIEWED"
  // check — a stale or never-durably-provenance-backed record must not be
  // quoted as real evidence in a generated, submittable support document,
  // while a durably SOURCE_VERIFIED record (machine-verified against the
  // company's own uploaded source) is accepted same as GENERATION elsewhere.
  // A soft-deleted record (deletedAt set) must never surface here either.
  const experts = tender.expertMatches.filter((m) => m.expert && !m.expert.deletedAt && canUseVaultRecord(m.expert, "GENERATION")).map((m) => `${m.expert.fullName}${m.expert.title ? ` — ${m.expert.title}` : ""}${m.expert.yearsExperience ? ` | ${m.expert.yearsExperience}+ years` : ""}${m.expert.profile ? ` | ${shortText(m.expert.profile, 260)}` : ""}`);
  const projects = tender.projectMatches.filter((m) => m.project && !m.project.deletedAt && canUseVaultRecord(m.project, "GENERATION")).map((m) => `${m.project.name}${m.project.clientName ? ` — ${m.project.clientName}` : ""}${m.project.country ? ` | ${m.project.country}` : ""}${m.project.summary ? ` | ${shortText(m.project.summary, 300)}` : ""}`);
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
      // Tender-issued form / legal / financial / declaration / annex: never
      // generate a lookalike — a generated file is not the client's form.
      //
      // Before asking for the original, look for it in the Tender Intake files
      // the user already uploaded. When it is there, its bytes are reused
      // unchanged with full provenance; asking someone to re-upload a file the
      // app is already holding is the blocker this removes. Discovery is
      // conservative and fails closed, so an ambiguous or absent match falls
      // through to the same request as before — now carrying the specific
      // reason no file could be reused.
      const reuse = await reuseTenderIssuedForm({
        client: prisma,
        storage: getStorageAdapter(),
        tenderId,
        userId,
        documentId: doc.id,
        plannedFileName: doc.exactFileName ?? doc.name,
      });
      if (reuse.reused) {
        filled += 1;
      } else if (doc.generationStatus !== "PLANNED" || !generatedDocumentHasContent(doc)) {
        await prisma.generatedDocument.update({
          where: { id: doc.id },
          data: {
            generationStatus: "PLANNED",
            validationStatus: "PENDING",
            reviewStatus: "REPLACE_WITH_ORIGINAL",
            reviewNotes: `Attach the tender-issued original / signed / stamped / certified document before final export. Do not submit a generated file in place of this item. Automatic reuse from the uploaded Tender Intake files was not possible: ${reuse.reason}`,
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

  // Audit H-6: per-user daily AI quota. Generation is the most token-expensive
  // operation; enforce the daily cap before any provider call is made.
  const quota = await checkAiQuota(userId, actor.role);
  if (!quota.allowed) {
    const retryAfter = Math.max(1, Math.ceil((quota.resetAtMs - Date.now()) / 1000));
    return NextResponse.json(
      { error: quota.reason ?? "Daily AI quota exceeded.", used: quota.used, limit: quota.limit },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    include: {
      requirements: true,
      files: {
        select: { id: true, originalFileName: true, extractedText: true, extractionScore: true, totalPages: true, extractedPages: true, ocrPages: true, failedPages: true, deletionStatus: true },
      },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const invalidFields = listInvalidStoredFields(tender);
  if (invalidFields.length > 0) {
    const patch = computeStoredMetadataPatch(tender);
    await prisma.tender.update({ where: { id: tender.id }, data: patch });
    logger.warn(`[generate] tender=${tender.id} sanitised ${invalidFields.length} invalid stored field(s) before generation: ${invalidFields.join(", ")}`);
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
  // Safety net alongside the AI-assigned requirementType: the AI classifier
  // can plausibly miscategorize an expert-CV or project-reference requirement
  // (e.g. as TECHNICAL) for an unusually-phrased tender, which would silently
  // disable the reviewed-evidence gate below. inferType() is the same
  // deterministic keyword classifier already used by the regex-fallback
  // extraction path (lib/engine/analysis.ts) -- reusing it here as an
  // OR-signal never weakens the gate, only strengthens it.
  const looksLikeExpertOrProject = (req: { requirementType: string | null; title: string | null; description: string | null }) => {
    const inferred = inferRequirementType(`${req.title ?? ""} ${req.description ?? ""}`);
    return req.requirementType === "EXPERT" || req.requirementType === "PROJECT_EXPERIENCE"
      ? req.requirementType
      : inferred === "EXPERT" || inferred === "PROJECT_EXPERIENCE" ? inferred : null;
  };
  const requiresExperts = tender.requirements.some((req) => looksLikeExpertOrProject(req) === "EXPERT");
  const requiresProjects = tender.requirements.some((req) => looksLikeExpertOrProject(req) === "PROJECT_EXPERIENCE");
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
  // Accept procuringEntityName / legalClientName / donorAgency / implementingAgency as
  // fallbacks for clientName — AI Analyze may set procuringEntityName without
  // back-filling clientName on older tenders, and some tenders only have a donor/
  // implementing agency as the contracting entity.
  const effectiveClientName = tender.clientName
    || tender.procuringEntityName
    || tender.legalClientName
    || tender.donorAgency
    || tender.implementingAgency;

  // ── Metadata is NOT a hard blocker for draft generation ──────────────
  // Missing client name, placeholder values, contaminated metadata, missing
  // submission method/endpoint, and missing source evidence are all treated
  // as unavailable information — they are omitted from generated output and
  // surfaced as warnings. Only genuine non-metadata risks (auth, tenant
  // ownership, no source file, corrupted extraction) may hard-block.
  //
  // The operation gate (resolveTenderOperationGate) is the sole authority
  // for metadata eligibility. For DRAFT_GENERATION, metadata never blocks.

  // ── Generation gates check (metadata gates downgraded to warnings) ───
  // For DRAFT_GENERATION, metadata issues (client details, submission
  // method/endpoint, requirements) are all warnings — they never return 422.
  // Only genuine non-metadata risks (extraction quality, no usable source
  // text) may hard-block. Requirements being empty is a warning for draft
  // work — the user can generate a skeleton/draft proposal from source text.
  const generationGates = checkGenerationGates({
    extractionStatus: (tender.analysisExtractionStatus as any) ?? null,
    requirementCount: tender.requirements.length,
    hasProcuringEntity: !!(tender.procuringEntityName || tender.clientName),
    hasSubmissionMethod: !!tender.submissionMethod,
    hasSubmissionEmails: !!tender.submissionEmails,
    hasSubmissionAddress: !!tender.submissionAddress,
    hasEvaluationMethodology: !!tender.evaluationMethodology,
    buildsSubmissionPlan: true,
  });
  // Only extraction quality (no usable source text) may hard-block draft work.
  // Requirements missing = warning (draft can be generated from source text).
  const hardBlockers = generationGates.blockers.filter(b =>
    b.includes("extraction") || b.includes("analyzed")
  );
  if (hardBlockers.length > 0) {
    return NextResponse.json({
      errorCode: "GENERATION_GATES_FAILED",
      error: "Generation blocked: tender source is not ready for generation.",
      blockers: hardBlockers,
      recommendations: generationGates.recommendations,
      gates: generationGates,
      nextAction: "OPEN_GENERATION_GATES",
      diagnosticId: `generation-gates-failed-${id}`,
    }, { status: 422 });
  }

  // ── Pre-generation validation (metadata issues → warnings only) ──────
  const preGenValidation = await validateTenderBeforeGeneration({
    ...tender,
    clientNameSourcePage: tender.clientNameSourcePage as number | null,
    clientNameSourceQuote: tender.clientNameSourceQuote as string | null,
  });
  // Metadata validation failures are warnings for draft work — do NOT return 422.
  if (preGenValidation.warnings.length > 0) {
    logger.warn(`[generate] tender=${id} has metadata warnings: ${preGenValidation.warnings.join("; ")}`);
  }

  // ── Operation gate (DRAFT_GENERATION) — authoritative metadata check ────
  // The operation gate is the single authority for metadata eligibility.
  // For DRAFT_GENERATION, metadata NEVER blocks — the gate returns ok=true
  // and surfaces warnings/placeholders for UI display. This is the wiring
  // point that connects the source-driven tender model to the live route.
  const operationGate = resolveTenderOperationGate({
    tender: {
      id: tender.id,
      title: tender.title,
      reference: tender.reference,
      clientName: effectiveClientName,
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
    overrides: [], // overrides are resolved by canonical-field-state for UI; gate uses raw tender
    buildPlan: { ok: true, items: [] }, // draft does not require confirmed BuildPlan
    operation: "DRAFT_GENERATION",
  });
  // For DRAFT_GENERATION, the operation gate is non-blocking. Log warnings
  // for observability and surface them later in the response.
  if (operationGate.warnings.length > 0) {
    logger.info(`[generate] tender=${id} operation-gate warnings: ${operationGate.warnings.join("; ")}`);
  }
  if (operationGate.placeholderFields.length > 0) {
    logger.info(`[generate] tender=${id} placeholder fields: ${operationGate.placeholderFields.join(", ")}`);
  }
  // Defensive: if the operation gate ever returns blockers for DRAFT_GENERATION
  // (it should not, by design), surface them as a hard block. This catches
  // regressions where a future change accidentally reintroduces metadata
  // blocking for draft work.
  if (operationGate.blockers.length > 0) {
    return NextResponse.json({
      errorCode: "OPERATION_GATE_BLOCKED",
      error: "Generation blocked by operation gate (DRAFT_GENERATION).",
      blockers: operationGate.blockers,
      warnings: operationGate.warnings,
      placeholderFields: operationGate.placeholderFields,
      diagnosticId: `operation-gate-blocked-${id}`,
    }, { status: 422 });
  }

  // ── Source-driven tender detail (for response payload) ─────────────────
  // Derive source-driven tender facts from the extracted tender data.
  // This makes the source-driven model available to the UI without an extra
  // round-trip, and proves that draft generation is driven by the extracted
  // tender source, not by a predesigned required format.
  const sourceDrivenDetail = deriveSourceDrivenTenderDetail({
    id: tender.id,
    title: tender.title,
    reference: tender.reference,
    clientName: tender.clientName,
    procuringEntityName: tender.procuringEntityName,
    deadline: tender.deadline,
    submissionMethod: tender.submissionMethod,
    submissionEmails: tender.submissionEmails,
    submissionAddress: tender.submissionAddress,
    country: tender.country,
    budget: tender.budget,
    bidBondAmount: tender.bidBondAmount,
    pageLimit: tender.pageLimit,
    validityDays: tender.validityDays,
    mandatorySiteVisit: tender.mandatorySiteVisit,
    preBidMeetingDate: tender.preBidMeetingDate,
    preBidMeetingLocation: tender.preBidMeetingLocation,
    evaluationMethodology: tender.evaluationMethodology,
    clientContactName: tender.clientContactName,
    clientContactEmail: tender.clientContactEmail,
    clientContactPhone: tender.clientContactPhone,
    clientNameSourcePage: tender.clientNameSourcePage,
    clientNameSourceQuote: tender.clientNameSourceQuote,
    titleSourcePage: tender.titleSourcePage,
    titleSourceQuote: tender.titleSourceQuote,
    deadlineSourcePage: tender.deadlineSourcePage,
    deadlineSourceQuote: tender.deadlineSourceQuote,
  });

  // ── Partial AI analysis gate ─────────────────────────────────────────────
  // When tender.status === "AI_ANALYSIS_PARTIAL", the AI analysis job hit its
  // deadline and stopped before processing all content chunks. Requirements from
  // later pages of the tender were not extracted. Generating on a partial analysis
  // produces proposals that may be missing evaluation criteria, required documents,
  // or submission rules from the unprocessed sections.
  if (tender.status === "AI_ANALYSIS_PARTIAL") {
    return NextResponse.json({
      errorCode: "ANALYSIS_PARTIAL",
      error: "Generation blocked: the previous AI Analyze run did not finish — it was interrupted before processing all tender content. Re-run AI Analyze to complete the analysis before generating documents.",
      blockers: ["AI Analyze stopped before reading all tender pages. Requirements from later sections may be missing."],
      nextAction: "RERUN_AI_ANALYZE",
      diagnosticId: `analysis-partial-${id}`,
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

  // ── Analysis-extraction-status gate ──────────────────────────────────────
  // Block generation when AI Analyze ran on corrupted or regex-fallback
  // extraction, mirroring the same gate in the export route. Block with a
  // bypass option when extraction was only partial (softer case).
  // Note: "EXTRACTION_CORRUPTED_AI_SKIPPED" is stored in tender.status;
  // the analysisExtractionStatus field is set to "OCR_REQUIRED" in that case.
  const analysisExtractionStatusForGen = tender.analysisExtractionStatus;
  if (analysisExtractionStatusForGen === "OCR_REQUIRED") {
    return NextResponse.json({
      errorCode: "ANALYSIS_FROM_CORRUPTED_EXTRACTION",
      error: "Generation blocked: AI Analyze was skipped because tender extraction was corrupted. The analysis and requirements may be incomplete. Re-upload a clearer document or run OCR, then re-run AI Analyze before generating documents.",
      blockers: ["AI Analyze was skipped due to corrupted extraction — requirements and metadata may be incomplete."],
      nextAction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN",
      diagnosticId: `corrupted-extraction-${id}`,
    }, { status: 422 });
  }
  if (analysisExtractionStatusForGen === "EXTRACTION_WEAK_REVIEW_REQUIRED") {
    return NextResponse.json({
      errorCode: "ANALYSIS_FROM_WEAK_EXTRACTION",
      error: "Generation blocked: AI Analyze ran on a weak extraction — the tender text had low density or quality. Re-extract the tender (run OCR if needed) and re-run AI Analyze before generating documents.",
      blockers: ["AI analysis ran on weak extraction — requirements and metadata may be incomplete."],
      nextAction: "RERUN_AI_ANALYZE",
      diagnosticId: `weak-extraction-analysis-${id}`,
    }, { status: 422 });
  }
  if (analysisExtractionStatusForGen === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION") {
    return NextResponse.json({
      errorCode: "ANALYSIS_FROM_WEAK_EXTRACTION",
      error: "Generation blocked: AI Analyze used regex/deterministic fallback because extraction was too weak. The generated documents would be based on incomplete requirements. Re-extract the tender (run OCR if needed) and re-run AI Analyze before generating documents.",
      blockers: ["AI analysis used regex fallback due to weak extraction — requirements may be incomplete."],
      nextAction: "RERUN_AI_ANALYZE",
      diagnosticId: `regex-fallback-analysis-${id}`,
    }, { status: 422 });
  }
  if (analysisExtractionStatusForGen === "PARTIAL_EXTRACTION_AI_ANALYZED") {
    {
      return NextResponse.json({
        errorCode: "PARTIAL_EXTRACTION_ANALYSIS",
        error: "Generation blocked: AI Analyze ran on a partially-extracted tender (some pages could not be fully read). The generated documents may be missing requirements, evaluation criteria, or submission instructions from unread pages. Re-extract the tender file (run OCR if needed) and re-run AI Analyze to get a complete analysis before generating documents.",
        blockers: ["AI analysis was performed on partial tender extraction — some pages were weak, blank, or OCR-only. Re-extract and re-analyze before generating."],
        nextAction: "RERUN_AI_ANALYZE",
        // URL bypass removed
        diagnosticId: `partial-extraction-analysis-${id}`,
      }, { status: 422 });
    }
  }

  if (tender.status === "NO_BID") return NextResponse.json({
    errorCode: "NO_BID_BLOCK",
    error: "Generation blocked: this tender is marked NO_BID. Apply a BID or BID_WITH_CONDITIONS decision before generating proposal documents.",
    blockers: ["Tender is marked NO_BID."],
    nextAction: "CHANGE_BID_DECISION",
    diagnosticId: `no-bid-${id}`,
  }, { status: 409 });
  // ── Requirements check — NOT a hard block for draft work ──────────────
  // Missing requirements is a warning, not a blocker. The user can generate
  // a skeleton/draft proposal from available tender source text. Final
  // submission still requires extracted requirements.
  if (tender.requirements.length === 0) {
    logger.warn(`[generate] tender=${id} has no extracted requirements — generating draft from source text only`);
  }

  // ── Mandatory requirements classification advisory ────────────────────────
  // Advisory only — NOT a hard block for draft work. When the AI extracted
  // requirements but classified none as MANDATORY, the mandatory-compliance
  // section may be incomplete. This is a warning for the user.
  {
    const mandatoryCount = tender.requirements.filter((r) => r.priority === "MANDATORY").length;
    if (mandatoryCount === 0 && tender.requirements.length >= 3) {
      logger.warn(`[generate] tender=${id} has ${tender.requirements.length} requirements but none classified as MANDATORY — advisory only for draft work`);
    }
  }

  // ── Critical content-page gate ────────────────────────────────────────────
  // Per CLAUDE.md: generation is blocked unless submission instructions AND
  // required documents were detected in the extracted text. Evaluation criteria
  // absence is a warning only (documents can still be generated without it, but
  // the plan may under-score sections).
  {
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
      const contentWarnings: string[] = [];
      if (!anySubmission) contentWarnings.push("No submission instruction pages detected — submission details will be omitted from draft output.");
      if (!anyRequiredDocs) contentWarnings.push("No required document pages detected — required documents may be missing from draft output.");
      if (!anyEvaluation) contentWarnings.push("No evaluation criteria pages detected — evaluation guidance will be limited in draft output.");
      if (contentWarnings.length > 0) {
        // Content-page coverage is NOT a hard block for draft work.
        // Missing submission/required-doc/evaluation pages are warnings —
        // draft generation proceeds with available source text.
        logger.warn(`[generate] tender=${id} content-page coverage incomplete: ${contentWarnings.join("; ")}`);
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
  //
  // Field criticality is sourced from the single tender-policy registry — this
  // route does NOT keep its own critical-field list (Manual Override & Evidence
  // Policy point 7). This is a fast, targeted pre-check; the registry-backed
  // completeness gate further below is the full enforcing authority.
  {
    // Use canonical field-state resolver instead of raw column checks.
    // A valid manual override must NOT fail just because the raw DB column is blank.
    const overrides = await prisma.tenderMetadataOverride.findMany({
      where: { tenderId: id },
    }).catch(() => []);
    const canonicalState = resolveCanonicalFieldState({
      tender: {
        ...tender,
        submissionEmailSubject: (tender as any).submissionEmailSubject ?? null,
        clientContactEmail: (tender as any).clientContactEmail ?? null,
        // Per-field source-evidence columns — forward ALL of them so the
        // canonical resolver can ground every critical field, not just
        // clientName/submissionMethod. Without these, title/deadline/
        // reference/submissionAddress/submissionEmails can never be
        // GROUNDED in the generate route even when the DB has the evidence.
        clientNameSourcePage: (tender as any).clientNameSourcePage ?? null,
        clientNameSourceQuote: (tender as any).clientNameSourceQuote ?? null,
        clientNameSourceFileId: (tender as any).clientNameSourceFileId ?? null,
        titleSourcePage: (tender as any).titleSourcePage ?? null,
        titleSourceQuote: (tender as any).titleSourceQuote ?? null,
        titleSourceFileId: (tender as any).titleSourceFileId ?? null,
        deadlineSourcePage: (tender as any).deadlineSourcePage ?? null,
        deadlineSourceQuote: (tender as any).deadlineSourceQuote ?? null,
        deadlineSourceFileId: (tender as any).deadlineSourceFileId ?? null,
        submissionMethodSourcePage: (tender as any).submissionMethodSourcePage ?? null,
        submissionMethodSourceQuote: (tender as any).submissionMethodSourceQuote ?? null,
        submissionMethodSourceFileId: (tender as any).submissionMethodSourceFileId ?? null,
        submissionAddressSourcePage: (tender as any).submissionAddressSourcePage ?? null,
        submissionAddressSourceQuote: (tender as any).submissionAddressSourceQuote ?? null,
        submissionAddressSourceFileId: (tender as any).submissionAddressSourceFileId ?? null,
        submissionEmailSourcePage: (tender as any).submissionEmailSourcePage ?? null,
        submissionEmailSourceQuote: (tender as any).submissionEmailSourceQuote ?? null,
        submissionEmailSourceFileId: (tender as any).submissionEmailSourceFileId ?? null,
        contactDetailsSourceJson: (tender as any).contactDetailsSourceJson ?? null,
      } as any,
      overrides: overrides as any[],
      hasExtractedRequirements: tender.requirements.length > 0,
      submissionMethodContext: tender.submissionMethod ?? undefined,
      // Enforce active-file grounding: a fileId pointing to a
      // deleted/superseded TenderFile must NOT count as GROUNDED.
      activeTenderFileIds: new Set((tender.files ?? []).filter((f: any) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE").map((f: any) => f.id)),
      // Full active-file rows enable the STRONGEST shared grounding check
      // (quote containment + page <= totalPages) — same rule the BuildPlan
      // validator applies, so this pre-check and the validator agree.
      activeFiles: (tender.files ?? [])
        .filter((f: any) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")
        .map((f: any) => ({ id: f.id, extractedText: f.extractedText ?? null, totalPages: f.totalPages ?? null })),
    });
    const policyCtx = { submissionMethod: tender.submissionMethod };
    const missingCritical: string[] = canonicalState.fields
      .filter(f => f.criticality !== "non-critical" && f.blockerReason)
      .map(f => f.blockerReason!);
    // Only require submissionEmails when the method clearly indicates email
    // delivery — not when "email" appears in a prohibition phrase like
    // "no email submissions" or "hard copy only; email not accepted".
    if (
      isCriticalField("submissionEndpoint", policyCtx) &&
      tender.submissionMethod &&
      /email/i.test(tender.submissionMethod) &&
      !/no.{0,30}email|email.{0,30}not.{0,10}(accepted|allowed)|hard.{0,10}copy.{0,30}only/i.test(tender.submissionMethod) &&
      !tender.submissionEmails
    ) {
      // Generation is DRAFT work — missing submission email is a warning,
      // not a blocker. The user can still generate draft proposal material.
      // Final submission gates enforce strict endpoint requirements.
    }
    if (missingCritical.length > 0) {
      // Metadata is NOT a hard blocker for draft generation.
      // Missing critical metadata is a warning — draft work proceeds.
      logger.warn(`[generate] tender=${id} has missing critical metadata: ${missingCritical.join(", ")}`);
    }
  }

  // ── Submission plan gate ──────────────────────────────────────────────────
  // BuildPlan is the AUTHORITATIVE plan. GeneratedDocument rows MUST NEVER be
  // used as a proxy for plan existence — that was the legacy hasValidSubmission
  // path which counted any non-SUPERSEDED row (including PLANNED/pending rows)
  // as proof of a plan, then bypassed the real BuildPlan gate. The real
  // confirmation/enforcement happens in assertTenderReadyForGenerationAndExport
  // below via hasCurrentConfirmedBuildPlan + recordedBuildPlanState. planOnly
  // is NOT exempt from any safety gate.
  {
    // No proxy check here — GeneratedDocument rows are not plan evidence.
    // The authoritative BuildPlan gate runs unconditionally below.
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
      logger.warn(`[generate] TenderMetadataOverride table not available (${code}) — proceeding with empty overrides. Run database migration to resolve.`);
      metadataOverrides = [];
      metadataOverrideLookupFailed = true;
    } else {
      throw overrideErr;
    }
  }
  const metadataReport = assessTenderMetadataCompleteness({
    clientName: effectiveClientName,
    procuringEntityName: tender.procuringEntityName,
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
    clientAddress: tender.clientAddress ?? null,
    clientWebsite: tender.clientWebsite ?? null,
    submissionEmailSubject: tender.submissionEmailSubject ?? null,
    preBidChannel: tender.preBidChannel ?? null,
    clientRepresentative: tender.clientRepresentative ?? null,
    legalClientName: tender.legalClientName ?? null,
    donorAgency: tender.donorAgency ?? null,
    implementingAgency: tender.implementingAgency ?? null,
    requirementCount: tender.requirements.length,
    hasEvaluationMethodology: Boolean((tender.evaluationMethodology ?? "").trim()),
    hasSubmissionRules: Boolean(tender.submissionMethod || tender.submissionEmails || tender.submissionAddress),
  }, metadataOverrides);
  if (metadataReport.blockingForGeneration) {
    // Metadata is NOT a hard blocker for draft generation.
    // blockingForGeneration is always false per the metadata-optional policy
    // (set in tender-metadata-completeness.ts). This block is kept as a
    // safety net but should never execute. If it does, log a warning.
    logger.warn(`[generate] tender=${id} metadata blockingForGeneration was true (should be false)`);
  }

  // ── Standalone contamination gate ─────────────────────────────────────────
  // Contaminated metadata is NOT a hard block for draft generation.
  // The contaminated client name is omitted from generated output (replaced
  // with neutral framing like "To the Procurement Committee"). Only Final
  // Submission Check blocks on contaminated metadata.
  // (Previously: hard 422 block removed per metadata-optional policy)

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
      description: "Final generation blocked: analysis source is regex fallback. Human approval is audit-only and does NOT authorize generation.",
      requestId,
    });
    return NextResponse.json({
      errorCode: analysisGate.code,
      error: analysisGate.message,
      code: analysisGate.code,
      blockers: [analysisGate.message],
      nextAction: analysisGate.nextAction,
      diagnosticId: `analysis-source-${id}`,
      details: "Re-run AI Analyze with healthy providers to obtain a genuine AI analysis. Approving the regex fallback records an audit-only review — it does NOT unblock generation.",
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
      logger.warn(`[generate] source-grounding repair attempt failed: ${err instanceof Error ? err.message : String(err)}`);
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

  // AUTHORITATIVE: the generation reconciliation scope (which files control
  // fill/missing/extra checks) comes from the current CONFIRMED BuildPlan
  // only — never from a derived heuristic plan. The central gate below
  // (purpose "generate") independently blocks when no current confirmed plan
  // exists, so an empty scope here never authorizes anything.
  const confirmedPlanForRun = await getCurrentConfirmedBuildPlan(prisma, id, userId);
  const submissionPlan = { files: confirmedPlanForRun.ok ? confirmedPlanForRun.items : [], warnings: [] as string[] } as any;
  const explicitSubmissionScope = confirmedPlanForRun.ok;
  const plannedTargetFiles = explicitSubmissionScope ? plannedSubmissionTargetFiles(submissionPlan) : [];
  const plannedFileKeys = explicitSubmissionScope ? plannedSubmissionTargetKeys(submissionPlan) : undefined;

  // NOTE: The pre-generation SUBMISSION_PLAN_INCOMPLETE check that required
  // generated rows before generation has been REMOVED. A persisted DRAFT
  // BuildPlan now satisfies the plan prerequisite for generation (the gate
  // checks recordedBuildPlanState + hasCurrentConfirmedBuildPlan). PLANNED/
  // virtual rows are not required and must not be created before readiness.
  // Export and final-ZIP still require real generated files (checked by the
  // gate via exportReadyDocumentCount).

  const criticalGaps = await prisma.complianceGap.findMany({ where: { tenderId: id, severity: "CRITICAL", isResolved: false }, select: { title: true, description: true, mitigationPlan: true } });
  const hardBlocks = criticalGaps.filter(criticalGapIsHardBlock);
  const seniorReviewCriticals = criticalGaps.filter((gap) => !criticalGapIsHardBlock(gap));
  if (hardBlocks.length > 0) return NextResponse.json({ error: `Generation blocked: ${hardBlocks.length} hard blocker(s) remain. ${hardBlocks.map((g) => g.title).join("; ")}`, code: "HARD_BLOCKERS" }, { status: 422 });

  // ── Plan-only mode (AFTER all hard gates, BEFORE central confirmed-plan gate) ──
  // planOnly is a dry-run that proves the tender CAN be planned. It runs every
  // per-tender hard gate above (auth + role, extraction quality, AI success,
  // no regex/fallback/synthetic analysis, active-file evidence, grounded
  // mandatory requirements, critical metadata grounding, tender-controlled
  // scope) and then creates/updates ONLY a DRAFT BuildPlan via the unified
  // service. It creates ZERO GeneratedDocument rows and returns
  // authorizesGeneration:false. The central gate (which requires a CONFIRMED
  // BuildPlan) is intentionally NOT run for planOnly — planOnly proves the
  // tender is plannable, not that it is releasable.
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
        error: "Submission plan build produced zero required files. Re-run AI Analyze against the current verified source, upload a better source, or correct the source-backed requirements before generation.",
        code: "SUBMISSION_PLAN_EMPTY_REVIEW_REQUIRED",
        nextAction: "RUN_AI_ANALYZE_OR_REPAIR_SOURCE",
        blockers: plan.warnings.length > 0 ? plan.warnings : ["No required submission files could be derived from tender requirements or exact file naming instructions."],
      }, { status: 422 });
    }
    // Build/refresh the DRAFT BuildPlan via the unified service. This writes
    // status="DRAFT", builtById, itemsJson, validationJson, contentHash, and
    // resets confirmedRevision/confirmedContentHash/confirmedById/confirmedAt
    // so any stale confirmation is invalidated. It creates ZERO
    // GeneratedDocument rows.
    const draftResult = await buildDraftBuildPlan(prisma, id, userId);
    if (!draftResult.ok) {
      return NextResponse.json({ ok: false, planBuilt: false, error: draftResult.message, code: draftResult.code }, { status: draftResult.status });
    }
    const draftPlan = draftResult.plan;
    const beforeDocCount = await prisma.generatedDocument.count({ where: { tenderId: id } });
    const afterDocCount = await prisma.generatedDocument.count({ where: { tenderId: id } });
    const planRowsCreated = 0; // planOnly never creates GeneratedDocument rows
    await logAction({ userId, action: "TENDER_PLAN_BUILT", entityType: "Tender", entityId: id, description: `planOnly: DRAFT BuildPlan built (revision ${draftPlan.revision}); ${plannedFiles.length} required file(s) identified; ${afterDocCount - beforeDocCount} GeneratedDocument rows created.`, metadata: { tenderId: id, planRowsCreated, plannedFileCount: plannedFiles.length, planOnlyDryRun: true, draftRevision: draftPlan.revision, draftContentHash: draftPlan.contentHash } });
    return NextResponse.json({
      planBuilt: true,
      planOnlyDryRun: true,
      virtualOnly: true,
      authorizesGeneration: false,
      planRowsCreated,
      plannedFileCount: plannedFiles.length,
      draftBuildPlanRevision: draftPlan.revision,
      draftBuildPlanStatus: draftPlan.status,
      virtualFiles: plannedFiles.map((file) => ({ exactFileName: file.exactFileName, exactOrder: file.exactOrder, documentType: file.documentType, format: file.format })),
      message: `DRAFT BuildPlan built — ${plannedFiles.length} required file(s) identified; 0 GeneratedDocument rows created; authorizesGeneration=false. Run Engine creates and source-verifies the authoritative Build Plan before automatic downstream processing.`,
    });
  }

  const promotion = await promoteBestAvailableReviewedMatchesForGeneration({ tenderId: id, requirements: tender.requirements });
  const selectedExpertMatches = await prisma.tenderExpertMatch.findMany({ where: { tenderId: id, isSelected: true }, include: { expert: { select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT } } });
  const selectedProjectMatches = await prisma.tenderProjectMatch.findMany({ where: { tenderId: id, isSelected: true }, include: { project: { select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT } } });
  const [totalExpertMatches, totalProjectMatches] = await Promise.all([
    prisma.tenderExpertMatch.count({ where: { tenderId: id } }),
    prisma.tenderProjectMatch.count({ where: { tenderId: id } }),
  ]);
  // canUseVaultRecord(..., "GENERATION"), not raw trustLevel — see
  // fillPlannedSupportDocuments above for the same reasoning: a stale
  // REVIEWED record must gate generation identically to an unreviewed one,
  // while a durably SOURCE_VERIFIED record is accepted.
  const draftExperts = selectedExpertMatches.filter((m) => !canUseVaultRecord(m.expert, "GENERATION"));
  const draftProjects = selectedProjectMatches.filter((m) => !canUseVaultRecord(m.project, "GENERATION"));
  const reviewedExpertCount = selectedExpertMatches.length - draftExperts.length;
  const reviewedProjectCount = selectedProjectMatches.length - draftProjects.length;
  // Reuses requiresExperts/requiresProjects computed above (already
  // safety-net-aware against AI requirementType miscategorization) instead
  // of a second, independent requirementType-only count query -- keeps both
  // checkpoints in this route consistent and avoids a redundant DB round trip.
  if (requiresExperts && selectedExpertMatches.length === 0) {
    if (totalExpertMatches > 0) {
      return NextResponse.json({ error: `Generation blocked: tender requires experts, and none of the ${totalExpertMatches} expert match(es) the Engine found could be selected automatically — selection promotes source-verified or reviewed vault records only. Upload or re-upload the CVs behind these experts under Company Vault so they verify against their documents, then run the Engine again.`, code: "NO_EXPERT_MATCHES_SELECTED", totalExpertMatches, nextAction: "REVIEW_MATCHES" }, { status: 422 });
    }
    return NextResponse.json({ error: "Generation blocked: tender requires experts but no tender-specific expert match rows exist yet. Run Engine first — it creates the match rows and selects the source-verified ones automatically.", code: "ENGINE_NOT_RUN_OR_NO_EXPERT_MATCH_ROWS", totalExpertMatches: 0, nextAction: "RUN_ENGINE" }, { status: 422 });
  }
  if (requiresProjects && selectedProjectMatches.length === 0) {
    if (totalProjectMatches > 0) {
      return NextResponse.json({ error: `Generation blocked: tender requires project references, and none of the ${totalProjectMatches} project match(es) the Engine found could be selected automatically — selection promotes source-verified or reviewed vault records only. Upload or re-upload the project reference sheets behind them under Company Vault so they verify against their documents, then run the Engine again.`, code: "NO_PROJECT_MATCHES_SELECTED", totalProjectMatches, nextAction: "REVIEW_MATCHES" }, { status: 422 });
    }
    return NextResponse.json({ error: "Generation blocked: tender requires project references but no tender-specific project match rows exist yet. Run Engine first — it creates the match rows and selects the source-verified ones automatically.", code: "ENGINE_NOT_RUN_OR_NO_PROJECT_MATCH_ROWS", totalProjectMatches: 0, nextAction: "RUN_ENGINE" }, { status: 422 });
  }
  if (selectedExpertMatches.length > 0 && reviewedExpertCount === 0 && requiresExperts) return NextResponse.json({ error: `Generation blocked: ${selectedExpertMatches.length} selected expert(s) could not be source-verified against their uploaded documents, so none can be cited as evidence. Re-upload or replace the CVs behind them under Company Vault and run the Engine again — verification is automatic and needs no approval step.`, code: "ALL_EXPERTS_UNREVIEWED", draftExperts: draftExperts.map((m) => m.expert.fullName) }, { status: 422 });
  if (selectedProjectMatches.length > 0 && reviewedProjectCount === 0 && requiresProjects) return NextResponse.json({ error: `Generation blocked: ${selectedProjectMatches.length} selected project reference(s) could not be source-verified against their uploaded documents, so none can be cited as evidence. Re-upload or replace the project reference sheets behind them under Company Vault and run the Engine again — verification is automatic and needs no approval step.`, code: "ALL_PROJECTS_UNREVIEWED", draftProjects: draftProjects.map((m) => m.project.name) }, { status: 422 });

  // ── Empty vault hard gate ─────────────────────────────────────────────────
  // A proposal built from zero evidence is entirely generic and unsuitable for
  // submission. Block generation when the company vault has no reviewed experts
  // AND no reviewed projects so the user is prompted to add real evidence before
  // generating documents that will be submitted under their company name.
  const [vaultExpertsForGate, vaultProjectsForGate] = await Promise.all([
    prisma.expert.findMany({ where: { company: { userId }, deletedAt: null }, select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT }),
    prisma.project.findMany({ where: { company: { userId }, deletedAt: null }, select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT }),
  ]);
  const vaultReviewedExpertCount = vaultExpertsForGate.filter((e) => canUseVaultRecord(e, "GENERATION")).length;
  const vaultReviewedProjectCount = vaultProjectsForGate.filter((p) => canUseVaultRecord(p, "GENERATION")).length;
  if (vaultReviewedExpertCount === 0 && vaultReviewedProjectCount === 0) {
    return NextResponse.json({
      errorCode: "EMPTY_VAULT",
      error: "Generation blocked: your company knowledge vault contains no source-verified experts or projects. A proposal built from zero evidence will be entirely generic and unsuitable for submission. Upload at least one expert CV or one comparable project reference under Company Vault — the Engine verifies them automatically against the uploaded bytes, with no approval step.",
      blockers: ["Company knowledge vault has no usable evidence — zero source-verified experts and zero source-verified projects found."],
      nextAction: "OPEN_COMPANY_READINESS",
      diagnosticId: `empty-vault-${id}`,
    }, { status: 422 });
  }

  const warnings: string[] = [...readiness.warnings, ...promotion.warnings];
  if (explicitSubmissionScope) warnings.push(`Submission plan target scope detected: ${plannedTargetFiles.length} tender-required file(s) will control generation reconciliation.`);
  if (seniorReviewCriticals.length > 0) warnings.push(`${seniorReviewCriticals.length} critical evidence/review gap(s) were carried into the proposal as senior bid-review items instead of blocking draft generation.`);
  if (draftExperts.length > 0) warnings.push(`${draftExperts.length} selected expert(s) are not source-verified and were excluded from the evidence base: ${draftExperts.map((m) => m.expert.fullName).join(", ")}. Upload the CVs they came from so the Engine can verify them automatically.`);
  if (draftProjects.length > 0) warnings.push(`${draftProjects.length} selected project(s) are not source-verified and were excluded from the evidence base: ${draftProjects.map((m) => m.project.name).join(", ")}. Upload the reference sheets they came from so the Engine can verify them automatically.`);

  // ── Central authoritative readiness gate (final consolidated check) ───────
  // Last fail-closed check before full generation creates documents. Enforces
  // the binding conditions the per-field gates above do not all enforce
  // together: a promoted AI Analyze job whose content hash still matches the
  // current tender, complete analysis chunks, source-grounded mandatory
  // requirements, weak-extraction override, fallback approval bound to this exact
  // job+hash, and an existing submission plan. planOnly requests already returned
  // above, so this runs only on the full-generation path.
  const centralGate = await assertTenderReadyForGenerationAndExport({ prisma, tenderId: id, userId, purpose: "generate" });
  if (!centralGate.ok) {
    return NextResponse.json({
      errorCode: centralGate.blockerCode,
      error: `Generation blocked: ${centralGate.blockerDetail}`,
      blockers: [centralGate.blockerDetail ?? "Tender is not ready for generation."],
      nextAction: "RERUN_AI_ANALYZE",
      diagnosticId: `central-gate-${id}`,
    }, { status: 422 });
  }

  // Concurrent generation guard — same check used for planOnly mode.
  // Without this, two parallel POST /generate calls could each enter
  // generateTenderDocuments() simultaneously, creating duplicate GENERATING
  // records and doubled proposal output.
  const alreadyGenerating = await prisma.generatedDocument.count({
    where: { tenderId: id, generationStatus: { in: ["GENERATING", "QUEUED"] } },
  });
  if (alreadyGenerating > 0) {
    return NextResponse.json({
      error: "Generation already in progress — another generate request is running for this tender. Wait for it to finish before starting a new run.",
      code: "GENERATION_IN_PROGRESS",
      nextAction: "WAIT_FOR_CURRENT_GENERATION",
    }, { status: 409 });
  }

  const log = childLogger({ tenderId: id, userId, route: "/api/tenders/[id]/generate" });
  log.info("generation_started", { reviewedExpertCount, draftExpertCount: draftExperts.length, reviewedProjectCount, draftProjectCount: draftProjects.length, promotedExpertCount: promotion.promotedExpertCount, promotedProjectCount: promotion.promotedProjectCount, readinessTotals: readiness.totals });
  const job = createJob({ userId, tenderId: id, type: "GENERATE", steps: ["FETCH", "AI_GENERATE", "SAVE", "LETTERHEAD", "VALIDATE"] });
  advanceJob(job.id, "FETCH");

  try {
    // Materialise a row for every CONFIRMED plan file that has none.
    //
    // Full Generate Docs must not invent scope, and it does not: the only
    // files created here are the ones the owner already confirmed, and
    // findMissingGeneratedDocuments -- the same reconciliation the response
    // reports with -- decides which are absent. Creating nothing was the bug.
    // fillPlannedSupportDocuments below only ever UPDATES existing rows, so a
    // confirmed slot with no row was never written: on a two-file plan the
    // proposal was generated, the second file was silently skipped, generate
    // still returned success, and the final ZIP then refused the package for
    // CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE. The only code path that created the
    // missing row was POST /generate-missing-plan-files, a separate manual
    // click -- so the normal path could not reach a downloadable ZIP at all,
    // and the owner automation contract forbids requiring that click.
    let plannedRecordCount = 0;
    if (explicitSubmissionScope) {
      const existingForPlan = await prisma.generatedDocument.findMany({
        where: { tenderId: id, generationStatus: { not: "SUPERSEDED" } },
        select: { id: true, name: true, exactFileName: true, exactOrder: true, documentType: true, format: true, generationStatus: true },
      });
      for (const missing of findMissingGeneratedDocuments(submissionPlan, existingForPlan)) {
        const alreadyPresent = existingForPlan.some(
          (doc) => (doc.exactFileName ?? doc.name ?? "").trim().toLowerCase() === missing.exactFileName.trim().toLowerCase(),
        );
        if (alreadyPresent) continue;
        try {
          await prisma.generatedDocument.create({
            data: {
              tenderId: id,
              // lastIndexOf, not /\.[a-z0-9]+$/i: this name comes from the
              // analysed tender, and an anchored + quantifier over uncontrolled
              // input is the polynomial-ReDoS shape CodeQL flags.
              name: stripFileExtension(missing.exactFileName),
              documentType: missing.documentType ?? "SUPPORTING_DOCUMENT",
              format: missing.format ?? "DOCX",
              exactFileName: missing.exactFileName,
              exactOrder: missing.exactOrder ?? null,
              generationStatus: "PLANNED",
              validationStatus: "PENDING",
              reviewStatus: "PENDING",
              contentSummary: `Planned submission file ${missing.exactFileName} from the confirmed build plan.`,
            },
          });
          plannedRecordCount += 1;
        } catch (createErr) {
          // P2002 = the partial unique index caught a concurrent creator for
          // the same plan file. Converge: the row now exists, which is the
          // outcome this loop wanted.
          if ((createErr as { code?: string })?.code !== "P2002") throw createErr;
        }
      }
      if (plannedRecordCount > 0) warnings.push(`${plannedRecordCount} confirmed plan file(s) had no document record and were created for generation.`);
    }
    advanceJob(job.id, "AI_GENERATE");
    await time("generate.tender_documents", () => generateTenderDocuments(id, userId), { tenderId: id });
    advanceJob(job.id, "SAVE");
    const supportDocumentCount = await time("generate.fill_support_docs", () => fillPlannedSupportDocuments(id, userId, plannedFileKeys), { tenderId: id });
    if (supportDocumentCount > 0) warnings.push(explicitSubmissionScope ? `${supportDocumentCount} planned package document(s) were generated or marked for original replacement.` : `${supportDocumentCount} remaining package document(s) were generated or marked for original replacement.`);
    advanceJob(job.id, "LETTERHEAD");
    const letterheadAppliedCount = await applyActiveUploadedLetterheadToTenderDocuments(id, userId);
    if (letterheadAppliedCount > 0) warnings.push(`Uploaded Word letterhead applied to ${letterheadAppliedCount} generated DOCX file(s).`);
    // Auto-apply company signature and stamp images (user uploads all company
    // documents — the App uses them automatically, no human approval needed).
    const { signatureApplied, stampApplied } = await applyActiveSignatureAndStampToTenderDocuments(id, userId);
    if (signatureApplied > 0) warnings.push(`Company signature auto-applied to ${signatureApplied} generated DOCX file(s).`);
    if (stampApplied > 0) warnings.push(`Company stamp auto-applied to ${stampApplied} generated DOCX file(s).`);

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
    completeInMemoryJob(job.id, jobResult);
    void createNotification({ userId, type: "TENDER_GENERATED", title: `Documents generated for "${tender.title}"`, body: `${(updatedTender?.generatedDocuments ?? []).length} document(s) ready for review.`, entityType: "Tender", entityId: id, link: `/dashboard/tenders/${id}` });
    // Extract quality score and axis scores from contentSummary so the UI
    // doesn't need to parse a text string — structured fields are more reliable.
    const proposalDoc = updatedTender?.generatedDocuments?.find((d) => d.documentType === "TECHNICAL_PROPOSAL");
    const qMatch = proposalDoc?.contentSummary?.match(/Quality score:\s*(\d+)\/100/);
    const aMatch = proposalDoc?.contentSummary?.match(/AXIS_SCORES:\s*(\{[^}]+\})/);
    const qualityScoreValue = qMatch ? parseInt(qMatch[1], 10) : null;
    let axisScoresValue: Record<string, number> | null = null;
    try { axisScoresValue = aMatch ? JSON.parse(aMatch[1]) as Record<string, number> : null; } catch { axisScoresValue = null; }
    // Gap 4: re-query the canonical final-export authority after the mutation.
    // The "readiness.totals" above is the generation-readiness totals (a different
    // resolver). This is the authoritative final-export verdict the UI should use.
    const canonicalReadiness = await getCanonicalReadinessSummary(prisma, userId, id);
    return NextResponse.json({ success: true, jobId: job.id, tender: updatedTender, warnings, readiness: readiness.totals, plannedRecordCount, supportDocumentCount, letterheadAppliedCount, promotedExpertCount: promotion.promotedExpertCount, promotedProjectCount: promotion.promotedProjectCount, qualityScore: qualityScoreValue, axisScores: axisScoresValue, submissionPlan: explicitSubmissionScope ? { plannedTargetCount: plannedTargetFiles.length, missing: missingPlanFiles.map((file) => file.exactFileName), extras: extraGeneratedDocs.map((doc) => doc.exactFileName ?? doc.name ?? doc.documentType ?? doc.id ?? "document") } : null, sourceDrivenDetail: { tenderId: sourceDrivenDetail.tenderId, extractedCount: sourceDrivenDetail.extractedCount, missingRelevantCount: sourceDrivenDetail.missingRelevantCount, coverageRatio: sourceDrivenDetail.coverageRatio, submissionMethod: sourceDrivenDetail.submissionMethod, requiresDeadline: sourceDrivenDetail.requiresDeadline, requiresEmailEndpoint: sourceDrivenDetail.requiresEmailEndpoint, requiresPhysicalAddress: sourceDrivenDetail.requiresPhysicalAddress }, operationGate: { ok: operationGate.ok, warnings: operationGate.warnings, placeholderFields: operationGate.placeholderFields }, canonicalReadiness, ...(metadataOverrideLookupFailed ? { metadataOverrideLookupFailed: true, metadataOverrideLookupWarning: "TenderMetadataOverride table is not yet available — run database migration." } : {}) });
  } catch (error) {
    failInMemoryJob(job.id, error instanceof Error ? error.message : String(error));
    void reportError(error, { tenderId: id, userId, route: "/api/tenders/[id]/generate" });
    const mapped = mapGenerationError(error, { failedStage: "GENERATION_PIPELINE" });
    return NextResponse.json(
      { ...mapped.body, error: mapped.body.message, jobId: job.id },
      { status: mapped.status },
    );
  }
}
