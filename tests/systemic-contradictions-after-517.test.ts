// Systemic contradiction fixes after PR #517.
//
// Three real gaps were left in the codebase that surfaced as the screenshot
// contradictions:
//   D — Generation panel said "Full proposal generation gate: passes" while
//       POST /api/tenders/[id]/generate returned 422
//       METADATA_INCOMPLETE_FOR_GENERATION. The readiness helper did not
//       mirror the POST's metadata-completeness gate.
//   A — AI Provider Health pill said "READY" purely because keys exist,
//       even when no provider had a successful runtime call yet or every
//       configured provider was in cooldown.
//   A (diagnostics) — analysis-fallback-diagnostics could not distinguish
//       "every provider is currently rate-limited" from "all providers
//       collectively exhausted". The first is recoverable by waiting; the
//       second usually needs operator action.
//
// Behavioural unit tests for the diagnostics enum; source-level tests for the
// readiness/panel/route assertions (auth + Prisma + process.env are needed at
// runtime, so contract is asserted in source).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAnalysisFallbackDiagnostics } from "../lib/engine/analysis/analysis-fallback-diagnostics";

describe("D — readiness helper mirrors the POST /generate metadata gate", () => {
  const source = readFileSync("lib/tender-generation-readiness.ts", "utf8");

  it("imports the same metadata-completeness helper used by /generate", () => {
    assert.match(source, /import \{ assessTenderMetadataCompleteness \} from ".\/engine\/tender-metadata-completeness"/);
  });

  it("calls assessTenderMetadataCompleteness with the same field set as /generate", () => {
    assert.match(source, /const metadataReport = assessTenderMetadataCompleteness\(\{/);
    for (const field of [
      "submissionMethod", "submissionAddress", "submissionEmails", "deadline",
      "clientContactEmail", "pageLimit", "budget", "validityDays",
      "bidBondAmount", "mandatorySiteVisit", "numberOfCopiesRequired",
      "hasEvaluationMethodology", "hasSubmissionRules",
    ]) {
      assert.match(source, new RegExp(field));
    }
  });

  it("pushes a FULL_PROPOSAL_METADATA_INCOMPLETE blocker when blockingForGeneration", () => {
    assert.match(source, /if \(metadataReport\.blockingForGeneration\)/);
    assert.match(source, /code: "FULL_PROPOSAL_METADATA_INCOMPLETE"/);
    assert.match(source, /nextAction: "EDIT_TENDER"/);
  });

  it("blocker reason names the actual missing field(s) so the panel can render them", () => {
    assert.match(source, /missingCritical\.slice\(0,\s*4\)\.map/);
  });
});

describe("A — AI Provider Health distinguishes configured vs runtime-verified", () => {
  const panel = readFileSync("components/ai-health-panel.tsx", "utf8");
  const route = readFileSync("app/api/ai/health/route.ts", "utf8");

  it("panel defines RUNTIME_NOT_VERIFIED + ALL_PROVIDERS_COOLING states", () => {
    assert.match(panel, /RUNTIME_NOT_VERIFIED/);
    assert.match(panel, /ALL_PROVIDERS_COOLING/);
  });

  it("panel pill is green only when a configured provider has lastSuccessAt and no warnings", () => {
    assert.match(panel, /anyHasRecentSuccess/);
    assert.match(panel, /allConfiguredCooling/);
    // The nextAction ladder: blockers → cooling → not-verified → warnings → READY
    assert.match(panel, /CONFIGURE_AI_KEYS[\s\S]*ALL_PROVIDERS_COOLING[\s\S]*RUNTIME_NOT_VERIFIED[\s\S]*REVIEW_AI_CONFIGURATION[\s\S]*READY/);
  });

  it("panel header tone follows the same three-state ladder", () => {
    assert.match(panel, /verified \? "border-emerald-200/);
    assert.match(panel, /degraded \? "border-amber-200/);
  });

  it("route mirrors the same nextAction ladder so server callers agree", () => {
    assert.match(route, /anyHasRecentSuccess/);
    assert.match(route, /allConfiguredCooling/);
    assert.match(route, /ALL_PROVIDERS_COOLING/);
    assert.match(route, /RUNTIME_NOT_VERIFIED/);
  });

  it("route + panel warn the user when keys exist but no runtime success yet", () => {
    assert.match(panel, /runtime availability is not verified/);
    assert.match(route, /runtime availability is not verified/);
  });
});

describe("A — diagnostics distinguishes AI_PROVIDERS_RATE_LIMITED from ALL_PROVIDERS_EXHAUSTED", () => {
  it("classifies an 'all providers in cooldown' message as AI_PROVIDERS_RATE_LIMITED", () => {
    const d = buildAnalysisFallbackDiagnostics("all configured AI providers are currently in cooldown (429)");
    assert.equal(d.category, "AI_PROVIDERS_RATE_LIMITED");
    assert.equal(d.retryRecommended, true);
    assert.match(d.nextAction, /Wait/i);
  });

  it("classifies an 'all providers exhausted' message as ALL_PROVIDERS_EXHAUSTED", () => {
    const d = buildAnalysisFallbackDiagnostics("all configured providers exhausted after retry");
    assert.equal(d.category, "ALL_PROVIDERS_EXHAUSTED");
  });

  it("a single-provider 429 still classifies as RATE_LIMIT (not the new bucket)", () => {
    const d = buildAnalysisFallbackDiagnostics("Claude returned 429 rate limit");
    assert.equal(d.category, "RATE_LIMIT");
  });

  it("recognises the AI_PROVIDERS_RATE_LIMITED code in raw error text", () => {
    const d = buildAnalysisFallbackDiagnostics("AI_PROVIDERS_RATE_LIMITED");
    assert.equal(d.category, "AI_PROVIDERS_RATE_LIMITED");
  });
});

describe("M — engine action panel no longer claims false readiness", () => {
  const source = readFileSync("components/engine-action-panel.tsx", "utf8");

  it("removed the bare 'Engine completed successfully' claim", () => {
    assert.doesNotMatch(source, /error:\s*"Engine completed successfully\."/);
  });

  it("the new label points the user at the readiness panels", () => {
    assert.match(source, /readiness panels below/);
    assert.match(source, /remaining blockers/);
  });
});
