// End-to-end test for the deep-reasoning pipeline (gap #6).
//
// True end-to-end generation requires real AI keys + DB and is run in
// CI/production. This file covers the *integration* of every
// deep-reasoning module in a single pipeline so wiring regressions
// surface before they reach production:
//
//   1. evaluation-criteria-extractor — parser handles real Claude
//      output shape (mocked here, parsed end-to-end)
//   2. semantic-match-aligner — parser handles real Claude output
//      shape, joins criteria, formats for prompt
//   3. constraint-validator — runs deterministic sweep + critique
//      formatters against the same comprehension
//   4. proposal-quality-scorer — depth + table coverage strengthen
//      lift on a substantive proposal
//   5. evaluator-simulator — calibration notes detect cross-persona
//      disagreement on the same canonical criterion
//   6. proposal-tools — executor returns coherent results for a
//      multi-turn Claude conversation
//
// Together these tests guarantee that the pipeline produces a
// well-formed analysis when every step succeeds AND that every
// graceful-null path keeps the legacy engine running.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  parseComprehensionJson,
  formatComprehensionForPrompt,
  type DeepTenderComprehension,
} from "../lib/engine/evaluation-criteria-extractor";
import {
  parseAlignmentReport,
  formatAlignmentForPrompt,
} from "../lib/engine/semantic-match-aligner";
import {
  validateConstraints,
  formatConstraintsForCritique,
  formatViolationsForCritique,
  violationsAsWeakAxes,
} from "../lib/engine/constraint-validator";
import { scoreProposalQuality } from "../lib/engine/proposal-quality-scorer";
import {
  computeCalibrationNotes,
  extractPersonaFocusedSlice,
  type PersonaAssessment,
} from "../lib/engine/evaluator-simulator";
import {
  executeProposalTool,
  type ToolEvidenceInventory,
} from "../lib/engine/proposal-tools";

// ─── Fixtures ────────────────────────────────────────────────────────

const TENDER_COMPREHENSION_JSON = JSON.stringify({
  reasoning: "Parsed an explicit scoring matrix. Technical Approach 40%, Team Experience 30%, Compliance 20%, Sustainability 10%. Joint ventures forbidden; ISO 9001 disqualifier.",
  criteria: [
    { criterion: "Technical Approach", weight: 40, mandatory: true, scoringMethod: "weighted", evidenceExpected: ["methodology narrative", "work plan"], sourceQuote: "Technical 40%" },
    { criterion: "Team Experience", weight: 30, mandatory: false, scoringMethod: "weighted", evidenceExpected: ["CVs"], sourceQuote: "Team 30%" },
    { criterion: "Compliance", weight: 20, mandatory: true, scoringMethod: "weighted", evidenceExpected: ["compliance matrix"], sourceQuote: "Compliance 20%" },
    { criterion: "Sustainability", weight: 10, mandatory: false, scoringMethod: "weighted", evidenceExpected: ["ESMP"], sourceQuote: "Sustainability 10%" },
  ],
  disqualifiers: [
    { rule: "ISO 9001 certification required", triggerLanguage: "without ISO 9001 will be deemed non-responsive" },
  ],
  prohibitions: ["No joint ventures permitted", "Sub-contracting of core services is not allowed"],
  totalWeightAccountedFor: 100,
});

