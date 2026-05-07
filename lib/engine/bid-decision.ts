export type BidDecisionOutcome = "BID" | "BID_WITH_CONDITIONS" | "NO_BID";

export type BidDecisionCriterion = {
  key: string;
  label: string;
  score: number;
  weight: number;
  rationale: string;
  blockers?: string[];
};

export type BidDecisionInput = {
  deadline?: Date | string | null;
  budget?: number | null;
  requirements: Array<{ priority: string; requirementType: string; title: string; description: string }>;
  complianceGaps: Array<{ severity: string; isResolved: boolean; title: string }>;
  expertMatches: Array<{ score: number; isSelected: boolean }>;
  projectMatches: Array<{ score: number; isSelected: boolean }>;
  generatedDocuments?: Array<{ generationStatus: string; reviewStatus: string }>;
};

export type BidDecisionResult = {
  decision: BidDecisionOutcome;
  score: number;
  criteria: BidDecisionCriterion[];
  blockers: string[];
  conditions: string[];
  summary: string;
};

function clamp(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function daysUntil(deadline?: Date | string | null): number | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function avgScore(matches: Array<{ score: number; isSelected: boolean }>): number {
  const selected = matches.filter((m) => m.isSelected);
  const set = selected.length > 0 ? selected : matches.slice(0, 5);
  if (set.length === 0) return 0;
  return clamp((set.reduce((sum, m) => sum + m.score, 0) / set.length) * 100);
}

function mandatoryRequirements(requirements: BidDecisionInput["requirements"]): number {
  return requirements.filter((r) => r.priority === "MANDATORY").length;
}

export function evaluateBidDecision(input: BidDecisionInput): BidDecisionResult {
  const unresolvedCritical = input.complianceGaps.filter((g) => !g.isResolved && g.severity === "CRITICAL");
  const unresolvedHigh = input.complianceGaps.filter((g) => !g.isResolved && g.severity === "HIGH");
  const mandatoryCount = mandatoryRequirements(input.requirements);
  const expertFit = avgScore(input.expertMatches);
  const projectFit = avgScore(input.projectMatches);
  const days = daysUntil(input.deadline);

  const deadlineScore = days === null ? 55 : days < 0 ? 0 : days <= 2 ? 15 : days <= 7 ? 45 : days <= 14 ? 70 : 90;
  const complianceScore = clamp(100 - unresolvedCritical.length * 35 - unresolvedHigh.length * 15);
  const eligibilityScore = clamp(100 - Math.max(0, mandatoryCount - input.requirements.length * 0.55) * 3 - unresolvedCritical.length * 25);
  const teamScore = clamp(expertFit * 0.72 + Math.min(input.expertMatches.length, 6) * 4.5);
  const referenceScore = clamp(projectFit * 0.72 + Math.min(input.projectMatches.length, 5) * 5);
  const commercialScore = input.budget && input.budget > 0 ? 75 : 55;
  const readinessScore = clamp(
    input.generatedDocuments && input.generatedDocuments.length > 0
      ? (input.generatedDocuments.filter((d) => d.generationStatus === "GENERATED" || d.reviewStatus === "READY_FOR_EXPORT").length / input.generatedDocuments.length) * 100
      : 50,
  );

  const criteria: BidDecisionCriterion[] = [
    { key: "eligibility", label: "Mandatory eligibility", score: eligibilityScore, weight: 0.2, rationale: `${mandatoryCount} mandatory requirement(s); ${unresolvedCritical.length} unresolved critical gap(s).`, blockers: unresolvedCritical.map((g) => g.title) },
    { key: "team", label: "Expert/team fit", score: teamScore, weight: 0.18, rationale: `${input.expertMatches.length} expert match(es); selected/top average fit ${expertFit}%.` },
    { key: "references", label: "Comparable project fit", score: referenceScore, weight: 0.16, rationale: `${input.projectMatches.length} project match(es); selected/top average fit ${projectFit}%.` },
    { key: "compliance", label: "Compliance risk", score: complianceScore, weight: 0.18, rationale: `${unresolvedCritical.length} critical and ${unresolvedHigh.length} high unresolved compliance gap(s).`, blockers: unresolvedCritical.map((g) => g.title) },
    { key: "deadline", label: "Deadline feasibility", score: deadlineScore, weight: 0.12, rationale: days === null ? "No deadline captured." : `${days} day(s) until deadline.` },
    { key: "commercial", label: "Commercial attractiveness", score: commercialScore, weight: 0.08, rationale: input.budget && input.budget > 0 ? "Budget/value is captured." : "Budget/value is not captured; commercial attractiveness requires review." },
    { key: "readiness", label: "Production readiness", score: readinessScore, weight: 0.08, rationale: input.generatedDocuments?.length ? `${input.generatedDocuments.length} planned/generated document(s) available.` : "No generated document package yet." },
  ];

  const score = clamp(criteria.reduce((sum, c) => sum + c.score * c.weight, 0));
  const blockers = criteria.flatMap((c) => c.blockers ?? []).filter(Boolean);
  const conditions: string[] = [];
  if (unresolvedCritical.length > 0) conditions.push("Resolve all CRITICAL compliance gaps before generation/export.");
  if (unresolvedHigh.length > 0) conditions.push("Assign owner and mitigation for HIGH compliance gaps.");
  if (expertFit < 65) conditions.push("Improve or manually confirm expert team fit.");
  if (projectFit < 60) conditions.push("Improve or manually confirm comparable project references.");
  if (days !== null && days <= 7) conditions.push("Escalate compressed-deadline review and final approval timetable.");

  let decision: BidDecisionOutcome;
  if (blockers.length > 0 || score < 45) decision = "NO_BID";
  else if (conditions.length > 0 || score < 72) decision = "BID_WITH_CONDITIONS";
  else decision = "BID";

  return {
    decision,
    score,
    criteria,
    blockers,
    conditions,
    summary: `${decision.replace(/_/g, " ")} — pursuit score ${score}/100. ${conditions.length ? `${conditions.length} condition(s) must be managed.` : "No major conditions detected."}`,
  };
}
