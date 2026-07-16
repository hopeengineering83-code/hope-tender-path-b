// SCREENSHOT-R2 — Remaining screenshot gap repair tests
// Tests for:
// 1. History page Actions column: whitespace-nowrap + flex-wrap for mobile
// 2. Analytics page: empty state when zero tenders
// 3. History page: status display is human-readable (no raw EXTRACTION_CORRUPTED)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
    // The page should use StatusBadge component, not hardcode status strings
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
