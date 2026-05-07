import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import {
  aiRematchExperts,
  aiRematchProjects,
  formatAssessmentRationale,
  type CandidateAssessment,
  type ExpertCandidateInput,
  type MatchPerspective,
  type ProjectCandidateInput,
} from "../../../../../lib/engine/ai-multi-perspective-matcher";
import { buildCompliance } from "../../../../../lib/engine/compliance";
import { exactSelectionLimit } from "../../../../../lib/engine/scope-policy";
import { logAction } from "../../../../../lib/audit";
import { childLogger, time, reportError } from "../../../../../lib/observability";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Widen the pool so the AI can rescue non-obvious candidates that lexical
// matching placed below the first page. The UI still shows the assessed set.
const PRE_FILTER_LIMIT = 30;
const PORTFOLIO_ITERATIONS = 20;

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

function chunks<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function selectionLimit(requirements: RequirementForLimit[], type: "EXPERT" | "PROJECT_EXPERIENCE", available: number): number {
  if (available <= 0) return 0;
  const exact = exactSelectionLimit(requirements, type);
  if (exact > 0) return Math.min(exact, available);
  const relevant = requirements.some((r) => r.requirementType === type);
  if (type === "EXPERT") return Math.min(available, relevant ? 6 : 4);
  return Math.min(available, relevant ? 5 : 3);
}

function perspectiveScore(a: CandidateAssessment, key: MatchPerspective): number {
  return (a.perspectives[key] ?? 5) / 10;
}

function rankForCycle(a: CandidateAssessment, cycle: number): number {
  const weights: Array<Partial<Record<MatchPerspective, number>>> = [
    { DISCIPLINE_FIT: 0.24, SCOPE_COVERAGE: 0.18, SECTOR_FIT: 0.18, COMPLIANCE_CRITICALITY: 0.14 },
    { SECTOR_FIT: 0.28, ROLE_RECENCY: 0.18, EVIDENCE_QUALITY: 0.16 },
    { SCOPE_COVERAGE: 0.25, PORTFOLIO_CONTRIBUTION: 0.20, DISCIPLINE_FIT: 0.16 },
    { EVIDENCE_QUALITY: 0.24, COMPLIANCE_CRITICALITY: 0.20, SENIORITY_OR_SCALE: 0.16 },
    { SENIORITY_OR_SCALE: 0.23, ROLE_RECENCY: 0.20, DISCIPLINE_FIT: 0.16 },
  ];
  const w = weights[cycle % weights.length];
  let score = a.overallScore * 0.55;
  for (const key of Object.keys(w) as MatchPerspective[]) score += perspectiveScore(a, key) * (w[key] ?? 0);
  const min = Math.min(...Object.values(a.perspectives));
  if (min < 3) score -= 0.08;
  if (a.recommendSelection) score += 0.04;
  return score;
}

function setScore(set: CandidateAssessment[]): number {
  if (set.length === 0) return 0;
  const avg = set.reduce((s, a) => s + a.overallScore, 0) / set.length;
  const perspectives = Object.keys(set[0].perspectives) as MatchPerspective[];
  const coverage = perspectives.reduce((sum, key) => sum + Math.max(...set.map((a) => perspectiveScore(a, key))), 0) / perspectives.length;
  const weakPenalty = set.filter((a) => Math.min(...Object.values(a.perspectives)) < 3).length * 0.03;
  return avg * 0.62 + coverage * 0.38 - weakPenalty;
}

function selectBestAvailable(assessments: CandidateAssessment[], limit: number): Set<string> {
  if (limit <= 0 || assessments.length === 0) return new Set();
  let best: CandidateAssessment[] = [];
  let bestScore = -Infinity;
  for (let cycle = 0; cycle < PORTFOLIO_ITERATIONS; cycle += 1) {
    const ranked = [...assessments].sort((a, b) => rankForCycle(b, cycle) - rankForCycle(a, cycle));
    const picked: CandidateAssessment[] = [];
    for (const candidate of ranked) {
      if (picked.length >= limit) break;
      picked.push(candidate);
    }
    const score = setScore(picked);
    if (score > bestScore) {
      bestScore = score;
      best = picked;
    }
  }
  return new Set(best.map((a) => a.candidateId));
}

