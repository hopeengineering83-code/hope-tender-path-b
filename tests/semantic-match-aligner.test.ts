// Unit tests for semantic-match-aligner (gap #3 — semantic matching).
// Pure-function coverage: JSON parsing, formatter output, graceful-null
// orchestration. No live AI calls.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  alignMatchesToEvaluatorCriteria,
  formatAlignmentForPrompt,
  parseAlignmentReport,
  __testing__ as alignerInternals,
  type AlignmentReport,
} from "../lib/engine/matching/semantic-match-aligner";
import type { DeepTenderComprehension } from "../lib/engine/analysis/evaluation-criteria-extractor";

function comprehensionFixture(): DeepTenderComprehension {
  return {
    reasoning: "test",
    criteria: [
      { id: "tech-approach", criterion: "Technical Approach", weight: 40, mandatory: true, scoringMethod: "weighted", evidenceExpected: ["methodology"], sourceQuote: "" },
      { id: "team-experience", criterion: "Team Experience", weight: 30, mandatory: false, scoringMethod: "weighted", evidenceExpected: ["CVs"], sourceQuote: "" },
    ],
    disqualifiers: [],
    prohibitions: [],
    totalWeightAccountedFor: 70,
  };
}

describe("parseAlignmentReport — happy path", () => {
  it("parses a well-formed JSON payload and joins criterion names", () => {
    const raw = JSON.stringify({
      summary: "Strong fit on technical approach; team experience is solid but light on regional projects.",
      alignments: [
        {
          recordType: "expert",
          recordId: "exp1",
          recordName: "Dr. Alemu",
          criterionId: "tech-approach",
          alignmentScore: 8,
          rationale: "2022 Sebeta WASH project demonstrated EPANET-based hydraulic modelling",
          riskFlag: null,
        },
        {
          recordType: "project",
          recordId: "proj1",
          recordName: "Sebeta WASH",
          criterionId: "team-experience",
          alignmentScore: 7,
          rationale: "Delivered with 5 engineers over 18 months",
          riskFlag: "value 30% below tender estimate",
        },
      ],
      coverageByCriterion: [
        { criterionId: "tech-approach", coverageScore: 8, topRecords: ["Dr. Alemu", "Sebeta WASH"] },
        { criterionId: "team-experience", coverageScore: 6, topRecords: ["Sebeta WASH"] },
      ],
    });
    const report = parseAlignmentReport(raw, comprehensionFixture());
    assert.ok(report, "expected report to parse");
    assert.equal(report!.alignments.length, 2);
    assert.equal(report!.alignments[0].criterion, "Technical Approach"); // joined from comprehension
    assert.equal(report!.alignments[0].criterionWeight, 40);
    assert.equal(report!.alignments[1].riskFlag, "value 30% below tender estimate");
    assert.equal(report!.coverageByCriterion.length, 2);
    assert.match(report!.summary, /Strong fit on technical approach/);
  });
});

