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
import { assertAnalysisReadyForFinalGeneration } from "../../../../../lib/engine/analysis-source";
import { assessTenderMetadataCompleteness } from "../../../../../lib/engine/tender-metadata-completeness";

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
  const tender = await prisma.tender.findUnique({ where: { id: tenderId }, include: { requirements: true, expertMatches: { where: { isSelected: true }, include: { expert: true }, orderBy: { score: "desc" } }, projectMatches: { where: { isSelected: true }, include: { project: true }, orderBy: { score: "desc" } } } });
  if (!tender) return 0;
  const requirements = tender.requirements.map((r) => formatRequirementLine(r, 380));
  const experts = tender.expertMatches.filter((m) => m.expert && m.expert.trustLevel === "REVIEWED").map((m) => `${m.expert.fullName}${m.expert.title ? ` — ${m.expert.title}` : ""}${m.expert.yearsExperience ? ` | ${m.expert.yearsExperience}+ years` : ""}${m.expert.profile ? ` | ${shortText(m.expert.profile, 260)}` : ""}`);
  const projects = tender.projectMatches.filter((m) => m.project && m.project.trustLevel === "REVIEWED").map((m) => `${m.project.name}${m.project.clientName ? ` — ${m.project.clientName}` : ""}${m.project.country ? ` | ${m.project.country}` : ""}${m.project.summary ? ` | ${shortText(m.project.summary, 300)}` : ""}`);
  const docs = await prisma.generatedDocument.findMany({ where: { tenderId, generationStatus: { not: "SUPERSEDED" } }, select: { id: true, name: true, exactFileName: true, documentType: true, generationStatus: true, fileContent: true } });
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
  const incomplete = dedupedDocs.filter((doc) => !isMainProposalLike(doc) && !(doc.generationStatus === "GENERATED" && doc.fileContent) && (!plannedFileKeys || plannedFileKeys.has(generatedDocumentSubmissionKey(doc))));
  let filled = 0;
  for (const doc of incomplete) {
    const title = clean(doc.exactFileName || doc.name);
    const kind = classifySupportDoc(title);
    const cleanTitle = cleanTenderTitle(tender.title, { clientName: cleanClientName(tender.clientName, tender.description), description: tender.description });

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
      if (doc.generationStatus !== "PLANNED" || !doc.fileContent) {
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
  const tender = await prisma.tender.findFirst({ where: { id, userId }, include: { requirements: true } });
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
  if (!company) return NextResponse.json({ error: "Company profile required before generation.", code: "COMPANY_PROFILE_REQUIRED", nextAction: "OPEN_COMPANY_READINESS" }, { status: 422 });
  const requiresExperts = tender.requirements.some((req) => req.requirementType === "EXPERT");
  const requiresProjects = tender.requirements.some((req) => req.requirementType === "PROJECT_EXPERIENCE");
  const readiness = await getCompanyIngestionReadiness(company.id, { requireDocuments: true, requireReviewedExperts: requiresExperts, requireReviewedProjects: requiresProjects });
  if (!readiness.ingestionReady) return NextResponse.json({ error: "Generation blocked: company knowledge is not ready.", code: "INGESTION_NOT_READY", blockers: readiness.blockers, warnings: readiness.warnings, totals: readiness.totals, nextAction: "OPEN_COMPANY_READINESS" }, { status: 422 });
  if (!hasRealClientName(tender.clientName)) return NextResponse.json({ error: "Generation blocked: client name is not set. Edit the tender and fill the Client Name field before generating proposal documents.", code: "CLIENT_NAME_REQUIRED", nextAction: "EDIT_TENDER" }, { status: 422 });
  if (tender.status === "NO_BID") return NextResponse.json({ error: "Generation blocked: this tender is marked NO_BID. Apply a BID or BID_WITH_CONDITIONS decision before generating proposal documents.", code: "NO_BID_BLOCK" }, { status: 409 });
  if (tender.requirements.length === 0) {
    return NextResponse.json({
      error: "Generation blocked: no tender requirements were extracted yet. Run AI Analyze / Run Engine first, or add requirements manually before generating documents.",
      code: "NO_REQUIREMENTS",
      nextAction: "RUN_ENGINE",
    }, { status: 422 });
  }

  // ── Metadata completeness gate ────────────────────────────────────────────
  // Blocks generation when critical metadata is missing or placeholder-filled
  // (e.g. client name "Bid-Team to confirm", no submission endpoint, no deadline).
  // overallRatio < 0.3 is a hard block; missingCritical / invalidFields always block.
  const metadataReport = assessTenderMetadataCompleteness({
    clientName: tender.clientName,
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
    requirementCount: tender.requirements.length,
    hasEvaluationMethodology: Boolean((tender.evaluationMethodology ?? "").trim()),
    hasSubmissionRules: Boolean(tender.submissionMethod || tender.submissionEmails || tender.submissionAddress),
  });
  if (metadataReport.blockingForGeneration) {
    // Name the actual missing fields so the user knows exactly what's wrong,
    // and nudge them to the one-click repair button. The endpoint behind that
    // button never invents — it returns NOT_FOUND when no source quote matches.
    const missingNames = metadataReport.missingCritical.map((f) => f.field).slice(0, 5);
    const placeholderNames = metadataReport.invalidFields.map((f) => f.field).slice(0, 5);
    const parts: string[] = [];
    if (missingNames.length > 0) parts.push(`${missingNames.length} critical field(s) missing (${missingNames.join(", ")})`);
    if (placeholderNames.length > 0) parts.push(`${placeholderNames.length} field(s) contain placeholder language (${placeholderNames.join(", ")})`);
    return NextResponse.json({
      error: `Generation blocked: ${parts.join("; ")}. First try the "Repair all empty fields from source" button — the deterministic extractor pulls verifiable values from the uploaded tender files when present. If a field is genuinely absent from the tender source, edit the tender and confirm it manually.`,
      code: "METADATA_INCOMPLETE_FOR_GENERATION",
      missingCritical: metadataReport.missingCritical.map((f) => ({ field: f.field, reason: f.reason })),
      invalidFields: metadataReport.invalidFields.map((f) => ({ field: f.field, reason: f.reason })),
      overallRatio: metadataReport.overallRatio,
      nextAction: "REPAIR_OR_EDIT_TENDER",
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
      error: analysisGate.message,
      code: analysisGate.code,
      nextAction: analysisGate.nextAction,
      details: "Re-run AI Analyze with healthy providers, or POST /api/tenders/[id]/approve-analysis to explicitly approve the current regex-fallback analysis.",
    }, { status: 409 });
  }
  const untracedInitial = tender.requirements.filter((req) => req.priority === "MANDATORY" && ((req.sourceConfidence ?? 0) <= 0));
  if (untracedInitial.length > 0) {
    // Attempt one automatic repair pass using uploaded tender file text before hard-blocking.
    const repairResult = await repairSourceGrounding(id).catch((err) => {
      console.warn(`[generate] source-grounding repair attempt failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    // Reload requirements to see the updated confidence values after repair.
    const mandatoryAfterRepair = repairResult && repairResult.repairedCount > 0
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
    const plannedRecordCount = explicitSubmissionScope ? await time("generate.plan_records", () => ensurePlannedGeneratedDocumentRecords(id, plannedTargetFiles), { tenderId: id }) : 0;
    if (plannedRecordCount > 0) warnings.push(`${plannedRecordCount} missing tender-required file target(s) were added to the Generated outputs plan before generation.`);
    advanceJob(job.id, "AI_GENERATE");
    await time("generate.tender_documents", () => generateTenderDocuments(id, userId), { tenderId: id });
    advanceJob(job.id, "SAVE");
    const supportDocumentCount = await time("generate.fill_support_docs", () => fillPlannedSupportDocuments(id, plannedFileKeys), { tenderId: id });
    if (supportDocumentCount > 0) warnings.push(explicitSubmissionScope ? `${supportDocumentCount} planned package document(s) were generated or marked for original replacement.` : `${supportDocumentCount} remaining package document(s) were generated or marked for original replacement.`);
    advanceJob(job.id, "LETTERHEAD");
    const letterheadAppliedCount = await applyActiveUploadedLetterheadToTenderDocuments(id, userId);
    if (letterheadAppliedCount > 0) warnings.push(`Uploaded Word letterhead applied to ${letterheadAppliedCount} generated DOCX file(s).`);

    const generatedDocsForPlan = explicitSubmissionScope ? await prisma.generatedDocument.findMany({ where: { tenderId: id }, select: { id: true, name: true, exactFileName: true, exactOrder: true, documentType: true, format: true, generationStatus: true, fileContent: true } }) : [];
    const missingPlanFiles = explicitSubmissionScope ? findMissingGeneratedDocuments(submissionPlan, generatedDocsForPlan) : [];
    const extraGeneratedDocs = explicitSubmissionScope ? findExtraGeneratedDocuments(submissionPlan, generatedDocsForPlan) : [];
    if (missingPlanFiles.length > 0) warnings.push(`Submission plan still has ${missingPlanFiles.length} missing tender-required file(s): ${missingPlanFiles.map((file) => file.exactFileName).join(", ")}.`);
    if (extraGeneratedDocs.length > 0) warnings.push(`Generation produced ${extraGeneratedDocs.length} generated file(s) outside the explicit submission plan: ${extraGeneratedDocs.map((doc) => doc.exactFileName ?? doc.name ?? doc.documentType ?? doc.id ?? "document").join(", ")}. Final ZIP export will block until reconciled.`);

    advanceJob(job.id, "VALIDATE");
    if (reviewedExpertCount > 0 || draftExperts.length > 0 || reviewedProjectCount > 0 || draftProjects.length > 0) await prisma.generatedDocument.updateMany({ where: { tenderId: id }, data: { reviewedExpertCount, draftExpertCount: draftExperts.length, reviewedProjectCount, draftProjectCount: draftProjects.length, updatedAt: new Date() } });
    // Advance tender stage to GENERATION so the header stage pill reflects progress.
    await prisma.tender.update({ where: { id }, data: { stage: "GENERATION" } }).catch(() => {});
    await logAction({ userId, action: "TENDER_GENERATED", entityType: "Tender", entityId: id, description: `Generated benchmark-quality documents for tender "${tender.title}" — ${reviewedExpertCount} reviewed experts, ${draftExperts.length} draft experts, ${reviewedProjectCount} reviewed projects, ${draftProjects.length} draft projects, ${supportDocumentCount} supporting/replacement-control package documents, ${letterheadAppliedCount} uploaded letterhead overlays, ${seniorReviewCriticals.length} senior-review gaps`, metadata: { tenderId: id, reviewedExpertCount, draftExpertCount: draftExperts.length, reviewedProjectCount, draftProjectCount: draftProjects.length, promotedExpertCount: promotion.promotedExpertCount, promotedProjectCount: promotion.promotedProjectCount, plannedRecordCount, supportDocumentCount, letterheadAppliedCount, seniorReviewGapCount: seniorReviewCriticals.length, explicitSubmissionScope, plannedTargetCount: plannedTargetFiles.length, missingPlanFileCount: missingPlanFiles.length, extraGeneratedFileCount: extraGeneratedDocs.length, readiness: readiness.totals, warnings }, requestId });
    const updatedTender = await prisma.tender.findFirst({ where: { id, userId }, include: { generatedDocuments: { orderBy: { exactOrder: "asc" } } } });
    const jobResult = { warnings, supportDocumentCount, letterheadAppliedCount, promotedExpertCount: promotion.promotedExpertCount, promotedProjectCount: promotion.promotedProjectCount };
    completeJob(job.id, jobResult);
    void createNotification({ userId, type: "TENDER_GENERATED", title: `Documents generated for "${tender.title}"`, body: `${(updatedTender?.generatedDocuments ?? []).length} document(s) ready for review.`, entityType: "Tender", entityId: id, link: `/dashboard/tenders/${id}` });
    return NextResponse.json({ success: true, jobId: job.id, tender: updatedTender, warnings, readiness: readiness.totals, plannedRecordCount, supportDocumentCount, letterheadAppliedCount, promotedExpertCount: promotion.promotedExpertCount, promotedProjectCount: promotion.promotedProjectCount, submissionPlan: explicitSubmissionScope ? { plannedTargetCount: plannedTargetFiles.length, missing: missingPlanFiles.map((file) => file.exactFileName), extras: extraGeneratedDocs.map((doc) => doc.exactFileName ?? doc.name ?? doc.documentType ?? doc.id ?? "document") } : null });
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
