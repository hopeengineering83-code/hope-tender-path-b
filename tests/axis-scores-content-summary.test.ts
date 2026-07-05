// Verifies that generate-elite writes AXIS_SCORES: {...} to contentSummary
// in a format that can be parsed by the tender-detail.tsx IIFE regex.
//
// The regex used by the UI: /AXIS_SCORES:\s*(\{[^}]+\})/
// This test decouples the format contract from a live generation run.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { scoreProposalQuality } from "../lib/engine/proposal-quality-scorer";

const FULL_PROPOSAL = `
## Section A: Cover Letter
We submit this proposal for the Ministry of Health tender REF-MOH-2026.
Our firm has 18 years of experience in health-sector consulting.

## Section B: Company Profile
Established in 2008, our firm has delivered 50+ projects across Ethiopia and East Africa.
Key registration: TIN 1234567. Our ISO 9001:2015 certification demonstrates quality management.

## Section C: Technical Approach and Methodology
| Phase | Activity | Duration | Deliverable |
|---|---|---|---|
| 1 | Inception | 2 weeks | Inception Report |
| 2 | Data Collection | 4 weeks | Raw Data |
| 3 | Analysis | 3 weeks | Analysis Report |
Our methodology draws on WHO clinical guidelines and FMOH health protocols.
The proposed team includes Dr. Alemu (Team Leader) with 18 years' experience.

## Section D: Team Qualifications
Senior experts: Dr. Alemu (MD, MPH), Dr. Bekele (PhD Epidemiology).
Combined 35+ years in health-system strengthening across Sub-Saharan Africa.

## Section E: Compliance Matrix
| Tender requirement | Compliance status | Evidence | Action |
|---|---|---|---|
| Team lead 10+ years | FULLY MET | Dr. Alemu — 18 years | None |
| ISO certification | FULLY MET | ISO 9001:2015 | None |

## Section F: Evaluation Criteria Response Mirror
| Criterion | Weight | Where answered | Strength |
|---|---|---|---|
| Technical approach | 40% | Section C | DIRECT |
| Team qualifications | 30% | Section D | DIRECT |

## Section G: Win Themes and Discriminators
Our three win themes: (1) deep FMOH network, (2) proprietary HIMS toolkit, (3) 100% on-time delivery.

## Section H: Proposal Self-Score
Quality self-assessment: Technical 9/10, Team 9/10, Compliance 10/10. Estimated win probability 72%.

## Section I: Declaration
We confirm all information is accurate and the proposal is valid for 90 days.
`.trim();

describe("AXIS_SCORES contentSummary format contract", () => {
  it("scoreProposalQuality returns all 10 expected axes", () => {
    const score = scoreProposalQuality({ markdown: FULL_PROPOSAL, primarySector: "Health", topProjects: [] });
    const axes = score.axes;
    const expected = [
      "structureCompleteness", "evidenceDensity", "tableCoverage",
      "sectorVocabulary", "throughlineConsistency", "aiTraceFreedom",
      "complianceMatrixCoverage", "evaluatorMirrorCoverage",
      "winThemesPresence", "selfScorePresence",
    ];
    for (const key of expected) {
      assert.ok(key in axes, `Missing axis: ${key}`);
      assert.ok(typeof (axes as Record<string, number>)[key] === "number", `Axis ${key} must be a number`);
    }
  });

  it("JSON.stringify of axis scores produces valid JSON parseable by the UI regex", () => {
    const score = scoreProposalQuality({ markdown: FULL_PROPOSAL, primarySector: "Health", topProjects: [] });
    const axisScoresJson = JSON.stringify({
      structure: score.axes.structureCompleteness,
      evidence: score.axes.evidenceDensity,
      tables: score.axes.tableCoverage,
      vocabulary: score.axes.sectorVocabulary,
      throughline: score.axes.throughlineConsistency,
      "ai-free": score.axes.aiTraceFreedom,
      compliance: score.axes.complianceMatrixCoverage,
      mirror: score.axes.evaluatorMirrorCoverage,
      "win-themes": score.axes.winThemesPresence,
      "self-score": score.axes.selfScorePresence,
    });
    const contentSummary = `Technical proposal generated. Quality score: ${score.total}/100. AXIS_SCORES: ${axisScoresJson}. Win probability: 72%.`;
    // The UI regex: /AXIS_SCORES:\s*(\{[^}]+\})/
    const match = contentSummary.match(/AXIS_SCORES:\s*(\{[^}]+\})/);
    assert.ok(match !== null, "UI regex must match AXIS_SCORES in contentSummary");
    const parsed = JSON.parse(match[1]) as Record<string, number>;
    assert.ok(typeof parsed.structure === "number", "structure axis must be a number");
    assert.ok(typeof parsed.evidence === "number", "evidence axis must be a number");
    assert.ok(typeof parsed.compliance === "number", "compliance axis must be a number");
  });

  it("full-proposal scores above 50 overall", () => {
    const score = scoreProposalQuality({ markdown: FULL_PROPOSAL, primarySector: "Health", topProjects: [] });
    assert.ok(score.total >= 50, `Full proposal should score ≥ 50, got ${score.total}`);
  });
});
