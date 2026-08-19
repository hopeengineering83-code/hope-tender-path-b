// GLM-A2 Issue #1135 — Shared matching configuration constants.
//
// GLM-A2 Issue #1135 Revision #4: Page-size constant was duplicated in
// page.tsx and route.ts. This shared module is the single source of truth.
// Both files import from here so the contract cannot drift.

/** Number of tenders shown per page on the matching dashboard. */
export const TENDERS_PER_PAGE = 5;

/**
 * Number of match rows (per type: expert/project) shown per tender.
 * Used by both SSR (page.tsx) and GET (matches/route.ts) so re-fetch
 * after failure returns the same visible set.
 */
export const MATCH_PAGE_SIZE = 15;
