import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { simulateEvaluatorPanel } from "../../../../../lib/engine/evaluator-simulator";
import { logAction } from "../../../../../lib/audit";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function short(value: string | null | undefined, max = 420): string {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function generatedDocTextFromTender(tender: { intakeSummary: string | null; generatedDocuments: Array<{ name: string; documentType: string; contentSummary: string | null; generationStatus: string; reviewStatus: string }> }): string {
  const parts: string[] = [];
  if (tender.intakeSummary && tender.intakeSummary.trim().length > 500) parts.push(tender.intakeSummary);
  const generatedSummaries = tender.generatedDocuments
    .filter((doc) => doc.generationStatus === "GENERATED")
    .map((doc) => `${doc.name} (${doc.documentType}, review=${doc.reviewStatus}): ${doc.contentSummary ?? "No summary"}`);
  if (generatedSummaries.length > 0) parts.push(`Generated package summary:\n${generatedSummaries.join("\n")}`);
  return parts.join("\n\n---\n\n");
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  const canSimulate = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role);
  if (!canSimulate) return forbiddenResponse();

  const { id } = await params;
  await prismaReady;

  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    include: {
      requirements: { orderBy: { createdAt: "asc" } },
      complianceGaps: { where: { isResolved: false }, orderBy: { createdAt: "desc" } },
      expertMatches: { where: { isSelected: true }, include: { expert: true }, orderBy: { score: "desc" } },
      projectMatches: { where: { isSelected: true }, include: { project: true }, orderBy: { score: "desc" } },
      generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" } }, orderBy: { exactOrder: "asc" } },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const proposalContext = generatedDocTextFromTender(tender);
  if (!proposalContext || proposalContext.trim().length < 500) {
    return NextResponse.json({
      error: "Proposal/package context is too short to simulate. Run AI Proposal or Generate Docs first to produce a substantive proposal/package.",
      code: "NO_PROPOSAL",
    }, { status: 400 });
  }

  const context = {
    requirements: tender.requirements.map((req) => `[${req.priority}] ${req.requirementType}: ${req.title} — ${short(req.description, 360)}`),
    complianceGaps: tender.complianceGaps.map((gap) => `[${gap.severity}] ${gap.title} — ${short(gap.description, 360)}${gap.mitigationPlan ? ` | Mitigation: ${short(gap.mitigationPlan, 220)}` : ""}`),
    selectedExperts: tender.expertMatches.map((match) => `${match.expert.fullName}${match.expert.title ? ` — ${match.expert.title}` : ""}; score=${Math.round(match.score * 100)}%; trust=${match.expert.trustLevel}; ${short(match.expert.profile, 260)}`),
    selectedProjects: tender.projectMatches.map((match) => `${match.project.name}${match.project.clientName ? ` — ${match.project.clientName}` : ""}; score=${Math.round(match.score * 100)}%; trust=${match.project.trustLevel}; ${short(match.project.summary, 300)}`),
    matchRationales: [
      ...tender.expertMatches.map((match) => `Expert ${match.expert.fullName}: ${short(match.rationale, 420)}`),
      ...tender.projectMatches.map((match) => `Project ${match.project.name}: ${short(match.rationale, 420)}`),
    ],
    readinessSummary: `Tender readiness=${Math.round(tender.readinessScore ?? 0)}/100; open gaps=${tender.complianceGaps.length}; selected experts=${tender.expertMatches.length}; selected projects=${tender.projectMatches.length}; documents=${tender.generatedDocuments.length}`,
  };

  await logAction({
    userId: actor.id,
    action: "EVALUATOR_SIMULATION_RUN",
    entityType: "Tender",
    entityId: id,
    description: `${actor.email} ran evidence-aware evaluator committee on tender "${tender.title}"`,
    metadata: { tenderId: id, proposalLength: proposalContext.length, requirements: tender.requirements.length, gaps: tender.complianceGaps.length, selectedExperts: tender.expertMatches.length, selectedProjects: tender.projectMatches.length },
  });

  const result = await simulateEvaluatorPanel({
    tenderTitle: tender.title,
    proposalMarkdown: proposalContext,
    evaluationCriteria: tender.evaluationMethodology ?? "",
    context,
  });

  if (!result) {
    return NextResponse.json({
      error: "All evaluator personas failed. Check AI provider configuration and rate-limit status, then retry.",
      code: "ALL_PERSONAS_FAILED",
    }, { status: 502 });
  }

  await logAction({
    userId: actor.id,
    action: "EVALUATOR_COMMITTEE_RESULT",
    entityType: "Tender",
    entityId: id,
    description: `Evidence-aware evaluator committee scored "${tender.title}" ${result.predictedOverallScore}/100 (${result.verdict})`,
    metadata: {
      tenderId: id,
      predictedOverallScore: result.predictedOverallScore,
      verdict: result.verdict,
      topObjections: result.topObjections,
      actionPlan: result.actionPlan,
      riskRegister: result.riskRegister,
    },
  });

  await prisma.tender.update({
    where: { id },
    data: {
      notes: [
        tender.notes?.trim(),
        `Evaluator committee: ${result.predictedOverallScore}/100 (${result.verdict}). ${result.topObjections.length} objection(s), ${result.actionPlan.length} action(s).`,
      ].filter(Boolean).join("\n"),
    },
  });

  return NextResponse.json({ simulation: result });
}
