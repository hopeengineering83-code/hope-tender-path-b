import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

// ─── Gap #5: Matching dashboard pagination ──────────────────────────────────

describe("Issue #1135 Gap #5 — matching dashboard pagination", () => {
  it("matching page reads and normalizes the page search parameter", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    assert.match(src, /searchParams/);
    assert.match(src, /Math\.max\(1/);
    assert.match(src, /parseInt\(params\.page/);
  });

  it("matching page paginates tenders with skip and take", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    assert.match(src, /skip,/);
    assert.match(src, /take:\s*TENDERS_PER_PAGE/);
    assert.match(src, /prisma\.tender\.count/);
  });

  it("matching page bounds unselected candidates per tender", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    assert.match(src, /take:\s*MATCH_PAGE_SIZE/);
    assert.match(src, /isSelected:\s*false/);
  });

  it("matching dashboard renders bounded page navigation", () => {
    const src = readFileSync("app/dashboard/matching/matching-dashboard.tsx", "utf8");
    assert.match(src, /pagination\.totalPages > 1/);
    assert.match(src, /Previous/);
    assert.match(src, /Next/);
    assert.match(src, /Page \{pagination\.page\} of \{pagination\.totalPages\}/);
  });

  it("matching dashboard reports total match counts separately from visible rows", () => {
    const src = readFileSync("app/dashboard/matching/matching-dashboard.tsx", "utf8");
    assert.match(src, /expertMatchCount/);
    assert.match(src, /projectMatchCount/);
    assert.match(src, /Showing persisted selections first/);
  });

  it("shared module matching-config.ts exists with correct constants", () => {
    const src = readFileSync("lib/engine/matching-config.ts", "utf8");
    assert.match(src, /export const TENDERS_PER_PAGE\s*=\s*\d+/);
    assert.match(src, /export const MATCH_PAGE_SIZE\s*=\s*\d+/);
  });

  it("page.tsx queries selected rows separately (Revision #3)", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    assert.match(src, /isSelected:\s*true/);
    assert.match(src, /isSelected:\s*false/);
  });

  it("GET route queries selected rows separately (Revision #3)", () => {
    const src = readFileSync("app/api/tenders/[id]/matches/route.ts", "utf8");
    assert.match(src, /isSelected:\s*true/);
    assert.match(src, /isSelected:\s*false/);
  });
});

// ─── Gap #6: Engine-owned selection authority ──────────────────────────────

describe("Issue #1135 Gap #6 — Engine-owned automatic selection", () => {
  it("matching-dashboard.tsx is read-only", () => {
    const src = readFileSync("app/dashboard/matching/matching-dashboard.tsx", "utf8");
    assert.match(src, /read-only view of persisted evidence/);
    assert.doesNotMatch(src, /method:\s*"PUT"|aria-pressed|>Select</);
  });

  it("matches API route has GET endpoint for re-fetching", () => {
    const src = readFileSync("app/api/tenders/[id]/matches/route.ts", "utf8");
    assert.match(src, /export async function GET/);
    assert.match(src, /REVIEWER/);
  });

  it("matches API route exposes no competing selection mutation", () => {
    const src = readFileSync("app/api/tenders/[id]/matches/route.ts", "utf8");
    assert.doesNotMatch(src, /export async function PUT|TENDER_EVIDENCE_SELECT/);
  });
});
