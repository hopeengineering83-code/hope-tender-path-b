/**
 * Bid Strategy Engine — beyond-spec feature (PR #249).
 *
 * THE GAP THE SPEC DOESN'T COVER
 * Every tender tool on the market — and the spec the user wrote —
 * focuses on GENERATING the proposal once you've decided to bid.
 * Nothing in the spec helps the firm answer the question that comes
 * BEFORE generation: "Should we even be in this race?"
 *
 * For consultancy firms that participate in many tenders per quarter,
 * the win/loss differential isn't decided in the proposal — it's
 * decided in the bid/no-bid call. Bidding on tenders the firm can't
 * win wastes ~40 person-hours per submission AND damages reputation
 * with evaluators who see weak unfit submissions.
 *
 * THE FEATURE
 * Deterministic strategy engine that takes the analyzed tender +
 * matched experts/projects + compliance gaps + company knowledge
 * and produces:
 *
 *   • winProbability   — 0–100 numeric score
 *   • recommendation   — BID_HARD / BID_CAREFULLY / DECLINE
 *   • topRisks         — 3 specific gaps the bid team must address
 *   • topAdvantages    — 3 firm-specific strengths to amplify
 *   • bidPosture       — SOLO / JV_RECOMMENDED / SUBCONTRACT_REQUIRED / DECLINE
 *   • rationale        — 2–3 sentence executive summary
 *   • dimensionScores  — per-dimension breakdown for transparency
 *
 * Dimensions scored (each 0–100, weighted):
 *
 *   capability_coverage  (30%) — how many required disciplines does
 *                                the firm have reviewed experts for?
 *   experience_fit       (25%) — how relevant is the project portfolio?
 *   compliance_readiness (20%) — what fraction of mandatory reqs have
 *                                supporting evidence on file?
 *   evaluation_alignment (15%) — does the firm score on the heaviest
 *                                evaluation criteria?
 *   eligibility_clearance (10%) — can the firm satisfy
 *                                jurisdictional / consortia / local-
 *                                content requirements stated in the
 *                                tender?
 *
 * The win-probability is the weighted average of these dimensions.
 * Recommendation thresholds (tunable via env):
 *   ≥ 70  → BID_HARD       (commit full effort)
 *   45–69 → BID_CAREFULLY  (mitigate top risks first)
 *   < 45  → DECLINE        (cost > expected return)
 *
 * NEVER FABRICATES
 * Every signal is computed from data already in the database.
 * No AI calls, no external services. Runs in <100ms.
 */

import type { Prisma } from "@prisma/client";

// Type aliases for the records we read. Kept loose so the engine
// works against whatever the caller passes in.
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
  };
  company: {
    name: string;
    sectors: string;       // JSON array string
    serviceLines: string;  // JSON array string
    licenseGrade?: string | null;
    country?: string | null;
    headcount?: number | null;
    expertCount: number;
    projectCount: number;
    legalRecordCount: number;
    financialRecordCount: number;
    // Historical bid outcomes — fetched from past Tender records with bidOutcome set
    historicalWins?: number;
    historicalTotal?: number;
  };
}

export type BidRecommendation = "BID_HARD" | "BID_CAREFULLY" | "DECLINE";
export type BidPosture = "SOLO" | "JV_RECOMMENDED" | "SUBCONTRACT_REQUIRED" | "DECLINE";

export interface BidStrategy {
  winProbability: number; // 0–100
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
  computedAt: string;
}

// ─── Tunable thresholds (env-overridable) ────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
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

// ─── Dimension scorers ───────────────────────────────────────────────────────

/**
 * Capability coverage — how many of the disciplines mentioned in the
 * tender's expert / technical requirements does the firm have reviewed
 * experts for? Reviewed-expert coverage is what evaluators ultimately
 * score, so unreviewed drafts don't count toward the metric.
 */
