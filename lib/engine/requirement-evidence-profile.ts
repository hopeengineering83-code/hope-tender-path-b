// Requirement → evidence profile (Gap 14).
//
// PROBLEM
// ───────
// The 17-gap spec called for requirements to expose a structured
// profile with: requirementType, priority, evidenceNeeded, sourceQuote,
// page/section reference, responseStrategy, linkedEvidenceIds.
//
// Most of these fields already exist on TenderRequirement (Prisma):
//   • requirementType, priority   — direct columns
//   • sourceExactQuote            — already there from the source-tracker PR
//   • sourcePageNumber, sectionReference — already there
//   • complianceMatrixRows        — implicit linkedEvidenceIds (one-to-many)
//
// FIX (NO SCHEMA CHANGE)
// ──────────────────────
// Pure helper that:
//   1. Builds the spec's profile object from existing columns.
//   2. Infers `evidenceNeeded` from requirementType + restrictions text
//      (no AI call — fast, deterministic, side-effect-free).
//   3. Derives a tender-wide `evidenceCoverage` percent: requirements
//      that have ≥1 linked compliance row resolved with FULL or
//      SUBSTANTIAL evidence / total requirements.
//
// `responseStrategy` is intentionally NOT inferred here — it's writer
// guidance that lives elsewhere (proposal-sections / generate-elite
// prompts). When a future schema migration lands, expose it as a
// `responseStrategy` column and have generators read from this profile.

export type EvidenceKind =
  | "EXPERT_CV"
  | "PROJECT_REFERENCE"
  | "FINANCIAL_STATEMENT"
  | "LEGAL_REGISTRATION"
  | "TAX_CERTIFICATE"
  | "INSURANCE_CERTIFICATE"
  | "DECLARATION"
  | "FORM_TEMPLATE"
  | "METHODOLOGY_NARRATIVE"
  | "EVIDENCE_OF_PAST_PERFORMANCE"
  | "GENERAL";

// Formal support-level model. Compliance rows historically stored this as a
// free-form string ("FULL" / "SUBSTANTIAL" / "PARTIAL" / "NONE" / etc.).
// `normalizeSupportLevel` collapses the known spellings (incl. NOT_APPLICABLE)
// onto this union so coverage logic and the UI agree. Only FULL / SUBSTANTIAL
// count as strong support; NOT_APPLICABLE means the requirement does not need
// evidence (a recorded human decision), and is never treated as strong.
export type SupportLevel =
  | "FULL"
  | "SUBSTANTIAL"
  | "PARTIAL"
  | "NONE"
  | "NOT_COVERED"
  | "NOT_APPLICABLE";

export function normalizeSupportLevel(value?: string | null): SupportLevel {
  const v = (value ?? "").trim().toUpperCase().replace(/[\s/-]+/g, "_");
  switch (v) {
    case "FULL": return "FULL";
    case "SUBSTANTIAL": return "SUBSTANTIAL";
    // Vocabulary the engine and matrix builder actually persist. Without these
    // cases every real row fell through to the `default` and normalised to
    // PARTIAL, so isStrongSupportLevel was false for evidence that is in fact
    // direct — and no tender could ever reach strong mandatory coverage.
    // "DIRECT" is evidence tied straight to the requirement; "SUPPORTED" is a
    // linked vault record backing it.
    case "DIRECT": return "FULL";
    case "SUPPORTED": return "SUBSTANTIAL";
    case "PARTIAL":
    // Explicitly weak states: linked but unverified, or invalidated by a later
    // analysis/plan change. They must stay PARTIAL so they never read as proof.
    case "NEEDS_CONFIRMATION":
    case "STALE": return "PARTIAL";
    case "N_A":
    case "NA":
    case "NOT_APPLICABLE": return "NOT_APPLICABLE";
    case "NOT_COVERED": return "NOT_COVERED";
    case "NONE": return "NONE";
    default: return v ? "PARTIAL" : "NONE";
  }
}

export function isStrongSupportLevel(level: SupportLevel): boolean {
  return level === "FULL" || level === "SUBSTANTIAL";
}