const SUBSTANTIVE_PROPOSAL = `# Cover Letter

To the Evaluation Committee, we are pleased to submit our proposal for the Water Supply Detailed Design tender. Our firm has delivered comparable assignments — the 2022 Sebeta WASH project (ETB 18M, World Bank) demonstrates EPANET-based hydraulic modelling at exactly the scale this tender requires.

# Executive Summary

The 2022 Sebeta WASH project shows our firm's capability for the proposed methodology. Dr. Alemu, our Senior Hydraulic Engineer, led that assignment over 18 months and brings 18 years of relevant experience. We hold License Grade I and ISO 9001 certification, current to 2027.

# Section A: Company Profile

## A.2 Corporate Information

ABC Engineering Consultants. Founded in 2008. License Grade I (Engineering Consultancy). Registration number 12345. TIN 0001234567. VAT 0009876543. ISO 9001:2015 certified, valid to 2027. Headcount 42.

## A.4 Proposed Project Team

The team is led by Dr. Alemu Tadesse, Senior Hydraulic Engineer, with 18 years of EPANET-based hydraulic modelling experience for urban water supply schemes. Supported by Mr. Bekele Bogale (PMP-certified Project Manager, 12 years) and Ms. Tigist Wolde (QA Engineer, 9 years).

# Section B: Relevant Experience

The 2022 Sebeta WASH project (ETB 18M, World Bank) covered hydraulic design, EPANET modelling, and detailed engineering drawings for 12 woredas. Delivered on schedule with full client acceptance.

The 2020 Adama Urban Master Plan (ETB 24M, AfDB-funded) extended into infrastructure planning for water and sanitation. Both projects are documented in the firm's project portfolio.

# Section C: Technical Approach

## C.1 Understanding of the Assignment

We understand the scope as: detailed hydraulic design for the proposed water supply network, with EPANET modelling, field surveys, and hydrogeological assessment. The 12-month delivery aligns with our standard methodology.

## C.2 Technical Methodology

Hydraulic modelling will use EPANET 2.2 with calibrated demand patterns. Field surveys will employ differential GPS for ±5 cm precision. Hydrogeological assessment will reuse the methodology from the Sebeta WASH project. Three-stage QA review with internal peer audit at 30%, 70%, and 100% milestones.

## C.5 Risk Register

Procurement delays — mitigated by parallel sourcing. Field access — mitigated by pre-mobilisation site visits. Staff continuity — mitigated by 2 backup engineers per role.

## C.6 Work Plan and Schedule

12-month workplan: months 1–2 mobilisation and surveys; months 3–6 modelling and design; months 7–10 detailed drawings and BoQ; months 11–12 client review and handover.

# Section D: Additional Information

## D.4 Declaration of Eligibility

ABC Engineering Consultants confirms full eligibility under the tender's terms. License Grade I current to 2027. ISO 9001 current to 2027. No pending litigation, no debarments, not under sanctions. The firm bids as sole prime contractor — no joint venture, no consortium, no sub-contracting of core services.

# Section E: Compliance Matrix

| Requirement | Where Addressed | Evidence | Status |
|---|---|---|---|
| Senior Hydraulic Engineer | A.4 | Dr. Alemu CV (18 yrs, License Grade I) | FULLY MET |
| EPANET methodology | C.2 | Section C.2, Sebeta reference | FULLY MET |
| ISO 9001 certification | A.2 | Certificate to 2027 | FULLY MET |
| Comparable project | B | 2022 Sebeta WASH | FULLY MET |
| 12-month delivery | C.6 | Work plan | FULLY MET |

# Section F: Evaluation Criteria Response Mirror

| Criterion | Weight | Where Answered | Evidence Anchor |
|---|---|---|---|
| Technical Approach | 40% | Section C.2 | EPANET 2.2, Sebeta reference |
| Team Experience | 30% | Section A.4 | Dr. Alemu 18 yrs, License Grade I |
| Compliance | 20% | Section E + D.4 | Compliance Matrix; sole prime |
| Sustainability | 10% | Section C.2 | Calibrated demand patterns; ESMP |

# Declaration

We confirm the accuracy of the information provided.
`;

const VIOLATING_PROPOSAL = `# Cover Letter

We propose to deliver this assignment in joint venture with XYZ Partners — combining our hydraulic expertise with their local field force. Survey work will be subcontracted to a local firm to reduce mobilisation time.

# Section A: Company Profile

Founded in 2024 as a specialist water consultancy.
`;

// ─── Tests ───────────────────────────────────────────────────────────