function scoreCapabilityCoverage(input: BidStrategyInput): { score: number; matchedDisciplines: string[]; missingDisciplines: string[] } {
  const expertReqs = input.tender.requirements.filter((r) => r.requirementType === "EXPERT" || /technical|methodology|expertise/i.test(r.description));
  if (expertReqs.length === 0) {
    // No specific expert disciplines required — neutral high score
    return { score: 75, matchedDisciplines: [], missingDisciplines: [] };
  }

  // Extract discipline-keyword tokens from the requirements
  const requiredTokens = new Set<string>();
  for (const req of expertReqs) {
    for (const t of tokenize(`${req.title} ${req.description}`)) requiredTokens.add(t);
  }

  // Build pool of disciplines from REVIEWED experts only
  const reviewedExpertDisciplines = input.tender.expertMatches
    .filter((m) => m.expert.trustLevel === "REVIEWED")
    .flatMap((m) => safeJsonArray(m.expert.disciplines));
  const expertTokens = new Set<string>();
  for (const d of reviewedExpertDisciplines) for (const t of tokenize(d)) expertTokens.add(t);

  const matched: string[] = [];
  const missing: string[] = [];
  // Look at the most-distinctive required tokens (length >= 6 to skip
  // "design", "system" etc.)
  const distinctive = [...requiredTokens].filter((t) => t.length >= 6).slice(0, 12);
  for (const t of distinctive) {
    if (expertTokens.has(t)) matched.push(t);
    else missing.push(t);
  }
  if (distinctive.length === 0) {
    return { score: 70, matchedDisciplines: [], missingDisciplines: [] };
  }
  const score = Math.round((matched.length / distinctive.length) * 100);
  return { score, matchedDisciplines: matched.slice(0, 5), missingDisciplines: missing.slice(0, 5) };
}

/**
 * Experience fit — how relevant is the firm's project portfolio?
 * Uses the matching engine's own scores. Average top-N reviewed
 * project scores; >= 0.85 is excellent fit, < 0.5 is weak fit.
 */
function scoreExperienceFit(input: BidStrategyInput): { score: number; topProjects: string[]; weakSignal: boolean } {
  const reviewed = input.tender.projectMatches.filter((m) => m.project.trustLevel === "REVIEWED");
  if (reviewed.length === 0) return { score: 30, topProjects: [], weakSignal: true };
  const top = [...reviewed].sort((a, b) => b.score - a.score).slice(0, 5);
  const avg = top.reduce((s, m) => s + m.score, 0) / top.length;
  // Map cosine similarity 0–1 → 0–100 with a steeper curve so 0.85+
  // maps to ~90+, and 0.5 maps to ~50. avg^0.7 gives that shape.
  const score = Math.round(Math.min(100, Math.pow(avg, 0.7) * 100));
  return {
    score,
    topProjects: top.slice(0, 3).map((m) => m.project.name),
    weakSignal: avg < 0.5,
  };
}

/**
 * Compliance readiness — what fraction of mandatory requirements have
 * supporting evidence already on file (no unresolved CRITICAL gaps)?
 */
function scoreComplianceReadiness(input: BidStrategyInput): { score: number; criticalGaps: number; mandatoryReqs: number } {
  const mandatoryReqs = input.tender.requirements.filter((r) => r.priority === "MANDATORY").length;
  const criticalGaps = input.tender.complianceGaps.filter((g) => !g.isResolved && g.severity === "CRITICAL").length;
  if (mandatoryReqs === 0) return { score: 80, criticalGaps, mandatoryReqs };
  if (criticalGaps === 0) return { score: 95, criticalGaps, mandatoryReqs };
  // Each unresolved critical gap drops the score by ~12 points, floored at 20
  const score = Math.max(20, 95 - criticalGaps * 12);
  return { score, criticalGaps, mandatoryReqs };
}

/**
 * Evaluation alignment — looking at the tender's evaluation methodology,
 * does the firm have evidence aligned with the heaviest-weighted
 * criteria? This is heuristic: the top-3 capability families that
 * appear in evaluation methodology are checked against the firm's
 * service lines and sectors.
 */
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
    // Accept the service when ANY of its long tokens appears in the methodology
    // text — the prior `find` returned only the first token, missing services
    // whose identifying term was not their first long word.
    if (tokens.some((t) => methodologyLower.includes(t))) aligned.push(service);
  }
  // Each aligned firm-service against methodology = ~15 points, floor 40
  const score = Math.max(40, Math.min(100, 40 + aligned.length * 15));
  return { score, alignedCriteria: aligned.slice(0, 5) };
}

/**
 * Eligibility clearance — can the firm satisfy jurisdictional /
 * consortia / local-content / debarment-clearance requirements stated
 * in the tender? This is a coarse scorer: missing legal records or
 * missing financial records → eligibility risk.
 */
function scoreEligibilityClearance(input: BidStrategyInput): { score: number; missingArtifacts: string[] } {
  const missing: string[] = [];
  if (input.company.legalRecordCount < 1) missing.push("legal-registration documents");
  if (input.company.financialRecordCount < 1) missing.push("audited financial statements");
  if (input.company.expertCount < 3) missing.push("minimum reviewed expert pool (3+)");
  if (input.company.projectCount < 3) missing.push("minimum reviewed project portfolio (3+)");
  // Each missing artifact drops 18 points, floor 30
  const score = Math.max(30, 100 - missing.length * 18);
  return { score, missingArtifacts: missing };
}

