// Analysis-source detection helpers in lib/engine/analysis-source.ts.
//
// The DB-aware paths (detectAnalysisSourceWithApproval, approve/revoke)
// are integration-level and exercised in Vercel preview. Here we lock
// the pure synchronous detector behaviour against the exact `tender.notes`
// strings written by lib/engine/run-tender-engine.ts:459.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectAnalysisSource } from "../lib/engine/analysis-source";

describe("detectAnalysisSource — pure synchronous detection", () => {
  it("returns AI when notes record an AI analysis", () => {
    assert.equal(
      detectAnalysisSource({ notes: "Analysis source: AI (chunked multi-call when tender > 60K chars)." }),
      "AI",
    );
  });
  it("returns REGEX_FALLBACK_AI_ERROR for the regex-fallback line", () => {
    assert.equal(
      detectAnalysisSource({ notes: "Analysis source: regex fallback (REGEX_FALLBACK_AI_ERROR). All providers exhausted." }),
      "REGEX_FALLBACK_AI_ERROR",
    );
    assert.equal(
      detectAnalysisSource({ notes: "Analysis source: regex fallback (REGEX_FALLBACK_NO_TEXT). Extracted text too short." }),
      "REGEX_FALLBACK_AI_ERROR",
    );
    assert.equal(
      detectAnalysisSource({ notes: "Analysis source: regex fallback (REGEX_FALLBACK_AI_DISABLED). GEMINI_API_KEY not configured." }),
      "REGEX_FALLBACK_AI_ERROR",
    );
  });
  it("returns UNKNOWN when notes do not include an analysis-source marker", () => {
    assert.equal(detectAnalysisSource({}), "UNKNOWN");
    assert.equal(detectAnalysisSource({ notes: "" }), "UNKNOWN");
    assert.equal(detectAnalysisSource({ notes: "some other note" }), "UNKNOWN");
  });
});

describe("approve-analysis route — source inspection", () => {
  // The /api/tenders/[id]/approve-analysis route flows through Prisma so
  // it cannot be invoked in this pure test runner. Instead, this is a
  // contract check that the route file exists and uses the helpers from
  // analysis-source.ts (not a parallel ad-hoc implementation).
  it("exists and uses the canonical helpers", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/tenders/[id]/approve-analysis/route.ts", "utf8");
    assert.match(source, /approveRegexFallbackAnalysis/);
    assert.match(source, /revokeRegexFallbackApproval/);
    assert.match(source, /requireRole\(\s*"ADMIN",\s*"PROPOSAL_MANAGER"\s*\)/);
  });
});

describe("generate route — regex fallback gate", () => {
  it("imports the gate from analysis-source.ts and calls it", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    assert.match(source, /assertAnalysisReadyForFinalGeneration/);
    // Make sure the gate is actually invoked, not just imported.
    assert.match(source, /await\s+assertAnalysisReadyForFinalGeneration\(/);
  });
  it("ai-proposal route also imports and invokes the gate", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/tenders/[id]/ai-proposal/route.ts", "utf8");
    assert.match(source, /assertAnalysisReadyForFinalGeneration/);
    assert.match(source, /await\s+assertAnalysisReadyForFinalGeneration\(/);
  });
});

describe("generation-readiness route — canonical analysis-source helper", () => {
  it("resolves the analysis source through the canonical helper, not a local regex", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/tenders/[id]/generation-readiness/route.ts", "utf8");
    // resolveCanonicalAnalysisSource is the canonical helper: it reads the
    // AiJob/AiAnalyzeChunk resolver first and delegates to
    // detectAnalysisSourceWithApproval — which is what checks the
    // ANALYSIS_APPROVAL:REGEX_FALLBACK ComplianceGap row — for every state the
    // resolver does not establish. The approval distinction this test was
    // written for is therefore preserved.
    //
    // The route previously called the notes-only detector directly, so an AI
    // Analyze proven only by job rows read as UNKNOWN and the route told the
    // owner their analysed tender had never been analysed.
    assert.match(source, /resolveCanonicalAnalysisSource/);
    // Must NOT use the old ad-hoc regex against tender.notes only.
    assert.doesNotMatch(source, /hasRegexFallbackSource/);
  });

  it("exposes ALLOWED_APPROVED_FALLBACK gate state for human-approved analyses", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/tenders/[id]/generation-readiness/route.ts", "utf8");
    assert.match(source, /ALLOWED_APPROVED_FALLBACK/);
  });

  it("blocks only REGEX_FALLBACK_AI_ERROR, not HUMAN_APPROVED_REGEX_FALLBACK", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/tenders/[id]/generation-readiness/route.ts", "utf8");
    // The full-proposal readyForFullProposal must reference isUnapprovedFallback, not a plain regex check.
    assert.match(source, /isUnapprovedFallback/);
    // The gate must distinguish approved from unapproved fallback.
    assert.match(source, /isApprovedFallback/);
  });

  it("treats UNKNOWN analysis source as blocking (NOT_ANALYZED gate state)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/tenders/[id]/generation-readiness/route.ts", "utf8");
    // isUnapprovedFallback must include the UNKNOWN case, not just REGEX_FALLBACK_AI_ERROR.
    // A tender that has never been analyzed must not be allowed through the full-proposal gate.
    assert.match(source, /UNKNOWN/);
    assert.match(source, /NOT_ANALYZED/);
    // FULL_PROPOSAL_NOT_ANALYZED blocker code must be present for clarity.
    assert.match(source, /FULL_PROPOSAL_NOT_ANALYZED/);
  });

  it("generation-readiness panel maps RETRY_AI_ANALYZE and REVIEW_ANALYSIS actions", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("components/generation-readiness-panel.tsx", "utf8");
    // Panel must handle RETRY_AI_ANALYZE so users see a useful button, not "Open tender".
    assert.match(source, /RETRY_AI_ANALYZE/);
    // Panel must handle REVIEW_ANALYSIS so analysis quality link is shown.
    assert.match(source, /REVIEW_ANALYSIS/);
    // Panel must handle REPAIR_OR_EDIT_TENDER so metadata repair link is shown.
    assert.match(source, /REPAIR_OR_EDIT_TENDER/);
  });
});
