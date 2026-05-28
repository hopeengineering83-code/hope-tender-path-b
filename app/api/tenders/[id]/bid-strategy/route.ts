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
import { computeWinProbability } from "../../../../../lib/engine/win-probability";
import { detectAnalysisSourceWithApproval } from "../../../../../lib/engine/analysis-source";

// Confidence ceiling applied to bid-strategy win probability when the tender
// analysis came from an unapproved regex/deterministic fallback. The strategy
// is computed from requirements/matches the regex extractor may have gotten
// wrong, so the headline number must not read as a confident recommendation.
const FALLBACK_CONFIDENCE_CEILING = 50;

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

  const [tender, company, pastTenders] = await Promise.all([
    prisma.tender.findFirst({
      where: { id, userId: actor.id },
      include: {
        requirements: { select: { title: true, description: true, requirementType: true, priority: true, requiredQuantity: true } },
        complianceGaps: { select: { severity: true, isResolved: true, title: true } },
        expertMatches: {
          where: { isSelected: true },
          select: {
            score: true,
            isSelected: true,
            expert: { select: { fullName: true, trustLevel: true, disciplines: true, sectors: true, yearsExperience: true } },
          },
        },
        projectMatches: {
          where: { isSelected: true },
          select: {
            score: true,
            isSelected: true,
            project: { select: { name: true, trustLevel: true, sector: true, serviceAreas: true, contractValue: true } },
          },
        },
      },
    }),
    prisma.company.findUnique({
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
    }),
    // Historical bid outcomes — all past tenders with a resolved outcome
    prisma.tender.findMany({
      where: { userId: actor.id, bidOutcome: { in: ["WON", "LOST"] } },
      select: { bidOutcome: true, category: true },
    }),
  ]);

  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  if (!company) return NextResponse.json({ error: "Company profile required" }, { status: 400 });

  const historicalTotal = pastTenders.length;
  const historicalWins = pastTenders.filter((t) => t.bidOutcome === "WON").length;

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
      historicalWins,
      historicalTotal,
    },
  });

  // Part 12 — keep bid strategy consistent with the analysis source. If the
  // analysis came from an unapproved regex/deterministic fallback, the inputs
  // to computeBidStrategy are low-confidence, so the headline win probability
  // must be capped and the recommendation must not read as "BID_HARD".
  const analysisSource = await detectAnalysisSourceWithApproval(prisma, id, tender).catch(() => "UNKNOWN" as const);
  const confidenceCapped = analysisSource === "REGEX_FALLBACK_AI_ERROR" || analysisSource === "UNKNOWN";
  if (confidenceCapped && strategy.winProbability > FALLBACK_CONFIDENCE_CEILING) {
    strategy.winProbability = FALLBACK_CONFIDENCE_CEILING;
    if (strategy.recommendation === "BID_HARD") strategy.recommendation = "BID_CAREFULLY";
  }
  const confidenceNote = confidenceCapped
    ? "Bid strategy confidence is capped because the tender analysis used an unapproved regex/deterministic fallback. Re-run AI Analyze (or approve the fallback analysis with an audit note) for a full-confidence recommendation."
    : null;

  // Win-probability 4-axis breakdown (evidence match / team strength /
  // compliance posture / historical outcomes) — surfaced in the panel as
  // actionable per-axis scores with explanatory notes.
  const winProbability = computeWinProbability({
    primarySector: tender.category ?? "General",
    tenderBudget: (tender as { budget?: number | null }).budget ?? null,
    tenderCategory: tender.category ?? null,
    projects: tender.projectMatches.map((m) => ({
      sectors: m.project.sector ? JSON.stringify([m.project.sector]) : null,
      contractValue: m.project.contractValue ?? null,
    })),
    experts: tender.expertMatches.map((m) => ({
      disciplines: (m.expert as { disciplines?: string | null }).disciplines,
      sectors: (m.expert as { sectors?: string | null }).sectors,
      yearsExperience: (m.expert as { yearsExperience?: number | null }).yearsExperience,
    })),
    complianceGaps: tender.complianceGaps.filter((g) => !g.isResolved),
    bidOutcomes: pastTenders.map((t) => ({ won: t.bidOutcome === "WON", primarySector: t.category ?? null })),
  });

  return NextResponse.json({
    strategy,
    winProbabilityBreakdown: winProbability,
    historicalBidStats: { total: historicalTotal, wins: historicalWins },
    analysisSource,
    confidenceCapped,
    confidenceNote,
  });
}
