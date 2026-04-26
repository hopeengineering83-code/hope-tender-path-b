import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { generateTenderDocuments } from "../../../../../lib/engine/generate";
import { logAction } from "../../../../../lib/audit";

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

  // ── Gate 1: unresolved CRITICAL compliance gaps ───────────────────────────
  const criticalGaps = await prisma.complianceGap.count({
    where: { tenderId: id, severity: "CRITICAL", isResolved: false },
  });
  if (criticalGaps > 0) {
    return NextResponse.json(
      { error: `Generation blocked: ${criticalGaps} unresolved CRITICAL compliance gap(s). Resolve all critical gaps before generating.`, code: "CRITICAL_GAPS" },
      { status: 422 },
    );
  }

  // ── Gate 2: unresolved mandatory requirements ─────────────────────────────
  const unresolvedMandatory = await prisma.tenderRequirement.count({
    where: { tenderId: id, priority: "MANDATORY", isResolved: false },
  });
  if (unresolvedMandatory > 0) {
    return NextResponse.json(
      { error: `Generation blocked: ${unresolvedMandatory} mandatory requirement(s) are unresolved. Mark them resolved or add compliance evidence first.`, code: "UNRESOLVED_MANDATORY" },
      { status: 422 },
    );
  }

  // ── Gate 3: selected experts/projects trust level audit ───────────────────
  const selectedExpertMatches = await prisma.tenderExpertMatch.findMany({
    where: { tenderId: id, isSelected: true },
    include: { expert: { select: { fullName: true, trustLevel: true } } },
  });
  const selectedProjectMatches = await prisma.tenderProjectMatch.findMany({
    where: { tenderId: id, isSelected: true },
    include: { project: { select: { name: true, trustLevel: true } } },
  });

  const draftExperts = selectedExpertMatches.filter((m) => m.expert.trustLevel !== "REVIEWED");
  const draftProjects = selectedProjectMatches.filter((m) => m.project.trustLevel !== "REVIEWED");

  const reviewedExpertCount = selectedExpertMatches.length - draftExperts.length;
  const reviewedProjectCount = selectedProjectMatches.length - draftProjects.length;

  // ── Gate 3: Trust level hard-block ───────────────────────────────────────
  // Never use unreviewed records as the SOLE source in a final proposal.
  // Block if experts are selected AND not a single one is REVIEWED.
  // Block if projects are selected AND not a single one is REVIEWED.
  // (Mixed pools — some reviewed, some draft — are allowed with a warning.)
  const expertRequirementExists = await prisma.tenderRequirement.count({
    where: { tenderId: id, requirementType: "EXPERT" },
  });
  const projectRequirementExists = await prisma.tenderRequirement.count({
    where: { tenderId: id, requirementType: "PROJECT_EXPERIENCE" },
  });

  if (selectedExpertMatches.length > 0 && reviewedExpertCount === 0 && expertRequirementExists > 0) {
    return NextResponse.json(
      {
        error: `Generation blocked: ${selectedExpertMatches.length} expert(s) are selected but NONE have been reviewed. Go to the Knowledge Review page and review at least one expert before generating.`,
        code: "ALL_EXPERTS_UNREVIEWED",
        draftExperts: draftExperts.map((m) => m.expert.fullName),
      },
      { status: 422 },
    );
  }

  if (selectedProjectMatches.length > 0 && reviewedProjectCount === 0 && projectRequirementExists > 0) {
    return NextResponse.json(
      {
        error: `Generation blocked: ${selectedProjectMatches.length} project reference(s) are selected but NONE have been reviewed. Go to the Knowledge Review page and review at least one project before generating.`,
        code: "ALL_PROJECTS_UNREVIEWED",
        draftProjects: draftProjects.map((m) => m.project.name),
      },
      { status: 422 },
    );
  }

  // Soft warnings for mixed pools (some reviewed, some draft)
  const warnings: string[] = [];
  if (draftExperts.length > 0) {
    warnings.push(`${draftExperts.length} selected expert(s) are unreviewed drafts: ${draftExperts.map((m) => m.expert.fullName).join(", ")}. Review them in the Knowledge Review page for more accurate proposals.`);
  }
  if (draftProjects.length > 0) {
    warnings.push(`${draftProjects.length} selected project(s) are unreviewed drafts: ${draftProjects.map((m) => m.project.name).join(", ")}. Review them in the Knowledge Review page for more accurate proposals.`);
  }

  try {
    await generateTenderDocuments(id, userId);

    // Record trust-level audit counts on generated documents
    if (reviewedExpertCount > 0 || draftExperts.length > 0 || reviewedProjectCount > 0 || draftProjects.length > 0) {
      await prisma.generatedDocument.updateMany({
        where: { tenderId: id },
        data: {
          reviewedExpertCount,
          draftExpertCount: draftExperts.length,
          reviewedProjectCount,
          draftProjectCount: draftProjects.length,
          updatedAt: new Date(),
        },
      });
    }

    await logAction({
      userId,
      action: "TENDER_GENERATED",
      entityType: "Tender",
      entityId: id,
      description: `Generated documents for tender "${tender.title}" — ${reviewedExpertCount} reviewed experts, ${draftExperts.length} draft experts, ${reviewedProjectCount} reviewed projects, ${draftProjects.length} draft projects`,
      metadata: { tenderId: id, reviewedExpertCount, draftExpertCount: draftExperts.length, reviewedProjectCount, draftProjectCount: draftProjects.length, warnings },
    });

    const updatedTender = await prisma.tender.findFirst({
      where: { id, userId },
      include: { generatedDocuments: { orderBy: { exactOrder: "asc" } } },
    });

    return NextResponse.json({ success: true, tender: updatedTender, warnings });
  } catch (error) {
    console.error("[generate] error:", error);
    return NextResponse.json({ error: "Document generation failed" }, { status: 500 });
  }
}
