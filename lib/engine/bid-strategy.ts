import { safeParseJsonArray } from "../safe-json";
import type { Prisma } from "@prisma/client";
import { classifyBidStrategyGaps, type BidStrategyGapAnalysis } from "./bid-strategy-gap-classifier";

/**
 * Deterministic bid/no-bid strategy engine. All signals come from persisted
 * tender/company data; there are no AI calls here.
 *
 * Runtime evidence authority is intentionally aligned with the Company Vault
 * contract: authenticated REVIEWED and durable SOURCE_VERIFIED records count;
 * REGEX_DRAFT/AI_DRAFT/MANUAL_DRAFT do not.
 */
export interface BidStrategyInput {
  tender: {
    id: string;
    title: string;
    category?: string | null;
    requirements: Array<{
      title: string;
      description: string;
      requirementType: string;
      priority: string;
      requiredQuantity?: number | null;
    }>;
    complianceGaps: Array<{
      severity: string;
      isResolved: boolean;
      title: string;
    }>;
    expertMatches: Array<{
      score: number;
      isSelected: boolean;
      expert: { fullName: string; trustLevel: string; disciplines: string };
    }>;
    projectMatches: Array<{
      score: number;
      isSelected: boolean;
      project: { name: string; trustLevel: string; sector?: string | null; serviceAreas: string };
    }>;
    evaluationMethodology?: string | null;
    submissionMethod?: string | null;
    analysisSource?: string | null;
    evidenceCoverageRatio?: number | null;
    evidenceProgressRatio?: number | null;
  };
  company: {
    name: string;
    sectors: string;
    serviceLines: string;
    licenseGrade?: string | null;
    country?: string | null;
    headcount?: number | null;
    /** Runtime-authoritative evidence counts supplied by the API/Engine caller. */
    expertCount: number;
    projectCount: number;
    legalRecordCount: number;
    financialRecordCount: number;
    historicalWins?: number;
    historicalTotal?: number;
  };
}

export type BidRecommendation = "BID_HARD" | "BID_CAREFULLY" | "DECLINE";
export type BidPosture = "SOLO" | "JV_RECOMMENDED" | "SUBCONTRACT_REQUIRED" | "DECLINE";

export interface BidStrategy {
  winProbability: number;
  recommendation: BidRecommendation;
  bidPosture: BidPosture;
  rationale: string;
  topRisks: Array<{ title: string; severity: "HIGH" | "MEDIUM" | "LOW"; mitigation: string; category: "COMPLIANCE" | "CAPABILITY" | "PORTFOLIO" | "ELIGIBILITY" }>;
  topAdvantages: Array<{ title: string; evidenceAnchor: string }>;
  dimensionScores: {
    capabilityCoverage: number;
    experienceFit: number;
    complianceReadiness: number;
    evaluationAlignment: number;
    eligibilityClearance: number;
  };
  gapAnalysis?: BidStrategyGapAnalysis;
  computedAt: string;
}

function thresholdBidHard(): number {
  const raw = Number(process.env.BID_STRATEGY_BID_HARD_THRESHOLD);
  if (Number.isFinite(raw) && raw >= 50 && raw <= 95) return raw;
  return 70;
}

function thresholdDecline(): number {
  const raw = Number(process.env.BID_STRATEGY_DECLINE_THRESHOLD);
  if (Number.isFinite(raw) && raw >= 20 && raw <= 60) return raw;
  return 45;
}

function safeJsonArray(value: string | null | undefined): string[] {
  return safeParseJsonArray<string>(value ?? "").map(String).filter(Boolean);
}

function tokenize(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4),
  );
}

function authoritativeTrustLevel(value: string | null | undefined): boolean {
  return value === "REVIEWED" || value === "SOURCE_VERIFIED";
}

