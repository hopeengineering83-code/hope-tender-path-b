import type { CompanyKnowledgeSnapshot, MatchingResult, RequirementDraft } from "./types";
import {
  aiRematchExperts,
  aiRematchProjects,
  formatAssessmentRationale,
  PERSPECTIVE_KEYS,
  type CandidateAssessment,
  type ExpertCandidateInput,
  type MatchPerspective,
  type ProjectCandidateInput,
} from "./ai-multi-perspective-matcher";
import { exactSelectionLimit } from "./scope-policy";

// One bounded provider batch per category. Expert and project batches execute
// in parallel, keeping optional AI reranking inside Vercel's function budget.
const PRE_FILTER_LIMIT = 20;
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

export type MainEngineAIRematchResult = {
  matching: MatchingResult;
  aiApplied: boolean;
  expertAssessments: number;
  projectAssessments: number;
  selectedExpertCount: number;
  selectedProjectCount: number;
  warning: string | null;
  expertScoreBreakdowns: Record<string, Partial<Record<MatchPerspective, number>>>;
  projectScoreBreakdowns: Record<string, Partial<Record<MatchPerspective, number>>>;
};

function emptyResult(matching: MatchingResult, warning: string): MainEngineAIRematchResult {
  return {
    matching,
    aiApplied: false,
    expertAssessments: 0,
    projectAssessments: 0,
    selectedExpertCount: matching.expertMatches.filter((match) => match.isSelected).length,
    selectedProjectCount: matching.projectMatches.filter((match) => match.isSelected).length,
    warning,
    expertScoreBreakdowns: {},
    projectScoreBreakdowns: {},
  };
}

function safeParseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function requirementForLimit(requirements: RequirementDraft[]): RequirementForLimit[] {
  return requirements.map((requirement) => ({
    title: requirement.title,
    description: requirement.description,
    requirementType: requirement.requirementType,
    priority: requirement.priority,
    requiredQuantity: requirement.requiredQuantity,
    exactFileName: requirement.exactFileName,
    exactOrder: requirement.exactOrder,
    restrictions: requirement.restrictions,
  }));
}

function selectionLimit(requirements: RequirementDraft[], type: "EXPERT" | "PROJECT_EXPERIENCE", available: number): number {
  if (available <= 0) return 0;
  const exact = exactSelectionLimit(requirementForLimit(requirements), type);
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
  const coverageScore = PERSPECTIVE_KEYS.reduce(
    (sum, key) => sum + Math.max(...selected.map((assessment) => perspectiveScore(assessment, key))),
    0,
  ) / PERSPECTIVE_KEYS.length;
  const floorAverage = selected.reduce((sum, assessment) => sum + criticalFloor(assessment), 0) / selected.length / 10;
  const weakPenalty = selected.filter((assessment) => criticalFloor(assessment) < 4).length * 0.05;
  return averageScore * 0.50 + coverageScore * 0.30 + floorAverage * 0.20 - weakPenalty;
}

function selectBestAvailable(assessments: CandidateAssessment[], limit: number): Set<string> {
  if (limit <= 0 || assessments.length === 0) return new Set();
  let bestSelection: CandidateAssessment[] = [];
  let bestScore = -Infinity;
  for (let cycle = 0; cycle < PORTFOLIO_ITERATIONS; cycle += 1) {
    const selected = [...assessments]
      .sort((left, right) => rankForCycle(right, cycle) - rankForCycle(left, cycle))
      .slice(0, limit);
    const score = setScore(selected);
    if (score > bestScore) {
      bestScore = score;
      bestSelection = selected;
    }
  }
  return new Set(bestSelection.map((assessment) => assessment.candidateId));
}

function tenderRequirementsText(requirements: RequirementDraft[]): string {
  return requirements
    .map((requirement) => `[${requirement.priority}] ${requirement.requirementType}: ${requirement.title}: ${requirement.description}`)
    .join("\n");
}

function toScoreBreakdown(assessment: CandidateAssessment): Partial<Record<MatchPerspective, number>> {
  return Object.fromEntries(
    PERSPECTIVE_KEYS.map((key) => [
      key,
      Math.round(Math.max(0, Math.min(10, assessment.perspectives[key] ?? 0)) * 10),
    ]),
  ) as Partial<Record<MatchPerspective, number>>;
}