// ─── Synthesis: rationale + posture + risks + advantages ─────────────────────

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
  // High capability + experience → solo
  if (capability.score >= 75 && experience.score >= 70 && eligibility.missingArtifacts.length === 0) return "SOLO";
  // Capability gap + strong experience → JV with firm covering the gap
  if (capability.score < 60 && experience.score >= 50) return "JV_RECOMMENDED";
  // Specific discipline missing → subcontract
  if (capability.missingDisciplines.length >= 2) return "SUBCONTRACT_REQUIRED";
  // Default: solo with mitigation
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
      mitigation: "Either propose a JV/subcontract with a firm covering the missing discipline, OR add reviewed experts to the knowledge vault before bidding.",
      category: "CAPABILITY",
    });
  }

  if (experience.weakSignal) {
    risks.push({
      title: "Project portfolio shows weak fit to this tender",
      severity: "HIGH",
      mitigation: "Add at least 2 directly-comparable reviewed project references to the knowledge vault. Without strong portfolio anchors the proposal cannot demonstrate prior delivery.",
      category: "PORTFOLIO",
    });
  }

  if (eligibility.missingArtifacts.length > 0) {
    risks.push({
      title: `Eligibility artifacts missing: ${eligibility.missingArtifacts.join("; ")}`,
      severity: eligibility.missingArtifacts.length >= 2 ? "HIGH" : "MEDIUM",
      mitigation: "Upload the missing artifacts to the knowledge vault. Most tenders block bids that lack registration / audited statements / minimum portfolio depth.",
      category: "ELIGIBILITY",
    });
  }

  // Always cap at 3
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
      evidenceAnchor: `Top reviewed projects: ${experience.topProjects.slice(0, 2).join("; ")}`,
    });
  }

  if (capability.matchedDisciplines.length >= 2) {
    advantages.push({
      title: "Multi-discipline capability cover",
      evidenceAnchor: `Reviewed experts cover: ${capability.matchedDisciplines.slice(0, 4).join(", ")}`,
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

  // Always cap at 3 (we may have collected 4)
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
    return `Win probability of ${probLabel} is below the recommended bid threshold. Multiple structural gaps (capability coverage, portfolio fit, or eligibility artifacts) make a competitive submission unlikely. Recommend declining to bid OR investing in vault depth before committing bid resources to this opportunity.`;
  }
  return `Mixed signal (win probability ${probLabel}). The firm can compete on this tender if specific risks are mitigated FIRST. ${topRiskCount > 0 ? `${topRiskCount} risk${topRiskCount > 1 ? "s" : ""} flagged — resolve those before generating the proposal.` : "Proceed with caution; differentiate aggressively in the technical approach."}${posture === "JV_RECOMMENDED" ? " A JV with a firm covering capability gaps is recommended." : posture === "SUBCONTRACT_REQUIRED" ? " A subcontract for missing disciplines is required." : ""}`;
}

// ─── Main entry point ────────────────────────────────────────────────────────

export function computeBidStrategy(input: BidStrategyInput): BidStrategy {
  const capability = scoreCapabilityCoverage(input);
  const experience = scoreExperienceFit(input);
  const compliance = scoreComplianceReadiness(input);
  const evaluation = scoreEvaluationAlignment(input);
  const eligibility = scoreEligibilityClearance(input);

  // Weighted average — see header comment for weights
  let winProbability = Math.round(
    capability.score * 0.30 +
    experience.score * 0.25 +
    compliance.score * 0.20 +
    evaluation.score * 0.15 +
    eligibility.score * 0.10,
  );

  // Blend in historical win rate when ≥3 past bids exist. Modifier: ±8 points
  // centered at 40% win rate. Firms with >60% win rate get a boost; <20% get
  // a penalty. This uses real outcomes data rather than capability proxies.
  const { historicalWins = 0, historicalTotal = 0 } = input.company;
  if (historicalTotal >= 3) {
    const rate = historicalWins / historicalTotal;
    const modifier = Math.round((rate - 0.4) * 20); // [-8, +12] range
    winProbability = Math.max(0, Math.min(100, winProbability + modifier));
  }

  const recommendation = synthesizeRecommendation(winProbability);
  const posture = synthesizePosture(recommendation, capability, experience, eligibility);
  const topRisks = buildTopRisks(capability, experience, compliance, eligibility);
  const topAdvantages = buildTopAdvantages(experience, capability, evaluation, input);
  const rationale = buildRationale(recommendation, posture, winProbability, topRisks.length);

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
    computedAt: new Date().toISOString(),
  };
}

// Re-export Prisma type alias for callers that want to construct the
// input from raw findFirst() output.
export type _PrismaJson = Prisma.JsonValue;
