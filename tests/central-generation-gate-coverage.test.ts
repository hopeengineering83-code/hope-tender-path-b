// Central generation-readiness gate — coverage regression guards.
//
// These tests lock in the REQUIREMENT that every route which creates a
// GENERATED GeneratedDocument row (generationStatus: "GENERATED") must
// first call `assertTenderReadyForGenerationAndExport` — the central
// fail-closed gate. Without this, partial/failed/regex-fallback analysis
// could leak GENERATED documents that bypass hash-binding, chunk
// integrity, source-grounding, and submission-plan checks.
//
// The audited routes that create GENERATED documents:
//   • /api/tenders/[id]/generate            — guarded (gate at line ~971)
//   • /api/tenders/[id]/export              — guarded (gate at line ~200)
//   • /api/tenders/[id]/download            — guarded (3 paths: zip/single/pdf)
//   • PROPOSAL_GENERATION handler           — guarded (gate before create)
//   • /api/tenders/[id]/ai-proposal         — NEWLY guarded (this PR)
//   • /api/tenders/[id]/regenerate-cvs      — NEWLY guarded (this PR)
//   • /api/tenders/[id]/generate-missing-plan-files — NEWLY guarded (this PR)
//
// Routes that create only PLANNED stubs (submission-plan/build,
// generate planOnly) are intentionally exempt — the gate's own
// SUBMISSION_PLAN_MISSING check depends on those stubs existing.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

function expectContains(source: string, pattern: RegExp, message?: string) {
  assert.match(source, pattern, message);
}

