// Bid Strategy API endpoint (PR #249) — beyond-spec feature.
//
// GET /api/tenders/[id]/bid-strategy
//
// Returns the deterministic Bid Strategy assessment for the tender:
//   • winProbability (0–100)
//   • recommendation (BID_HARD / BID_CAREFULLY / DECLINE)
//   • bidPosture (SOLO / JV_RECOMMENDED / SUBCONTRACT_REQUIRED / DECLINE)
//   • topRisks, topAdvantages, dimensionScores, rationale
//
// No AI calls. No external services. <100ms typical response time —
// runs on every load of the tender workspace as a "should we even
// be in this race" indicator before the bid team commits effort.

import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { computeBidStrategy } from "../../../../../lib/engine/bid-strategy";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  const canRead = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"].includes(actor.role);
  if (!canRead) return forbiddenResponse();

  const { id } = await params;
  await prismaReady;

  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    include: {
      requirements: { select: { title: true, description: true, requirementType: true, priority: true, requiredQuantity: true } },
      complianceGaps: { select: { severity: true, isResolved: true, title: true } },
      expertMatches: {
        select: {
          score: true,
          isSelected: true,
          expert: { select: { fullName: true, trustLevel: true, disciplines: true } },
        },
      },
      projectMatches: {
        select: {
          score: true,
          isSelected: true,
          project: { select: { name: true, trustLevel: true, sector: true, serviceAreas: true } },
        },
      },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const company = await prisma.company.findUnique({
    where: { userId: actor.id },
    select: {
      name: true,
      sectors: true,
      serviceLines: true,
      licenseGrade: true,
      country: true,
      headcount: true,
      _count: {
        select: {
          experts: { where: { trustLevel: "REVIEWED" } },
          projects: { where: { trustLevel: "REVIEWED" } },
          legalRecords: true,
          financialRecords: true,
        },
      },
    },
  });
  if (!company) return NextResponse.json({ error: "Company profile required" }, { status: 400 });

  const strategy = computeBidStrategy({
    tender: {
      id: tender.id,
      title: tender.title,
      category: tender.category,
      requirements: tender.requirements,
      complianceGaps: tender.complianceGaps,
      expertMatches: tender.expertMatches,
      projectMatches: tender.projectMatches,
      evaluationMethodology: tender.evaluationMethodology,
      submissionMethod: tender.submissionMethod,
    },
    company: {
      name: company.name,
      sectors: company.sectors,
      serviceLines: company.serviceLines,
      licenseGrade: company.licenseGrade,
      country: company.country,
      headcount: company.headcount,
      expertCount: company._count.experts,
      projectCount: company._count.projects,
      legalRecordCount: company._count.legalRecords,
      financialRecordCount: company._count.financialRecords,
    },
  });

  return NextResponse.json({ strategy });
}