export type RequirementEvidenceProfile = {
  requirementId: string;
  title: string;
  description: string;
  requirementType: string;
  priority: string;
  /** What kind(s) of evidence this requirement needs — inferred from type + text. */
  evidenceNeeded: EvidenceKind[];
  /** Verbatim quote from the source tender file, if available. */
  sourceQuote: string | null;
  /** Page number in the source tender file, if available. */
  sourcePage: number | null;
  /** Section/heading reference (e.g. "Section A.2", "Annex 4"). */
  sectionReference: string | null;
  /** IDs of the ComplianceMatrix rows linked to this requirement. */
  linkedEvidenceIds: string[];
  /** Indicates the requirement has at least one strong link to reviewed evidence. */
  hasStrongEvidence: boolean;
};

// ─── Inputs from the DB layer ─────────────────────────────────────────

export type RequirementLikeForEvidence = {
  id: string;
  title: string;
  description: string;
  requirementType: string;
  priority: string;
  restrictions?: string | null;
  sectionReference?: string | null;
  sourceExactQuote?: string | null;
  sourcePageNumber?: number | null;
  complianceMatrixRows?: Array<{
    id: string;
    /** PARTIAL / SUBSTANTIAL / FULL / NONE etc. */
    supportLevel?: string | null;
    /** When the linked record is reviewed, this row counts as strong evidence. */
    evidenceSource?: string | null;
  }> | null;
};

// ─── Evidence-kind inference ─────────────────────────────────────────

