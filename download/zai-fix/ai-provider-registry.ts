/**
 * QUARANTINED ARTIFACT — DO NOT COPY INTO PRODUCTION.
 *
 * This file previously expanded Z.ai model allowlists based on unverified model
 * names. Release stabilization requires the opposite: do not guess model names,
 * classify Z.ai HTTP 400 model/configuration failures as CONFIGURATION_INVALID
 * or MODEL_UNAVAILABLE, quarantine the provider for a bounded cooldown, and
 * continue through the canonical provider order safely.
 *
 * The production fix must be implemented in the real application source tree
 * with schema-aware tests, provider-classification tests, raw-error leak tests,
 * and strict generation/export/ZIP gate tests.
 */
export const QUARANTINED_ZAI_PATCH = true;
