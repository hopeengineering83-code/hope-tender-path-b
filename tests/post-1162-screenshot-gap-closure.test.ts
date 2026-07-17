// Post-1162 screenshot gap closure tests
// Tests for F-03, F-05, F-08, F-12 fixes

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("F-03 — Matching page bounded take on match includes", () => {
  it("page.tsx has a MATCH_TAKE constant for bounding match queries", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    assert.match(
      src,
      /MATCH_TAKE/,
      "Matching page must define a MATCH_TAKE constant to bound match queries",
    );
  });

  it("expertMatches include has take: MATCH_TAKE", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    assert.match(
      src,
      /expertMatches[\s\S]*?take:\s*MATCH_TAKE/,
      "expertMatches include must have take: MATCH_TAKE to prevent unbounded loading",
    );
  });

  it("projectMatches include has take: MATCH_TAKE", () => {
    const src = readFileSync("app/dashboard/matching/page.tsx", "utf8");
    assert.match(
      src,
      /projectMatches[\s\S]*?take:\s*MATCH_TAKE/,
      "projectMatches include must have take: MATCH_TAKE to prevent unbounded loading",
    );
  });
});

describe("F-05 — AI readiness table mobile overflow fix", () => {
  it("does NOT use overflow-hidden on the section", () => {
    const src = readFileSync("app/dashboard/admin/ai-readiness/page.tsx", "utf8");
    // Check that no actual className uses overflow-hidden (comments are OK)
    const lines = src.split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("{/*"));
    const codeWithoutComments = lines.join("\n");
    assert.ok(
      !/className="[^"]*overflow-hidden/.test(codeWithoutComments),
      "AI readiness section must NOT use overflow-hidden in className — it clips table columns on mobile",
    );
  });

  it("has overflow-x-auto wrapper for desktop table", () => {
    const src = readFileSync("app/dashboard/admin/ai-readiness/page.tsx", "utf8");
    assert.match(
      src,
      /overflow-x-auto/,
      "AI readiness must have overflow-x-auto wrapper for horizontal scroll fallback",
    );
  });

  it("has mobile card layout (sm:hidden)", () => {
    const src = readFileSync("app/dashboard/admin/ai-readiness/page.tsx", "utf8");
    assert.match(
      src,
      /sm:hidden/,
      "AI readiness must have a mobile card layout hidden on sm+ screens",
    );
  });

  it("has desktop table hidden on mobile (hidden sm:block)", () => {
    const src = readFileSync("app/dashboard/admin/ai-readiness/page.tsx", "utf8");
    assert.match(
      src,
      /hidden sm:block/,
      "AI readiness desktop table must be hidden on mobile",
    );
  });

  it("mobile cards show Scope, Severity, and Purpose", () => {
    const src = readFileSync("app/dashboard/admin/ai-readiness/page.tsx", "utf8");
    const mobileSection = src.split("sm:hidden")[1] ?? "";
    assert.ok(mobileSection.includes("variable.scope"), "Mobile cards must show Scope");
    assert.ok(mobileSection.includes("variable.severity"), "Mobile cards must show Severity");
    assert.ok(mobileSection.includes("variable.note"), "Mobile cards must show Purpose");
  });
});

describe("F-08 — Documents page heading truthfulness", () => {
  it("heading says 'Document Workspace' not 'Generated Documents'", () => {
    const src = readFileSync("app/dashboard/documents/page.tsx", "utf8");
    assert.match(
      src,
      /Document Workspace/,
      "Documents page heading must say 'Document Workspace' not 'Generated Documents'",
    );
    assert.ok(
      !src.includes("Generated Documents"),
      "Documents page must NOT say 'Generated Documents' — it's misleading when 0 are generated",
    );
  });
});

describe("F-12 — 404 page label/destination agreement", () => {
  it("404 page says 'Return home' when linking to '/'", () => {
    const src = readFileSync("app/not-found.tsx", "utf8");
    assert.match(
      src,
      /Return home/,
      "404 page must say 'Return home' when linking to '/'",
    );
    assert.ok(
      !src.includes("Return to dashboard"),
      "404 page must NOT say 'Return to dashboard' when linking to '/' — label must match destination",
    );
  });
});
