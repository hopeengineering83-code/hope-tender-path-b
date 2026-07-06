/**
 * Neutral submission-method classification module.
 *
 * Extracted from the completeness module to break a circular
 * import: the policy registry imports submission-method helpers
 * from the completeness module, and if completeness imported
 * the registry it would create a cycle.
 *
 * Both the policy registry and the completeness/resolver logic import
 * from THIS neutral module. No duplication of regexes.
 */

/**
 * Returns true when the submission method indicates a physical / sealed
 * envelope delivery, meaning a submission address is required.
 */
export function isPhysicalSubmissionMethod(method?: string | null): boolean {
  if (!method) return false;
  return /sealed[\s_-]*envelope|hard[\s_-]*copy|physical[\s_-]*deliver|hand[\s_-]*deliver|in[\s_-]*person|drop[\s_-]?off|courier|registered[\s_-]*mail|post|by[\s_-]*hand/i.test(method);
}

/**
 * Returns true when the submission method is email-based, meaning the
 * exact email subject line (if the tender specifies one) is required.
 */
export function isEmailSubmissionMethod(method?: string | null): boolean {
  if (!method) return false;
  // \b treats "_" as a word character, so enum-style values like
  // "EMAIL_SUBMISSION" would not match \bemail\b — use explicit non-alnum
  // boundaries to catch both prose ("Submit by email") and enum forms.
  return /(?:^|[^a-z0-9])e[\s_-]?mail(?:[^a-z0-9]|$)/i.test(method) && !/portal|online|upload/i.test(method);
}

/**
 * Returns true when the submission method is portal/online-based.
 */
export function isPortalSubmissionMethod(method?: string | null): boolean {
  if (!method) return false;
  return /portal|online[\s_-]*submission|upload|e[\s_-]?procurement|e[\s_-]?tender/i.test(method);
}

// ─── Normalized submission method ───────────────────────────────────────────

/**
 * Normalized submission method representation.
 * Preserves the original text while providing a controlled enum for
 * downstream consumers (BuildPlan hash, gates, UI).
 */
export type NormalizedSubmissionMethod = "EMAIL" | "PORTAL" | "PHYSICAL" | "HYBRID" | "UNKNOWN";

/**
 * Normalize a raw submission method string into a controlled representation.
 *
 * Rules:
 * - If the method matches BOTH email and physical (e.g., "email or sealed
 *   envelope"), return "HYBRID".
 * - If the method matches portal, return "PORTAL".
 * - If the method matches email (and not portal), return "EMAIL".
 * - If the method matches physical (and not email/portal), return "PHYSICAL".
 * - Otherwise, return "UNKNOWN".
 *
 * "UNKNOWN" must NEVER block draft work. For final submission, UNKNOWN may
 * block only when no authorized human-confirmed submission method is available.
 *
 * The original text is preserved on the Tender row — this function only
 * provides a canonical enum for hash computation and gate logic.
 */
export function normalizeSubmissionMethod(method?: string | null): NormalizedSubmissionMethod {
  if (!method || !method.trim()) return "UNKNOWN";
  const isEmail = isEmailSubmissionMethod(method);
  const isPortal = isPortalSubmissionMethod(method);
  const isPhysical = isPhysicalSubmissionMethod(method);
  if (isPortal) return "PORTAL";
  if (isEmail && isPhysical) return "HYBRID";
  if (isEmail) return "EMAIL";
  if (isPhysical) return "PHYSICAL";
  return "UNKNOWN";
}
