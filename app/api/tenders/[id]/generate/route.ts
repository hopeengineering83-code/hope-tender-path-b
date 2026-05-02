import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { generateTenderDocuments } from "../../../../../lib/engine/generate-elite";
import { generateRemainingSupportingTenderDocuments } from "../../../../../lib/engine/generate-supporting-documents";
import { applyActiveUploadedLetterheadToTenderDocuments } from "../../../../../lib/engine/apply-active-letterhead";
import { logAction } from "../../../../../lib/audit";

function criticalGapIsHardBlock(gap: { title: string; description: string; mitigationPlan: string | null }) {
  const text = `${gap.title} ${gap.description} ${gap.mitigationPlan ?? ""}`;
  // Hard blocks are true eligibility/commercial/format impossibilities. Evidence gaps and proposal-response gaps are senior review items.
  return /(ineligible|debarred|blacklisted|deadline.*passed|late submission|missing required file name|missing exact file|tender not found|company profile required|no documents? have been generated|signature prohibited|branding prohibited)/i.test(text);
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

  const tender = await prisma.tender.findFirst({ where: { id, userId } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const criticalGaps = await prisma.complianceGap.findMany({
    where: { tenderId: id, severity: "CRITICAL", isResolved: false },
    select: { title: true, description: true, mitigationPlan: true },
  });
  const hardBlocks = criticalGaps.filter(criticalGapIsHardBlock);
  const seniorReviewCriticals = criticalGaps.filter((gap) => !criticalGapIsHardBlock(gap));
  if (hardBlocks.length > 0) {
    return NextResponse.json({ error: `Generation blocked: ${hardBlocks.length} hard blocker(s) remain. ${hardBlocks.map((g) => g.title).join("; ")}`, code: "HARD_BLOCKERS" }, { status: 422 });
  }

  const selectedExpertMatches = await prisma.tenderExpertMatch.findMany({ where: { tenderId: id, isSelected: true }, include: { expert: { select: { fullName: true, trustLevel: true } } } });
  const selectedProjectMatches = await prisma.tenderProjectMatch.findMany({ where: { tenderId: id, isSelected: true }, include: { project: { select: { name: true, trustLevel: true } } } });
  const draftExperts = selectedExpertMatches.filter((m) => m.expert.trustLevel !== "REVIEWED");
  const draftProjects = selectedProjectMatches.filter((m) => m.project.trustLevel !== "REVIEWED");
  const reviewedExpertCount = selectedExpertMatches.length - draftExperts.length;
  const reviewedProjectCount = selectedProjectMatches.length - draftProjects.length;
  const expertRequirementExists = await prisma.tenderRequirement.count({ where: { tenderId: id, requirementType: "EXPERT" } });
  const projectRequirementExists = await prisma.tenderRequirement.count({ where: { tenderId: id, requirementType: "PROJECT_EXPERIENCE" } });

  if (selectedExpertMatches.length > 0 && reviewedExpertCount === 0 && expertRequirementExists > 0) {
    return NextResponse.json({ error: `Generation blocked: ${selectedExpertMatches.length} expert(s) are selected but NONE have been reviewed. Go to the Knowledge Review page and review at least one expert before generating.`, code: "ALL_EXPERTS_UNREVIEWED", draftExperts: draftExperts.map((m) => m.expert.fullName) }, { status: 422 });
  }
  if (selectedProjectMatches.length > 0 && reviewedProjectCount === 0 && projectRequirementExists > 0) {
    return NextResponse.json({ error: `Generation blocked: ${selectedProjectMatches.length} project reference(s) are selected but NONE have been reviewed. Go to the Knowledge Review page and review at least one project before generating.`, code: "ALL_PROJECTS_UNREVIEWED", draftProjects: draftProjects.map((m) => m.project.name) }, { status: 422 });
  }

  const warnings: string[] = [];
  if (seniorReviewCriticals.length > 0) warnings.push(`${seniorReviewCriticals.length} critical evidence/review gap(s) were carried into the proposal as senior bid-review items instead of blocking draft generation.`);
  if (draftExperts.length > 0) warnings.push(`${draftExperts.length} selected expert(s) are unreviewed drafts: ${draftExperts.map((m) => m.expert.fullName).join(", ")}. Review them in the Knowledge Review page for more accurate proposals.`);
  if (draftProjects.length > 0) warnings.push(`${draftProjects.length} selected project(s) are unreviewed drafts: ${draftProjects.map((m) => m.project.name).join(", ")}. Review them in the Knowledge Review page for more accurate proposals.`);

  try {
    await generateTenderDocuments(id, userId);
    const supportingDocumentCount = await generateRemainingSupportingTenderDocuments(id, userId);
    if (supportingDocumentCount > 0) warnings.push(`Generated ${supportingDocumentCount} supporting tender package document(s).`);
    const letterheadAppliedCount = await applyActiveUploadedLetterheadToTenderDocuments(id, userId);
    if (letterheadAppliedCount > 0) warnings.push(`Uploaded Word letterhead applied to ${letterheadAppliedCount} generated DOCX file(s).`);

    if (reviewedExpertCount > 0 || draftExperts.length > 0 || reviewedProjectCount > 0 || draftProjects.length > 0) {
      await prisma.generatedDocument.updateMany({ where: { tenderId: id }, data: { reviewedExpertCount, draftExpertCount: draftExperts.length, reviewedProjectCount, draftProjectCount: draftProjects.length, updatedAt: new Date() } });
    }

    await logAction({ userId, action: "TENDER_GENERATED", entityType: "Tender", entityId: id, description: `Generated benchmark-quality documents for tender "${tender.title}" — ${reviewedExpertCount} reviewed experts, ${draftExperts.length} draft experts, ${reviewedProjectCount} reviewed projects, ${draftProjects.length} draft projects, ${supportingDocumentCount} supporting documents, ${letterheadAppliedCount} uploaded letterhead overlays, ${seniorReviewCriticals.length} senior-review gaps`, metadata: { tenderId: id, reviewedExpertCount, draftExpertCount: draftExperts.length, reviewedProjectCount, draftProjectCount: draftProjects.length, supportingDocumentCount, letterheadAppliedCount, seniorReviewGapCount: seniorReviewCriticals.length, warnings } });
    const updatedTender = await prisma.tender.findFirst({ where: { id, userId }, include: { generatedDocuments: { orderBy: { exactOrder: "asc" } } } });
    return NextResponse.json({ success: true, tender: updatedTender, warnings, supportingDocumentCount, letterheadAppliedCount });
  } catch (error) {
    console.error("[generate] error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Document generation failed" }, { status: 500 });
  }
}
