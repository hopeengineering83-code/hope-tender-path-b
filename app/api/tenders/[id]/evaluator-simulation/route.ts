import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { rateLimit, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { simulateEvaluatorPanel } from "../../../../../lib/engine/evaluator-simulator";
import { scoreProposalQuality } from "../../../../../lib/engine/proposal-quality-scorer";
import { logAction } from "../../../../../lib/audit";
import { isDeepReasoningEnabled } from "../../../../../lib/engine/feature-flags";
import { extractDeepTenderComprehension } from "../../../../../lib/engine/evaluation-criteria-extractor";

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
  const canSimulate = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role);
  if (!canSimulate) return forbiddenResponse();

  const rl = rateLimit(`eval-sim:${actor.id}`, AI_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please wait before running the simulation again.", code: "RATE_LIMITED", resetAt: rl.resetAt }, { status: 429 });

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

  // Run quality scorer on proposal text to surface weak axes for evaluators.
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

  // Deep-comprehension cross-persona calibration (TENDER_DEEP_REASONING).
  // When the flag is ON, extract evaluation criteria from the tender
  // (or use already-stored evaluationMethodology as input) and pass
  // them as `sharedCriteria` so every persona scores against the
  // same canonical criterion names. This is what enables the spread
  // detection in computeCalibrationNotes — without shared criteria
  // each persona invents its own names and calibration can't join
  // them. No-ops silently when AI is unavailable.
  let sharedCriteria: Array<{ id: string; criterion: string; weight: number | null }> | undefined;
  if (isDeepReasoningEnabled()) {
    try {
      const tenderTextForExtraction = [
        tender.intakeSummary ?? "",
        tender.analysisSummary ?? "",
        tender.evaluationMethodology ?? "",
        tender.description ?? "",
      ].filter(Boolean).join("\n\n");
      const comprehension = await extractDeepTenderComprehension(tenderTextForExtraction);
      if (comprehension && comprehension.criteria.length > 0) {
        sharedCriteria = comprehension.criteria.map((c) => ({
          id: c.id,
          criterion: c.criterion,
          weight: c.weight,
        }));
        console.info(`[evaluator-simulation:route] Deep-reasoning ON — passing ${sharedCriteria.length} shared criteria to the panel for cross-persona calibration.`);
      }
    } catch (err) {
      console.warn(`[evaluator-simulation:route] Deep-reasoning comprehension threw (non-critical): ${err instanceof Error ? err.message : String(err)}`);
    }
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
    readinessSummary: [
      `Tender readiness=${Math.round(tender.readinessScore ?? 0)}/100; open gaps=${tender.complianceGaps.length}; selected experts=${tender.expertMatches.length}; selected projects=${tender.projectMatches.length}; documents=${tender.generatedDocuments.length}`,
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

  // Persist evaluator objections so the EvaluatorObjectionsPanel can display
  // and resolve them. Wrapped in a transaction so a concurrent re-run can't
  // leave the table in a partially-cleared state. RESOLVED and WAIVED
  // objections are preserved across re-runs.
  await prisma.$transaction(async (tx) => {
    await tx.evaluatorObjection.deleteMany({ where: { tenderId: id, status: "OPEN" } });
    if (result.topObjections.length > 0) {
      await tx.evaluatorObjection.createMany({
        data: result.topObjections.map((o) => ({
          tenderId: id,
          severity: o.severity,
          category: inferObjectionCategory(o.persona, o.detail),
          title: o.title.slice(0, 300),
          description: `[${o.persona}] ${o.detail}`.slice(0, 2000),
          status: "OPEN",
        })),
      });
    }
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
