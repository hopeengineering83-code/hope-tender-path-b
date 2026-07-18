import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { rateLimitPersistent, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import {
  aiRematchExperts,
  aiRematchProjects,
  formatAssessmentRationale,
  type CandidateAssessment,
  type ExpertCandidateInput,
  type MatchAssessmentBatch,
  type MatchPerspective,
  type ProjectCandidateInput,
} from "../../../../../lib/engine/ai-multi-perspective-matcher";
import { exactSelectionLimit } from "../../../../../lib/engine/scope-policy";
import { logAction } from "../../../../../lib/audit";
import { childLogger, time, reportError } from "../../../../../lib/observability";
import { sanitizeError } from "../../../../../lib/sanitize-error";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const PRE_FILTER_LIMIT = 20;
const PORTFOLIO_ITERATIONS = 20;
const AI_SELECTION_THRESHOLD = 0.75;
const AI_CRITICAL_FLOOR_MINIMUM = 5;

type RequirementForLimit = {
  title: string;
  description: string;
  requirementType: string;
  priority: string;
  requiredQuantity?: number | null;
  exactFileName?: string | null;
  exactOrder?: number | null;
  restrictions?: string | null;
};

function safeParseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function selectionLimit(requirements: RequirementForLimit[], type: "EXPERT" | "PROJECT_EXPERIENCE", available: number): number {
  if (available <= 0) return 0;
  const exact = exactSelectionLimit(requirements, type);
  if (exact > 0) return Math.min(exact, available);
  const relevant = requirements.some((requirement) => requirement.requirementType === type);
  if (type === "EXPERT") return Math.min(available, relevant ? 6 : 4);
  return Math.min(available, relevant ? 5 : 3);
}

function perspectiveScore(assessment: CandidateAssessment, key: MatchPerspective): number {
  return (assessment.perspectives[key] ?? 5) / 10;
}

function criticalFloor(assessment: CandidateAssessment): number {
  return Math.min(
    assessment.perspectives.DISCIPLINE_FIT ?? 5,
    assessment.perspectives.SCOPE_COVERAGE ?? 5,
    assessment.perspectives.EVIDENCE_QUALITY ?? 5,
    assessment.perspectives.COMPLIANCE_CRITICALITY ?? 5,
    assessment.perspectives.MANDATORY_ELIGIBILITY ?? 5,
  );
}

function rankForCycle(assessment: CandidateAssessment, cycle: number): number {
  const weights: Array<Partial<Record<MatchPerspective, number>>> = [
    { DISCIPLINE_FIT: 0.22, SCOPE_COVERAGE: 0.18, MANDATORY_ELIGIBILITY: 0.15, COMPLIANCE_CRITICALITY: 0.12 },
    { SECTOR_FIT: 0.22, ROLE_RECENCY: 0.16, EVIDENCE_QUALITY: 0.18, DELIVERY_RISK: 0.12 },
    { SCOPE_COVERAGE: 0.22, PORTFOLIO_CONTRIBUTION: 0.18, DIFFERENTIATION: 0.14, DISCIPLINE_FIT: 0.12 },
    { EVIDENCE_QUALITY: 0.22, COMPLIANCE_CRITICALITY: 0.18, MANDATORY_ELIGIBILITY: 0.16, SENIORITY_OR_SCALE: 0.10 },
    { SENIORITY_OR_SCALE: 0.18, DELIVERY_RISK: 0.16, ROLE_RECENCY: 0.14, COMMERCIAL_VALUE: 0.10 },
  ];

  const activeWeights = weights[cycle % weights.length] ?? {};
  let score = assessment.overallScore * 0.48;
  for (const key of Object.keys(activeWeights) as MatchPerspective[]) {
    score += perspectiveScore(assessment, key) * (activeWeights[key] ?? 0);
  }

  const floor = criticalFloor(assessment);
  if (floor < 3) score -= 0.18;
  else if (floor < 4) score -= 0.10;
  else if (floor < 5) score -= 0.04;
  if (assessment.recommendSelection) score += 0.03;
  return score;
}

function setScore(selected: CandidateAssessment[]): number {
  if (selected.length === 0) return 0;
  const averageScore = selected.reduce((sum, assessment) => sum + assessment.overallScore, 0) / selected.length;
  const perspectives = Object.keys(selected[0]?.perspectives ?? {}) as MatchPerspective[];
  const coverageScore = perspectives.reduce(
    (sum, key) => sum + Math.max(...selected.map((assessment) => perspectiveScore(assessment, key))),
    0,
  ) / Math.max(perspectives.length, 1);
  const floorAverage = selected.reduce((sum, assessment) => sum + criticalFloor(assessment), 0) / selected.length / 10;
  const weakPenalty = selected.filter((assessment) => criticalFloor(assessment) < 4).length * 0.05;
  return averageScore * 0.50 + coverageScore * 0.30 + floorAverage * 0.20 - weakPenalty;
}

function isSelectionEligible(assessment: CandidateAssessment): boolean {
  return assessment.overallScore >= AI_SELECTION_THRESHOLD && criticalFloor(assessment) >= AI_CRITICAL_FLOOR_MINIMUM && assessment.recommendSelection === true;
}

function selectBestAvailable(assessments: CandidateAssessment[], limit: number): Set<string> {
  const eligibleAssessments = assessments.filter(isSelectionEligible);
  if (limit <= 0 || eligibleAssessments.length === 0) return new Set();

  let bestSelection: CandidateAssessment[] = [];
  let bestScore = -Infinity;
  for (let cycle = 0; cycle < PORTFOLIO_ITERATIONS; cycle += 1) {
    const selected = [...eligibleAssessments]
      .sort((a, b) => rankForCycle(b, cycle) - rankForCycle(a, cycle))
      .slice(0, limit);
    const score = setScore(selected);
    if (score > bestScore) {
      bestScore = score;
      bestSelection = selected;
    }
  }

  return new Set(bestSelection.map((assessment) => assessment.candidateId));
}

function withAppliedSelection(assessment: CandidateAssessment, selectedIds: Set<string>): CandidateAssessment {
  return { ...assessment, recommendSelection: selectedIds.has(assessment.candidateId) };
}

function appendRematchNote(existingNotes: string | null, selectedExpertCount: number, selectedProjectCount: number): string {
  const note = `AI Multi-Perspective Rematch applied to main engine match records. ${selectedExpertCount} expert(s) and ${selectedProjectCount} project reference(s) selected after ${PORTFOLIO_ITERATIONS} threshold-gated portfolio passes using 12-perspective scoring and critical-floor risk control. Compliance review should be refreshed/confirmed before final export.`;
  if (!existingNotes?.trim()) return note;
  if (existingNotes.includes("AI Multi-Perspective Rematch applied to main engine match records")) return existingNotes;
  return `${existingNotes.trim()}\n${note}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  const rl = await rateLimitPersistent(`rematch:${actor.id}`, AI_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Rate limit exceeded — too many rematch requests. Please wait a minute and retry.", code: "RATE_LIMITED", resetAt: rl.resetAt, retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const { id: tenderId } = await params;
  const body = await req.json().catch(() => ({} as { applySelections?: boolean }));
  const applySelections = body.applySelections === true;

  await prismaReady;
  const log = childLogger({ tenderId, userId: actor.id, route: "/api/tenders/[id]/ai-rematch" });
  log.info("ai_rematch_started", { applySelections, poolLimit: PRE_FILTER_LIMIT, iterations: PORTFOLIO_ITERATIONS, perspectives: 12 });

  const tender = await prisma.tender.findFirst({
    where: actor.role === "ADMIN" ? { id: tenderId } : { id: tenderId, userId: actor.id },
    include: {
      requirements: {
        select: {
          id: true,
          title: true,
          description: true,
          requirementType: true,
          priority: true,
          requiredQuantity: true,
          exactFileName: true,
          exactOrder: true,
          restrictions: true,
        },
      },
      expertMatches: {
        orderBy: { score: "desc" },
        take: PRE_FILTER_LIMIT,
        include: {
          expert: {
            select: {
              id: true,
              fullName: true,
              title: true,
              yearsExperience: true,
              disciplines: true,
              sectors: true,
              certifications: true,
              profile: true,
              trustLevel: true,
            },
          },
        },
      },
      projectMatches: {
        orderBy: { score: "desc" },
        take: PRE_FILTER_LIMIT,
        include: {
          project: {
            select: {
              id: true,
              name: true,
              clientName: true,
              country: true,
              sector: true,
              serviceAreas: true,
              summary: true,
              contractValue: true,
              currency: true,
              startDate: true,
              endDate: true,
              trustLevel: true,
            },
          },
        },
      },
    },
  });

  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  if (tender.expertMatches.length === 0 && tender.projectMatches.length === 0) {
    return NextResponse.json({ error: "No matches to rematch. Run the tender engine first to produce initial matches.", code: "NO_MATCHES" }, { status: 400 });
  }

  const expertCandidates: ExpertCandidateInput[] = tender.expertMatches.map((match) => ({
    id: match.expert.id,
    fullName: match.expert.fullName,
    title: match.expert.title,
    yearsExperience: match.expert.yearsExperience,
    disciplines: safeParseJsonArray(match.expert.disciplines),
    sectors: safeParseJsonArray(match.expert.sectors),
    certifications: safeParseJsonArray(match.expert.certifications),
    profile: match.expert.profile,
    trustLevel: match.expert.trustLevel,
  }));

  const projectCandidates: ProjectCandidateInput[] = tender.projectMatches.map((match) => ({
    id: match.project.id,
    name: match.project.name,
    clientName: match.project.clientName,
    country: match.project.country,
    sector: match.project.sector,
    serviceAreas: safeParseJsonArray(match.project.serviceAreas),
    summary: match.project.summary,
    contractValue: match.project.contractValue,
    currency: match.project.currency,
    startDate: match.project.startDate,
    endDate: match.project.endDate,
    trustLevel: match.project.trustLevel,
  }));

  const tenderRequirementsText = tender.requirements
    .map((requirement) => `[${requirement.priority}] ${requirement.requirementType}: ${requirement.title}: ${requirement.description}`)
    .join("\n");

  let expertBatch: MatchAssessmentBatch | null = null;
  let projectBatch: MatchAssessmentBatch | null = null;
  try {
    [expertBatch, projectBatch] = await time("ai-rematch.parallel_calls", () => Promise.all([
      expertCandidates.length > 0
        ? aiRematchExperts({ tenderTitle: tender.title, tenderRequirementsText, evaluationMethodology: tender.evaluationMethodology ?? "", candidates: expertCandidates })
        : Promise.resolve(null),
      projectCandidates.length > 0
        ? aiRematchProjects({ tenderTitle: tender.title, tenderRequirementsText, tenderCategory: tender.category, candidates: projectCandidates })
        : Promise.resolve(null),
    ]), { tenderId });
  } catch (err) {
    void reportError(err, { tenderId, route: "/api/tenders/[id]/ai-rematch" });
    log.error("ai_rematch_failed", { error: sanitizeError(err) });
    return NextResponse.json({ error: "AI rematch failed. Retry after checking provider availability.", code: "AI_REMATCH_FAILED" }, { status: 502 });
  }

  if (!expertBatch && !projectBatch) {
    return NextResponse.json(
      {
        error: "AI rematch scoring unavailable. No fallback selections were applied; keep existing reviewed selections or retry after provider recovery.",
        code: "AI_REMATCH_UNAVAILABLE_NO_SELECTION",
        applySelections,
      },
      { status: applySelections ? 409 : 503 },
    );
  }

  const aiSelectedExpertIds = expertBatch
    ? selectBestAvailable(expertBatch.assessments, selectionLimit(tender.requirements, "EXPERT", expertBatch.assessments.length))
    : new Set<string>();
  const aiSelectedProjectIds = projectBatch
    ? selectBestAvailable(projectBatch.assessments, selectionLimit(tender.requirements, "PROJECT_EXPERIENCE", projectBatch.assessments.length))
    : new Set<string>();

  // PR RR — UNION selection semantics. The pre-fix behaviour was:
  // "applySelections=true" cleared ALL existing isSelected to false then
  // set true only for AI-recommended candidates. Bug: if a user had
  // manually selected 8 experts but the AI batch returned only 5
  // usable assessments (or zero — the "no usable assessments" case
  // shown in production), the user's other selections were silently
  // wiped.
  //
  // New behaviour: AI selections AUGMENT the user's existing manual
  // selections — they never replace them. Manual selections always
  // persist; AI recommendations are added on top so the bid team can
  // see both their picks and the AI's picks.
  //
  // Fail-closed rematch semantics: existing manual selections are preserved,
  // but new AI-selected rows must pass the threshold/critical-floor gate above.
  const userSelectedExpertIds = new Set(
    tender.expertMatches.filter((m) => m.isSelected).map((m) => m.expert.id)
  );
  const userSelectedProjectIds = new Set(
    tender.projectMatches.filter((m) => m.isSelected).map((m) => m.project.id)
  );
  const selectedExpertIds = new Set<string>([...userSelectedExpertIds, ...aiSelectedExpertIds]);
  const selectedProjectIds = new Set<string>([...userSelectedProjectIds, ...aiSelectedProjectIds]);

  // applySelections=true means PERSIST the union back to the DB so the
  // main engine picks them up. We do NOT clear anything first — the
  // updateMany.set-isSelected-false call from the pre-fix version is
  // gone. Each match record we touch below sets isSelected to its
  // membership in the union; matches we DON'T touch keep their
  // existing state.

  const expertBatchForResponse = expertBatch
    ? { ...expertBatch, assessments: expertBatch.assessments.map((assessment) => withAppliedSelection(assessment, selectedExpertIds)) }
    : null;
  const projectBatchForResponse = projectBatch
    ? { ...projectBatch, assessments: projectBatch.assessments.map((assessment) => withAppliedSelection(assessment, selectedProjectIds)) }
    : null;

  // PR XX-G3 — write per-dimension scores into MatchScoreBreakdown so
  // readiness, bid/no-bid, evaluator simulator, and proposal generator
  // can consume identical 12-dimension scoring objects. The scalar
  // overallScore is still written to TenderExpertMatch.score for
  // backward-compatible UI ranking.
  const { writeScoreBreakdown } = await import("../../../../../lib/engine/score-breakdown-writer");

  let expertsUpdated = 0;
  if (expertBatchForResponse) {
    for (const assessment of expertBatchForResponse.assessments) {
      const match = tender.expertMatches.find((candidate) => candidate.expert.id === assessment.candidateId);
      if (!match) continue;
      await prisma.tenderExpertMatch.update({
        where: { id: match.id },
        data: {
          score: assessment.overallScore,
          rationale: formatAssessmentRationale(assessment),
          ...(applySelections ? { isSelected: selectedExpertIds.has(assessment.candidateId) } : {}),
        },
      });
      // Persist per-dimension scores. AI scoring uses 0–10; writer expects
      // 0–100, so multiply by 10.
      const perspectives100 = Object.fromEntries(
        Object.entries(assessment.perspectives).map(([k, v]) => [k, Number(v) * 10])
      ) as Partial<Record<MatchPerspective, number>>;
      await writeScoreBreakdown({
        tenderId,
        entityType: "EXPERT",
        entityId: assessment.candidateId,
        perspectives: perspectives100,
        rationales: { DISCIPLINE_FIT: assessment.strength?.slice(0, 400), DELIVERY_RISK: assessment.concern?.slice(0, 400) },
        source: "AI_REMATCH",
      });
      expertsUpdated += 1;
    }
  }

  let projectsUpdated = 0;
  if (projectBatchForResponse) {
    for (const assessment of projectBatchForResponse.assessments) {
      const match = tender.projectMatches.find((candidate) => candidate.project.id === assessment.candidateId);
      if (!match) continue;
      await prisma.tenderProjectMatch.update({
        where: { id: match.id },
        data: {
          score: assessment.overallScore,
          rationale: formatAssessmentRationale(assessment),
          ...(applySelections ? { isSelected: selectedProjectIds.has(assessment.candidateId) } : {}),
        },
      });
      const perspectives100 = Object.fromEntries(
        Object.entries(assessment.perspectives).map(([k, v]) => [k, Number(v) * 10])
      ) as Partial<Record<MatchPerspective, number>>;
      await writeScoreBreakdown({
        tenderId,
        entityType: "PROJECT",
        entityId: assessment.candidateId,
        perspectives: perspectives100,
        rationales: { DISCIPLINE_FIT: assessment.strength?.slice(0, 400), DELIVERY_RISK: assessment.concern?.slice(0, 400) },
        source: "AI_REMATCH",
      });
      projectsUpdated += 1;
    }
  }

  if (applySelections) {
    await prisma.tender.update({
      where: { id: tenderId },
      data: {
        status: "COMPLIANCE_REVIEW",
        stage: "COMPLIANCE",
        notes: appendRematchNote(tender.notes, selectedExpertIds.size, selectedProjectIds.size),
      },
    });
  }

  await logAction({
    userId: actor.id,
    action: "AI_REMATCH_RUN",
    entityType: "Tender",
    entityId: tenderId,
    description: `${actor.email} ran 12-perspective AI rematch on "${tender.title}" — ${expertsUpdated} expert(s), ${projectsUpdated} project(s), selected ${selectedExpertIds.size} expert(s) and ${selectedProjectIds.size} project(s)${applySelections ? "; applied to main engine" : ""}`,
    metadata: {
      tenderId,
      expertsUpdated,
      projectsUpdated,
      applySelections,
      selectedExpertCount: selectedExpertIds.size,
      selectedProjectCount: selectedProjectIds.size,
      iterations: PORTFOLIO_ITERATIONS,
      perspectives: 12,
      criticalFloorControl: true,
      complianceStatePreserved: true,
    },
  });

  log.info("ai_rematch_done", { expertsUpdated, projectsUpdated, applySelections, selectedExpertCount: selectedExpertIds.size, selectedProjectCount: selectedProjectIds.size, perspectives: 12 });

  return NextResponse.json({
    success: true,
    expertsUpdated,
    projectsUpdated,
    applySelections,
    selectedExpertCount: selectedExpertIds.size,
    selectedProjectCount: selectedProjectIds.size,
    iterations: PORTFOLIO_ITERATIONS,
    perspectives: 12,
    criticalFloorControl: true,
    complianceStatePreserved: true,
    expertBatch: expertBatchForResponse,
    projectBatch: projectBatchForResponse,
  });
}
