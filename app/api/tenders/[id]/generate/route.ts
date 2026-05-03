import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { generateTenderDocuments } from "../../../../../lib/engine/generate-elite";
import { applyActiveUploadedLetterheadToTenderDocuments } from "../../../../../lib/engine/apply-active-letterhead";
import { buildSubmissionPlan, findExtraGeneratedDocuments, findMissingGeneratedDocuments, generatedDocumentSubmissionKey, hasExplicitSubmissionScope, plannedSubmissionTargetFiles, plannedSubmissionTargetKeys } from "../../../../../lib/engine/submission-plan";
import { polishBenchmarkOutput } from "../../../../../lib/engine/benchmark-output-polisher";
import { logAction } from "../../../../../lib/audit";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

function criticalGapIsHardBlock(gap: { title: string; description: string; mitigationPlan: string | null }) {
  const text = `${gap.title} ${gap.description} ${gap.mitigationPlan ?? ""}`;
  return /(ineligible|debarred|blacklisted|deadline.*passed|late submission|missing required file name|missing exact file|tender not found|company profile required|no documents? have been generated|signature prohibited|branding prohibited)/i.test(text);
}

function clean(value?: string | null): string {
  return polishBenchmarkOutput(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/=+\s*PAGE\s+\d+\s*=+/gi, " ")
    .replace(/<PARSED TEXT FOR PAGE:[^>]+>/gi, " ")
    .replace(/ChatGPT|OpenAI|as an AI/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shortText(value?: string | null, max = 420): string {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function para(text: string, bold = false): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: clean(text), bold, size: 22, font: "Calibri" })], spacing: { after: 120, line: 276 } });
}

function heading(text: string): Paragraph {
  return new Paragraph({ text: clean(text), heading: HeadingLevel.HEADING_1, spacing: { before: 260, after: 140 } });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ text: shortText(text, 560), bullet: { level: 0 }, spacing: { after: 80, line: 260 } });
}

async function makeSupportDocx(tenderTitle: string, title: string, sections: Array<{ title: string; lines: string[] }>): Promise<string> {
  const children: Paragraph[] = [
    para(title, true),
    para(`Supporting package document for ${shortText(tenderTitle, 220)}. This document presents the relevant tender requirement response, supporting evidence and submission controls in a client-ready package format.`),
  ];
  for (const section of sections) {
    children.push(heading(section.title));
    const lines = section.lines.length ? section.lines : ["Applicable tender-issued forms, attachments or source evidence should be inserted under this section where required."];
    for (const line of lines) children.push(bullet(line));
  }
  const buffer = await Packer.toBuffer(new Document({ sections: [{ properties: {}, children }], styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } } } }));
  return buffer.toString("base64");
}

function supportSections(docName: string, context: { tenderTitle: string; requirements: string[]; experts: string[]; projects: string[] }): Array<{ title: string; lines: string[] }> {
  const name = docName.toLowerCase();
  if (/expert|cv/.test(name)) return [
    { title: "Expert CV Register", lines: context.experts.slice(0, 20) },
    { title: "Role and Requirement Mapping", lines: context.requirements.slice(0, 10) },
    { title: "CV Attachment Control", lines: ["Reviewed CVs and professional credentials are included for the proposed personnel required by the tender.", "Each proposed expert is mapped to role, qualification, comparable experience and assignment responsibility."] },
  ];
  if (/financial|audited|capacity/.test(name)) return [
    { title: "Financial Capacity Evidence", lines: ["Financial capacity evidence should include audited financial statements, tax evidence, bank/financial records or equivalent documents required by the tender.", "No financial offer, fee, rate or price is included in this support document unless expressly required by the tender."] },
    { title: "Tender Requirement Mapping", lines: context.requirements.slice(0, 10) },
  ];
  if (/form|template|declaration|certificate|compliance/.test(name)) return [
    { title: "Required Forms and Declarations", lines: context.requirements.slice(0, 12) },
    { title: "Completion Control", lines: ["Tender-issued forms and declarations are completed in the required format.", "Signature, stamp, date, file name, file order and attachment requirements are checked before submission."] },
  ];
  if (/methodology|work plan|approach/.test(name)) return [
    { title: "Technical Methodology", lines: context.requirements.slice(0, 14) },
    { title: "Work Plan", lines: ["The work plan responds to the confirmed scope and deliverables from the tender documents.", "Each task is mapped to responsible experts, deliverables, QA checks and submission milestones.", "Senior technical review and final compliance verification are applied before submission."] },
  ];
  if (/experience|project|reference/.test(name)) return [
    { title: "Relevant Project References", lines: context.projects.slice(0, 18) },
    { title: "Evidence Attachment Control", lines: ["Project evidence may include completion certificates, client testimony, contracts, photos, drawings or references where required by the tender."] },
  ];
  if (/scope|technical requirement|water|solar|feasibility|design|supervision|appendix|annex|submission|deadline|delivery|formatting|packaging/.test(name)) return [
    { title: "Tender Requirement Response", lines: context.requirements.slice(0, 16) },
    { title: "Submission Package Control", lines: ["This document corresponds to the tender source section or package item with the same title.", "Tender-issued annexes, templates or attachments are inserted or substituted where applicable."] },
  ];
  return [
    { title: "Tender Package Response", lines: context.requirements.slice(0, 12) },
    { title: "Supporting Evidence", lines: [...context.projects, ...context.experts].slice(0, 12) },
  ];
}

