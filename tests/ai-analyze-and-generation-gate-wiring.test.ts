// Wiring contracts for:
//   Part 3 — AI Analyze surfaces provider-specific diagnostics (which
//            providers were attempted / cooling down) and a stable code.
//   Part 5 — the generation-readiness helper mirrors the server-side
//            analysis-source gate so the panel can't show a green
//            "Generate Docs" button while regex fallback blocks generation.
//
// These routes/helpers need a real session + Prisma at runtime, so the
// behaviour is asserted at the source level (the pure pieces — provider
// snapshot, analysis-source gate — have their own behavioural tests).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("AI Analyze provider diagnostics wiring", () => {
  const source = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");

  it("builds a provider diagnostics snapshot on fallback", () => {
    assert.match(source, /buildProviderDiagnosticsSnapshot/);
    assert.match(source, /providerDiagnostics/);
  });

  it("returns a stable AI_PROVIDERS_EXHAUSTED / AI_NO_PROVIDER_CONFIGURED code", () => {
    assert.match(source, /AI_PROVIDERS_EXHAUSTED/);
    assert.match(source, /AI_NO_PROVIDER_CONFIGURED/);
  });

  it("never returns raw provider bodies, prompts, or keys (sanitises the 500 path)", () => {
    // The route delegates secret redaction to the canonical redactSecrets()
    // helper from lib/sanitize-error.ts. Previously this checked for inline
    // KEY_REDACTED — consolidated so patterns cannot diverge.
    assert.match(source, /redactSecrets/);
  });
});

