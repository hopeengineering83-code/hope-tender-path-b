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