describe("parseAlignmentReport — robustness", () => {
  it("returns null for non-JSON input", () => {
    assert.equal(parseAlignmentReport("not json", comprehensionFixture()), null);
  });

  it("returns null when JSON is empty / unrelated", () => {
    assert.equal(parseAlignmentReport("[]", comprehensionFixture()), null);
    assert.equal(parseAlignmentReport('{"foo": "bar"}', comprehensionFixture()), null);
  });

  it("drops alignments with unknown criterionId", () => {
    const raw = JSON.stringify({
      summary: "test",
      alignments: [
        { recordType: "expert", recordId: "e1", recordName: "Expert One", criterionId: "unknown-criterion", alignmentScore: 9, rationale: "x", riskFlag: null },
        { recordType: "expert", recordId: "e2", recordName: "Expert Two", criterionId: "tech-approach", alignmentScore: 7, rationale: "y", riskFlag: null },
      ],
      coverageByCriterion: [],
    });
    const report = parseAlignmentReport(raw, comprehensionFixture());
    assert.ok(report);
    assert.equal(report!.alignments.length, 1);
    assert.equal(report!.alignments[0].recordId, "e2");
  });

  it("clamps alignment scores to 0–10", () => {
    const raw = JSON.stringify({
      summary: "test",
      alignments: [
        { recordType: "expert", recordId: "e1", recordName: "x", criterionId: "tech-approach", alignmentScore: 25, rationale: "x", riskFlag: null },
        { recordType: "expert", recordId: "e2", recordName: "y", criterionId: "tech-approach", alignmentScore: -5, rationale: "x", riskFlag: null },
      ],
      coverageByCriterion: [],
    });
    const report = parseAlignmentReport(raw, comprehensionFixture());
    assert.ok(report);
    assert.equal(report!.alignments[0].alignmentScore, 10);
    assert.equal(report!.alignments[1].alignmentScore, 0);
  });

  it("unwraps a markdown-fenced JSON block", () => {
    const fenced = "```json\n" + JSON.stringify({
      summary: "fenced test",
      alignments: [{ recordType: "expert", recordId: "e1", recordName: "X", criterionId: "tech-approach", alignmentScore: 5, rationale: "ok", riskFlag: null }],
      coverageByCriterion: [],
    }) + "\n```";
    const report = parseAlignmentReport(fenced, comprehensionFixture());
    assert.ok(report);
    assert.equal(report!.alignments.length, 1);
  });

  it("drops alignments with invalid recordType", () => {
    const raw = JSON.stringify({
      summary: "test",
      alignments: [
        { recordType: "company", recordId: "e1", recordName: "x", criterionId: "tech-approach", alignmentScore: 5, rationale: "x", riskFlag: null },
      ],
      coverageByCriterion: [],
    });
    // Without alignments AND without coverages AND without summary length 0 → null
    const report = parseAlignmentReport(raw, comprehensionFixture());
    assert.ok(report); // summary is non-empty so report is not null
    assert.equal(report!.alignments.length, 0);
  });

  it("normalises risk flags: empty string becomes null", () => {
    const raw = JSON.stringify({
      summary: "test",
      alignments: [
        { recordType: "expert", recordId: "e1", recordName: "x", criterionId: "tech-approach", alignmentScore: 5, rationale: "y", riskFlag: "" },
      ],
      coverageByCriterion: [],
    });
    const report = parseAlignmentReport(raw, comprehensionFixture());
    assert.ok(report);
    assert.equal(report!.alignments[0].riskFlag, null);
  });
});

describe("formatAlignmentForPrompt", () => {
  it("renders header, summary, coverage, and alignments", () => {
    const report: AlignmentReport = {
      summary: "Strong technical fit, light on regional refs.",
      alignments: [
        {
          recordType: "expert",
          recordId: "e1",
          recordName: "Dr. Alemu",
          criterionId: "tech-approach",
          criterion: "Technical Approach",
          criterionWeight: 40,
          alignmentScore: 8,
          rationale: "Sebeta WASH delivers EPANET modelling",
          riskFlag: null,
        },
        {
          recordType: "project",
          recordId: "p1",
          recordName: "Sebeta WASH",
          criterionId: "team-experience",
          criterion: "Team Experience",
          criterionWeight: 30,
          alignmentScore: 7,
          rationale: "5-engineer team over 18 months",
          riskFlag: "value below tender estimate",
        },
      ],
      coverageByCriterion: [
        { criterionId: "tech-approach", criterion: "Technical Approach", weight: 40, coverageScore: 8, topRecords: ["Dr. Alemu"] },
      ],
    };
    const text = formatAlignmentForPrompt(report);
    assert.match(text, /SEMANTIC MATCH-TO-CRITERIA ALIGNMENT/);
    assert.match(text, /Strong technical fit/);
    assert.match(text, /Coverage by criterion/);
    assert.match(text, /Technical Approach.*\(40%\): 8\/10/);
    assert.match(text, /anchors: Dr\. Alemu/);
    assert.match(text, /Per-candidate alignment/);
    assert.match(text, /Expert \*Dr\. Alemu\*/);
    assert.match(text, /\[RISK: value below tender estimate\]/);
  });

  it("omits empty sections cleanly", () => {
    const report: AlignmentReport = {
      summary: "no data",
      alignments: [],
      coverageByCriterion: [],
    };
    const text = formatAlignmentForPrompt(report);
    assert.match(text, /SEMANTIC MATCH-TO-CRITERIA ALIGNMENT/);
    assert.equal(text.includes("Coverage by criterion"), false);
    assert.equal(text.includes("Per-candidate alignment"), false);
  });
});