export async function applyAIRematchToMainEngine(params: {
  tenderTitle: string;
  tenderCategory?: string | null;
  evaluationMethodology?: string | null;
  requirements: RequirementDraft[];
  matching: MatchingResult;
  knowledge: CompanyKnowledgeSnapshot;
}): Promise<MainEngineAIRematchResult> {
  const expertMatches = [...params.matching.expertMatches]
    .sort((a, b) => b.score - a.score).slice(0, PRE_FILTER_LIMIT);
  const projectMatches = [...params.matching.projectMatches]
    .sort((a, b) => b.score - a.score).slice(0, PRE_FILTER_LIMIT);

  if (expertMatches.length === 0 && projectMatches.length === 0) {
    return emptyResult(params.matching, "No deterministic matches available for main-engine AI rematch.");
  }

  const expertsById = new Map(params.knowledge.experts.map((expert) => [expert.id, expert]));
  const projectsById = new Map(params.knowledge.projects.map((project) => [project.id, project]));

  const expertCandidates: ExpertCandidateInput[] = expertMatches.flatMap((match) => {
    const expert = expertsById.get(match.expertId);
    if (!expert) return [];
    return [{
      id: expert.id,
      fullName: expert.fullName,
      title: expert.title,
      yearsExperience: expert.yearsExperience,
      disciplines: safeParseJsonArray(expert.disciplines),
      sectors: safeParseJsonArray(expert.sectors),
      certifications: safeParseJsonArray(expert.certifications),
      profile: expert.profile,
      trustLevel: expert.trustLevel,
    }];
  });

  const projectCandidates: ProjectCandidateInput[] = projectMatches.flatMap((match) => {
    const project = projectsById.get(match.projectId);
    if (!project) return [];
    return [{
      id: project.id,
      name: project.name,
      clientName: project.clientName,
      country: project.country,
      sector: project.sector,
      serviceAreas: safeParseJsonArray(project.serviceAreas),
      summary: project.summary,
      contractValue: project.contractValue,
      currency: project.currency,
      startDate: project.startDate,
      endDate: project.endDate,
      trustLevel: project.trustLevel,
    }];
  });

  try {
    const requirementsText = tenderRequirementsText(params.requirements);
    const [expertBatch, projectBatch] = await Promise.all([
      expertCandidates.length > 0
        ? aiRematchExperts({
            tenderTitle: params.tenderTitle,
            tenderRequirementsText: requirementsText,
            evaluationMethodology: params.evaluationMethodology ?? "",
            candidates: expertCandidates,
          })
        : Promise.resolve(null),
      projectCandidates.length > 0
        ? aiRematchProjects({
            tenderTitle: params.tenderTitle,
            tenderRequirementsText: requirementsText,
            tenderCategory: params.tenderCategory,
            candidates: projectCandidates,
          })
        : Promise.resolve(null),
    ]);

    if (!expertBatch && !projectBatch) {
      return emptyResult(params.matching, "AI rematch returned no usable assessments; deterministic main-engine matching was kept.");
    }

    const expertAssessmentsById = new Map(
      (expertBatch?.assessments ?? []).map((assessment) => [assessment.candidateId, assessment]),
    );
    const projectAssessmentsById = new Map(
      (projectBatch?.assessments ?? []).map((assessment) => [assessment.candidateId, assessment]),
    );
    const selectedExpertIds = expertBatch
      ? selectBestAvailable(
          expertBatch.assessments,
          selectionLimit(params.requirements, "EXPERT", expertBatch.assessments.length),
        )
      : new Set<string>();
    const selectedProjectIds = projectBatch
      ? selectBestAvailable(
          projectBatch.assessments,
          selectionLimit(params.requirements, "PROJECT_EXPERIENCE", projectBatch.assessments.length),
        )
      : new Set<string>();

    const matching: MatchingResult = {
      expertMatches: params.matching.expertMatches
        .map((match) => {
          const assessment = expertAssessmentsById.get(match.expertId);
          if (!assessment) return match;
          const selected = selectedExpertIds.has(match.expertId);
          return {
            ...match,
            score: assessment.overallScore,
            rationale: formatAssessmentRationale({ ...assessment, recommendSelection: selected }),
            isSelected: selected,
          };
        })
        .sort((a, b) => b.score - a.score),
      projectMatches: params.matching.projectMatches
        .map((match) => {
          const assessment = projectAssessmentsById.get(match.projectId);
          if (!assessment) return match;
          const selected = selectedProjectIds.has(match.projectId);
          return {
            ...match,
            score: assessment.overallScore,
            rationale: formatAssessmentRationale({ ...assessment, recommendSelection: selected }),
            isSelected: selected,
          };
        })
        .sort((a, b) => b.score - a.score),
    };

    return {
      matching,
      aiApplied: true,
      expertAssessments: expertAssessmentsById.size,
      projectAssessments: projectAssessmentsById.size,
      selectedExpertCount: matching.expertMatches.filter((match) => match.isSelected).length,
      selectedProjectCount: matching.projectMatches.filter((match) => match.isSelected).length,
      warning: null,
      expertScoreBreakdowns: Object.fromEntries(
        [...expertAssessmentsById].map(([id, assessment]) => [id, toScoreBreakdown(assessment)]),
      ),
      projectScoreBreakdowns: Object.fromEntries(
        [...projectAssessmentsById].map(([id, assessment]) => [id, toScoreBreakdown(assessment)]),
      ),
    };
  } catch (error) {
    return emptyResult(params.matching, error instanceof Error ? error.message : String(error));
  }
}