function scoreCapabilityCoverage(input: BidStrategyInput): { score: number; matchedDisciplines: string[]; missingDisciplines: string[] } {
  const expertReqs = input.tender.requirements.filter((r) => r.requirementType === "EXPERT" || /technical|methodology|expertise/i.test(r.description));
  if (expertReqs.length === 0) return { score: 75, matchedDisciplines: [], missingDisciplines: [] };

  const requiredTokens = new Set<string>();
  for (const req of expertReqs) {
    for (const t of tokenize(`${req.title} ${req.description}`)) requiredTokens.add(t);
  }

  const authoritativeExpertDisciplines = input.tender.expertMatches
    .filter((m) => authoritativeTrustLevel(m.expert.trustLevel))
    .flatMap((m) => safeJsonArray(m.expert.disciplines));
  const expertTokens = new Set<string>();
  for (const discipline of authoritativeExpertDisciplines) {
    for (const token of tokenize(discipline)) expertTokens.add(token);
  }

  const matched: string[] = [];
  const missing: string[] = [];
  const distinctive = [...requiredTokens].filter((t) => t.length >= 6).slice(0, 12);
  for (const token of distinctive) {
    if (expertTokens.has(token)) matched.push(token);
    else missing.push(token);
  }
  if (distinctive.length === 0) return { score: 70, matchedDisciplines: [], missingDisciplines: [] };

  const rawScore = Math.round((matched.length / distinctive.length) * 100);
  const selectedExperts = input.tender.expertMatches.filter((m) => m.isSelected).length;
  const authoritativeExpertMatches = input.tender.expertMatches.filter((m) => authoritativeTrustLevel(m.expert.trustLevel)).length;
  const anyExpertEvidence = selectedExperts > 0 || authoritativeExpertMatches > 0 || input.tender.expertMatches.length > 0;
  const score = rawScore === 0 && anyExpertEvidence ? 30 : rawScore;

  return { score, matchedDisciplines: matched.slice(0, 5), missingDisciplines: missing.slice(0, 5) };
}

function scoreExperienceFit(input: BidStrategyInput): { score: number; topProjects: string[]; weakSignal: boolean } {
  const authoritative = input.tender.projectMatches.filter((m) => authoritativeTrustLevel(m.project.trustLevel));
  if (authoritative.length === 0) return { score: 30, topProjects: [], weakSignal: true };
  const top = [...authoritative].sort((a, b) => b.score - a.score).slice(0, 5);
  const avg = top.reduce((sum, match) => sum + match.score, 0) / top.length;
  const score = Math.round(Math.min(100, Math.pow(avg, 0.7) * 100));
  return {
    score,
    topProjects: top.slice(0, 3).map((m) => m.project.name),
    weakSignal: avg < 0.5,
  };
}

function scoreComplianceReadiness(input: BidStrategyInput): { score: number; criticalGaps: number; mandatoryReqs: number } {
  const mandatoryReqs = input.tender.requirements.filter((r) => r.priority === "MANDATORY").length;
  const criticalGaps = input.tender.complianceGaps.filter((g) => !g.isResolved && g.severity === "CRITICAL").length;
  if (mandatoryReqs === 0) return { score: 0, criticalGaps, mandatoryReqs };
  const releaseCoverage = Math.max(0, Math.min(1, input.tender.evidenceCoverageRatio ?? 0));
  const progress = Math.max(releaseCoverage, Math.min(1, input.tender.evidenceProgressRatio ?? releaseCoverage));
  const score = Math.max(0, Math.round((releaseCoverage * 0.8 + progress * 0.2) * 100) - criticalGaps * 12);
  return { score, criticalGaps, mandatoryReqs };
}

function scoreEvaluationAlignment(input: BidStrategyInput): { score: number; alignedCriteria: string[] } {
  const methodology = input.tender.evaluationMethodology ?? "";
  if (!methodology || methodology.length < 50) return { score: 70, alignedCriteria: [] };

  const firmServices = [
    ...safeJsonArray(input.company.serviceLines),
    ...safeJsonArray(input.company.sectors),
  ].map((s) => s.toLowerCase());
  if (firmServices.length === 0) return { score: 50, alignedCriteria: [] };

  const methodologyLower = methodology.toLowerCase();
  const aligned: string[] = [];
  for (const service of firmServices) {
    const tokens = [...tokenize(service)].filter((t) => t.length >= 5);
    if (tokens.some((t) => methodologyLower.includes(t))) aligned.push(service);
  }
  const score = Math.max(40, Math.min(100, 40 + aligned.length * 15));
  return { score, alignedCriteria: aligned.slice(0, 5) };
}

function scoreEligibilityClearance(input: BidStrategyInput): { score: number; missingArtifacts: string[] } {
  const missing: string[] = [];
  if (input.company.legalRecordCount < 1) missing.push("legal-registration documents");
  if (input.company.financialRecordCount < 1) missing.push("audited financial statements");
  if (input.company.expertCount < 3) missing.push("minimum reviewed expert pool (3+)");
  if (input.company.projectCount < 3) missing.push("minimum reviewed project portfolio (3+)");
  const score = Math.max(30, 100 - missing.length * 18);
  return { score, missingArtifacts: missing };
}

function synthesizeRecommendation(winProbability: number): BidRecommendation {
  if (winProbability >= thresholdBidHard()) return "BID_HARD";
  if (winProbability < thresholdDecline()) return "DECLINE";
  return "BID_CAREFULLY";
}

