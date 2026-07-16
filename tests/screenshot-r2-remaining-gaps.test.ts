// SCREENSHOT-R2 — Remaining screenshot gap repair tests
// Tests for:
// 1. History page Actions column: whitespace-nowrap + flex-wrap for mobile
// 2. Analytics page: empty state when zero tenders
// 3. History page: status display is human-readable (no raw EXTRACTION_CORRUPTED)
// 4. Admin page: /dashboard/admin no longer returns 404 (page.tsx exists)
// 5. Dashboard overview: activity feed description uses line-clamp to prevent overflow

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

describe("SCREENSHOT-R2 Gap #1 — history page mobile Actions column", () => {
  it("Actions header has whitespace-nowrap to prevent truncation", () => {
    const src = readFileSync("app/dashboard/history/page.tsx", "utf8");
    assert.match(
      src,
      /whitespace-nowrap.*Actions/,
      "Actions header must have whitespace-nowrap to prevent text truncation on mobile",
    );
  });

  it("Actions cell uses flex-wrap to allow wrapping on narrow screens", () => {
    const src = readFileSync("app/dashboard/history/page.tsx", "utf8");
    assert.match(
      src,
      /flex-wrap.*items-center.*gap-2/,
      "Actions cell must use flex-wrap to prevent button truncation on mobile",
    );
  });
});

describe("SCREENSHOT-R2 Gap #2 — analytics page empty state", () => {
  it("analytics page has empty state when tenders.length === 0", () => {
    const src = readFileSync("app/dashboard/analytics/page.tsx", "utf8");
    assert.match(
      src,
      /tenders\.length === 0/,
      "Analytics page must check for zero tenders and show an empty state",
    );
  });

  it("empty state includes a 'New Tender' call-to-action link", () => {
    const src = readFileSync("app/dashboard/analytics/page.tsx", "utf8");
    assert.match(
      src,
      /No tender data yet/,
      "Analytics page must show 'No tender data yet' message when empty",
    );
    assert.match(
      src,
      /\/dashboard\/tenders\/new/,
      "Analytics empty state must include a link to create a new tender",
    );
  });

  it("main content is wrapped in tenders.length > 0 conditional", () => {
    const src = readFileSync("app/dashboard/analytics/page.tsx", "utf8");
    assert.match(
      src,
      /tenders\.length > 0/,
      "Analytics page must only render main content when tenders exist",
    );
  });
});

describe("SCREENSHOT-R2 Gap #3 — no false status labels in history", () => {
  it("history page does not hardcode 'EXTRACTION CORRUPTED' text", () => {
    const src = readFileSync("app/dashboard/history/page.tsx", "utf8");
    assert.ok(
      !src.includes("EXTRACTION CORRUPTED"),
      "History page must not hardcode 'EXTRACTION CORRUPTED' — use StatusBadge component",
    );
    assert.match(
      src,
      /StatusBadge/,
      "History page must use StatusBadge component for status display",
    );
  });
});

describe("SCREENSHOT-R2 Gap #4 — admin page 404 fix", () => {
  it("app/dashboard/admin/page.tsx exists", () => {
    assert.ok(
      existsSync("app/dashboard/admin/page.tsx"),
      "app/dashboard/admin/page.tsx must exist to fix the 404 error",
    );
  });

  it("admin page checks for ADMIN role", () => {
    const src = readFileSync("app/dashboard/admin/page.tsx", "utf8");
    assert.match(
      src,
      /ADMIN/,
      "Admin page must check for ADMIN role before granting access",
    );
    assert.match(
      src,
      /redirect/,
      "Admin page must redirect non-admin users",
    );
  });

  it("admin page links to sub-pages", () => {
    const src = readFileSync("app/dashboard/admin/page.tsx", "utf8");
    assert.match(src, /ai-readiness/, "Admin page must link to AI Readiness sub-page");
    assert.match(src, /safety-center/, "Admin page must link to Safety Center sub-page");
    assert.match(src, /users/, "Admin page must link to User Management");
    assert.match(src, /system/, "Admin page must link to System Status");
  });
});

describe("SCREENSHOT-R2 Gap #5 — dashboard activity feed overflow", () => {
  it("activity feed description uses line-clamp to prevent overflow", () => {
    const src = readFileSync("app/dashboard/page.tsx", "utf8");
    assert.match(
      src,
      /line-clamp-2/,
      "Dashboard activity feed description must use line-clamp-2 to prevent text overflow",
    );
  });
});
