/**
 * Neutral submission-method classification module.
 *
 * Extracted from tender-metadata-completeness.ts to break a circular
 * import: tender-policy-registry.ts imports submission-method helpers
 * from tender-metadata-completeness.ts, and if completeness imported
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
  return /sealed\s*envelope|hard\s*copy|physical\s*deliver|hand\s*deliver|in\s*person|drop[\s-]?off|courier|registered\s*mail|post|by\s*hand/i.test(method);
}

/**
 * Returns true when the submission method is email-based, meaning the
 * exact email subject line (if the tender specifies one) is required.
 */
export function isEmailSubmissionMethod(method?: string | null): boolean {
  if (!method) return false;
  return /\bemail\b|\be-?mail\b/i.test(method) && !/portal|online|upload/i.test(method);
}

/**
 * Returns true when the submission method is portal/online-based.
 */
export function isPortalSubmissionMethod(method?: string | null): boolean {
  if (!method) return false;
  return /portal|online\s*submission|upload|e-?procurement|e-?tender/i.test(method);
}
