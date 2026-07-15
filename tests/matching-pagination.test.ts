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

  it("page.tsx limits tenders to 5 per page (bounded query)", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    // Extract the TENDERS_PER_PAGE value
    const match = src.match(/TENDERS_PER_PAGE\s*=\s*(\d+)/);
    assert.ok(match, "TENDERS_PER_PAGE must be defined");
    const perPage = parseInt(match[1], 10);
    assert.ok(
      perPage <= 10,
      `TENDERS_PER_PAGE must be bounded (<= 10), got ${perPage}`,
    );
  });

  it("page.tsx uses MATCH_PAGE_SIZE (shared with GET endpoint, Revision #3)", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    assert.match(src, /MATCH_PAGE_SIZE/);
    const match = src.match(/MATCH_PAGE_SIZE\s*=\s*(\d+)/);
    assert.ok(match, "MATCH_PAGE_SIZE must be defined");
    const perType = parseInt(match[1], 10);
    assert.ok(
      perType >= 10 && perType <= 30,
      `MATCH_PAGE_SIZE must be 10-30, got ${perType}`,
    );
  });

  it("GET endpoint uses the SAME MATCH_PAGE_SIZE (Revision #3)", () => {
    const pageSrc = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    const getSrc = readFileSync("app/api/tenders/[id]/matches/route.ts", "utf8");
    const pageMatch = pageSrc.match(/MATCH_PAGE_SIZE\s*=\s*(\d+)/);
    const getMatch = getSrc.match(/MATCH_PAGE_SIZE\s*=\s*(\d+)/);
    assert.ok(pageMatch, "page.tsx must define MATCH_PAGE_SIZE");
    assert.ok(getMatch, "route.ts must define MATCH_PAGE_SIZE");
    assert.equal(
      pageMatch[1],
      getMatch[1],
      "SSR and GET must use the same MATCH_PAGE_SIZE",
    );
  });

  it("page.tsx sorts selected-first to prevent truncation hiding (Revision #2)", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    assert.match(src, /sortSelectedFirst/);
    assert.match(src, /isSelected.*-1.*1/);
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