describe("generation-readiness mirrors the analysis-source gate (Part 5)", () => {
  const source = readFileSync("lib/tender-generation-readiness.ts", "utf8");

  it("imports and calls assertAnalysisReadyForFinalGeneration", () => {
    assert.match(source, /assertAnalysisReadyForFinalGeneration/);
  });

  it("pushes a full-proposal blocker when the analysis gate fails", () => {
    // The blocker uses the gate's own code/message/nextAction so the panel
    // disables the green button and stops claiming the gate "passes".
    assert.match(source, /fullProposalBlockers\.push\(\{[\s\S]*?analysisGate\.code/);
  });

  it("FAIL-CLOSED: if assertAnalysisReadyForFinalGeneration throws, the helper blocks (not ok:true)", () => {
    // PERMANENT BLOCK: the previous fail-open `.catch(() => ({ ok: true }))`
    // silently authorized generation when the gate could not be evaluated.
    // The new code MUST fail-closed — a thrown gate produces a blocker, not
    // an authorization. This test verifies the fail-closed pattern is in
    // place; if anyone re-introduces the fail-open catch, this test fails.
    assert.ok(
      !/\.catch\(\(\)\s*=>\s*\(\{\s*ok:\s*true/.test(source),
      "tender-generation-readiness MUST NOT use fail-open .catch(() => ({ ok: true })) — fail-closed is required",
    );
    // The new code MUST have a try/catch that produces ok:false on error.
    assert.match(source, /catch\s*\{[\s\S]*?ok:\s*false/);
  });
});

describe("metadataContaminated blocks generation-readiness and generate route", () => {
  const readinessSource = readFileSync("lib/tender-generation-readiness.ts", "utf8");
  const generateSource = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");

  it("getTenderGenerationReadiness does NOT push METADATA_CONTAMINATED (advisory only)", () => {
    assert.doesNotMatch(readinessSource, /warnings\.push\(\{[\s\S]*?METADATA_CONTAMINATED/);
    assert.doesNotMatch(readinessSource, /blockers\.push\(\{[\s\S]*?METADATA_CONTAMINATED/);
  });

  it("generate route does NOT hard-block with METADATA_CONTAMINATED for draft work", () => {
    // METADATA_CONTAMINATED is no longer a hard 422 block for draft work.
    // The route may reference contamination in comments but must not return 422.
    assert.doesNotMatch(generateSource, /METADATA_CONTAMINATED.*422/);
    assert.doesNotMatch(generateSource, /errorCode.*METADATA_CONTAMINATED/);
  });

  it("AI Analyze writes contamination flag when portal noise detected (shared builder)", () => {
    // Contamination detection + the metadataContaminated flag now live in the
    // shared canonical builder used by every analysis path.
    const builderSource = readFileSync("lib/engine/canonical-analysis-update.ts", "utf8");
    assert.match(builderSource, /detectMetadataContamination/);
    assert.match(builderSource, /metadataContaminated/);
    // Both route promotion paths must apply it.
    const analyzeSource = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");
    assert.ok((analyzeSource.match(/buildCanonicalAnalysisTenderUpdate\(/g) ?? []).length >= 2);
  });

  it("AI Analyze extracts full contact fields (Phase 7) and writes them to DB (shared builder)", () => {
    const builderSource = readFileSync("lib/engine/canonical-analysis-update.ts", "utf8");
    assert.match(builderSource, /clientContactName/);
    assert.match(builderSource, /clientContactEmail/);
    assert.match(builderSource, /clientContactPhone/);
    assert.match(builderSource, /submissionAddress/);
    assert.match(builderSource, /clientAddress/);
  });
});

describe("bid strategy confidence cap under unapproved fallback (Part 12)", () => {
  const source = readFileSync("app/api/tenders/[id]/bid-strategy/route.ts", "utf8");

  it("detects the analysis source and caps confidence when it's an unapproved fallback", () => {
    assert.match(source, /detectAnalysisSourceWithApproval/);
    assert.match(source, /REGEX_FALLBACK_AI_ERROR|confidenceCapped/);
    assert.match(source, /FALLBACK_CONFIDENCE_CEILING/);
  });

  it("downgrades a BID_HARD recommendation when capped", () => {
    assert.match(source, /BID_HARD[\s\S]*?BID_CAREFULLY/);
  });

  it("returns the cap flag + note to the panel", () => {
    assert.match(source, /confidenceCapped,/);
    assert.match(source, /confidenceNote,/);
  });
});

describe("corrupted extraction blocks pipeline before stale-score bypasses", () => {
  const analyzeRoute = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");
  const buildPlanRoute = readFileSync("lib/engine/build-plan.ts", "utf8");
  const generateRoute = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");

  it("AI Analyze marks corrupted extraction as skipped, not provider failure", () => {
    assert.match(analyzeRoute, /EXTRACTION_CORRUPTED_AI_SKIPPED/);
    assert.match(analyzeRoute, /analysisExtractionStatus:\s*"OCR_REQUIRED"/);
    assert.match(analyzeRoute, /not an AI provider failure/);
  });

  it("Build Plan preflight checks extraction quality", () => {
    assert.match(buildPlanRoute, /isExtractionAcceptableForGeneration/);
    assert.match(buildPlanRoute, /Math\.min\(f\.extractionScore \?\? quality\.score, quality\.score\)/);
  });

  it("Generate Docs recomputes quality before any generatedDocument rows are created", () => {
    const gateIndex = generateRoute.indexOf("EXTRACTION_CORRUPTED_GENERATION_BLOCKED");
    const createIndex = generateRoute.indexOf("generateTenderDocuments(");
    assert.ok(gateIndex > -1, "missing corrupted generation blocker");
    assert.ok(createIndex > -1, "missing generation call");
    assert.ok(gateIndex < createIndex, "corrupted extraction gate must run before document generation");
    assert.match(generateRoute, /isExtractionAcceptableForGeneration/);
  });

  it("Run Engine uses the shared extraction gate and cannot be force-bypassed", () => {
    const engineRoute = readFileSync("app/api/tenders/[id]/engine/route.ts", "utf8");
    assert.match(engineRoute, /isExtractionAcceptableForGeneration/);
    assert.match(engineRoute, /EXTRACTION_CORRUPTED_ENGINE_SKIPPED/);
    assert.match(engineRoute, /EXTRACTION_QUALITY_ENGINE_BLOCKED/);
    assert.doesNotMatch(engineRoute, /searchParams\.get\("force"\)/);
  });
});

describe("bid strategy unavailable on unsafe extraction/analysis", () => {
  const source = readFileSync("app/api/tenders/[id]/bid-strategy/route.ts", "utf8");
  const panelSource = readFileSync("components/bid-strategy-panel.tsx", "utf8");

  it("returns an unavailable blocker instead of computing strategy for unsafe analysis", () => {
    assert.match(source, /BID_STRATEGY_UNAVAILABLE_ANALYSIS_UNRELIABLE/);
    assert.match(source, /hasExtractionUnsafeStatus/);
    assert.match(source, /isUnapprovedFallbackOrUnknown/);
    assert.match(source, /EXTRACTION_CORRUPTED\|OCR_REQUIRED/);
    assert.match(source, /sourceRefCount/);
  });

  it("checks unsafe blockers before computeBidStrategy is invoked", () => {
    const blockerIndex = source.indexOf("BID_STRATEGY_UNAVAILABLE_ANALYSIS_UNRELIABLE");
    const computeIndex = source.indexOf("computeBidStrategy({");
    assert.ok(blockerIndex > -1, "missing unavailable blocker code");
    assert.ok(computeIndex > -1, "missing computeBidStrategy call");
    assert.ok(blockerIndex < computeIndex, "bid-strategy unsafe gate must run before score computation");
  });

  it("panel renders the server blocker list in the unavailable state", () => {
    assert.match(panelSource, /unavailableBlockers/);
    assert.match(panelSource, /errBody\.blockers/);
    assert.match(panelSource, /Bid Strategy unavailable/);
  });
});

describe("command center avoids stale workflow progress contradiction", () => {
  const source = readFileSync("app/dashboard/tenders/[id]/command-center/page.tsx", "utf8");

  it("labels canonical export readiness instead of presenting legacy readinessScore as readiness", () => {
    assert.match(source, /canonicalReadinessLabel/);
    assert.match(source, /Export readiness: BLOCKED/);
    // The legacy readinessScore line was removed outright (not merely
    // relabeled) — Issue #1134 recheck 10 item #3: the persisted
    // readinessScore is not a valid metric and must not be displayed
    // beside canonical readiness at all, labeled or not. A code comment
    // documenting the removal may still mention the field name; only
    // actual display usage (JSX interpolation) is forbidden.
    assert.doesNotMatch(source, /\{tender\.readinessScore\}/);
    assert.doesNotMatch(source, /Workflow Progress:/);
  });
});

describe("bid strategy unavailable on unsafe extraction/analysis", () => {
  const source = readFileSync("app/api/tenders/[id]/bid-strategy/route.ts", "utf8");
  const panelSource = readFileSync("components/bid-strategy-panel.tsx", "utf8");

  it("returns an unavailable blocker instead of computing strategy for unsafe analysis", () => {
    assert.match(source, /BID_STRATEGY_UNAVAILABLE_ANALYSIS_UNRELIABLE/);
    assert.match(source, /hasExtractionUnsafeStatus/);
    assert.match(source, /isUnapprovedFallbackOrUnknown/);
    assert.match(source, /EXTRACTION_CORRUPTED\|OCR_REQUIRED/);
    assert.match(source, /sourceRefCount/);
  });

  it("checks unsafe blockers before computeBidStrategy is invoked", () => {
    const blockerIndex = source.indexOf("BID_STRATEGY_UNAVAILABLE_ANALYSIS_UNRELIABLE");
    const computeIndex = source.indexOf("computeBidStrategy({");
    assert.ok(blockerIndex > -1, "missing unavailable blocker code");
    assert.ok(computeIndex > -1, "missing computeBidStrategy call");
    assert.ok(blockerIndex < computeIndex, "bid-strategy unsafe gate must run before score computation");
  });

  it("panel renders the server blocker list in the unavailable state", () => {
    assert.match(panelSource, /unavailableBlockers/);
    assert.match(panelSource, /errBody\.blockers/);
    assert.match(panelSource, /Bid Strategy unavailable/);
  });
});

// DIRECTIVE 2: The SSE streaming path (handleStreamingAnalyze) was removed.
// The legacy /ai-analyze route now returns 422 MANUAL_AI_ANALYZE_REQUIRED for
// streaming/synchronous requests. These tests were updated to verify the new
// architecture instead of the deleted streaming path.
describe("Legacy ai-analyze route refuses fresh job creation", () => {
  const routeSource = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");

  it("route returns MANUAL_AI_ANALYZE_REQUIRED for fresh creation", () => {
    assert.match(routeSource, /MANUAL_AI_ANALYZE_REQUIRED/);
  });

  it("route returns 422 status for fresh creation", () => {
    assert.match(routeSource, /status: 422/);
  });

  it("route returns MANUAL_AI_ANALYZE_REQUIRED for fresh creation", () => {
    assert.match(routeSource, /MANUAL_AI_ANALYZE_REQUIRED/);
  });
});

describe("clientContactName validation in AI Analyze save path", () => {
  // The clientContactName validation now lives in the shared canonical builder
  // used by both AI Analyze promotion paths.
  const builderSource = readFileSync("lib/engine/canonical-analysis-update.ts", "utf8");
  const analyzeSource = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");

  it("imports isValidClientContact validator (shared builder)", () => {
    assert.match(builderSource, /isValidClientContact/);
  });

  it("validates clientContactName before writing to DB (shared builder, applied by both paths)", () => {
    // The builder must not write clientContactName unconditionally —
    // it must call isValidClientContact() to reject fragments like "s Contact Person".
    assert.match(builderSource, /isValidClientContact\(aiResult\.clientContactName\)/);
    assert.ok((analyzeSource.match(/buildCanonicalAnalysisTenderUpdate\(/g) ?? []).length >= 2);
  });
});

describe("clientContactName propagates into AI cover letter prompt", () => {
  const aiSource = readFileSync("lib/ai.ts", "utf8");
  const sectionsSource = readFileSync("lib/engine/proposal-sections.ts", "utf8");
  const generateSource = readFileSync("lib/engine/generate-elite.ts", "utf8");

  it("AIBidWriterInput type includes clientContactName", () => {
    assert.match(aiSource, /clientContactName\?.*string.*null/);
  });

  it("buildCoverAndSummaryPrompt includes CLIENT CONTACT line in prompt when name provided", () => {
    assert.match(sectionsSource, /CLIENT CONTACT/);
    assert.match(sectionsSource, /clientContactName/);
    assert.match(sectionsSource, /Dear.*clientContactName/);
  });

  it("generate-elite passes clientContactName from intelligence into aiInputBase", () => {
    assert.match(generateSource, /clientContactName:\s*intelligence\.clientContactName/);
  });
});

describe("regenerate-section route passes clientContactName to AIBidWriterInput", () => {
  const source = readFileSync("app/api/tenders/[id]/regenerate-section/route.ts", "utf8");

  it("includes clientContactName in the aiInput object", () => {
    assert.match(source, /clientContactName:\s*tender\.clientContactName/);
  });

  it("covers the null fallback so the type contract is met", () => {
    assert.match(source, /clientContactName:\s*tender\.clientContactName\s*\?\?\s*null/);
  });
});

describe("proposal quality score improvement — Bid-Team stubs penalised on aiTraceFreedom", () => {
  const scorerSource = readFileSync("lib/engine/proposal-quality-scorer.ts", "utf8");

  it("FORBIDDEN_PHRASES includes Bid-Team to confirm pattern", () => {
    assert.match(scorerSource, /Bid-Team to confirm/i);
  });

  it("FORBIDDEN_PHRASES includes MISSING_SOURCE pattern", () => {
    assert.match(scorerSource, /MISSING_SOURCE/);
  });

  it("FORBIDDEN_PHRASES includes Bid-Team bracket variant", () => {
    assert.match(scorerSource, /\[Bid-Team/);
  });
});

describe("partial AI analysis caps analysisExtractionStatus to PARTIAL_EXTRACTION_AI_ANALYZED", () => {
  const source = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");

  it("imports ExtractionStatus type for compile-time safety", () => {
    assert.match(source, /type ExtractionStatus/);
  });

  it("streaming path: downgrades FULL to PARTIAL when aiMeta.isPartial is true", () => {
    // The fix must NOT simply persist the raw deriveExtractionStatus() return;
    // when isPartial is true the status must be capped at PARTIAL_EXTRACTION_AI_ANALYZED.
    assert.match(
      source,
      /aiMeta\.isPartial\s*&&\s*rawExtractionStatus\s*===\s*"FULL_EXTRACTION_AI_ANALYZED"\s*\?/,
      "streaming path must check aiMeta.isPartial before persisting extraction status",
    );
  });

  it("non-streaming path: downgrades FULL to PARTIAL when aiMeta.isPartial is true", () => {
    // The same cap must exist in the non-streaming path.
    // We verify by counting occurrences — at least 2 (one per code path).
    const matches = source.match(/aiMeta\.isPartial\s*&&\s*rawExtractionStatus\s*===\s*"FULL_EXTRACTION_AI_ANALYZED"/g);
    assert.ok(matches && matches.length >= 2, "both streaming and non-streaming paths must cap partial AI status");
  });

  it("generate-missing-plan-files route does not hard-block on contamination", () => {
    const genSource = readFileSync("app/api/tenders/[id]/generate-missing-plan-files/route.ts", "utf8");
    // Contamination is no longer a hard block for draft support-file generation
    assert.ok(true, "contamination no longer hard-blocks");
    assert.doesNotMatch(genSource, /\(tender as any\)\.clientName/);
    assert.doesNotMatch(genSource, /\(tender as any\)\.procuringEntityName/);
    // The route must NOT contain a hard contamination block
    assert.doesNotMatch(genSource, /code.*METADATA_CONTAMINATED/);
  });
});

describe("authority review gate blocks download route", () => {
  const source = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
  it("imports runAuthorityReview", () => { assert.match(source, /runAuthorityReview/); });
  it("returns AUTHORITY_REVIEW_BLOCKED on blocked status", () => { assert.match(source, /AUTHORITY_REVIEW_BLOCKED/); });
  it("METADATA_CONTAMINATED is advisory only", () => { assert.doesNotMatch(source, /warnings\.push\(\{[\s\S]*?METADATA_CONTAMINATED/); });
});

describe("central readiness gate covers EVERY download export path", () => {
  const source = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
  // Regression: the ZIP path (zipPackage) called the central gate, but the
  // single-document (?docId) and proposal-PDF (?type=pdf) export paths did
  // not — so a stale-hash / revoked-fallback analysis could still leak final
  // content one file at a time or as a PDF. All three export paths must pass
  // assertTenderReadyForGenerationAndExport, so the call count is at least 3.
  it("calls assertTenderReadyForGenerationAndExport in zip, single-doc, and pdf paths", () => {
    const calls = source.match(/assertTenderReadyForGenerationAndExport\(/g);
    assert.ok(
      calls && calls.length >= 3,
      `expected the central gate in all 3 export paths (zip, single-doc, pdf), found ${calls?.length ?? 0}`,
    );
  });
  it("single-document path blocks with a structured 409 on a failed gate", () => {
    assert.match(source, /Single-document export blocked/);
  });
  it("proposal-PDF path blocks with a structured 409 on a failed gate", () => {
    assert.match(source, /PDF export blocked/);
  });
});

describe("deferred gap fixes — post-618 hardening", () => {
  it("final-submission-readiness blocks on empty clientName", () => {
    const source = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    assert.match(source, /CLIENT_NAME_MISSING/);
    assert.match(source, /clientName/);
  });
  it("export-readiness checks for duplicate exactOrder", () => {
    const source = readFileSync("lib/engine/export-readiness.ts", "utf8");
    assert.match(source, /DUPLICATE_EXACT_ORDER/);
  });
  it("download route runs authority review on single-document path", () => {
    const source = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
    assert.match(source, /runAuthorityReview/);
    // single-doc path also calls it
    assert.match(source, /AUTHORITY_REVIEW_BLOCKED/);
  });
  it("document-quality-validator FINANCIAL_IN_TECHNICAL_RE requires numeric follow-on", () => {
    const source = readFileSync("lib/engine/document-quality-validator.ts", "utf8");
    // Pattern must require digit/currency after "total price" — the raw source
    // must contain the tightened regex with [\d,] follow-on so that prose like
    // "the total price of the contract was fair" does NOT trigger the rule.
    // We use assert.ok + includes() because the source contains literal
    // backslash characters (\s, \d) that make regex-based matching tricky.
    assert.ok(
      source.includes("total\\s+price\\s*(?:[:\\$€£]|is\\b)?\\s*[\\$€£]?\\s*[\\d,]"),
      "FINANCIAL_IN_TECHNICAL_RE must require a numeric/currency follow-on after 'total price'",
    );
    // Double-check: the old bare "total\s+price" pattern (without numeric guard)
    // must not appear as its own leading alternative in FINANCIAL_IN_TECHNICAL_RE.
    assert.ok(
      !source.match(/FINANCIAL_IN_TECHNICAL_RE\s*=\s*\/total\\s\+price\|/),
      "FINANCIAL_IN_TECHNICAL_RE must not start with bare 'total price' as its own alternative",
    );
  });
});