function synthesizePosture(
  recommendation: BidRecommendation,
  capability: ReturnType<typeof scoreCapabilityCoverage>,
  experience: ReturnType<typeof scoreExperienceFit>,
  eligibility: ReturnType<typeof scoreEligibilityClearance>,
): BidPosture {
  if (recommendation === "DECLINE") return "DECLINE";
  if (capability.score >= 75 && experience.score >= 70 && eligibility.missingArtifacts.length === 0) return "SOLO";
  if (capability.score < 60 && experience.score >= 50) return "JV_RECOMMENDED";
  if (capability.missingDisciplines.length >= 2) return "SUBCONTRACT_REQUIRED";
  return "SOLO";
}

function buildTopRisks(
  capability: ReturnType<typeof scoreCapabilityCoverage>,
  experience: ReturnType<typeof scoreExperienceFit>,
  compliance: ReturnType<typeof scoreComplianceReadiness>,
  eligibility: ReturnType<typeof scoreEligibilityClearance>,
): BidStrategy["topRisks"] {
  const risks: BidStrategy["topRisks"] = [];

  if (compliance.criticalGaps > 0) {
    risks.push({
      title: `${compliance.criticalGaps} unresolved CRITICAL compliance gap${compliance.criticalGaps > 1 ? "s" : ""}`,
      severity: "HIGH",
      mitigation: "Resolve every CRITICAL gap before generation. The submission engine blocks ZIP export when CRITICAL gaps are unresolved.",
      category: "COMPLIANCE",
    });
  }

  if (capability.missingDisciplines.length > 0) {
    risks.push({
      title: `Capability gap: ${capability.missingDisciplines.slice(0, 3).join(", ")}`,
      severity: capability.missingDisciplines.length >= 3 ? "HIGH" : "MEDIUM",
      mitigation: "Either propose a JV/subcontract with a firm covering the missing discipline, or upload genuine source evidence for additional experts before bidding.",
      category: "CAPABILITY",
    });
  }

  if (experience.weakSignal) {
    risks.push({
      title: "Project portfolio shows weak fit to this tender",
      severity: "HIGH",
      mitigation: "Add at least 2 directly comparable source-backed project references to the Company Vault. Without strong portfolio anchors the proposal cannot demonstrate prior delivery.",
      category: "PORTFOLIO",
    });
  }

  if (eligibility.missingArtifacts.length > 0) {
    risks.push({
      title: `Eligibility artifacts missing: ${eligibility.missingArtifacts.join("; ")}`,
      severity: eligibility.missingArtifacts.length >= 2 ? "HIGH" : "MEDIUM",
      mitigation: "Upload the missing artifacts to the Company Vault. Most tenders block bids that lack registration, audited statements, or minimum portfolio depth.",
      category: "ELIGIBILITY",
    });
  }

  return risks.slice(0, 3);
}

function buildTopAdvantages(
  experience: ReturnType<typeof scoreExperienceFit>,
  capability: ReturnType<typeof scoreCapabilityCoverage>,
  evaluation: ReturnType<typeof scoreEvaluationAlignment>,
  input: BidStrategyInput,
): BidStrategy["topAdvantages"] {
  const advantages: BidStrategy["topAdvantages"] = [];

  if (experience.topProjects.length >= 1) {
    advantages.push({
      title: "Direct comparable-project track record",
      evidenceAnchor: `Top source-backed projects: ${experience.topProjects.slice(0, 2).join("; ")}`,
    });
  }

  if (capability.matchedDisciplines.length >= 2) {
    advantages.push({
      title: "Multi-discipline capability cover",
      evidenceAnchor: `Authoritative experts cover: ${capability.matchedDisciplines.slice(0, 4).join(", ")}`,
    });
  }

  if (evaluation.alignedCriteria.length >= 1) {
    advantages.push({
      title: "Service lines aligned to evaluation methodology",
      evidenceAnchor: `Firm services scoring against tender criteria: ${evaluation.alignedCriteria.slice(0, 3).join(", ")}`,
    });
  }

  if (input.company.licenseGrade) {
    advantages.push({
      title: `Holds ${input.company.licenseGrade} license grade`,
      evidenceAnchor: `${input.company.name} carries ${input.company.licenseGrade} — meets eligibility on most public-sector tenders.`,
    });
  }

  return advantages.slice(0, 3);
}

