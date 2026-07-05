// Regression tests for quality gap fixes — Phase 22.
//
// Phase 22 covers two targeted hardening improvements:
//
//   1. ZIP authority review gap closed:
//      The download route's zipPackage() was only blocking on
//      authorityResult.status === "BLOCKED", allowing "NEEDS_REVIEW" documents
//      through into the final ZIP. Now any status !== "AUTHORITY_READY" blocks
//      the ZIP, consistent with the single-document download gate and the
//      export route.
//
//   2. Empty submission plan with mandatory requirements:
//      When a tender has mandatory requirements but no submission plan has been
//      built (requiredPlanCount === 0, no explicit scope), a HIGH tender-level
//      blocker MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN is now raised in
//      final-submission-readiness.ts.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

// ── 1. ZIP authority review gap ───────────────────────────────────────────────

describe("phase 22 — ZIP authority review blocks NEEDS_REVIEW (not just BLOCKED)", () => {
  it("download route blocks ZIP when authority status is not AUTHORITY_READY (static audit)", () => {
    const src = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
    // Must use !== "AUTHORITY_READY" for the ZIP path, not === "BLOCKED"
    assert.ok(
      src.includes('authorityResult.status !== "AUTHORITY_READY"'),
      "ZIP path must check status !== AUTHORITY_READY to catch both BLOCKED and NEEDS_REVIEW",
    );
  });

  it("download route uses AUTHORITY_REVIEW_NEEDS_REVIEW error code for NEEDS_REVIEW status (static audit)", () => {
    const src = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
    assert.ok(
      src.includes("AUTHORITY_REVIEW_NEEDS_REVIEW"),
      "download route must emit AUTHORITY_REVIEW_NEEDS_REVIEW code when status is NEEDS_REVIEW",
    );
  });

  it("download route still emits AUTHORITY_REVIEW_BLOCKED for BLOCKED status (static audit)", () => {
    const src = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
    assert.ok(
      src.includes("AUTHORITY_REVIEW_BLOCKED"),
      "download route must still emit AUTHORITY_REVIEW_BLOCKED for the BLOCKED case",
    );
  });

  it("single-document download gate is also !== AUTHORITY_READY (regression check)", () => {
    const src = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
    // The single-doc path (unchanged) also uses !== "AUTHORITY_READY"
    assert.ok(
      (src.match(/!== "AUTHORITY_READY"/g) ?? []).length >= 2,
      "both single-doc and ZIP download paths must use !== AUTHORITY_READY",
    );
  });
});

// ── 2. Empty submission plan with mandatory requirements ─────────────────────

describe("phase 22 — empty submission plan with mandatory requirements blocks export", () => {
  it("MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN category is present in source (static audit)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    assert.ok(
      src.includes("MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN"),
      "final-submission-readiness must have MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN blocker",
    );
  });

  it("blocker fires when requiredPlanCount === 0 and mandatory requirements exist (static audit)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    assert.ok(
      src.includes("requiredPlanCount === 0") && src.includes("mandatoryRequirements.length > 0"),
      "blocker condition must check both requiredPlanCount === 0 and mandatoryRequirements.length > 0",
    );
  });

  it("blocker requires no explicit plan scope to avoid false positives (static audit)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    // The condition must include !hasExplicitPlanScope so tenders with
    // confirmed-empty plans (rare) don't trigger a false alarm.
    assert.ok(
      src.includes("!hasExplicitPlanScope") && src.includes("MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN"),
      "MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN blocker must check !hasExplicitPlanScope",
    );
  });

  it("blocker severity is HIGH (static audit)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    const idx = src.indexOf("MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN");
    assert.ok(idx !== -1, "blocker category must exist");
    const snippet = src.slice(idx, idx + 300);
    assert.ok(snippet.includes('"HIGH"'), "MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN must have HIGH severity");
  });

  it("blocker recommends Build Plan action (static audit)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    const idx = src.indexOf("MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN");
    const snippet = src.slice(idx, idx + 400);
    assert.ok(
      snippet.includes("Build Plan") || snippet.includes("Build Submission Plan"),
      "blocker recommended action must mention Build Plan",
    );
  });
});

// ── 3. Regression checks ──────────────────────────────────────────────────────

describe("phase 22 — regression: prior export/authority checks unchanged", () => {
  it("export route still checks authority review and blocks when not AUTHORITY_READY", () => {
    const src = readFileSync("app/api/tenders/[id]/export/route.ts", "utf8");
    assert.ok(src.includes("runAuthorityReview"), "export route must still call runAuthorityReview");
    assert.ok(
      src.includes('!== "AUTHORITY_READY"'),
      "export route must block when status !== AUTHORITY_READY",
    );
  });

  it("SUBMISSION_PLAN_DERIVED_UNCONFIRMED still exists (not replaced)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    assert.ok(
      src.includes("SUBMISSION_PLAN_DERIVED_UNCONFIRMED"),
      "existing SUBMISSION_PLAN_DERIVED_UNCONFIRMED blocker must remain intact",
    );
  });
});
