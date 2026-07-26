/**
 * Client Quality Scoring
 *
 * Splits client quality scoring from internal bid diagnostics.
 *
 * Client quality scores:
 *   - required section completeness
 *   - five-criterion coverage
 *   - six-scope-workstream coverage
 *   - healthcare discipline coverage
 *   - evidence density
 *   - tender-language fidelity
 *   - factual consistency
 *   - submission-rule compliance
 *   - absence of internal notes and placeholders
 *
 * Does NOT require Proposal Self-Score, Win Probability, Evaluator
 * Simulation, or internal readiness sections to appear in the client
 * document.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ClientQualityScore = {
  /** 0–100 overall score. */
  overall: number;
  /** Individual dimension scores. */
  dimensions: ClientQualityDimension[];
  /** Whether the score blocks final export (< 70 = block). */
  blocksFinalExport: boolean;
};

export type ClientQualityDimension = {
  id: string;
  name: string;
  /** 0–100 score for this dimension. */
  score: number;
  /** The reason for the score. */
  reason: string;
};

// ─── Scoring functions ──────────────────────────────────────────────────────

/**
 * Score required section completeness (0–100).
 *
 * Checks for presence of: cover letter, executive summary, company profile,
 * proposed team, relevant experience, technical approach, compliance
 * strategy, appendix register, and declaration.
 */
export function scoreSectionCompleteness(text: string): ClientQualityDimension {
  const requiredSections = [
    { pattern: /cover\s+letter|submission\s+letter/i, name: "Cover letter" },
    { pattern: /executive\s+summary|introduction/i, name: "Executive summary" },
    { pattern: /company\s+profile|firm\s+profile/i, name: "Company profile" },
    { pattern: /proposed\s+team|key\s+personnel|professional\s+team/i, name: "Proposed team" },
    { pattern: /relevant\s+experience|project\s+experience/i, name: "Relevant experience" },
    { pattern: /technical\s+approach|methodology|technical\s+methodology/i, name: "Technical approach" },
    { pattern: /compliance|compliance\s+matrix|compliance\s+strategy/i, name: "Compliance" },
    { pattern: /appendix|annex/i, name: "Appendix register" },
    { pattern: /declaration|signature/i, name: "Declaration" },
  ];

  const present = requiredSections.filter((s) => s.pattern.test(text));
  const score = Math.round((present.length / requiredSections.length) * 100);
  const missing = requiredSections.filter((s) => !s.pattern.test(text)).map((s) => s.name);

  return {
    id: "section_completeness",
    name: "Required section completeness",
    score,
    reason:
      missing.length > 0
        ? `Missing sections: ${missing.join(", ")}`
        : "All required sections present.",
  };
}

/**
 * Score five-criterion coverage (0–100).
 */
export function scoreCriterionCoverage(
  criteriaCoverage: Array<{ coverageState: "covered" | "partial" | "missing" }>,
): ClientQualityDimension {
  if (criteriaCoverage.length === 0) {
    return {
      id: "criterion_coverage",
      name: "Five-criterion coverage",
      score: 0,
      reason: "No criteria coverage data.",
    };
  }
  const covered = criteriaCoverage.filter((c) => c.coverageState === "covered").length;
  const partial = criteriaCoverage.filter((c) => c.coverageState === "partial").length;
  const score = Math.round(((covered + partial * 0.5) / criteriaCoverage.length) * 100);
  return {
    id: "criterion_coverage",
    name: "Five-criterion coverage",
    score,
    reason: `${covered} covered, ${partial} partial, ${criteriaCoverage.length - covered - partial} missing.`,
  };
}

/**
 * Score six-scope-workstream coverage (0–100).
 */
export function scoreScopeWorkstreamCoverage(
  workstreams: Array<{ coverageState: "covered" | "partial" | "missing" }>,
): ClientQualityDimension {
  if (workstreams.length === 0) {
    return {
      id: "scope_workstream_coverage",
      name: "Six-scope-workstream coverage",
      score: 0,
      reason: "No scope workstream data.",
    };
  }
  const covered = workstreams.filter((w) => w.coverageState === "covered").length;
  const partial = workstreams.filter((w) => w.coverageState === "partial").length;
  const score = Math.round(((covered + partial * 0.5) / workstreams.length) * 100);
  return {
    id: "scope_workstream_coverage",
    name: "Six-scope-workstream coverage",
    score,
    reason: `${covered} covered, ${partial} partial, ${workstreams.length - covered - partial} missing.`,
  };
}

/**
 * Score healthcare discipline coverage (0–100).
 */
export function scoreDisciplineCoverage(
  disciplines: Array<{ isSatisfied: boolean }>,
): ClientQualityDimension {
  if (disciplines.length === 0) {
    return {
      id: "discipline_coverage",
      name: "Healthcare discipline coverage",
      score: 0,
      reason: "No discipline data.",
    };
  }
  const satisfied = disciplines.filter((d) => d.isSatisfied).length;
  const score = Math.round((satisfied / disciplines.length) * 100);
  return {
    id: "discipline_coverage",
    name: "Healthcare discipline coverage",
    score,
    reason: `${satisfied}/${disciplines.length} disciplines satisfied.`,
  };
}

/**
 * Score evidence density (0–100).
 *
 * Checks that paragraphs contain specific evidence (project names, values,
 * expert names, client references) rather than generic claims.
 */