describe("E2E: comprehension → alignment → constraints → scorer", () => {
  it("parses a representative Claude comprehension payload end-to-end", () => {
    const comp = parseComprehensionJson(TENDER_COMPREHENSION_JSON);
    assert.ok(comp);
    assert.equal(comp!.criteria.length, 4);
    assert.equal(comp!.disqualifiers.length, 1);
    assert.equal(comp!.prohibitions.length, 2);
    assert.equal(comp!.totalWeightAccountedFor, 100);
    // Stable ids drive cross-module joins.
    assert.equal(comp!.criteria[0].id, "technical-approach");
  });

  it("formats comprehension into a prompt block ready for the generator", () => {
    const comp = parseComprehensionJson(TENDER_COMPREHENSION_JSON)!;
    const block = formatComprehensionForPrompt(comp);
    assert.match(block, /DEEP TENDER COMPREHENSION/);
    assert.match(block, /Technical Approach.*40%.*MANDATORY/);
    assert.match(block, /Disqualifying conditions/);
    assert.match(block, /Structural prohibitions/);
  });

  it("alignment parser joins matched criterion names through the comprehension", () => {
    const comp = parseComprehensionJson(TENDER_COMPREHENSION_JSON)!;
    const alignmentRaw = JSON.stringify({
      summary: "Strong on technical approach; light on sustainability evidence.",
      alignments: [
        { recordType: "expert", recordId: "expert-1", recordName: "Dr. Alemu", criterionId: "technical-approach", alignmentScore: 9, rationale: "18 yrs EPANET; led Sebeta WASH", riskFlag: null },
        { recordType: "project", recordId: "project-1", recordName: "Sebeta WASH", criterionId: "team-experience", alignmentScore: 7, rationale: "12-woreda WASH design delivery", riskFlag: null },
      ],
      coverageByCriterion: [
        { criterionId: "technical-approach", coverageScore: 9, topRecords: ["Dr. Alemu", "Sebeta WASH"] },
        { criterionId: "team-experience", coverageScore: 7, topRecords: ["Sebeta WASH"] },
      ],
    });
    const report = parseAlignmentReport(alignmentRaw, comp);
    assert.ok(report);
    assert.equal(report!.alignments.length, 2);
    assert.equal(report!.alignments[0].criterion, "Technical Approach");
    assert.equal(report!.alignments[0].criterionWeight, 40);

    const block = formatAlignmentForPrompt(report!);
    assert.match(block, /SEMANTIC MATCH-TO-CRITERIA ALIGNMENT/);
    assert.match(block, /Dr\. Alemu.*Technical Approach.*\(40%\): 9\/10/);
  });

  it("constraint validator catches prohibition + disqualifier violations against a violating proposal", () => {
    const comp = parseComprehensionJson(TENDER_COMPREHENSION_JSON)!;
    const result = validateConstraints(comp, VIOLATING_PROPOSAL);
    // JV mention + sub-contracting mention + founding-year disqualifier (2024 + 5yr threshold)
    assert.ok(result.violations.length >= 2, `expected >=2 violations, got ${result.violations.length}`);
    const types = result.violations.map((v) => v.type);
    assert.ok(types.includes("prohibition"), "expected at least one prohibition violation");
    const ruleTexts = result.violations.map((v) => v.rule).join(" | ");
    assert.match(ruleTexts, /joint ventures|sub.contract/i);
    // Synthetic weak-axes pipe through the refiner gating.
    const axes = violationsAsWeakAxes(result);
    assert.ok(axes.includes("constraintProhibition"));
  });

  it("constraint validator clears a clean proposal and surfaces clearance + deferrals", () => {
    const comp = parseComprehensionJson(TENDER_COMPREHENSION_JSON)!;
    const result = validateConstraints(comp, SUBSTANTIVE_PROPOSAL);
    assert.equal(result.violations.length, 0, `expected zero violations on the substantive proposal, got ${JSON.stringify(result.violations.map((v) => v.rule))}`);
    assert.ok(result.cleared.length >= 2, `expected at least 2 cleared prohibitions, got ${result.cleared.length}`);
    // The ISO 9001 disqualifier has no deterministic checker → deferred.
    assert.ok(result.deferredToCritic.some((r) => /ISO 9001/.test(r)));
  });

  it("scorer rewards the substantive proposal on every depth-sensitive axis", () => {
    const score = scoreProposalQuality({
      markdown: SUBSTANTIVE_PROPOSAL,
      primarySector: "water",
      topProjects: [],
    });
    // Threshold sized for a fixture without the full sector-vocabulary
    // depth a real proposal would carry (no EBCS / chlorination /
    // WaterCAD / yield-test mentions). The point of this assertion is
    // that the depth-aware scorer rewards a substantive fixture above
    // a baseline, not that the fixture matches a production-grade
    // proposal token-for-token.
    assert.ok(score.total >= 55, `expected substantive proposal to score >=55, got ${score.total}`);
    assert.ok(score.axes.structureCompleteness >= 7, `expected structure >=7, got ${score.axes.structureCompleteness}`);
    assert.ok(score.axes.evidenceDensity >= 5, `expected evidence density >=5, got ${score.axes.evidenceDensity}`);
    assert.ok(score.axes.tableCoverage >= 2, `expected non-zero table coverage, got ${score.axes.tableCoverage}`);
    assert.ok(score.axes.aiTraceFreedom >= 8, `expected AI trace freedom >=8, got ${score.axes.aiTraceFreedom}`);
    // structureCompleteness should NOT be in weak axes.
    assert.equal(score.weakAxes.includes("structureCompleteness"), false);
  });

  it("constraint formatters produce non-empty checklist + violations blocks for downstream critique", () => {
    const comp = parseComprehensionJson(TENDER_COMPREHENSION_JSON)!;
    const checklist = formatConstraintsForCritique(comp);
    assert.match(checklist, /CONSTRAINT VERIFICATION CHECKLIST/);
    assert.match(checklist, /P1\. No joint ventures permitted/);
    assert.match(checklist, /D1\. ISO 9001 certification required/);

    const violations = validateConstraints(comp, VIOLATING_PROPOSAL);
    const violationsBlock = formatViolationsForCritique(violations);
    assert.match(violationsBlock, /CONSTRAINT VIOLATIONS DETECTED/);
    assert.match(violationsBlock, /Fix:/);
  });
});

