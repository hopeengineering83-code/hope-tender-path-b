// J — Bid-Strategy gap classifier + DECLINE-inhibition behaviour.
//
// Production screenshot: capabilityCoverage 0, recommendation DECLINE while
// experienceFit 92, complianceReadiness 95, eligibilityClearance 100. The 0
// was driven by an EVIDENCE_LINKING_GAP (no reviewed experts linked to this
// tender even though the vault was full). DECLINE on that basis is wrong.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyBidStrategyGaps } from "../lib/engine/bid-strategy-gap-classifier";
import { computeBidStrategy, type BidStrategyInput } from "../lib/engine/bid-strategy";

function baseInput(overrides: Partial<BidStrategyInput["tender"]> = {}, companyOverrides: Partial<BidStrategyInput["company"]> = {}): BidStrategyInput {
  return {
    tender: {
      id: "t1",
      title: "Health-sector consultancy",
      requirements: [
        { title: "Lead Public Health Specialist", description: "MPH with 10 years experience", requirementType: "EXPERT", priority: "MANDATORY" },
        { title: "Methodology", description: "evidence-based approach", requirementType: "METHODOLOGY", priority: "MANDATORY" },
      ],
      complianceGaps: [],
      expertMatches: [],
      projectMatches: [],
      evaluationMethodology: "Technical 70% Financial 30%",
      analysisSource: null,
      evidenceCoverageRatio: 0.8,
      ...overrides,
    },
    company: {
      name: "Acme",
      sectors: "[]",
      serviceLines: "[]",
      expertCount: 25,
      projectCount: 12,
      legalRecordCount: 1,
      financialRecordCount: 1,
      ...companyOverrides,
    },
  };
}

describe("classifyBidStrategyGaps — pure unit", () => {
  it("NO_CAPABILITY_GAP when capability is healthy", () => {
    const r = classifyBidStrategyGaps({
      tender: { requirements: { length: 2 }, expertMatches: [], analysisSource: null, evidenceCoverageRatio: 0.9 },
      company: { expertCount: 25 },
      capabilityScore: 80,
    });
    assert.equal(r.capabilityGapCause, "NO_CAPABILITY_GAP");
    assert.equal(r.inhibitDecline, false);
  });

  it("METADATA_EXTRACTION_GAP when no requirements were extracted", () => {
    const r = classifyBidStrategyGaps({
      tender: { requirements: { length: 0 }, expertMatches: [], analysisSource: null, evidenceCoverageRatio: 1 },
      company: { expertCount: 25 },
      capabilityScore: 10,
    });
    assert.equal(r.capabilityGapCause, "METADATA_EXTRACTION_GAP");
    assert.equal(r.inhibitDecline, true);
    assert.match(r.explanation, /no requirements have been extracted/i);
  });

  it("PROVIDER_RATE_LIMIT_GAP when analysisSource is a regex fallback", () => {
    const r = classifyBidStrategyGaps({
      tender: { requirements: { length: 5 }, expertMatches: [], analysisSource: "REGEX_FALLBACK_AI_ERROR", evidenceCoverageRatio: 0.5 },
      company: { expertCount: 25 },
      capabilityScore: 15,
    });
    assert.equal(r.capabilityGapCause, "PROVIDER_RATE_LIMIT_GAP");
    assert.equal(r.inhibitDecline, true);
    assert.match(r.explanation, /regex fallback/i);
  });

  it("EVIDENCE_LINKING_GAP when vault has experts but none are linked to this tender", () => {
    const r = classifyBidStrategyGaps({
      tender: { requirements: { length: 5 }, expertMatches: [], analysisSource: "AI_VERIFIED", evidenceCoverageRatio: 0 },
      company: { expertCount: 25 },
      capabilityScore: 5,
    });
    assert.equal(r.capabilityGapCause, "EVIDENCE_LINKING_GAP");
    assert.equal(r.inhibitDecline, true);
    assert.match(r.explanation, /linked \/ reviewed for THIS tender/i);
  });

  it("EVIDENCE_LINKING_GAP when vault has experts and matches exist but NONE are reviewed", () => {
    const r = classifyBidStrategyGaps({
      tender: {
        requirements: { length: 5 },
        expertMatches: [
          { expert: { trustLevel: "DRAFT" } },
          { expert: { trustLevel: "DRAFT" } },
        ],
        analysisSource: "AI_VERIFIED",
        evidenceCoverageRatio: 0.5,
      },
      company: { expertCount: 25 },
      capabilityScore: 20,
    });
    assert.equal(r.capabilityGapCause, "EVIDENCE_LINKING_GAP");
    assert.equal(r.inhibitDecline, true);
  });

  it("TRUE_CAPABILITY_GAP when vault is empty AND no other system-readiness signals", () => {
    const r = classifyBidStrategyGaps({
      tender: { requirements: { length: 5 }, expertMatches: [], analysisSource: "AI_VERIFIED", evidenceCoverageRatio: 0.5 },
      company: { expertCount: 0 },
      capabilityScore: 10,
    });
    assert.equal(r.capabilityGapCause, "TRUE_CAPABILITY_GAP");
    assert.equal(r.inhibitDecline, false);
    assert.match(r.explanation, /lacks reviewed experts/i);
  });

  it("the granular signal flags reflect input state", () => {
    const r = classifyBidStrategyGaps({
      tender: {
        requirements: { length: 0 },
        expertMatches: [],
        analysisSource: "REGEX_FALLBACK_AI_ERROR",
        evidenceCoverageRatio: 0,
      },
      company: { expertCount: 0 },
      capabilityScore: 0,
    });
    assert.equal(r.signals.analysisRegexFallback, true);
    assert.equal(r.signals.noRequirementsExtracted, true);
    assert.equal(r.signals.vaultLacksReviewedExperts, true);
    assert.equal(r.signals.vaultHasExpertsButNoneLinked, false);
  });
});

