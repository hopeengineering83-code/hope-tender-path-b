/**
 * QUARANTINED ARTIFACT — DO NOT COPY INTO PRODUCTION.
 *
 * The previous diagnostic route performed live Z.ai model probing and returned
 * provider error snippets. That is not acceptable for production stabilization.
 * A safe replacement must be admin-only, read-only, must not perform repeated
 * calls to a quarantined provider, and must return only safe status,
 * remediation text, and correlation IDs. Technical provider details belong in
 * server-side logs only.
 */
export const QUARANTINED_ZAI_DIAGNOSTIC_ROUTE = true;