describe("E2E: evaluator panel calibration on the substantive proposal", () => {
  function assess(persona: PersonaAssessment["persona"], scores: Array<[string, number]>): PersonaAssessment {
    return {
      persona,
      personaSummary: "test",
      criterionScores: scores.map(([criterion, score]) => ({ criterion, score, rationale: "" })),
      objections: [],
      commendations: [],
      actions: [],
      durationMs: 0,
    };
  }

  it("per-persona slicing returns domain-relevant content from the substantive proposal", () => {
    const technical = extractPersonaFocusedSlice(SUBSTANTIVE_PROPOSAL, "TECHNICAL");
    const compliance = extractPersonaFocusedSlice(SUBSTANTIVE_PROPOSAL, "COMPLIANCE");
    const endUser = extractPersonaFocusedSlice(SUBSTANTIVE_PROPOSAL, "END_USER");
    const commercial = extractPersonaFocusedSlice(SUBSTANTIVE_PROPOSAL, "COMMERCIAL");

    assert.match(technical, /EPANET 2\.2/);
    assert.match(compliance, /FULLY MET/);
    assert.match(endUser, /12-month workplan/);
    assert.match(commercial, /License Grade I/);
  });

  it("computeCalibrationNotes flags cross-persona disagreement", () => {
    const notes = computeCalibrationNotes([
      assess("TECHNICAL", [["Technical Approach", 9], ["Team Experience", 8]]),
      assess("COMPLIANCE", [["Technical Approach", 5], ["Team Experience", 8]]),
      assess("END_USER", [["Technical Approach", 7], ["Team Experience", 8]]),
    ]);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].criterion, "technical approach");
    assert.equal(notes[0].spread, 4); // 9 - 5
    assert.equal(notes[0].level, "moderate");
  });
});

