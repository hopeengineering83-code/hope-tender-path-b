export type AuthorityState = 
  | "SOURCE_GROUNDED_CONFIRMED" | "SOURCE_GROUNDED_UNUSUAL_FORMAT" | "HUMAN_CONFIRMED_OPERATIONAL"
  | "CANDIDATE_NEEDS_REVIEW" | "NOT_STATED_IN_SOURCE" | "CONDITIONAL_OR_UNSCHEDULED" | "REJECTED_EXTRACTION";

const GARBAGE_VALUES = new Set(["not", "n/a", "tbd", "none", "null", "unknown", "pending", "tbc"]);

export function classifyReferenceNumber(value: string): { isValid: boolean; state: AuthorityState } {
  const trimmed = value.trim();
  if (!trimmed) return { isValid: false, state: "NOT_STATED_IN_SOURCE" };
  if (GARBAGE_VALUES.has(trimmed.toLowerCase())) return { isValid: false, state: "REJECTED_EXTRACTION" };
  if (/^[a-zA-Z0-9\s\-\/\.\_]+$/.test(trimmed) && trimmed.length > 1) {
    return { isValid: true, state: "SOURCE_GROUNDED_CONFIRMED" };
  }
  return { isValid: false, state: "CANDIDATE_NEEDS_REVIEW" };
}

export function classifySubmissionMethod(value: string): { isValid: boolean; normalized: string; state: AuthorityState } {
  const lower = value.toLowerCase().trim();
  if (!lower) return { isValid: false, normalized: "UNKNOWN", state: "NOT_STATED_IN_SOURCE" };
  if (GARBAGE_VALUES.has(lower)) return { isValid: false, normalized: "UNKNOWN", state: "REJECTED_EXTRACTION" };

  if (lower.includes("email") || lower.includes("e-mail")) return { isValid: true, normalized: "EMAIL", state: "SOURCE_GROUNDED_CONFIRMED" };
  if (lower.includes("portal") || lower.includes("e-procurement")) return { isValid: true, normalized: "PORTAL", state: "SOURCE_GROUNDED_CONFIRMED" };
  if (lower.includes("physical") || lower.includes("sealed envelope") || lower.includes("delivery")) return { isValid: true, normalized: "PHYSICAL", state: "SOURCE_GROUNDED_CONFIRMED" };
  if (lower.includes("hybrid")) return { isValid: true, normalized: "HYBRID", state: "SOURCE_GROUNDED_CONFIRMED" };

  return { isValid: false, normalized: "UNKNOWN", state: "CANDIDATE_NEEDS_REVIEW" };
}

export function classifyConditionalNote(value: string): { isConditional: boolean; state: AuthorityState } {
  const lower = value.toLowerCase();
  const phrases = ["to be determined", "tbd", "exact site to be determined", "will be arranged", "not yet determined", "later date"];
  for (const phrase of phrases) {
    if (lower.includes(phrase)) return { isConditional: true, state: "CONDITIONAL_OR_UNSCHEDULED" };
  }
  return { isConditional: false, state: "SOURCE_GROUNDED_CONFIRMED" };
}