function buildRationale(
  recommendation: BidRecommendation,
  posture: BidPosture,
  winProbability: number,
  topRiskCount: number,
): string {
  const probLabel = `${winProbability}%`;
  if (recommendation === "BID_HARD") {
    return `Strong fit detected (win probability ${probLabel}). The firm carries the capability, experience, and compliance posture to win this tender${posture === "JV_RECOMMENDED" ? " through a strategic JV" : ""}. Recommend committing full bid effort. ${topRiskCount > 0 ? `Address ${topRiskCount} flagged risk${topRiskCount > 1 ? "s" : ""} before submission to lock in the win.` : "No major risks flagged."}`;
  }
  if (recommendation === "DECLINE") {
    return `Win probability of ${probLabel} is below the recommended bid threshold. Multiple structural gaps (capability coverage, portfolio fit, or eligibility artifacts) make a competitive submission unlikely. Recommend declining to bid OR investing in Vault depth before committing bid resources to this opportunity.`;
  }
  return `Mixed signal (win probability ${probLabel}). The firm can compete on this tender if specific risks are mitigated FIRST. ${topRiskCount > 0 ? `${topRiskCount} risk${topRiskCount > 1 ? "s" : ""} flagged — resolve those before generating the proposal.` : "Proceed with caution; differentiate aggressively in the technical approach."}${posture === "JV_RECOMMENDED" ? " A JV with a firm covering capability gaps is recommended." : posture === "SUBCONTRACT_REQUIRED" ? " A subcontract for missing disciplines is required." : ""}`;
}

export function computeBidStrategy(input: BidStrategyInput): BidStrategy {
  const capability = scoreCapabilityCoverage(input);
  const experience = scoreExperienceFit(input);
  const compliance = scoreComplianceReadiness(input);
  const evaluation = scoreEvaluationAlignment(input);
  const eligibility = scoreEligibilityClearance(input);

  let winProbability = Math.round(
    capability.score * 0.30 +
    experience.score * 0.25 +
    compliance.score * 0.20 +
    evaluation.score * 0.15 +
    eligibility.score * 0.10,
  );

  const { historicalWins = 0, historicalTotal = 0 } = input.company;
  if (historicalTotal >= 3) {
    const rate = historicalWins / historicalTotal;
    const modifier = Math.round((rate - 0.4) * 20);
    winProbability = Math.max(0, Math.min(100, winProbability + modifier));
  }

  if (input.tender.analysisSource === "REGEX_FALLBACK_AI_ERROR") {
    winProbability = Math.max(0, winProbability - 15);
  }
  if ((input.tender.evidenceCoverageRatio ?? 1) === 0) {
    winProbability = Math.max(0, winProbability - 10);
  }
  const releaseCoverage = input.tender.evidenceCoverageRatio ?? 0;
  if (releaseCoverage < 0.8) winProbability = Math.min(winProbability, 64);

  const gapAnalysis = classifyBidStrategyGaps({
    tender: {
      requirements: input.tender.requirements,
      expertMatches: input.tender.expertMatches,
      analysisSource: input.tender.analysisSource ?? null,
      evidenceCoverageRatio: input.tender.evidenceCoverageRatio ?? null,
    },
    company: { expertCount: input.company.expertCount },
    capabilityScore: capability.score,
  });

  let recommendation = synthesizeRecommendation(winProbability);
  if (gapAnalysis.inhibitDecline && recommendation === "DECLINE") recommendation = "BID_CAREFULLY";
  if (releaseCoverage < 0.8 && recommendation === "BID_HARD") recommendation = "BID_CAREFULLY";

  const posture = synthesizePosture(recommendation, capability, experience, eligibility);
  const topRisks = buildTopRisks(capability, experience, compliance, eligibility);
  const topAdvantages = buildTopAdvantages(experience, capability, evaluation, input);
  const baseRationale = buildRationale(recommendation, posture, winProbability, topRisks.length);
  const rationale = gapAnalysis.capabilityGapCause === "NO_CAPABILITY_GAP" && !gapAnalysis.systemReadinessGapsPresent
    ? baseRationale
    : `${baseRationale} Gap analysis: ${gapAnalysis.explanation}`;

  return {
    winProbability,
    recommendation,
    bidPosture: posture,
    rationale,
    topRisks,
    topAdvantages,
    dimensionScores: {
      capabilityCoverage: capability.score,
      experienceFit: experience.score,
      complianceReadiness: compliance.score,
      evaluationAlignment: evaluation.score,
      eligibilityClearance: eligibility.score,
    },
    gapAnalysis,
    computedAt: new Date().toISOString(),
  };
}

export type _PrismaJson = Prisma.JsonValue;