describe("buildAlignmentPrompt — prompt structure", () => {
  it("sorts criteria by weight then mandatory and truncates to top N", () => {
    const comprehension: DeepTenderComprehension = {
      reasoning: "x",
      criteria: [
        { id: "c1", criterion: "Cost", weight: 10, mandatory: false, scoringMethod: "weighted", evidenceExpected: [], sourceQuote: "" },
        { id: "c2", criterion: "Tech", weight: 50, mandatory: false, scoringMethod: "weighted", evidenceExpected: [], sourceQuote: "" },
        { id: "c3", criterion: "Team", weight: 50, mandatory: true, scoringMethod: "weighted", evidenceExpected: [], sourceQuote: "" },
      ],
      disqualifiers: [],
      prohibitions: [],
      totalWeightAccountedFor: 110,
    };
    const prompt = alignerInternals.buildAlignmentPrompt({
      tenderTitle: "T",
      clientName: "C",
      comprehension,
      experts: [{ id: "e1", name: "Expert 1", profile: "Senior water engineer" }],
      projects: [],
    });
    // Tech and Team (both 50%) come before Cost (10%); mandatory Team beats non-mandatory Tech at the same weight
    const techPos = prompt.indexOf("Tech");
    const teamPos = prompt.indexOf("Team");
    const costPos = prompt.indexOf("Cost");
    assert.ok(teamPos > 0);
    assert.ok(techPos > 0);
    assert.ok(costPos > 0);
    assert.ok(teamPos < costPos, "Team should appear before Cost");
    assert.ok(techPos < costPos, "Tech should appear before Cost");
    assert.ok(teamPos < techPos, "Mandatory Team should outrank non-mandatory Tech at same weight");
  });

  it("includes candidate ids and truncates long profiles", () => {
    const prompt = alignerInternals.buildAlignmentPrompt({
      tenderTitle: "T",
      clientName: "C",
      comprehension: comprehensionFixture(),
      experts: [{ id: "exp-007", name: "Bond", profile: "x".repeat(5000) }],
      projects: [{ id: "proj-007", name: "Casino Royale", profile: "y".repeat(5000) }],
    });
    assert.match(prompt, /\[exp-007\] Bond/);
    assert.match(prompt, /\[proj-007\] Casino Royale/);
    // Profile truncation to ~1200 chars — no 5000-char sequence appears
    assert.equal(prompt.includes("x".repeat(2000)), false);
    assert.equal(prompt.includes("y".repeat(2000)), false);
  });
});

describe("alignMatchesToEvaluatorCriteria — graceful nulls", () => {
  it("returns null when comprehension is missing", async () => {
    const result = await alignMatchesToEvaluatorCriteria({
      tenderTitle: "T",
      clientName: "C",
      comprehension: null,
      experts: [{ id: "e1", name: "X", profile: "y" }],
      projects: [],
    });
    assert.equal(result, null);
  });

  it("returns null when comprehension has no criteria", async () => {
    const result = await alignMatchesToEvaluatorCriteria({
      tenderTitle: "T",
      clientName: "C",
      comprehension: { reasoning: "x", criteria: [], disqualifiers: [], prohibitions: [], totalWeightAccountedFor: null },
      experts: [{ id: "e1", name: "X", profile: "y" }],
      projects: [],
    });
    assert.equal(result, null);
  });

  it("returns null when no candidates are supplied", async () => {
    const result = await alignMatchesToEvaluatorCriteria({
      tenderTitle: "T",
      clientName: "C",
      comprehension: comprehensionFixture(),
      experts: [],
      projects: [],
    });
    assert.equal(result, null);
  });
});
