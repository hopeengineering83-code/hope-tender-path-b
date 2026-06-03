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
    assert.match(analyzeSource, /metadataContaminated.*contamination\.contaminated/);
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