async function rebuildComplianceFromCurrentSelections(tenderId: string, userId: string, requirements: any[]) {
  const company = await prisma.company.findUnique({
    where: { userId },
    include: {
      experts: true,
      projects: true,
      documents: { select: { id: true, category: true, originalFileName: true, extractedText: true } },
      legalRecords: true,
      financialRecords: true,
      complianceRecords: true,
    },
  });
  if (!company) return { readinessScore: 0, gapCount: 0 };

  const [expertMatches, projectMatches] = await Promise.all([
    prisma.tenderExpertMatch.findMany({ where: { tenderId }, orderBy: { score: "desc" } }),
    prisma.tenderProjectMatch.findMany({ where: { tenderId }, orderBy: { score: "desc" } }),
  ]);

  const compliance = buildCompliance(
    requirements.map((r) => ({ id: r.id, requirement: r })),
    {
      companyId: company.id,
      experts: company.experts,
      projects: company.projects,
      documents: company.documents,
      legalRecords: company.legalRecords,
      financialRecords: company.financialRecords,
      complianceRecords: company.complianceRecords,
    },
    {
      expertMatches: expertMatches.map((m) => ({ expertId: m.expertId, score: m.score, rationale: m.rationale ?? "", evidenceSummary: m.rationale ?? "", isSelected: m.isSelected })),
      projectMatches: projectMatches.map((m) => ({ projectId: m.projectId, score: m.score, rationale: m.rationale ?? "", evidenceSummary: m.rationale ?? "", isSelected: m.isSelected })),
    },
  );

  await prisma.complianceMatrix.deleteMany({ where: { tenderId } });
  await prisma.complianceGap.deleteMany({ where: { tenderId } });

  const matrixRows = compliance.matrices.map((matrix) => ({
    tenderId,
    requirementId: matrix.requirementId,
    evidenceType: matrix.evidenceType,
    evidenceSource: matrix.evidenceSource,
    evidenceReference: matrix.evidenceReference ?? null,
    supportLevel: matrix.supportStatus,
    notes: [matrix.evidenceSummary, matrix.notes].filter(Boolean).join(" | ") || null,
  }));
  for (const batch of chunks(matrixRows, 100)) await prisma.complianceMatrix.createMany({ data: batch });

  const gapRows = compliance.gaps.map((gap) => ({
    tenderId,
    requirementId: gap.requirementId ?? null,
    severity: gap.severity,
    title: gap.title,
    description: gap.description,
    mitigationPlan: gap.mitigationPlan ?? null,
  }));
  for (const batch of chunks(gapRows, 100)) await prisma.complianceGap.createMany({ data: batch });

  const supported = compliance.matrices.filter((m) => ["SUPPORTED", "EVIDENCE_PENDING_REVIEW", "PARTIAL"].includes(m.supportStatus)).length;
  const readinessScore = Math.max(0, Math.min(100, Math.round((supported / Math.max(compliance.matrices.length, 1)) * 100)));
  await prisma.tender.update({
    where: { id: tenderId },
    data: {
      readinessScore,
      status: gapRows.some((g) => g.severity === "CRITICAL" || g.severity === "HIGH") ? "COMPLIANCE_REVIEW" : "MATCHED",
      stage: "MATCHING",
      notes: { set: `AI Multi-Perspective Rematch applied to main engine records. Best-available selection used ${PORTFOLIO_ITERATIONS} portfolio iterations and can select candidates below 90% when they are the strongest available fit.` },
    },
  });
  return { readinessScore, gapCount: gapRows.length };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  const { id: tenderId } = await params;
  const body = await req.json().catch(() => ({} as { applySelections?: boolean }));
  const applySelections = body.applySelections === true;

  await prismaReady;
  const log = childLogger({ tenderId, userId: actor.id, route: "/api/tenders/[id]/ai-rematch" });
  log.info("ai_rematch_started", { applySelections, poolLimit: PRE_FILTER_LIMIT, iterations: PORTFOLIO_ITERATIONS });

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    include: {
      requirements: { select: { id: true, title: true, description: true, requirementType: true, priority: true, requiredQuantity: true, exactFileName: true, exactOrder: true, restrictions: true } },
      expertMatches: {
        orderBy: { score: "desc" },
        take: PRE_FILTER_LIMIT,
        include: { expert: { select: { id: true, fullName: true, title: true, yearsExperience: true, disciplines: true, sectors: true, certifications: true, profile: true, trustLevel: true } } },
      },
      projectMatches: {
        orderBy: { score: "desc" },
        take: PRE_FILTER_LIMIT,
        include: { project: { select: { id: true, name: true, clientName: true, country: true, sector: true, serviceAreas: true, summary: true, contractValue: true, currency: true, startDate: true, endDate: true, trustLevel: true } } },
      },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  if (tender.expertMatches.length === 0 && tender.projectMatches.length === 0) {
    return NextResponse.json({ error: "No matches to rematch. Run the tender engine first to produce initial matches.", code: "NO_MATCHES" }, { status: 400 });
  }

  const expertCandidates: ExpertCandidateInput[] = tender.expertMatches.map((m) => ({
    id: m.expert.id,
    fullName: m.expert.fullName,
    title: m.expert.title,
    yearsExperience: m.expert.yearsExperience,
    disciplines: safeParseJsonArray(m.expert.disciplines),
    sectors: safeParseJsonArray(m.expert.sectors),
    certifications: safeParseJsonArray(m.expert.certifications),
    profile: m.expert.profile,
    trustLevel: m.expert.trustLevel,
  }));
  const projectCandidates: ProjectCandidateInput[] = tender.projectMatches.map((m) => ({
    id: m.project.id,
    name: m.project.name,
    clientName: m.project.clientName,
    country: m.project.country,
    sector: m.project.sector,
    serviceAreas: safeParseJsonArray(m.project.serviceAreas),
    summary: m.project.summary,
    contractValue: m.project.contractValue,
    currency: m.project.currency,
    startDate: m.project.startDate,
    endDate: m.project.endDate,
    trustLevel: m.project.trustLevel,
  }));

  const tenderRequirementsText = tender.requirements.map((r) => `[${r.priority}] ${r.requirementType}: ${r.title}: ${r.description}`).join("\n");

  let expertBatch, projectBatch;
  try {
    [expertBatch, projectBatch] = await time("ai-rematch.parallel_calls", () => Promise.all([
      expertCandidates.length > 0 ? aiRematchExperts({ tenderTitle: tender.title, tenderRequirementsText, evaluationMethodology: tender.evaluationMethodology ?? "", candidates: expertCandidates }) : Promise.resolve(null),
      projectCandidates.length > 0 ? aiRematchProjects({ tenderTitle: tender.title, tenderRequirementsText, tenderCategory: tender.category, candidates: projectCandidates }) : Promise.resolve(null),
    ]), { tenderId });
  } catch (err) {
    void reportError(err, { tenderId, route: "/api/tenders/[id]/ai-rematch" });
    return NextResponse.json({ error: err instanceof Error ? err.message : "AI rematch failed", code: "AI_REMATCH_FAILED" }, { status: 502 });
  }
  if (!expertBatch && !projectBatch) return NextResponse.json({ error: "AI rematch returned no usable assessments.", code: "NO_ASSESSMENTS" }, { status: 502 });

  const expertLimit = selectionLimit(tender.requirements, "EXPERT", expertBatch?.assessments.length ?? 0);
  const projectLimit = selectionLimit(tender.requirements, "PROJECT_EXPERIENCE", projectBatch?.assessments.length ?? 0);
  const selectedExpertIds = expertBatch ? selectBestAvailable(expertBatch.assessments, expertLimit) : new Set<string>();
  const selectedProjectIds = projectBatch ? selectBestAvailable(projectBatch.assessments, projectLimit) : new Set<string>();

  if (applySelections) {
    await Promise.all([
      prisma.tenderExpertMatch.updateMany({ where: { tenderId }, data: { isSelected: false } }),
      prisma.tenderProjectMatch.updateMany({ where: { tenderId }, data: { isSelected: false } }),
    ]);
  }

  let expertsUpdated = 0;
  let projectsUpdated = 0;
  if (expertBatch) {
    for (const raw of expertBatch.assessments) {
      const a = { ...raw, recommendSelection: selectedExpertIds.has(raw.candidateId) };
      const match = tender.expertMatches.find((m) => m.expert.id === a.candidateId);
      if (!match) continue;
      await prisma.tenderExpertMatch.update({ where: { id: match.id }, data: { score: a.overallScore, rationale: formatAssessmentRationale(a), ...(applySelections ? { isSelected: selectedExpertIds.has(a.candidateId) } : {}) } });
      expertsUpdated += 1;
    }
  }
  if (projectBatch) {
    for (const raw of projectBatch.assessments) {
      const a = { ...raw, recommendSelection: selectedProjectIds.has(raw.candidateId) };
      const match = tender.projectMatches.find((m) => m.project.id === a.candidateId);
      if (!match) continue;
      await prisma.tenderProjectMatch.update({ where: { id: match.id }, data: { score: a.overallScore, rationale: formatAssessmentRationale(a), ...(applySelections ? { isSelected: selectedProjectIds.has(a.candidateId) } : {}) } });
      projectsUpdated += 1;
    }
  }

  let complianceRefresh: { readinessScore: number; gapCount: number } | null = null;
  if (applySelections) complianceRefresh = await rebuildComplianceFromCurrentSelections(tenderId, actor.id, tender.requirements);

  await logAction({
    userId: actor.id,
    action: "AI_REMATCH_RUN",
    entityType: "Tender",
    entityId: tenderId,
    description: `${actor.email} ran strengthened AI rematch on "${tender.title}" — ${expertsUpdated} expert(s), ${projectsUpdated} project(s), selected ${selectedExpertIds.size} expert(s) and ${selectedProjectIds.size} project(s)${applySelections ? "; applied to main engine" : ""}`,
    metadata: { tenderId, expertsUpdated, projectsUpdated, applySelections, selectedExpertCount: selectedExpertIds.size, selectedProjectCount: selectedProjectIds.size, iterations: PORTFOLIO_ITERATIONS, complianceRefresh },
  });

  log.info("ai_rematch_done", { expertsUpdated, projectsUpdated, applySelections, selectedExpertCount: selectedExpertIds.size, selectedProjectCount: selectedProjectIds.size });
  return NextResponse.json({ success: true, expertsUpdated, projectsUpdated, applySelections, selectedExpertCount: selectedExpertIds.size, selectedProjectCount: selectedProjectIds.size, iterations: PORTFOLIO_ITERATIONS, complianceRefresh, expertBatch, projectBatch });
}
