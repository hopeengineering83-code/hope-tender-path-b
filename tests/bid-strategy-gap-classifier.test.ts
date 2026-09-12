// Bid-Strategy gap classifier + DECLINE-inhibition behaviour.
//
// Production failure class: capability coverage can read 0/DECLINE while the
// Company Vault already contains authoritative evidence. Both authenticated
// REVIEWED and durable SOURCE_VERIFIED records must count; draft records must
// never count.

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
    assert.match(r.explanation, /regex\/deterministic fallback/i);
  });

  it("EVIDENCE_LINKING_GAP when vault has authoritative experts but none are linked to this tender", () => {
    const r = classifyBidStrategyGaps({
      tender: { requirements: { length: 5 }, expertMatches: [], analysisSource: "AI_VERIFIED", evidenceCoverageRatio: 0 },
      company: { expertCount: 25 },
      capabilityScore: 5,
    });
    assert.equal(r.capabilityGapCause, "EVIDENCE_LINKING_GAP");
    assert.equal(r.inhibitDecline, true);
    assert.match(r.explanation, /authoritative source-backed experts/i);
  });

  it("EVIDENCE_LINKING_GAP when matches exist but all are drafts", () => {
    const r = classifyBidStrategyGaps({
      tender: {
        requirements: { length: 5 },
        expertMatches: [
          { expert: { trustLevel: "AI_DRAFT" } },
          { expert: { trustLevel: "REGEX_DRAFT" } },
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

  it("does not treat SOURCE_VERIFIED linked experts as unreviewed/linking gaps", () => {
    const r = classifyBidStrategyGaps({
      tender: {
        requirements: { length: 5 },
        expertMatches: [{ expert: { trustLevel: "SOURCE_VERIFIED" } }],
        analysisSource: "AI_VERIFIED",
        evidenceCoverageRatio: 0.8,
      },
      company: { expertCount: 25 },
      capabilityScore: 20,
    });
    assert.equal(r.signals.vaultHasExpertsButNoneReviewed, false);
  });

  it("TRUE_CAPABILITY_GAP when authoritative vault is empty and no other system-readiness signals exist", () => {
    const r = classifyBidStrategyGaps({
      tender: { requirements: { length: 5 }, expertMatches: [], analysisSource: "AI_VERIFIED", evidenceCoverageRatio: 0.5 },
      company: { expertCount: 0 },
      capabilityScore: 10,
    });
    assert.equal(r.capabilityGapCause, "TRUE_CAPABILITY_GAP");
    assert.equal(r.inhibitDecline, false);
    assert.match(r.explanation, /lacks authoritative source-backed experts/i);
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

describe("computeBidStrategy honours runtime-authoritative Company Vault evidence", () => {
  it("regex fallback + no linked evidence cannot collapse to DECLINE", () => {
    const strategy = computeBidStrategy(baseInput({
      analysisSource: "REGEX_FALLBACK_AI_ERROR",
      evidenceCoverageRatio: 0,
      expertMatches: [],
      projectMatches: [],
    }));
    assert.notEqual(strategy.recommendation, "DECLINE");
    assert.equal(strategy.gapAnalysis?.inhibitDecline, true);
    assert.match(strategy.rationale, /Gap analysis:/);
  });

  it("TRUE capability gap may still DECLINE when authoritative Vault is empty", () => {
    const strategy = computeBidStrategy(baseInput(
      { analysisSource: "AI_VERIFIED", evidenceCoverageRatio: 0.5, expertMatches: [], projectMatches: [] },
      { expertCount: 0, projectCount: 0 },
    ));
    assert.equal(strategy.gapAnalysis?.capabilityGapCause, "TRUE_CAPABILITY_GAP");
    assert.equal(strategy.gapAnalysis?.inhibitDecline, false);
  });

  it("SOURCE_VERIFIED experts contribute capability exactly like REVIEWED experts", () => {
    const shared = {
      analysisSource: "AI_VERIFIED",
      evidenceCoverageRatio: 0.9,
      projectMatches: [],
    };
    const reviewed = computeBidStrategy(baseInput({
      ...shared,
      expertMatches: [
        { expert: { trustLevel: "REVIEWED", fullName: "Dr A", disciplines: "[\"public health\",\"epidemiology\"]" }, score: 0.9, isSelected: true },
        { expert: { trustLevel: "REVIEWED", fullName: "Dr B", disciplines: "[\"methodology\",\"public health\"]" }, score: 0.85, isSelected: true },
      ],
    }));
    const sourceVerified = computeBidStrategy(baseInput({
      ...shared,
      expertMatches: [
        { expert: { trustLevel: "SOURCE_VERIFIED", fullName: "Dr A", disciplines: "[\"public health\",\"epidemiology\"]" }, score: 0.9, isSelected: true },
        { expert: { trustLevel: "SOURCE_VERIFIED", fullName: "Dr B", disciplines: "[\"methodology\",\"public health\"]" }, score: 0.85, isSelected: true },
      ],
    }));
    assert.equal(sourceVerified.dimensionScores.capabilityCoverage, reviewed.dimensionScores.capabilityCoverage);
  });

  it("SOURCE_VERIFIED projects contribute experience fit exactly like REVIEWED projects", () => {
    const baseProjects = [
      { score: 0.9, isSelected: true, project: { name: "A", trustLevel: "REVIEWED", sector: "health", serviceAreas: "[]" } },
      { score: 0.8, isSelected: true, project: { name: "B", trustLevel: "REVIEWED", sector: "health", serviceAreas: "[]" } },
    ];
    const reviewed = computeBidStrategy(baseInput({ analysisSource: "AI_VERIFIED", projectMatches: baseProjects }));
    const sourceVerified = computeBidStrategy(baseInput({
      analysisSource: "AI_VERIFIED",
      projectMatches: baseProjects.map((project) => ({ ...project, project: { ...project.project, trustLevel: "SOURCE_VERIFIED" } })),
    }));
    assert.equal(sourceVerified.dimensionScores.experienceFit, reviewed.dimensionScores.experienceFit);
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
  it("SOURCE_VERIFIED is explicitly part of strategy authority", () => {
    assert.match(src, /SOURCE_VERIFIED/);
  });
});

describe("Panel surfaces the gap analysis to the user", () => {
  const src = readFileSync("components/bid-strategy-panel.tsx", "utf8");
  it("shows the gap-cause block when capabilityGapCause is not NO_CAPABILITY_GAP", () => {
    assert.match(src, /strategy\.gapAnalysis\.capabilityGapCause !== "NO_CAPABILITY_GAP"/);
    assert.match(src, /Capability score read with care/);
    assert.match(src, /gap cause:[\s\S]*strategy\.gapAnalysis\.capabilityGapCause/);
  });
  it("explicitly explains the DECLINE inhibition when applicable", () => {
    assert.match(src, /prevented from collapsing to DECLINE/);
  });
});