describe("Central generation gate — GENERATED-document route coverage", () => {

  // ─── Already-guarded routes (regression lock) ─────────────────────────

  describe("generate route (already guarded)", () => {
    it("calls assertTenderReadyForGenerationAndExport before generateTenderDocuments", () => {
      const src = read("app/api/tenders/[id]/generate/route.ts");
      expectContains(src, /assertTenderReadyForGenerationAndExport/);
      const gateIdx = src.indexOf("assertTenderReadyForGenerationAndExport");
      const genIdx = src.indexOf("generateTenderDocuments(");
      assert.ok(gateIdx > -1 && genIdx > -1 && gateIdx < genIdx,
        "generate route must call the central gate BEFORE generateTenderDocuments");
    });
  });

  describe("export route (already guarded)", () => {
    it("calls assertTenderReadyForGenerationAndExport", () => {
      const src = read("app/api/tenders/[id]/export/route.ts");
      expectContains(src, /assertTenderReadyForGenerationAndExport/);
    });
  });

  describe("download route (already guarded — 3 paths)", () => {
    it("guards the zipPackage path", () => {
      const src = read("app/api/tenders/[id]/download/route.ts");
      expectContains(src, /assertTenderReadyForGenerationAndExport/);
    });
  });

  describe("PROPOSAL_GENERATION handler (already guarded)", () => {
    it("calls the gate before prisma.generatedDocument.create", () => {
      const src = read("lib/ai-job-handlers.ts");
      expectContains(src, /assertTenderReadyForGenerationAndExport/);
      const propGenBlock = src.slice(
        src.indexOf("PROPOSAL_GENERATION:"),
        src.indexOf("EVALUATOR_SIM:"),
      );
      const gateIdx = propGenBlock.indexOf("assertTenderReadyForGenerationAndExport");
      const createIdx = propGenBlock.indexOf("generatedDocument.create");
      assert.ok(gateIdx > -1 && createIdx > -1 && gateIdx < createIdx,
        "PROPOSAL_GENERATION handler must call the gate BEFORE generatedDocument.create");
    });
  });

  // ─── Legacy draft route containment ───────────────────────────────────

  describe("ai-proposal route (draft-only legacy route)", () => {
    it("does not persist GeneratedDocument rows", () => {
      const src = read("app/api/tenders/[id]/ai-proposal/route.ts");
      assert.doesNotMatch(src, /generatedDocument\.create/,
        "ai-proposal is a draft preview route and must not create GeneratedDocument rows");
      assert.doesNotMatch(src, /withTransactionalGenerationGate/,
        "ai-proposal must not use the transactional generation writer; canonical /generate owns persisted documents");
      assert.doesNotMatch(src, /assertTenderReadyForGenerationAndExport/,
        "ai-proposal must not retain the old persist gate now that it has no persist path");
    });

    it("surfaces a draft-only persistBlocked response", () => {
      const src = read("app/api/tenders/[id]/ai-proposal/route.ts");
      expectContains(src, /LEGACY_AI_PROPOSAL_DRAFT_ONLY/);
      expectContains(src, /Quick AI proposal previews are not saved as GeneratedDocument rows/);
      expectContains(src, /persistBlocked:\s*true/);
    });
  });

  describe("regenerate-cvs route (NEWLY guarded)", () => {
    it("imports the central gate", () => {
      const src = read("app/api/tenders/[id]/regenerate-cvs/route.ts");
      expectContains(src, /import\s*\{[^}]*assertTenderReadyForGenerationAndExport[^}]*\}\s*from\s*["'][^"']*generation-readiness-gate["']/);
    });

    it("calls the gate before prisma.generatedDocument.create", () => {
      const src = read("app/api/tenders/[id]/regenerate-cvs/route.ts");
      const gateIdx = src.indexOf("assertTenderReadyForGenerationAndExport(");
      const createIdx = src.indexOf("generatedDocument.create");
      assert.ok(gateIdx > -1 && createIdx > -1 && gateIdx < createIdx,
        "regenerate-cvs route must call the central gate BEFORE generatedDocument.create");
    });

    it("returns 409 when the gate blocks", () => {
      const src = read("app/api/tenders/[id]/regenerate-cvs/route.ts");
      expectContains(src, /status:\s*409/);
      expectContains(src, /CV regeneration blocked/);
    });

    it("uses a distinct purpose string for audit traceability", () => {
      const src = read("app/api/tenders/[id]/regenerate-cvs/route.ts");
      expectContains(src, /purpose:\s*["']regenerate-cvs["']/);
    });
  });

  describe("generate-missing-plan-files route (NEWLY guarded)", () => {
    it("imports the central gate", () => {
      const src = read("app/api/tenders/[id]/generate-missing-plan-files/route.ts");
      expectContains(src, /import\s*\{[^}]*assertTenderReadyForGenerationAndExport[^}]*\}\s*from\s*["'][^"']*generation-readiness-gate["']/);
    });

    it("calls the gate before prisma.generatedDocument.create", () => {
      const src = read("app/api/tenders/[id]/generate-missing-plan-files/route.ts");
      const gateIdx = src.indexOf("assertTenderReadyForGenerationAndExport(");
      const createIdx = src.indexOf("generatedDocument.create");
      assert.ok(gateIdx > -1 && createIdx > -1 && gateIdx < createIdx,
        "generate-missing-plan-files route must call the central gate BEFORE generatedDocument.create");
    });

    it("does NOT exempt any blocker code (dead SUBMISSION_PLAN_MISSING carve-out removed)", () => {
      // The previous carve-out `centralGate.blockerCode !== "SUBMISSION_PLAN_MISSING"`
      // was dead code — the gate never emits SUBMISSION_PLAN_MISSING (the enum
      // value exists but is never passed to fail()). The route requires a
      // confirmed plan (see getCurrentConfirmedBuildPlan check downstream) and
      // must fail closed on every central-gate blocker, including
      // BUILD_PLAN_MISSING and BUILD_PLAN_NOT_CONFIRMED.
      const src = read("app/api/tenders/[id]/generate-missing-plan-files/route.ts");
      expectContains(src, /if\s*\(\s*!centralGate\.ok\s*\)\s*\{/);
      // The old dead carve-out must NOT be present
      if (src.includes('blockerCode !== "SUBMISSION_PLAN_MISSING"') || src.includes("blockerCode !== 'SUBMISSION_PLAN_MISSING'")) {
        throw new Error("dead SUBMISSION_PLAN_MISSING carve-out must be removed — the gate never emits that code");
      }
    });

    it("uses a distinct purpose string for audit traceability", () => {
      const src = read("app/api/tenders/[id]/generate-missing-plan-files/route.ts");
      expectContains(src, /purpose:\s*["']generate-missing-plan-files["']/);
    });
  });

  // ─── Dead-code guard ──────────────────────────────────────────────────

  describe("legacy generate.ts is dead code (no live callers)", () => {
    it("the live generate route imports from generate-elite, not generate", () => {
      const src = read("app/api/tenders/[id]/generate/route.ts");
      expectContains(src, /from\s*["'][^"']*generate-elite["']/);
      assert.doesNotMatch(src, /from\s*["'][^"']*lib\/engine\/generate["']/,
        "generate route must NOT import from the legacy lib/engine/generate.ts");
    });
  });
});
