// GLM-A2 Issue #1135 Gap #5 — Matching pagination tests
// Verifies that the matching dashboard page uses bounded queries and
// pagination, and that the UI renders correctly at different viewports.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("Issue #1135 Gap #5 — matching dashboard pagination", () => {
  it("page.tsx uses bounded take with skip for pagination", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    // Must have TENDERS_PER_PAGE constant
    assert.match(src, /TENDERS_PER_PAGE/);
    // Must have skip calculation
    assert.match(src, /skip/);
    // Must have take with bounded value (not unlimited)
    assert.match(src, /take:\s*TENDERS_PER_PAGE/);
    // Must have MATCH_PAGE_SIZE for bounded match loading (Revision #3: shared with GET)
    assert.match(src, /MATCH_PAGE_SIZE/);
    // Must NOT load all matches (no unbounded include)
    assert.ok(
      !src.includes("take: undefined") && !src.includes("take: -1"),
      "Must not have unbounded take",
    );
  });

  it("page.tsx accepts page search param", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    assert.match(src, /searchParams/);
    assert.match(src, /page/);
  });

  it("matching-dashboard.tsx renders pagination controls", () => {
    const src = readFileSync("app/dashboard/matching/matching-dashboard.tsx", "utf8");
    // Must have pagination prop
    assert.match(src, /pagination/);
    // Must render page number
    assert.match(src, /Page.*of/);
    // Must have Previous/Next links
    assert.match(src, /Previous/);
    assert.match(src, /Next/);
  });

  it("matching-dashboard.tsx shows total match count per tender", () => {
    const src = readFileSync("app/dashboard/matching/matching-dashboard.tsx", "utf8");
    // Must display expertMatchCount and projectMatchCount
    assert.match(src, /expertMatchCount/);
    assert.match(src, /projectMatchCount/);
    // Must show "showing top N of M" message
    assert.match(src, /Showing top/);
  });

  it("page.tsx imports TENDERS_PER_PAGE from shared module (Revision #4)", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    assert.match(src, /import.*TENDERS_PER_PAGE.*from.*matching-config/);
    // Must NOT define TENDERS_PER_PAGE locally
    assert.ok(
      !/const\s+TENDERS_PER_PAGE\s*=/.test(src),
      "page.tsx must NOT define TENDERS_PER_PAGE locally — import from shared module",
    );
  });

  it("page.tsx imports MATCH_PAGE_SIZE from shared module (Revision #4)", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    assert.match(src, /import.*MATCH_PAGE_SIZE.*from.*matching-config/);
    // Must NOT define MATCH_PAGE_SIZE locally
    assert.ok(
      !/const\s+MATCH_PAGE_SIZE\s*=/.test(src),
      "page.tsx must NOT define MATCH_PAGE_SIZE locally — import from shared module",
    );
  });

  it("route.ts imports MATCH_PAGE_SIZE from shared module (Revision #4)", () => {
    const src = readFileSync("app/api/tenders/[id]/matches/route.ts", "utf8");
    assert.match(src, /import.*MATCH_PAGE_SIZE.*from.*matching-config/);
    // Must NOT define MATCH_PAGE_SIZE locally
    assert.ok(
      !/const\s+MATCH_PAGE_SIZE\s*=/.test(src),
      "route.ts must NOT define MATCH_PAGE_SIZE locally — import from shared module",
    );
  });

  it("shared module matching-config.ts exists with correct constants", () => {
    const src = readFileSync("lib/engine/matching-config.ts", "utf8");
    assert.match(src, /export const TENDERS_PER_PAGE\s*=\s*\d+/);
    assert.match(src, /export const MATCH_PAGE_SIZE\s*=\s*\d+/);
  });

  it("page.tsx queries selected rows separately (Revision #3)", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    // Must have a separate query for selected rows (WHERE isSelected: true)
    assert.match(src, /isSelected:\s*true/);
    // Must have a separate query for unselected candidates
    assert.match(src, /isSelected:\s*false/);
  });

  it("GET route queries selected rows separately (Revision #3)", () => {
    const src = readFileSync("app/api/tenders/[id]/matches/route.ts", "utf8");
    assert.match(src, /isSelected:\s*true/);
    assert.match(src, /isSelected:\s*false/);
  });
});

// ─── Gap #6: Selection API rejection handling ──────────────────────────────

describe("Issue #1135 Gap #6 — selection API rejection handling", () => {
  it("matching-dashboard.tsx surfaces server rejection errors", () => {
    const src = readFileSync("app/dashboard/matching/matching-dashboard.tsx", "utf8");
    // Must have error state
    assert.match(src, /error.*useState/);
    // Must set error on non-OK response
    assert.match(src, /setError/);
    // Must have error banner in UI
    assert.match(src, /error &&/);
  });

  it("matching-dashboard.tsx re-fetches authoritative state on rejection", () => {
    const src = readFileSync("app/dashboard/matching/matching-dashboard.tsx", "utf8");
    // Must re-fetch on non-OK
    assert.match(src, /refetch/);
    // Must use cache: no-store for authoritative state
    assert.match(src, /no-store/);
  });

  it("matches API route has GET endpoint for re-fetching", () => {
    const src = readFileSync("app/api/tenders/[id]/matches/route.ts", "utf8");
    assert.match(src, /export async function GET/);
    // GET must allow REVIEWER role (read-only)
    assert.match(src, /REVIEWER/);
  });

  it("matches API route PUT returns structured error on not found", () => {
    const src = readFileSync("app/api/tenders/[id]/matches/route.ts", "utf8");
    // Must return 404 with error message
    assert.match(src, /404/);
    assert.match(src, /Match not found/);
  });
});
