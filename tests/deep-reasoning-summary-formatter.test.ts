// Unit tests for the per-tender summary formatter (round 10).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  formatDeepReasoningRunAsMarkdown,
  type DeepReasoningSummaryMetadata,
} from "../lib/engine/deep-reasoning-summary-formatter";

const SAMPLE_CREATED_AT = new Date("2026-05-18T09:30:00Z");
const SAMPLE_DESCRIPTION = `Deep-reasoning generation for tender "Water Supply Detailed Design": 7 AI call(s) over 38.4s.`;

function sampleMetadata(): DeepReasoningSummaryMetadata {
  return {
    tenderId: "tender-abc",
    comprehension: {
      criteriaCount: 4,
      disqualifierCount: 2,
      prohibitionCount: 1,
      totalWeightAccountedFor: 100,
    },
    alignment: {
      alignmentCount: 16,
      criterionCoverageCount: 4,
    },
    refinement: {
      applied: true,
      iterations: 2,
      scoreLift: 14,
    },
    telemetry: {
      totalCalls: 7,
      successfulCalls: 7,
      failedCalls: 0,
      totalMs: 38_400,
      elapsedMs: 39_200,
      byStep: {
        comprehension: { count: 1, totalMs: 4_100, succeeded: 1, failed: 0 },
        alignment: { count: 1, totalMs: 5_800, succeeded: 1, failed: 0 },
        critique: { count: 2, totalMs: 14_200, succeeded: 2, failed: 0 },
        rewrite: { count: 2, totalMs: 14_300, succeeded: 2, failed: 0 },
      },
    },
    qualityScore: 86,
    weakAxes: ["throughlineConsistency"],
  };
}

describe("formatDeepReasoningRunAsMarkdown — happy path", () => {
  it("renders all sections when full metadata is supplied", () => {
    const md = formatDeepReasoningRunAsMarkdown({
      createdAt: SAMPLE_CREATED_AT,
      description: SAMPLE_DESCRIPTION,
      metadata: sampleMetadata(),
    });
    assert.match(md, /# Deep-reasoning generation summary/);
    assert.match(md, /## Tender comprehension/);
    assert.match(md, /4 evaluation criteria \(100% weight accounted for\)/);
    assert.match(md, /2 disqualifying condition\(s\)/);
    assert.match(md, /1 structural prohibition\(s\)/);

    assert.match(md, /## Match-to-criteria alignment/);
    assert.match(md, /16 record-criterion pairs scored/);

    assert.match(md, /## Critic-rewriter refinement/);
    assert.match(md, /Applied: 2 critique→rewrite iteration\(s\)/);
    assert.match(md, /Score lift: \+14/);

    assert.match(md, /## Quality score/);
    assert.match(md, /Final score: \*\*86\/100\*\*/);
    assert.match(md, /Weak axes: throughlineConsistency/);

    assert.match(md, /## AI call telemetry/);
    assert.match(md, /7 call\(s\)/);
    assert.match(md, /38\.4s\*\*\s+of AI time/);
    // Per-step table is rendered.
    assert.match(md, /\| Step \| Calls \| Time \| Failed \|/);
    assert.match(md, /\| comprehension \| 1 \| 4\.1s \| —/);
  });
});

describe("formatDeepReasoningRunAsMarkdown — partial metadata", () => {
  it("handles null metadata by returning an empty string", () => {
    const md = formatDeepReasoningRunAsMarkdown({
      createdAt: SAMPLE_CREATED_AT,
      description: "x",
      metadata: null,
    });
    assert.equal(md, "");
  });

  it("renders only the sections whose data was supplied", () => {
    const md = formatDeepReasoningRunAsMarkdown({
      createdAt: SAMPLE_CREATED_AT,
      description: "minimal run",
      metadata: {
        comprehension: { criteriaCount: 3, disqualifierCount: 0, prohibitionCount: 0, totalWeightAccountedFor: null },
        // No alignment, no refinement applied, no telemetry, no quality score
      },
    });
    assert.match(md, /## Tender comprehension/);
    assert.match(md, /no numeric weights stated/);
    assert.equal(md.includes("## Match-to-criteria alignment"), false);
    assert.equal(md.includes("## Quality score"), false);
    assert.equal(md.includes("## AI call telemetry"), false);
  });

  it("notes when refinement was not applied", () => {
    const md = formatDeepReasoningRunAsMarkdown({
      createdAt: SAMPLE_CREATED_AT,
      description: "x",
      metadata: {
        refinement: { applied: false, iterations: 0, scoreLift: 0 },
      },
    });
    assert.match(md, /Not applied/);
  });

  it("flags failed calls with a warning when present", () => {
    const md = formatDeepReasoningRunAsMarkdown({
      createdAt: SAMPLE_CREATED_AT,
      description: "x",
      metadata: {
        telemetry: {
          totalCalls: 3,
          successfulCalls: 2,
          failedCalls: 1,
          totalMs: 5000,
          elapsedMs: 5500,
          byStep: { comprehension: { count: 1, totalMs: 4000, succeeded: 1, failed: 0 }, critique: { count: 2, totalMs: 1000, succeeded: 1, failed: 1 } },
        },
      },
    });
    assert.match(md, /1 failed call\(s\)/);
    assert.match(md, /\| critique \| 2 \| 1\.0s \| 1 \|/);
  });

  it("notes all-axes-passing when weakAxes is empty", () => {
    const md = formatDeepReasoningRunAsMarkdown({
      createdAt: SAMPLE_CREATED_AT,
      description: "x",
      metadata: { qualityScore: 92, weakAxes: [] },
    });
    assert.match(md, /All axes passing/);
  });
});

describe("formatDeepReasoningRunAsMarkdown — date handling", () => {
  it("accepts ISO string dates", () => {
    const md = formatDeepReasoningRunAsMarkdown({
      createdAt: "2026-05-18T09:30:00.000Z",
      description: "x",
      metadata: { qualityScore: 85 },
    });
    assert.match(md, /Generated 2026-05-18T09:30/);
  });
});