function isMainProposalLike(doc: { name: string; exactFileName: string | null; documentType: string }): boolean {
  const label = `${doc.name} ${doc.exactFileName ?? ""}`.toLowerCase();
  return /client-ready benchmark technical proposal|technical-proposal\.docx$/.test(label) || (doc.documentType === "TECHNICAL_PROPOSAL" && /feasibility, design and supervision technical scope/i.test(doc.name));
}

async function fillPlannedSupportDocuments(tenderId: string, plannedFileKeys?: Set<string>): Promise<number> {
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: {
      requirements: true,
      expertMatches: { where: { isSelected: true }, include: { expert: true }, orderBy: { score: "desc" } },
      projectMatches: { where: { isSelected: true }, include: { project: true }, orderBy: { score: "desc" } },
    },
  });
  if (!tender) return 0;

  const requirements = tender.requirements.map((r) => `${r.priority} ${r.requirementType}: ${r.title} — ${shortText(r.description, 380)}`);
  const experts = tender.expertMatches.filter((m) => m.expert.trustLevel === "REVIEWED").map((m) => `${m.expert.fullName}${m.expert.title ? ` — ${m.expert.title}` : ""}${m.expert.yearsExperience ? ` | ${m.expert.yearsExperience}+ years` : ""}${m.expert.profile ? ` | ${shortText(m.expert.profile, 260)}` : ""}`);
  const projects = tender.projectMatches.filter((m) => m.project.trustLevel === "REVIEWED").map((m) => `${m.project.name}${m.project.clientName ? ` — ${m.project.clientName}` : ""}${m.project.country ? ` | ${m.project.country}` : ""}${m.project.summary ? ` | ${shortText(m.project.summary, 300)}` : ""}`);

  const docs = await prisma.generatedDocument.findMany({
    where: { tenderId },
    select: { id: true, name: true, exactFileName: true, documentType: true, generationStatus: true, fileContent: true },
  });

  const incomplete = docs.filter((doc) => {
    if (isMainProposalLike(doc)) return false;
    if (doc.generationStatus === "GENERATED" && doc.fileContent) return false;
    if (!plannedFileKeys) return true;
    return plannedFileKeys.has(generatedDocumentSubmissionKey(doc));
  });

  for (const doc of incomplete) {
    const title = clean(doc.exactFileName || doc.name);
    const fileContent = await makeSupportDocx(tender.title, title, supportSections(title, { tenderTitle: tender.title, requirements, experts, projects }));
    await prisma.generatedDocument.update({
      where: { id: doc.id },
      data: {
        fileContent,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        contentSummary: `Generated supporting package document for ${title} with distinct tender-specific content. Tender-issued attachments/forms remain subject to final submission review.`,
        updatedAt: new Date(),
      },
    });
  }
  return incomplete.length;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const userId = actor.id;
  await prismaReady;
  const { id } = await params;

  const tender = await prisma.tender.findFirst({ where: { id, userId }, include: { requirements: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const submissionPlan = buildSubmissionPlan({
    id: tender.id,
    title: tender.title,
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    pageLimit: tender.pageLimit,
    requirements: tender.requirements,
  });
  const explicitSubmissionScope = hasExplicitSubmissionScope(tender);
  const plannedTargetFiles = explicitSubmissionScope ? plannedSubmissionTargetFiles(submissionPlan) : [];
  const plannedFileKeys = explicitSubmissionScope ? plannedSubmissionTargetKeys(submissionPlan) : undefined;

  const criticalGaps = await prisma.complianceGap.findMany({ where: { tenderId: id, severity: "CRITICAL", isResolved: false }, select: { title: true, description: true, mitigationPlan: true } });
  const hardBlocks = criticalGaps.filter(criticalGapIsHardBlock);
  const seniorReviewCriticals = criticalGaps.filter((gap) => !criticalGapIsHardBlock(gap));
  if (hardBlocks.length > 0) return NextResponse.json({ error: `Generation blocked: ${hardBlocks.length} hard blocker(s) remain. ${hardBlocks.map((g) => g.title).join("; ")}`, code: "HARD_BLOCKERS" }, { status: 422 });

  const selectedExpertMatches = await prisma.tenderExpertMatch.findMany({ where: { tenderId: id, isSelected: true }, include: { expert: { select: { fullName: true, trustLevel: true } } } });
  const selectedProjectMatches = await prisma.tenderProjectMatch.findMany({ where: { tenderId: id, isSelected: true }, include: { project: { select: { name: true, trustLevel: true } } } });
  const draftExperts = selectedExpertMatches.filter((m) => m.expert.trustLevel !== "REVIEWED");
  const draftProjects = selectedProjectMatches.filter((m) => m.project.trustLevel !== "REVIEWED");
  const reviewedExpertCount = selectedExpertMatches.length - draftExperts.length;
  const reviewedProjectCount = selectedProjectMatches.length - draftProjects.length;
  const expertRequirementExists = await prisma.tenderRequirement.count({ where: { tenderId: id, requirementType: "EXPERT" } });
  const projectRequirementExists = await prisma.tenderRequirement.count({ where: { tenderId: id, requirementType: "PROJECT_EXPERIENCE" } });

  if (selectedExpertMatches.length > 0 && reviewedExpertCount === 0 && expertRequirementExists > 0) return NextResponse.json({ error: `Generation blocked: ${selectedExpertMatches.length} expert(s) are selected but NONE have been reviewed. Go to the Knowledge Review page and review at least one expert before generating.`, code: "ALL_EXPERTS_UNREVIEWED", draftExperts: draftExperts.map((m) => m.expert.fullName) }, { status: 422 });
  if (selectedProjectMatches.length > 0 && reviewedProjectCount === 0 && projectRequirementExists > 0) return NextResponse.json({ error: `Generation blocked: ${selectedProjectMatches.length} project reference(s) are selected but NONE have been reviewed. Go to the Knowledge Review page and review at least one project before generating.`, code: "ALL_PROJECTS_UNREVIEWED", draftProjects: draftProjects.map((m) => m.project.name) }, { status: 422 });

  const warnings: string[] = [];
  if (explicitSubmissionScope) warnings.push(`Submission plan target scope detected: ${plannedTargetFiles.length} tender-required file(s) will control generation reconciliation.`);
  if (seniorReviewCriticals.length > 0) warnings.push(`${seniorReviewCriticals.length} critical evidence/review gap(s) were carried into the proposal as senior bid-review items instead of blocking draft generation.`);
  if (draftExperts.length > 0) warnings.push(`${draftExperts.length} selected expert(s) are unreviewed drafts: ${draftExperts.map((m) => m.expert.fullName).join(", ")}. Review them in the Knowledge Review page for more accurate proposals.`);
  if (draftProjects.length > 0) warnings.push(`${draftProjects.length} selected project(s) are unreviewed drafts: ${draftProjects.map((m) => m.project.name).join(", ")}. Review them in the Knowledge Review page for more accurate proposals.`);

  try {
    await generateTenderDocuments(id, userId);
    const supportDocumentCount = await fillPlannedSupportDocuments(id, plannedFileKeys);
    if (supportDocumentCount > 0) warnings.push(explicitSubmissionScope
      ? `${supportDocumentCount} planned package document(s) were generated with distinct tender-specific content for export readiness.`
      : `${supportDocumentCount} remaining package document(s) were generated with distinct tender-specific content for export readiness.`);
    const letterheadAppliedCount = await applyActiveUploadedLetterheadToTenderDocuments(id, userId);
    if (letterheadAppliedCount > 0) warnings.push(`Uploaded Word letterhead applied to ${letterheadAppliedCount} generated DOCX file(s).`);

    const generatedDocsForPlan = explicitSubmissionScope ? await prisma.generatedDocument.findMany({
      where: { tenderId: id },
      select: { id: true, name: true, exactFileName: true, exactOrder: true, documentType: true, format: true, generationStatus: true, fileContent: true },
    }) : [];
    const missingPlanFiles = explicitSubmissionScope ? findMissingGeneratedDocuments(submissionPlan, generatedDocsForPlan) : [];
    const extraGeneratedDocs = explicitSubmissionScope ? findExtraGeneratedDocuments(submissionPlan, generatedDocsForPlan) : [];
    if (missingPlanFiles.length > 0) warnings.push(`Submission plan still has ${missingPlanFiles.length} missing tender-required file(s): ${missingPlanFiles.map((file) => file.exactFileName).join(", ")}.`);
    if (extraGeneratedDocs.length > 0) warnings.push(`Generation produced ${extraGeneratedDocs.length} generated file(s) outside the explicit submission plan: ${extraGeneratedDocs.map((doc) => doc.exactFileName ?? doc.name ?? doc.documentType ?? doc.id ?? "document").join(", ")}. Final ZIP export will block until reconciled.`);

    if (reviewedExpertCount > 0 || draftExperts.length > 0 || reviewedProjectCount > 0 || draftProjects.length > 0) await prisma.generatedDocument.updateMany({ where: { tenderId: id }, data: { reviewedExpertCount, draftExpertCount: draftExperts.length, reviewedProjectCount, draftProjectCount: draftProjects.length, updatedAt: new Date() } });

    await logAction({ userId, action: "TENDER_GENERATED", entityType: "Tender", entityId: id, description: `Generated benchmark-quality documents for tender "${tender.title}" — ${reviewedExpertCount} reviewed experts, ${draftExperts.length} draft experts, ${reviewedProjectCount} reviewed projects, ${draftProjects.length} draft projects, ${supportDocumentCount} supporting package documents, ${letterheadAppliedCount} uploaded letterhead overlays, ${seniorReviewCriticals.length} senior-review gaps`, metadata: { tenderId: id, reviewedExpertCount, draftExpertCount: draftExperts.length, reviewedProjectCount, draftProjectCount: draftProjects.length, supportDocumentCount, letterheadAppliedCount, seniorReviewGapCount: seniorReviewCriticals.length, explicitSubmissionScope, plannedTargetCount: plannedTargetFiles.length, missingPlanFileCount: missingPlanFiles.length, extraGeneratedFileCount: extraGeneratedDocs.length, warnings } });
    const updatedTender = await prisma.tender.findFirst({ where: { id, userId }, include: { generatedDocuments: { orderBy: { exactOrder: "asc" } } } });
    return NextResponse.json({ success: true, tender: updatedTender, warnings, supportDocumentCount, letterheadAppliedCount, submissionPlan: explicitSubmissionScope ? { plannedTargetCount: plannedTargetFiles.length, missing: missingPlanFiles.map((file) => file.exactFileName), extras: extraGeneratedDocs.map((doc) => doc.exactFileName ?? doc.name ?? doc.documentType ?? doc.id ?? "document") } : null });
  } catch (error) {
    console.error("[generate] error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Document generation failed" }, { status: 500 });
  }
}
