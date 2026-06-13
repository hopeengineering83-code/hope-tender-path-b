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
    assert.match(source, /KEY_REDACTED/);
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

  it("is defensive against test fakes lacking complianceGap.findFirst", () => {
    assert.match(source, /\.catch\(\(\)\s*=>\s*\(\{\s*ok:\s*true/);
  });
});

describe("metadataContaminated blocks generation-readiness and generate route", () => {
  const readinessSource = readFileSync("lib/tender-generation-readiness.ts", "utf8");
  const generateSource = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");

  it("getTenderGenerationReadiness pushes METADATA_CONTAMINATED blocker", () => {
    assert.match(readinessSource, /METADATA_CONTAMINATED/);
    assert.match(readinessSource, /metadataContaminated/);
    assert.match(readinessSource, /blockers\.push/);
  });

  it("generate route hard-blocks with METADATA_CONTAMINATED errorCode", () => {
    assert.match(generateSource, /METADATA_CONTAMINATED/);
    assert.match(generateSource, /metadataContaminated/);
    assert.match(generateSource, /status:\s*422/);
  });

  it("AI Analyze writes contamination flag when portal noise detected", () => {
    const analyzeSource = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");
    assert.match(analyzeSource, /detectMetadataContamination/);
    // Phase 21: contamination check covers all entity fields via anyEntityContaminated
    assert.match(analyzeSource, /metadataContaminated.*anyEntityContaminated|anyEntityContaminated.*metadataContaminated/);
  });

  it("AI Analyze extracts full contact fields (Phase 7) and writes them to DB", () => {
    const analyzeSource = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");
    assert.match(analyzeSource, /clientContactName/);
    assert.match(analyzeSource, /clientContactEmail/);
    assert.match(analyzeSource, /clientContactPhone/);
    assert.match(analyzeSource, /submissionAddress/);
    assert.match(analyzeSource, /clientAddress/);
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
  const buildPlanRoute = readFileSync("app/api/tenders/[id]/submission-plan/build/route.ts", "utf8");
  const generateRoute = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");

  it("AI Analyze marks corrupted extraction as skipped, not provider failure", () => {
    assert.match(analyzeRoute, /EXTRACTION_CORRUPTED_AI_SKIPPED/);
    assert.match(analyzeRoute, /analysisExtractionStatus:\s*"OCR_REQUIRED"/);
    assert.match(analyzeRoute, /not an AI provider failure/);
  });

  it("Build Plan recomputes quality from extracted text instead of trusting stored extractionScore", () => {
    assert.match(buildPlanRoute, /assessExtractionQuality\(file\.extractedText/);
    assert.match(buildPlanRoute, /Math\.min\(file\.extractionScore \?\? quality\.score, quality\.score\)/);
    assert.match(buildPlanRoute, /EXTRACTION_CORRUPTED_BUILD_PLAN_SKIPPED/);
  });

  it("Generate Docs recomputes quality before any generatedDocument rows are created", () => {
    const gateIndex = generateRoute.indexOf("EXTRACTION_CORRUPTED_GENERATION_BLOCKED");
    const createIndex = generateRoute.indexOf("generateTenderDocuments(");
    assert.ok(gateIndex > -1, "missing corrupted generation blocker");
    assert.ok(createIndex > -1, "missing generation call");
    assert.ok(gateIndex < createIndex, "corrupted extraction gate must run before document generation");
    assert.match(generateRoute, /assessExtractionQuality\(file\.extractedText/);
  });

  it("Run Engine uses the shared extraction gate and cannot be force-bypassed", () => {
    const engineRoute = readFileSync("app/api/tenders/[id]/engine/route.ts", "utf8");
    assert.match(engineRoute, /isExtractionAcceptableForGeneration/);
    assert.match(engineRoute, /EXTRACTION_CORRUPTED_ENGINE_SKIPPED/);
    assert.match(engineRoute, /EXTRACTION_QUALITY_ENGINE_BLOCKED/);
    assert.match(engineRoute, /cannot be forced through corrupted, unknown-page, or incomplete extraction/);
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
    assert.match(source, /Legacy workflow score:/);
    assert.match(source, /not an export gate/);
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

describe("SSE streaming wiring — AI Analyze endpoint and UI progress display", () => {
  const routeSource = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");
  const uiSource = readFileSync("app/dashboard/tenders/[id]/tender-detail.tsx", "utf8");

  it("route has handleStreamingAnalyze function", () => {
    assert.match(routeSource, /handleStreamingAnalyze/);
  });

  it("route responds with text/event-stream content type and no-cache", () => {
    assert.match(routeSource, /text\/event-stream/);
    assert.match(routeSource, /Cache-Control.*no-cache/);
  });

  it("route branches on Accept: text/event-stream header", () => {
    assert.match(routeSource, /wantsStream/);
  });

  it("route emits all required phase events", () => {
    for (const phase of ["starting", "extracting", "analyzing", "saving", "complete", "error"]) {
      assert.match(routeSource, new RegExp(`phase:\\s*"${phase}"`), `missing phase: ${phase}`);
    }
  });

  it("UI sends Accept: text/event-stream and falls back to non-streaming", () => {
    assert.match(uiSource, /handleAnalyzeStreaming/);
    assert.match(uiSource, /"Accept":\s*"text\/event-stream"/);
    assert.match(uiSource, /handleAIAnalyze\(\)/);
  });

  it("UI tracks analyzePhase and analyzeProgress", () => {
    assert.match(uiSource, /analyzePhase/);
    assert.match(uiSource, /analyzeProgress/);
  });
});

describe("clientContactName validation in AI Analyze save path", () => {
  const analyzeSource = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");

  it("imports isValidClientContact validator", () => {
    assert.match(analyzeSource, /isValidClientContact/);
  });

  it("validates clientContactName before writing to DB (both streaming and non-streaming paths)", () => {
    // The route must not write clientContactName unconditionally —
    // it must call isValidClientContact() to reject fragments like "s Contact Person".
    assert.match(analyzeSource, /isValidClientContact\(aiResult\.clientContactName\)/);
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

  it("generate-missing-plan-files route no longer uses (tender as any) for contamination check", () => {
    const genSource = readFileSync("app/api/tenders/[id]/generate-missing-plan-files/route.ts", "utf8");
    assert.doesNotMatch(genSource, /\(tender as any\)\.metadataContaminated/);
    assert.doesNotMatch(genSource, /\(tender as any\)\.clientName/);
    assert.doesNotMatch(genSource, /\(tender as any\)\.procuringEntityName/);
    assert.match(genSource, /tender\.metadataContaminated/);
    assert.match(genSource, /tender\.clientName/);
    assert.match(genSource, /tender\.procuringEntityName/);
  });
});

describe("authority review gate blocks download route", () => {
  const source = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
  it("imports runAuthorityReview", () => { assert.match(source, /runAuthorityReview/); });
  it("returns AUTHORITY_REVIEW_BLOCKED on blocked status", () => { assert.match(source, /AUTHORITY_REVIEW_BLOCKED/); });
  it("does not remove METADATA_CONTAMINATED check", () => { assert.match(source, /METADATA_CONTAMINATED/); });
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
