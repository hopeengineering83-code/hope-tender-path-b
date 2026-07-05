// Phase 26 quality-gap regression tests.
//
// Coverage:
//   1. Export route race-condition fix — atomic updateMany(SUPERSEDED) + create
//   2. final-submission-readiness: SUBMISSION_PLAN_DOCUMENTS_MISSING blocker
//   3. final-submission-readiness: MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN blocker

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── 1. Export route – atomic package creation ─────────────────────────────────
// We can't import the route directly (it uses Prisma), so we verify the source
// contains the $transaction pattern and NOT the old findFirst-then-update pattern.

import { readFileSync } from "node:fs";
import path from "node:path";

const exportRouteSource = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/export/route.ts"),
  "utf-8",
);

describe("export/route.ts — race-condition fix", () => {
  it("uses prisma.$transaction for atomic package creation", () => {
    assert.ok(
      exportRouteSource.includes("prisma.$transaction"),
      "export route must use $transaction for atomic package creation",
    );
  });

  it("supersedes existing READY packages inside the transaction", () => {
    assert.ok(
      exportRouteSource.includes("status: \"SUPERSEDED\""),
      "export route must set old packages to SUPERSEDED inside the transaction",
    );
  });

  it("does NOT use the old non-atomic findFirst+conditional update pattern", () => {
    assert.ok(
      !exportRouteSource.includes("exportPackage.findFirst"),
      "export route must not use findFirst (non-atomic) pattern",
    );
  });

  it("creates the new package inside the same transaction", () => {
    const txIdx = exportRouteSource.indexOf("prisma.$transaction");
    const createIdx = exportRouteSource.indexOf("tx.exportPackage.create", txIdx);
    assert.ok(
      createIdx > txIdx,
      "exportPackage.create must appear after $transaction opening",
    );
  });
});

// ── 2. final-submission-readiness: SUBMISSION_PLAN_DOCUMENTS_MISSING ──────────

import { readFileSync as rfs } from "node:fs";

const readinessSource = rfs(
  path.join(process.cwd(), "lib/engine/final-submission-readiness.ts"),
  "utf-8",
);

describe("final-submission-readiness.ts — SUBMISSION_PLAN_DOCUMENTS_MISSING blocker", () => {
  it("defines the SUBMISSION_PLAN_DOCUMENTS_MISSING category", () => {
    assert.ok(
      readinessSource.includes("SUBMISSION_PLAN_DOCUMENTS_MISSING"),
      "readiness source must define SUBMISSION_PLAN_DOCUMENTS_MISSING",
    );
  });

  it("fires only when missingPlan.length > 0 AND hasExplicitPlanScope", () => {
    const pattern = /missingPlan\.length\s*>\s*0\s*&&\s*hasExplicitPlanScope/;
    assert.ok(
      pattern.test(readinessSource),
      "SUBMISSION_PLAN_DOCUMENTS_MISSING must guard on missingPlan.length > 0 && hasExplicitPlanScope",
    );
  });

  it("lists missing document names in the blocker title", () => {
    const idx = readinessSource.indexOf("SUBMISSION_PLAN_DOCUMENTS_MISSING");
    assert.ok(idx > -1);
    const window = readinessSource.slice(idx, idx + 400);
    assert.ok(
      window.includes("missingPlan.map"),
      "blocker title must enumerate missing document names via missingPlan.map",
    );
  });

  it("has HIGH severity", () => {
    const idx = readinessSource.indexOf("SUBMISSION_PLAN_DOCUMENTS_MISSING");
    assert.ok(idx > -1);
    const window = readinessSource.slice(idx, idx + 300);
    assert.ok(window.includes('"HIGH"'), "SUBMISSION_PLAN_DOCUMENTS_MISSING must be HIGH severity");
  });
});

// ── 3. final-submission-readiness.ts: MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN

describe("final-submission-readiness.ts — MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN blocker", () => {
  it("defines the MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN category", () => {
    assert.ok(
      readinessSource.includes("MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN"),
      "readiness source must define MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN",
    );
  });

  it("guards on requiredPlanCount === 0 && !hasExplicitPlanScope && mandatoryRequirements.length > 0", () => {
    const pattern = /requiredPlanCount\s*===\s*0\s*&&\s*!hasExplicitPlanScope\s*&&\s*mandatoryRequirements\.length\s*>\s*0/;
    assert.ok(
      pattern.test(readinessSource),
      "MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN must check requiredPlanCount===0 && !hasExplicitPlanScope && mandatoryRequirements.length>0",
    );
  });

  it("has HIGH severity", () => {
    const idx = readinessSource.indexOf("MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN");
    assert.ok(idx > -1);
    const window = readinessSource.slice(idx, idx + 300);
    assert.ok(window.includes('"HIGH"'), "MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN must be HIGH severity");
  });

  it("recommends running Build Plan", () => {
    const idx = readinessSource.indexOf("MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN");
    assert.ok(idx > -1);
    const window = readinessSource.slice(idx, idx + 400);
    assert.ok(
      /Build Plan/i.test(window),
      "recommended action must mention Build Plan",
    );
  });
});

// ── 4. mandatoryRequirements is hoisted above tenderLevelBlockers section ─────
describe("final-submission-readiness.ts — mandatoryRequirements declaration order", () => {
  it("mandatoryRequirements is declared before SUBMISSION_PLAN_DOCUMENTS_MISSING", () => {
    const declIdx = readinessSource.indexOf("const mandatoryRequirements");
    const blockerIdx = readinessSource.indexOf("SUBMISSION_PLAN_DOCUMENTS_MISSING");
    assert.ok(declIdx > -1, "mandatoryRequirements must be declared");
    assert.ok(blockerIdx > -1, "SUBMISSION_PLAN_DOCUMENTS_MISSING must exist");
    assert.ok(
      declIdx < blockerIdx,
      "mandatoryRequirements declaration must precede SUBMISSION_PLAN_DOCUMENTS_MISSING blocker",
    );
  });

  it("mandatoryRequirements is declared before MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN", () => {
    const declIdx = readinessSource.indexOf("const mandatoryRequirements");
    const blockerIdx = readinessSource.indexOf("MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN");
    assert.ok(
      declIdx < blockerIdx,
      "mandatoryRequirements declaration must precede MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN blocker",
    );
  });

  it("mandatoryRequirements is declared exactly once", () => {
    const occurrences = readinessSource.split("const mandatoryRequirements").length - 1;
    assert.equal(occurrences, 1, "mandatoryRequirements must be declared exactly once (no duplicate)");
  });
});