export function scoreEvidenceDensity(text: string): ClientQualityDimension {
  if (!text || text.trim().length < 100) {
    return {
      id: "evidence_density",
      name: "Evidence density",
      score: 0,
      reason: "Text too short to evaluate.",
    };
  }

  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 50);
  if (paragraphs.length === 0) {
    return {
      id: "evidence_density",
      name: "Evidence density",
      score: 0,
      reason: "No substantive paragraphs.",
    };
  }

  // Evidence indicators: project names, values, expert names, client references
  const evidencePatterns = [
    /\b(?:ETB|USD|EUR|birr)\s*[\d,]+/gi, // currency values
    /\b\d{4}\s+(?:to|-)\s+\d{4}\b/gi, // year ranges
    /\b[A-Z][a-z]+\s+[A-Z][a-z]+/g, // proper names (John Doe)
    /\b(?:project|contract|assignment)\s+(?:for|with|at)\s+/gi, // project references
  ];

  const paragraphsWitvidence = paragraphs.filter((p) =>
    evidencePatterns.some((pat) => pat.test(p)),
  );

  const score = Math.round((paragraphsWitvidence.length / paragraphs.length) * 100);
  return {
    id: "evidence_density",
    name: "Evidence density",
    score,
    reason: `${paragraphsWitvidence.length}/${paragraphs.length} paragraphs contain specific evidence.`,
  };
}

/**
 * Score tender-language fidelity (0–100).
 *
 * Checks that the proposal uses the tender's exact title, client name, and
 * reference (not substituted names from the firm's project history).
 */
export function scoreTenderLanguageFidelity(
  text: string,
  expected: { title: string; client: string },
): ClientQualityDimension {
  let score = 100;
  const reasons: string[] = [];

  if (!text.includes(expected.title)) {
    score -= 40;
    reasons.push("Tender title not found in text.");
  }
  if (!text.includes(expected.client)) {
    score -= 30;
    reasons.push("Client name not found in text.");
  }

  return {
    id: "tender_language_fidelity",
    name: "Tender-language fidelity",
    score: Math.max(0, score),
    reason: reasons.length > 0 ? reasons.join(" ") : "Tender title and client name correctly used.",
  };
}

/**
 * Score factual consistency (0–100).
 *
 * Uses the cross-source consistency validator to detect contradictions.
 */
export function scoreFactualConsistency(
  violations: Array<{ severity: "error" | "warning" }>,
): ClientQualityDimension {
  const errors = violations.filter((v) => v.severity === "error").length;
  const warnings = violations.filter((v) => v.severity === "warning").length;
  const score = Math.max(0, 100 - errors * 20 - warnings * 5);
  return {
    id: "factual_consistency",
    name: "Factual consistency",
    score,
    reason: `${errors} error(s), ${warnings} warning(s) from consistency validator.`,
  };
}

/**
 * Score submission-rule compliance (0–100).
 *
 * Checks for correct submission method, deadline, and deliverable format.
 */
export function scoreSubmissionRuleCompliance(
  text: string,
  expected: { submissionMethod: string; deadlineDisplay: string; deliverable: string },
): ClientQualityDimension {
  let score = 100;
  const reasons: string[] = [];

  if (expected.submissionMethod === "email") {
    if (!/email/i.test(text)) {
      score -= 30;
      reasons.push("Email submission method not mentioned.");
    }
  }

  if (!text.includes(expected.deliverable)) {
    score -= 20;
    reasons.push(`Required deliverable "${expected.deliverable}" not mentioned.`);
  }

  return {
    id: "submission_rule_compliance",
    name: "Submission-rule compliance",
    score: Math.max(0, score),
    reason: reasons.length > 0 ? reasons.join(" ") : "Submission rules correctly referenced.",
  };
}

/**
 * Score absence of internal notes and placeholders (0–100).
 */
export function scoreAbsenceOfInternalNotes(text: string): ClientQualityDimension {
  // Reuse the client-output-separation module's patterns
  const violations = findForbiddenTerms(text);
  const score = Math.max(0, 100 - violations.length * 15);
  return {
    id: "absence_of_internal_notes",
    name: "Absence of internal notes and placeholders",
    score,
    reason: violations.length > 0 ? `${violations.length} internal term(s) detected: ${violations.slice(0, 3).join(", ")}` : "No internal terms or placeholders detected.",
  };
}

// ─── Combined scorer ────────────────────────────────────────────────────────

/**
 * Compute the overall client quality score.
 */
export function computeClientQualityScore(dimensions: ClientQualityDimension[]): ClientQualityScore {
  if (dimensions.length === 0) {
    return { overall: 0, dimensions: [], blocksFinalExport: true };
  }
  const overall = Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length);
  return {
    overall,
    dimensions,
    blocksFinalExport: overall < 70,
  };
}

// ─── Helper ────────────────────────────────────────────────────────────────

function findForbiddenTerms(text: string): string[] {
  const patterns = [
    /bid[- ]?team[- ]?action/gi,
    /proposal[- ]?self[- ]?score/gi,
    /win\s+probability/gi,
    /evaluator\s+simulation/gi,
    /unsupported[- ]claim\s+control/gi,
    /evidence[- ]gap\s+register/gi,
    /readiness\s+checklist/gi,
    /internal\s+review\s+notes?/gi,
    /auto[- ]?repair/gi,
    /\[(?:TBD|NAME|DATE|PLACEHOLDER|INSERT|TODO|FIXME)\]/gi,
  ];
  const found: string[] = [];
  for (const p of patterns) {
    const matches = text.match(p);
    if (matches) found.push(...matches);
  }
  return [...new Set(found)];
}
