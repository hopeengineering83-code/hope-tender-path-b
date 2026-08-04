// Systemic contradiction fixes after PR #517.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAnalysisFallbackDiagnostics } from "../lib/engine/analysis-fallback-diagnostics";

describe("D — readiness helper mirrors the POST /generate metadata gate", () => {
  const source = readFileSync("lib/tender-generation-readiness.ts", "utf8");

  it("imports and calls the same metadata-completeness helper", () => {
    assert.match(source, /import \{ assessTenderMetadataCompleteness \} from "\.\/engine\/tender-metadata-completeness"/);
    assert.match(source, /const metadataReport = assessTenderMetadataCompleteness\(\{/);
    for (const field of [
      "submissionMethod", "submissionAddress", "submissionEmails", "deadline",
      "clientContactEmail", "pageLimit", "budget", "validityDays",
      "bidBondAmount", "mandatorySiteVisit", "numberOfCopiesRequired",
      "hasEvaluationMethodology", "hasSubmissionRules",
    ]) assert.match(source, new RegExp(field));
  });

  it("keeps incomplete metadata advisory rather than inventing a blocker", () => {
    assert.doesNotMatch(source, /code: "FULL_PROPOSAL_METADATA_INCOMPLETE"/);
    assert.doesNotMatch(source, /Tender details incomplete/);
  });
});

describe("A — AI Provider Health distinguishes configured vs runtime-verified", () => {
  const panel = readFileSync("components/ai-health-panel.tsx", "utf8");
  const route = readFileSync("app/api/ai/health/route.ts", "utf8");

  it("defines and applies runtime-not-verified and cooling states", () => {
    for (const source of [panel, route]) {
      assert.match(source, /RUNTIME_NOT_VERIFIED/);
      assert.match(source, /ALL_PROVIDERS_COOLING/);
      assert.match(source, /anyHasRecentSuccess/);
      assert.match(source, /allConfiguredCooling/);
      assert.match(source, /runtime availability is not verified/);
    }
  });

  it("keeps the provider-state ordering explicit", () => {
    assert.match(panel, /CONFIGURE_AI_KEYS[\s\S]*ALL_PROVIDERS_COOLING[\s\S]*RUNTIME_NOT_VERIFIED[\s\S]*REVIEW_AI_CONFIGURATION[\s\S]*READY/);
    assert.match(panel, /verified \? "border-emerald-200/);
    assert.match(panel, /degraded \? "border-amber-200/);
  });
});

describe("A — diagnostics distinguishes rate limiting from provider exhaustion", () => {
  it("classifies all-provider cooldown as recoverable rate limiting", () => {
    const result = buildAnalysisFallbackDiagnostics("all configured AI providers are currently in cooldown (429)");
    assert.equal(result.category, "AI_PROVIDERS_RATE_LIMITED");
    assert.equal(result.retryRecommended, true);
    assert.match(result.nextAction, /Wait/i);
  });

  it("classifies collective exhaustion separately", () => {
    assert.equal(buildAnalysisFallbackDiagnostics("all configured providers exhausted after retry").category, "ALL_PROVIDERS_EXHAUSTED");
    assert.equal(buildAnalysisFallbackDiagnostics("Claude returned 429 rate limit").category, "RATE_LIMIT");
    assert.equal(buildAnalysisFallbackDiagnostics("AI_PROVIDERS_RATE_LIMITED").category, "AI_PROVIDERS_RATE_LIMITED");
  });
});

// "M — engine action panel no longer claims false readiness" is superseded:
// the panel claimed a FROZEN readiness ("Pending automatic processing",
// permanently) because nothing ever set its state, and it was deleted. The
// canonical claim now comes from NextActionPanel alone.
