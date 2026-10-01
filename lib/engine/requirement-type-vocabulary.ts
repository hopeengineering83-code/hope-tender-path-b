// The canonical TenderRequirement.requirementType vocabulary, and the
// normalization every write boundary must pass model output through.
//
// WHY THIS EXISTS
// ---------------
// The AI Analyze prompt asks for one of thirteen values (lib/ai.ts) and the
// deterministic classifier in lib/engine/analysis.ts returns exactly those
// thirteen. The promotion path, however, wrote the model's string straight to
// the column with no check, so a near-miss synonym — "EXPERIENCE" instead of
// "PROJECT_EXPERIENCE" is the one observed in a real run — was persisted as-is.
//
// Nothing failed loudly. It failed by omission: the main engine's selection
// policy sizes its project limit with
// requirementLimit(requirements, "PROJECT_EXPERIENCE", 3), which returns 0 when
// no requirement carries that exact spelling, so selectBestAuthoritativeProjects
// returned early and NO project match was ever auto-selected — including one
// scoring 0.645, comfortably above the 0.55 safe floor. Generation then blocked
// asking for selected matches. A synonym from the model silently disabled a
// whole automatic step.
//
// Models return synonyms. That is not a defect in the model, it is an input the
// boundary has to normalize.

export const CANONICAL_REQUIREMENT_TYPES = [
  "TECHNICAL",
  "FINANCIAL",
  "ELIGIBILITY",
  "EXPERT",
  "PROJECT_EXPERIENCE",
  "FORMAT",
  "SUBMISSION_RULE",
  "DECLARATION",
  "ANNEX",
  "SCHEDULE",
  "FORM",
  "METHODOLOGY",
  "COMPANY_PROFILE",
] as const;

export type CanonicalRequirementType = (typeof CANONICAL_REQUIREMENT_TYPES)[number];

const CANONICAL_SET = new Set<string>(CANONICAL_REQUIREMENT_TYPES);

/**
 * Synonyms observed from models or written by older code paths, mapped to the
 * canonical spelling. Keys are compared after upper-casing and collapsing any
 * run of non-alphanumeric characters to a single underscore, so "project
 * experience", "project-experience" and "PROJECT_EXPERIENCE" all agree.
 *
 * Only add a mapping when the synonym unambiguously means the canonical value.
 * Anything genuinely ambiguous must fall through to the safe default rather
 * than be guessed into a type that changes selection or packaging behaviour.
 */
const SYNONYMS: Record<string, CanonicalRequirementType> = {
  EXPERIENCE: "PROJECT_EXPERIENCE",
  RELEVANT_EXPERIENCE: "PROJECT_EXPERIENCE",
  PAST_EXPERIENCE: "PROJECT_EXPERIENCE",
  PROJECT_REFERENCE: "PROJECT_EXPERIENCE",
  PROJECT_REFERENCES: "PROJECT_EXPERIENCE",
  REFERENCE_PROJECT: "PROJECT_EXPERIENCE",
  SIMILAR_PROJECT: "PROJECT_EXPERIENCE",
  TRACK_RECORD: "PROJECT_EXPERIENCE",
  PAST_PERFORMANCE: "PROJECT_EXPERIENCE",
  PERSONNEL: "EXPERT",
  STAFF: "EXPERT",
  STAFFING: "EXPERT",
  KEY_PERSONNEL: "EXPERT",
  KEY_EXPERT: "EXPERT",
  CV: "EXPERT",
  QUALIFICATION: "ELIGIBILITY",
  QUALIFICATIONS: "ELIGIBILITY",
  LEGAL: "ELIGIBILITY",
  COMPLIANCE: "ELIGIBILITY",
  PRICE: "FINANCIAL",
  PRICING: "FINANCIAL",
  COST: "FINANCIAL",
  BUDGET: "FINANCIAL",
  SUBMISSION: "SUBMISSION_RULE",
  SUBMISSION_REQUIREMENT: "SUBMISSION_RULE",
  APPENDIX: "ANNEX",
  ATTACHMENT: "ANNEX",
  TIMELINE: "SCHEDULE",
  WORK_PLAN: "SCHEDULE",
  APPROACH: "METHODOLOGY",
  METHOD: "METHODOLOGY",
  COMPANY: "COMPANY_PROFILE",
  PROFILE: "COMPANY_PROFILE",
};

/**
 * The value used when a requirement type is missing or cannot be resolved.
 *
 * TECHNICAL is deliberately the fallback: it is the type that grants a
 * requirement no special selection, quantity or packaging treatment, so an
 * unrecognized value degrades to "an ordinary requirement" rather than being
 * guessed into EXPERT or PROJECT_EXPERIENCE and pulling evidence into a
 * proposal on the strength of a spelling.
 */
export const DEFAULT_REQUIREMENT_TYPE: CanonicalRequirementType = "TECHNICAL";

function lookupKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Resolve any inbound requirement type to the canonical vocabulary.
 *
 * Returns null only for input that is absent or empty; every other input
 * resolves to a canonical value so the column can never hold a spelling the
 * gates and selection policy do not recognise.
 */
export function normalizeRequirementType(value: unknown): CanonicalRequirementType | null {
  if (typeof value !== "string") return null;
  const key = lookupKey(value);
  if (key.length === 0) return null;
  if (CANONICAL_SET.has(key)) return key as CanonicalRequirementType;
  return SYNONYMS[key] ?? DEFAULT_REQUIREMENT_TYPE;
}

/** Convenience for write paths that must always store a value. */
export function normalizeRequirementTypeOrDefault(value: unknown): CanonicalRequirementType {
  return normalizeRequirementType(value) ?? DEFAULT_REQUIREMENT_TYPE;
}

/** True when the value is already canonical — used by regression tests. */
export function isCanonicalRequirementType(value: unknown): value is CanonicalRequirementType {
  return typeof value === "string" && CANONICAL_SET.has(value);
}
