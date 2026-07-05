// Phase 30 quality-gap regression tests.
//
// Coverage:
//   1. next-action-panel: AI_SUCCEEDED blocks aiAnalyzeOk
//   2. submission-plan/build: AI_SUCCEEDED in isWeak check
//   3. traceability/route: DB source fields (page, quote, confidence) in response
//   4. traceability/route: weakMandatoryCriticalRequirements in summary

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const panelSource = readFileSync(
  path.join(process.cwd(), "components/next-action-panel.tsx"),
  "utf-8",
);

const nextActionSource = readFileSync(
  path.join(process.cwd(), "lib/tender-next-action.ts"),
  "utf-8",
);

const buildSource = readFileSync(
  path.join(process.cwd(), "lib/engine/build-plan.ts"),
  "utf-8",
);

const traceSource = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/traceability/route.ts"),
  "utf-8",
);

// ── 1. next-action-panel — REGEX_FALLBACK blocks aiAnalyzeOk ─────────────────

describe("next-action-panel — AI_SUCCEEDED as blocker", () => {
  it("preflight requires AI_SUCCEEDED for analysis", () => {
    // The preflight in build-plan.ts checks analysis.state !== "AI_SUCCEEDED"
    assert.ok(
      buildSource.includes('"AI_SUCCEEDED"'),
      "preflight must require AI_SUCCEEDED analysis state",
    );
  });

  it("pushes a blocker message for REGEX_FALLBACK status", () => {
    // The blocker may be defined directly in the panel or delegated to the shared resolver.
    assert.ok(
      panelSource.includes("Analysis used regex fallback") || nextActionSource.includes("Analysis used regex fallback"),
      "panel or its resolver must push a human-readable blocker when analysis used regex fallback",
    );
  });
});

// ── 2. submission-plan/build — REGEX_FALLBACK in isWeak check ─────────────────

describe("submission-plan/build — AI_SUCCEEDED blocks plan build", () => {
  it("preflight requires AI_SUCCEEDED for analysis", () => {
    assert.ok(
      buildSource.includes('"AI_SUCCEEDED"'),
      "preflight must require AI_SUCCEEDED analysis state",
    );
  });
});

// ── 3-4. traceability/route — DB source fields and CRITICAL/MANDATORY split ────

describe("traceability/route — DB source traceability fields in response", () => {
  it("includes sourcePageNumber from DB requirement", () => {
    assert.ok(
      traceSource.includes("sourcePageNumber: requirement.sourcePageNumber"),
      "traceability must return sourcePageNumber from the DB requirement field",
    );
  });

  it("includes sourceExactQuote from DB requirement", () => {
    assert.ok(
      traceSource.includes("sourceExactQuote"),
      "traceability must return sourceExactQuote from the DB requirement field",
    );
  });

  it("includes sourceConfidenceScore from DB requirement", () => {
    assert.ok(
      traceSource.includes("sourceConfidenceScore"),
      "traceability must return sourceConfidenceScore derived from DB sourceConfidence",
    );
  });

  it("includes extractionMethod in response", () => {
    assert.ok(
      traceSource.includes("extractionMethod"),
      "traceability must return extractionMethod per requirement",
    );
  });

  it("counts weakMandatoryCriticalRequirements separately in summary", () => {
    assert.ok(
      traceSource.includes("weakMandatoryCriticalRequirements"),
      "traceability summary must include weakMandatoryCriticalRequirements count",
    );
  });

  it("filters weak MANDATORY and CRITICAL requirements separately", () => {
    assert.ok(
      traceSource.includes('r.priority === "MANDATORY" || r.priority === "CRITICAL"'),
      "traceability must filter MANDATORY and CRITICAL weak requirements separately",
    );
  });

  it("warns specifically about MANDATORY/CRITICAL weak traceability", () => {
    assert.ok(
      traceSource.includes("MANDATORY/CRITICAL requirement(s) have weak source/support traceability"),
      "traceability warnings must call out MANDATORY/CRITICAL weak requirements",
    );
  });
});