describe("computeBidStrategy honours inhibitDecline", () => {
  it("Pharo-style screenshot: regex fallback + no linked evidence ⇒ NOT DECLINE", () => {
    const input = baseInput({
      analysisSource: "REGEX_FALLBACK_AI_ERROR",
      evidenceCoverageRatio: 0,
      expertMatches: [],
      projectMatches: [],
    });
    const strategy = computeBidStrategy(input);
    assert.notEqual(strategy.recommendation, "DECLINE", "must not collapse to DECLINE when the cause is system-readiness");
    assert.ok(strategy.gapAnalysis);
    assert.equal(strategy.gapAnalysis!.inhibitDecline, true);
    assert.match(strategy.rationale, /Gap analysis:/);
  });

  it("TRUE capability gap (empty vault, AI-verified, no linking gap) ⇒ DECLINE allowed", () => {
    const input = baseInput(
      { analysisSource: "AI_VERIFIED", evidenceCoverageRatio: 0.5, expertMatches: [], projectMatches: [] },
      { expertCount: 0, projectCount: 0 },
    );
    const strategy = computeBidStrategy(input);
    assert.ok(strategy.gapAnalysis);
    assert.equal(strategy.gapAnalysis!.capabilityGapCause, "TRUE_CAPABILITY_GAP");
    assert.equal(strategy.gapAnalysis!.inhibitDecline, false);
    // DECLINE is allowed here (engine may still choose BID_CAREFULLY based on
    // other dimensions; the rule is that DECLINE is NOT inhibited).
  });

  it("healthy capability ⇒ gapAnalysis.capabilityGapCause is NO_CAPABILITY_GAP", () => {
    const input = baseInput({
      expertMatches: [
        { expert: { trustLevel: "REVIEWED", fullName: "Dr A", disciplines: "[\"public health\",\"epidemiology\"]" }, score: 0.9, isSelected: true },
        { expert: { trustLevel: "REVIEWED", fullName: "Dr B", disciplines: "[\"methodology\",\"public health\"]" }, score: 0.85, isSelected: true },
      ],
      analysisSource: "AI_VERIFIED",
      evidenceCoverageRatio: 0.9,
    });
    const strategy = computeBidStrategy(input);
    assert.ok(strategy.gapAnalysis);
    assert.equal(strategy.gapAnalysis!.capabilityGapCause, "NO_CAPABILITY_GAP");
  });
});

describe("BidStrategy output exposes the gap analysis", () => {
  const src = readFileSync("lib/engine/bid-strategy.ts", "utf8");
  it("BidStrategy carries an optional gapAnalysis field", () => {
    assert.match(src, /gapAnalysis\?:\s*BidStrategyGapAnalysis/);
  });
  it("computeBidStrategy inhibits DECLINE when the classifier asks it to", () => {
    assert.match(src, /gapAnalysis\.inhibitDecline\s*&&\s*recommendation === "DECLINE"/);
    assert.match(src, /recommendation = "BID_CAREFULLY"/);
  });
});

describe("Panel surfaces the gap analysis to the user", () => {
  const src = "" /* deleted */;
  it("shows the gap-cause block when capabilityGapCause is not NO_CAPABILITY_GAP", () => {
    assert.match(src, /strategy\.gapAnalysis\.capabilityGapCause !== "NO_CAPABILITY_GAP"/);
    assert.match(src, /Capability score read with care/);
    assert.match(src, /gap cause:[\s\S]*strategy\.gapAnalysis\.capabilityGapCause/);
  });
  it("explicitly explains the DECLINE inhibition when applicable", () => {
    assert.match(src, /prevented from collapsing to DECLINE/);
  });
});
