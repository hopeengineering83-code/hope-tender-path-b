import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { rateLimitPersistent, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { simulateEvaluatorPanel } from "../../../../../lib/engine/evaluator-simulator";
import { scoreProposalQuality } from "../../../../../lib/engine/proposal-quality-scorer";
import { logAction } from "../../../../../lib/audit";
import { isDeepReasoningEnabled } from "../../../../../lib/engine/feature-flags";
import { extractDeepTenderComprehension } from "../../../../../lib/engine/evaluation-criteria-extractor";
import { sanitizeError } from "../../../../../lib/sanitize-error";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function inferObjectionCategory(persona: string, detail: string): string {
  const d = detail.toLowerCase();
  const p = persona.toLowerCase();
  if (/compliance|declaration|eligib|certif|missing.*form|required.*document/.test(d)) return "COMPLIANCE_GAP";
  if (/evidence|expert|project.*reference|past.*performance|cv|qualification|experience/.test(d)) return "EVIDENCE_GAP";
  if (/criterion|scoring|evaluation|criterion.*miss|not.*addressed|not.*covered/.test(d)) return "EVAL_CRITERION_MISS";
  if (/price|cost|budget|financial|commercial|value/.test(d) || p === "commercial") return "PRICING_GAP";
  if (/incorrect|wrong|inaccur|contradict|fact/.test(d)) return "FACT_ERROR";
  return "OTHER";
}

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
  if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role)) return forbiddenResponse();

  const rl = await rateLimitPersistent(`eval-sim:${actor.id}`, AI_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests. Please wait before running the simulation again.", code: "RATE_LIMITED", resetAt: rl.resetAt, retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const { id } = await params;
  await prismaReady;

  const [tender, latestProposalVersion] = await Promise.all([
    prisma.tender.findFirst({
      where: { id, userId: actor.id },
      include: {
        requirements: { orderBy: { createdAt: "asc" } },
        complianceGaps: { where: { isResolved: false }, orderBy: { createdAt: "desc" } },
        expertMatches: { where: { isSelected: true }, include: { expert: true }, orderBy: { score: "desc" } },
        projectMatches: { where: { isSelected: true }, include: { project: true }, orderBy: { score: "desc" } },
        generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" } }, orderBy: { exactOrder: "asc" } },
      },
    }),
    prisma.proposalVersion.findFirst({ where: { tenderId: id }, orderBy: { version: "desc" }, select: { version: true } }),
  ]);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  const currentProposalVersion = latestProposalVersion?.version ?? 1;

  const proposalContext = generatedDocTextFromTender(tender);
  if (!proposalContext || proposalContext.trim().length < 500) {
    return NextResponse.json({ error: "Proposal/package context is too short to simulate. Produce a substantive proposal/package first — run AI Proposal, or run AI Analyze and Run Engine so the full package is generated automatically.", code: "NO_PROPOSAL" }, { status: 400 });
  }

  const qualityScore = (() => {
    try {
      return scoreProposalQuality({ markdown: proposalContext, primarySector: "", topProjects: [] });
    } catch {
      return null;
    }
  })();
  const weakAxesSummary = qualityScore && qualityScore.weakAxes.length > 0
    ? `Quality scorer: ${qualityScore.total}/100 — weak axes: ${qualityScore.weakAxes.join(", ")}`
    : qualityScore
      ? `Quality scorer: ${qualityScore.total}/100 — all axes passing`
      : "";

  let sharedCriteria: Array<{ id: string; criterion: string; weight: number | null }> | undefined;
  if (isDeepReasoningEnabled()) {
    try {
      const tenderTextForExtraction = [tender.intakeSummary ?? "", tender.analysisSummary ?? "", tender.evaluationMethodology ?? "", tender.description ?? ""].filter(Boolean).join("\n\n");
      const comprehension = await extractDeepTenderComprehension(tenderTextForExtraction);
      if (comprehension && comprehension.criteria.length > 0) {
        sharedCriteria = comprehension.criteria.map((criterion) => ({ id: criterion.id, criterion: criterion.criterion, weight: criterion.weight }));
      }
    } catch (error) {
      logger.warn(`[evaluator-simulation] Deep comprehension unavailable: ${sanitizeError(error)}`);
    }
  }

  const context = {
    requirements: tender.requirements.map((requirement) => `[${requirement.priority}] ${requirement.requirementType}: ${requirement.title} — ${short(requirement.description, 360)}`),
    complianceGaps: tender.complianceGaps.map((gap) => `[${gap.severity}] ${gap.title} — ${short(gap.description, 360)}${gap.mitigationPlan ? ` | Mitigation: ${short(gap.mitigationPlan, 220)}` : ""}`),
    selectedExperts: tender.expertMatches.map((match) => `${match.expert.fullName}${match.expert.title ? ` — ${match.expert.title}` : ""}; score=${Math.round(match.score * 100)}%; trust=${match.expert.trustLevel}; ${short(match.expert.profile, 260)}`),
    selectedProjects: tender.projectMatches.map((match) => `${match.project.name}${match.project.clientName ? ` — ${match.project.clientName}` : ""}; score=${Math.round(match.score * 100)}%; trust=${match.project.trustLevel}; ${short(match.project.summary, 300)}`),
    matchRationales: [
      ...tender.expertMatches.map((match) => `Expert ${match.expert.fullName}: ${short(match.rationale, 420)}`),
      ...tender.projectMatches.map((match) => `Project ${match.project.name}: ${short(match.rationale, 420)}`),
    ],
    readinessSummary: [
      `Tender workflowProgress=${Math.round(tender.readinessScore ?? 0)}/100; open gaps=${tender.complianceGaps.length}; selected experts=${tender.expertMatches.length}; selected projects=${tender.projectMatches.length}; documents=${tender.generatedDocuments.length}`,
      weakAxesSummary,
    ].filter(Boolean).join(" | "),
    sharedCriteria,
  };

  await logAction({
    userId: actor.id,
    action: "EVALUATOR_SIMULATION_RUN",
    entityType: "Tender",
    entityId: id,
    description: `${actor.email} ran evidence-aware evaluator committee on tender "${tender.title}"`,
    metadata: { tenderId: id, proposalLength: proposalContext.length, requirements: tender.requirements.length, gaps: tender.complianceGaps.length, selectedExperts: tender.expertMatches.length, selectedProjects: tender.projectMatches.length },
  });

  let result;
  try {
    result = await simulateEvaluatorPanel({ tenderTitle: tender.title, proposalMarkdown: proposalContext, evaluationCriteria: tender.evaluationMethodology ?? "", context });
  } catch (error) {
    logger.error(`[evaluator-simulation] Provider failure for tender ${id}: ${sanitizeError(error)}`);
    return NextResponse.json({ error: "Evaluator simulation failed. Retry or review provider configuration.", code: "EVALUATOR_PROVIDER_FAILED" }, { status: 502 });
  }

  if (!result) {
    return NextResponse.json({ error: "All evaluator personas failed. Check AI provider configuration and rate-limit status, then retry.", code: "ALL_PERSONAS_FAILED" }, { status: 502 });
  }

  await logAction({
    userId: actor.id,
    action: "EVALUATOR_COMMITTEE_RESULT",
    entityType: "Tender",
    entityId: id,
    description: `Evidence-aware evaluator committee scored "${tender.title}" ${result.predictedOverallScore}/100 (${result.verdict})`,
    metadata: { tenderId: id, predictedOverallScore: result.predictedOverallScore, verdict: result.verdict, topObjections: result.topObjections, actionPlan: result.actionPlan, riskRegister: result.riskRegister },
  });

  await prisma.$transaction(async (tx) => {
    await tx.evaluatorObjection.deleteMany({ where: { tenderId: id, status: "OPEN" } });
    if (result.topObjections.length > 0) {
      await tx.evaluatorObjection.createMany({
        data: result.topObjections.map((objection) => ({
          tenderId: id,
          proposalVersion: currentProposalVersion,
          severity: objection.severity,
          category: inferObjectionCategory(objection.persona, objection.detail),
          title: objection.title.slice(0, 300),
          description: `[${objection.persona}] ${objection.detail}`.slice(0, 2000),
          status: "OPEN",
        })),
      });
    }
  });

  await prisma.tender.update({
    where: { id },
    data: { notes: [tender.notes?.trim(), `Evaluator committee: ${result.predictedOverallScore}/100 (${result.verdict}). ${result.topObjections.length} objection(s), ${result.actionPlan.length} action(s).`].filter(Boolean).join("\n") },
  });

  return NextResponse.json({ simulation: result });
}
