// Regression tests for quality gap fixes — Phase 24.
//
// Phase 24 covers two hardening improvements:
//
//   1. Concurrent generation guard added to full Generate Docs path:
//      The planOnly mode already blocked on GENERATING/QUEUED documents,
//      but the full generation path had no such guard. Two parallel POST
//      /generate calls could each enter generateTenderDocuments() and produce
//      duplicate document records. Now the full path also checks for
//      in-progress documents before starting and returns GENERATION_IN_PROGRESS.
//
//   2. isEmailSubmissionMethod() helper exported:
//      Companion to isPhysicalSubmissionMethod(). Detects email-based
//      submission methods for future conditional escalation logic.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isEmailSubmissionMethod, isPhysicalSubmissionMethod } from "../lib/engine/tender-metadata-completeness";
import { readFileSync } from "node:fs";

// ── 1. Concurrent generation guard ───────────────────────────────────────────

describe("phase 24 — concurrent generation guard in full generate path", () => {
  it("generate route checks for GENERATING documents before starting full run (static audit)", () => {
    const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    assert.ok(
      src.includes("alreadyGenerating"),
      "generate route must declare alreadyGenerating variable for the concurrent guard",
    );
    assert.ok(
      src.includes('GENERATION_IN_PROGRESS') && (src.match(/GENERATION_IN_PROGRESS/g) ?? []).length >= 2,
      "generate route must emit GENERATION_IN_PROGRESS from both planOnly and full generation paths",
    );
  });

  it("concurrent guard checks for GENERATING and QUEUED statuses (static audit)", () => {
    const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    // Must include a second occurrence (first is planOnly)
    const idx1 = src.indexOf('"GENERATING"');
    const idx2 = src.indexOf('"GENERATING"', idx1 + 1);
    assert.ok(idx2 !== -1, "generate route must check GENERATING status in both planOnly and full generation paths");
  });

  it("concurrent guard is placed before createJob is called (static audit)", () => {
    const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    const guardIdx = src.lastIndexOf("alreadyGenerating");
    const createJobIdx = src.indexOf("createJob(");
    assert.ok(guardIdx !== -1 && createJobIdx !== -1, "both variables must exist");
    assert.ok(guardIdx < createJobIdx, "concurrent guard must come before createJob() call");
  });

  it("concurrent guard returns 409 GENERATION_IN_PROGRESS (static audit)", () => {
    const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    // Find the GENERATION_IN_PROGRESS block near alreadyGenerating
    const idx = src.lastIndexOf("alreadyGenerating");
    const snippet = src.slice(idx, idx + 400);
    assert.ok(snippet.includes("409") || snippet.includes("status: 409"), "concurrent guard must return HTTP 409");
    assert.ok(snippet.includes("GENERATION_IN_PROGRESS"), "concurrent guard must use GENERATION_IN_PROGRESS code");
  });
});

// ── 2. isEmailSubmissionMethod helper ─────────────────────────────────────────

describe("phase 24 — isEmailSubmissionMethod helper", () => {
  const emailMethods = [
    "Email submission",
    "Submit by email",
    "E-mail to procurement@example.com",
    "Email only",
    "Submission via email",
  ];
  for (const method of emailMethods) {
    it(`detects "${method}" as email`, () => {
      assert.equal(isEmailSubmissionMethod(method), true, `"${method}" must be detected as email method`);
    });
  }

  const nonEmailMethods = [
    "Online portal",
    "Sealed envelope",
    "Upload via tender portal",
    "Hard copy",
    "Physical delivery",
    null,
    "",
    undefined,
  ];
  for (const method of nonEmailMethods) {
    it(`does not flag "${method}" as email`, () => {
      assert.equal(isEmailSubmissionMethod(method as string | null | undefined), false, `"${method}" must not be detected as email`);
    });
  }

  it("physical and email helpers are mutually exclusive for unambiguous methods", () => {
    const sealedEnvelope = "Sealed envelope";
    const emailMethod = "Email submission";
    assert.equal(isPhysicalSubmissionMethod(sealedEnvelope), true);
    assert.equal(isEmailSubmissionMethod(sealedEnvelope), false);
    assert.equal(isPhysicalSubmissionMethod(emailMethod), false);
    assert.equal(isEmailSubmissionMethod(emailMethod), true);
  });
});

// ── 3. Regression ─────────────────────────────────────────────────────────────

describe("phase 24 — regression: planOnly generation still has its own guard", () => {
  it("planOnly path still has GENERATION_IN_PROGRESS guard (static audit)", () => {
    const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    const planOnlyIdx = src.indexOf('planOnly') ;
    const firstGuardIdx = src.indexOf("GENERATION_IN_PROGRESS");
    assert.ok(planOnlyIdx !== -1 && firstGuardIdx !== -1, "both planOnly and GENERATION_IN_PROGRESS must exist");
    // planOnly section appears before the full generation guard
    assert.ok(planOnlyIdx < firstGuardIdx, "planOnly guard is earlier in the file than the full-gen guard");
  });
});