const EVIDENCE_RULES: Array<{ kind: EvidenceKind; test: RegExp }> = [
  { kind: "EXPERT_CV",                    test: /\b(expert|key\s+staff|personnel|cv|curriculum\s+vitae|team\s+leader|project\s+manager|specialist)\b/i },
  { kind: "PROJECT_REFERENCE",            test: /\b(project\s+(reference|experience)|past\s+performance|similar\s+(project|assignment)|relevant\s+experience|portfolio)\b/i },
  { kind: "FINANCIAL_STATEMENT",          test: /\b(audited|financial\s+statements?|turnover|revenue|annual\s+report|profit|loss|balance\s+sheet|fiscal\s+year)\b/i },
  { kind: "LEGAL_REGISTRATION",           test: /\b(business\s+licen[cs]e|registration\s+certificate|incorporation|trade\s+licen[cs]e|grade\s+certificate|company\s+registration|good\s+standing)\b/i },
  { kind: "TAX_CERTIFICATE",              test: /\b(tax\s+clearance|tin\s+certificate|vat\s+certificate|tax\s+identification|withholding\s+tax)\b/i },
  { kind: "INSURANCE_CERTIFICATE",        test: /\b(insurance\s+certificate|professional\s+indemnity|public\s+liability|workers?'?\s+compensation)\b/i },
  { kind: "DECLARATION",                  test: /\b(declaration|undertaking|integrity\s+pact|self[-\s]declaration|power\s+of\s+attorney|sworn\s+statement)\b/i },
  { kind: "FORM_TEMPLATE",                test: /\b(bidder\s+(info|information)\s+form|bid\s+form|price\s+schedule|schedule\s+of\s+rates|form\s+\d|annex(ure)?\s+\d|appendix\s+\d|attachment\s+\d|template\s+to\s+(complete|fill))\b/i },
  { kind: "METHODOLOGY_NARRATIVE",        test: /\b(methodology|approach|work\s+plan|implementation\s+plan|technical\s+approach|inception\s+report|qa\s+plan|risk\s+management)\b/i },
  { kind: "EVIDENCE_OF_PAST_PERFORMANCE", test: /\b(completion\s+certificate|performance\s+certificate|client\s+testimonial|reference\s+letter|recommendation\s+letter)\b/i },
];

function inferEvidenceKindsFromText(text: string, requirementType: string): EvidenceKind[] {
  const out: EvidenceKind[] = [];
  const seen = new Set<EvidenceKind>();

  // requirementType is the strongest signal — map directly.
  const t = requirementType.toUpperCase();
  if (t === "EXPERT") { out.push("EXPERT_CV"); seen.add("EXPERT_CV"); }
  if (t === "PROJECT_EXPERIENCE") { out.push("PROJECT_REFERENCE"); seen.add("PROJECT_REFERENCE"); }
  if (t === "FORM" || t === "SCHEDULE" || t === "ANNEX") { out.push("FORM_TEMPLATE"); seen.add("FORM_TEMPLATE"); }
  if (t === "DECLARATION") { out.push("DECLARATION"); seen.add("DECLARATION"); }
  if (t === "METHODOLOGY") { out.push("METHODOLOGY_NARRATIVE"); seen.add("METHODOLOGY_NARRATIVE"); }

  // Then enrich from the text — multiple kinds can apply (e.g. an
  // ELIGIBILITY requirement that wants both LEGAL_REGISTRATION and
  // TAX_CERTIFICATE).
  for (const rule of EVIDENCE_RULES) {
    if (seen.has(rule.kind)) continue;
    if (rule.test.test(text)) {
      out.push(rule.kind);
      seen.add(rule.kind);
    }
  }

  if (out.length === 0) out.push("GENERAL");
  return out;
}

// ─── Profile builder ────────────────────────────────────────────────

function isStrongComplianceLink(row: { supportLevel?: string | null }): boolean {
  return isStrongSupportLevel(normalizeSupportLevel(row.supportLevel));
}

/**
 * Build the spec's structured RequirementEvidenceProfile for a single
 * requirement. Pure function — no DB hit, no AI call.
 */
export function buildRequirementEvidenceProfile(req: RequirementLikeForEvidence): RequirementEvidenceProfile {
  const text = `${req.title} ${req.description} ${req.restrictions ?? ""}`;
  const evidenceNeeded = inferEvidenceKindsFromText(text, req.requirementType);
  const links = req.complianceMatrixRows ?? [];

  return {
    requirementId: req.id,
    title: req.title,
    description: req.description,
    requirementType: req.requirementType,
    priority: req.priority,
    evidenceNeeded,
    sourceQuote: req.sourceExactQuote ?? null,
    sourcePage: req.sourcePageNumber ?? null,
    sectionReference: req.sectionReference ?? null,
    linkedEvidenceIds: links.map((row) => row.id),
    hasStrongEvidence: links.some(isStrongComplianceLink),
  };
}

// ─── Tender-wide evidence coverage ───────────────────────────────────

export type EvidenceCoverageReport = {
  totalRequirements: number;
  requirementsWithLinkedEvidence: number;
  requirementsWithStrongEvidence: number;
  /** 0-100 percent of requirements with ≥1 strong link (FULL / SUBSTANTIAL). */
  strongCoveragePercent: number;
  /** 0-100 percent of requirements with ≥1 link of any support level. */
  anyCoveragePercent: number;
  /** Per-requirement profile array for UI consumption. */
  profiles: RequirementEvidenceProfile[];
  /** Mandatory-requirement-only stats (priority === "MANDATORY"). */
  totalMandatory: number;
  fullyCoveredMandatory: number;
  /** 0–1 ratio of mandatory requirements with strong evidence coverage. */
  coverageRatio: number;
};

/**
 * Computes the tender-wide evidence coverage from a list of requirements
 * (with their complianceMatrixRows pre-loaded by the caller).
 *
 * "Evidence coverage should rise only when requirements are linked to
 * reviewed evidence" — this matches the Gap 14 acceptance criterion:
 * we only count FULL / SUBSTANTIAL compliance rows toward
 * strongCoveragePercent. PARTIAL counts toward anyCoveragePercent only.
 */
export function computeEvidenceCoverage(requirements: RequirementLikeForEvidence[]): EvidenceCoverageReport {
  const profiles = requirements.map(buildRequirementEvidenceProfile);
  const total = profiles.length;
  const withAny = profiles.filter((p) => p.linkedEvidenceIds.length > 0).length;
  const withStrong = profiles.filter((p) => p.hasStrongEvidence).length;
  const mandatoryProfiles = profiles.filter((p) => p.priority?.toUpperCase() === "MANDATORY");
  const totalMandatory = mandatoryProfiles.length;
  const fullyCoveredMandatory = mandatoryProfiles.filter((p) => p.hasStrongEvidence).length;
  return {
    totalRequirements: total,
    requirementsWithLinkedEvidence: withAny,
    requirementsWithStrongEvidence: withStrong,
    strongCoveragePercent: total === 0 ? 0 : Math.round((withStrong / total) * 100),
    anyCoveragePercent: total === 0 ? 0 : Math.round((withAny / total) * 100),
    profiles,
    totalMandatory,
    fullyCoveredMandatory,
    coverageRatio: totalMandatory === 0 ? 0 : fullyCoveredMandatory / totalMandatory,
  };
}