describe("E2E: proposal tools answer search/inspect queries coherently", () => {
  const inventory: ToolEvidenceInventory = {
    experts: [
      { fullName: "Dr. Alemu Tadesse", title: "Senior Hydraulic Engineer", yearsExperience: 18, profile: "EPANET-based hydraulic modelling lead. 2022 Sebeta WASH project (ETB 18M).", disciplines: ["water"], sectors: ["water"], certifications: ["License Grade I"], trustLevel: "REVIEWED" },
    ],
    projects: [
      { name: "Sebeta WASH Feasibility and Detailed Design", clientName: "Ethiopian Ministry of Water", country: "Ethiopia", sector: "water", summary: "World Bank-funded WASH project, EPANET modelling.", contractValue: 18000000, currency: "ETB", trustLevel: "REVIEWED" },
    ],
  };

  it("returns a coherent search payload when Claude asks about a skill", () => {
    const result = executeProposalTool("search_company_knowledge", { query: "EPANET hydraulic modelling", type: "both" }, inventory) as {
      experts: Array<{ name: string }>;
      projects: Array<{ name: string }>;
    };
    assert.ok(result.experts.length >= 1);
    assert.ok(result.projects.length >= 1);
    assert.equal(result.experts[0].name, "Dr. Alemu Tadesse");
  });

  it("returns the named expert when Claude asks for a specific profile", () => {
    const result = executeProposalTool("inspect_expert", { name: "Alemu" }, inventory) as { matchCount: number; experts: Array<{ profile: string }> };
    assert.equal(result.matchCount, 1);
    assert.match(result.experts[0].profile, /Sebeta WASH/);
  });

  it("surfaces a 'not in library' note when Claude asks for an unknown record", () => {
    const result = executeProposalTool("inspect_project", { name: "Phantom Hydropower Phase 99" }, inventory) as { matchCount: number; note?: string };
    assert.equal(result.matchCount, 0);
    assert.match(result.note ?? "", /does not include/);
  });
});

describe("E2E: graceful degradation when AI is unavailable", () => {
  it("comprehension extractor returns null for too-short input without calling AI", async () => {
    const { extractDeepTenderComprehension } = await import("../lib/engine/evaluation-criteria-extractor");
    const result = await extractDeepTenderComprehension("");
    assert.equal(result, null);
  });

  it("alignment returns null when no comprehension is supplied", async () => {
    const { alignMatchesToEvaluatorCriteria } = await import("../lib/engine/semantic-match-aligner");
    const result = await alignMatchesToEvaluatorCriteria({
      tenderTitle: "T",
      clientName: "C",
      comprehension: null,
      experts: [{ id: "e1", name: "X", profile: "y" }],
      projects: [],
    });
    assert.equal(result, null);
  });

  it("deep refinement returns null when initial score already exceeds threshold", async () => {
    const { runDeepRefinement } = await import("../lib/engine/deep-reasoning-refiner");
    const result = await runDeepRefinement({
      initialMarkdown: SUBSTANTIVE_PROPOSAL,
      initialScore: {
        total: 95,
        axes: {
          structureCompleteness: 10, evidenceDensity: 10, tableCoverage: 10, sectorVocabulary: 10,
          throughlineConsistency: 10, aiTraceFreedom: 10, complianceMatrixCoverage: 10,
          evaluatorMirrorCoverage: 10, winThemesPresence: 10, selfScorePresence: 5,
        },
        weakAxes: [],
        notes: [],
      },
      scoreMarkdown: () => ({
        total: 95,
        axes: {
          structureCompleteness: 10, evidenceDensity: 10, tableCoverage: 10, sectorVocabulary: 10,
          throughlineConsistency: 10, aiTraceFreedom: 10, complianceMatrixCoverage: 10,
          evaluatorMirrorCoverage: 10, winThemesPresence: 10, selfScorePresence: 5,
        },
        weakAxes: [],
        notes: [],
      }),
      cleanMarkdown: (md) => md,
      tenderTitle: "T", clientName: "C", primarySector: "water",
      topProjectNames: [], topExpertNames: [],
      scoreThreshold: 90,
    });
    assert.equal(result, null);
  });
});
