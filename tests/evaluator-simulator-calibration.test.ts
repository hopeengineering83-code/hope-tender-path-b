// Unit tests for evaluator-simulator gap #9 upgrades:
// - extractPersonaFocusedSlice: domain-focused proposal slicing
// - computeCalibrationNotes: cross-persona disagreement detection

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  extractPersonaFocusedSlice,
  computeCalibrationNotes,
  type PersonaAssessment,
} from "../lib/engine/evaluation/evaluator-simulator";

const SAMPLE_PROPOSAL = `# Cover Letter

To the evaluation committee, we are pleased to submit this proposal.

# Executive Summary

Our firm has delivered comparable assignments across the region.

# Section A: Company Profile

## A.2 Corporate Information

ABC Engineering, founded in 2010. License grade I. Registration 12345.

## A.4 Proposed Project Team

The team is led by Dr. Alemu, Senior Hydraulic Engineer.

# Section B: Relevant Experience

The 2022 Sebeta WASH project (ETB 18M, World Bank).

# Section C: Technical Approach

## C.1 Understanding of the Assignment

We understand the scope as detailed water supply network design.

## C.2 Technical Methodology

EPANET-based hydraulic modelling. Field surveys with GPS. Hydrogeological assessment.

## C.5 Risk Register

Procurement delays mitigated by parallel sourcing.

## C.6 Work Plan and Schedule

12-month workplan with mobilisation in week 1.

# Section D: Additional Information

## D.4 Declaration of Eligibility

We confirm full eligibility. License current to 2027.

# Section E: Compliance Matrix

| Requirement | Where | Evidence | Status |
|---|---|---|---|
| Senior Hydraulic Eng | A.4 | Dr. Alemu CV | FULLY MET |
| 5+ yrs experience | A.2 | Since 2010 | FULLY MET |
`;

describe("extractPersonaFocusedSlice — domain-focused proposal slicing", () => {
  it("TECHNICAL slice prioritises Section C and the Project Team", () => {
    const slice = extractPersonaFocusedSlice(SAMPLE_PROPOSAL, "TECHNICAL");
    assert.match(slice, /Cover Letter|Executive Summary/, "every persona gets the opening for context");
    assert.match(slice, /C\.2 Technical Methodology/);
    assert.match(slice, /EPANET-based hydraulic modelling/);
    assert.match(slice, /A\.4 Proposed Project Team/);
  });

  it("COMPLIANCE slice prioritises the Compliance Matrix and Declarations", () => {
    const slice = extractPersonaFocusedSlice(SAMPLE_PROPOSAL, "COMPLIANCE");
    assert.match(slice, /Section E: Compliance Matrix/);
    assert.match(slice, /FULLY MET/);
    assert.match(slice, /D\.4 Declaration of Eligibility/);
  });

  it("END_USER slice prioritises Work Plan and Relevant Experience", () => {
    const slice = extractPersonaFocusedSlice(SAMPLE_PROPOSAL, "END_USER");
    assert.match(slice, /C\.6 Work Plan and Schedule/);
    assert.match(slice, /12-month workplan/);
    assert.match(slice, /Section B: Relevant Experience/);
    assert.match(slice, /Sebeta WASH project/);
  });

  it("COMMERCIAL slice prioritises Section D and Corporate Information", () => {
    const slice = extractPersonaFocusedSlice(SAMPLE_PROPOSAL, "COMMERCIAL");
    assert.match(slice, /Section D: Additional Information/);
    assert.match(slice, /A\.2 Corporate Information/);
  });

  it("falls back to the full proposal when no domain sections are present", () => {
    const flat = "# Cover Letter\n\nMinimal proposal body with no canonical sections.";
    const slice = extractPersonaFocusedSlice(flat, "TECHNICAL");
    // The fall-back returns the whole proposal truncated to 30K — for a
    // tiny proposal that's equivalent to the input itself.
    assert.ok(slice.length > 0);
    assert.match(slice, /Minimal proposal body/);
  });

  it("each persona returns a non-empty excerpt within the 30K-char budget", () => {
    for (const persona of ["TECHNICAL", "COMPLIANCE", "END_USER", "COMMERCIAL"] as const) {
      const slice = extractPersonaFocusedSlice(SAMPLE_PROPOSAL, persona);
      assert.ok(slice.length > 100, `expected non-trivial slice for ${persona}, got ${slice.length} chars`);
      assert.ok(slice.length <= 30_000, `expected <=30K chars for ${persona}, got ${slice.length}`);
    }
  });
});

describe("computeCalibrationNotes — cross-persona disagreement detection", () => {
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

  it("returns empty when no shared criteria", () => {
    const notes = computeCalibrationNotes([
      assess("TECHNICAL", [["Technical Approach", 8]]),
      assess("COMPLIANCE", [["Compliance Coverage", 7]]),
    ]);
    assert.deepEqual(notes, []);
  });

  it("flags a 3-point spread on a shared criterion as moderate", () => {
    const notes = computeCalibrationNotes([
      assess("TECHNICAL", [["Technical Approach", 9]]),
      assess("END_USER", [["Technical Approach", 6]]),
    ]);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].spread, 3);
    assert.equal(notes[0].level, "moderate");
    assert.equal(notes[0].scoresByPersona.length, 2);
  });

  it("flags a 5-point spread as alarm", () => {
    const notes = computeCalibrationNotes([
      assess("TECHNICAL", [["Technical Approach", 9]]),
      assess("END_USER", [["Technical Approach", 4]]),
    ]);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].spread, 5);
    assert.equal(notes[0].level, "alarm");
  });

  it("ignores criterion scores with <3 point spread", () => {
    const notes = computeCalibrationNotes([
      assess("TECHNICAL", [["X", 8]]),
      assess("END_USER", [["X", 7]]),
    ]);
    assert.deepEqual(notes, []);
  });

  it("matches criterion names case-insensitively + whitespace-tolerant", () => {
    const notes = computeCalibrationNotes([
      assess("TECHNICAL", [["Technical Approach", 9]]),
      assess("END_USER", [["  technical approach  ", 4]]),
    ]);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].spread, 5);
  });

  it("sorts notes by descending spread", () => {
    const notes = computeCalibrationNotes([
      assess("TECHNICAL", [["A", 8], ["B", 9]]),
      assess("COMPLIANCE", [["A", 5], ["B", 1]]),
    ]);
    assert.equal(notes.length, 2);
    assert.equal(notes[0].criterion, "b"); // spread 8
    assert.equal(notes[1].criterion, "a"); // spread 3
  });

  it("returns at most 10 notes", () => {
    const techScores: Array<[string, number]> = [];
    const userScores: Array<[string, number]> = [];
    for (let i = 0; i < 15; i++) {
      techScores.push([`Criterion ${i}`, 9]);
      userScores.push([`Criterion ${i}`, 3]);
    }
    const notes = computeCalibrationNotes([
      assess("TECHNICAL", techScores),
      assess("END_USER", userScores),
    ]);
    assert.equal(notes.length, 10);
  });
});
