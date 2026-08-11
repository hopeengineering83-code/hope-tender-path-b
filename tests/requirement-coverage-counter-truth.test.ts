// Requirements and Evidence — the numbers on screen must reconcile.
//
// Found on the preview at commit 30206ee2: the stat block read
// "Genuine gaps 5" while the filter chip directly beneath read
// "Genuine gaps / unresolved (6)", and six rows rendered. Five carried the red
// "Genuine gap" badge; the sixth carried a grey "Stale or invalidated" badge.
//
// Root cause: the panel had four stat tiles for five row states. The tile
// counted only TRUE_EVIDENCE_GAP, the chip counted TRUE_EVIDENCE_GAP +
// STALE_OR_INVALIDATED, and STALE_OR_INVALIDATED had no tile at all. So the
// tiles summed to fewer than the rows on screen, and the same words
// ("Genuine gaps") carried two different numbers a few pixels apart.
//
// automationState is a single exhaustive enum — every row has exactly one —
// so the tiles CAN account for every row, and now do. The bucket is no longer
// named after one of its two members.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { humanizeEnumValue } from "../lib/ui/human-labels";

const PANEL = readFileSync("components/requirement-coverage-panel.tsx", "utf8");
const ROUTE = readFileSync("app/api/tenders/[id]/requirement-coverage/route.ts", "utf8");

/** The five states a row can be in, per the server's automationState union. */
const ROW_STATES = [
  "FULLY_VERIFIED",
  "PARTIALLY_VERIFIED",
  "AUTO_RESOLVING",
  "TRUE_EVIDENCE_GAP",
  "STALE_OR_INVALIDATED",
] as const;

describe("Requirement coverage tiles account for every row", () => {
  it("derives each server counter from automationState or its exact equivalent", () => {
    // FULLY_VERIFIED <=> FULLY_MET and PARTIALLY_VERIFIED <=> PARTIALLY_MET are
    // the first two branches of automaticStateFor, so counting either field
    // gives the same number. This assertion pins that equivalence: if the
    // mapping ever gains a condition, these counters stop being interchangeable
    // and the tiles would silently start disagreeing with the rows again.
    assert.match(ROUTE, /if \(input\.coverageStatus === "FULLY_MET"\) return "FULLY_VERIFIED";/);
    assert.match(ROUTE, /if \(input\.coverageStatus === "PARTIALLY_MET"\) return "PARTIALLY_VERIFIED";/);
  });

  it("counts every one of the five row states in some tile", () => {
    // Full + Partial + Automatic verification + Gaps/unresolved, where the last
    // is the union of the two unresolved states.
    const tileSources = [
      "data.fullyCovered",
      "data.partiallyCovered",
      "data.sourceProcessing",
      "unresolvedCount",
    ];
    for (const source of tileSources) {
      assert.ok(PANEL.includes(source), `tile source ${source} must be rendered`);
    }
    assert.match(
      PANEL,
      /const unresolvedCount = data\.trueEvidenceGaps \+ data\.staleOrInvalidated;/,
      "the unresolved tile must include stale evidence, which previously had no tile",
    );
    assert.equal(ROW_STATES.length, 5);
  });

  it("uses one shared value for the tile, the chip count, and nothing else", () => {
    // Exactly three references: the definition, the tile, the chip.
    const references = PANEL.match(/unresolvedCount/g) ?? [];
    assert.equal(references.length, 4, "definition + tile value + tile colour + chip count");
    // The old inline duplicate must not come back.
    assert.doesNotMatch(
      PANEL,
      /data\.trueEvidenceGaps \+ data\.staleOrInvalidated[\s\S]{0,40}\?/,
      "the unresolved sum must not be recomputed inline anywhere",
    );
  });

  it("does not name the combined bucket after only one of its members", () => {
    // "Genuine gap" remains a ROW badge; it must not also be a bucket label,
    // because the bucket also holds "Stale or invalidated" rows.
    assert.match(PANEL, /label: "Genuine gaps \/ stale"/);
    assert.match(PANEL, /"Genuine gaps \/ stale" : value\[0\]/);
    assert.doesNotMatch(PANEL, /"Genuine gaps \/ unresolved"/);
    // The per-row badge keeps its precise name.
    assert.match(PANEL, /TRUE_EVIDENCE_GAP: \{ label: "Genuine gap"/);
    assert.match(PANEL, /STALE_OR_INVALIDATED: \{ label: "Stale or invalidated"/);
  });

  it("keeps the unresolved chip count and its filter predicate on the same states", () => {
    assert.match(
      PANEL,
      /filter === "UNRESOLVED"\) return row\.automationState === "TRUE_EVIDENCE_GAP" \|\| row\.automationState === "STALE_OR_INVALIDATED"/,
    );
  });
});

describe("Requirement type labels never render as raw enum values", () => {
  it("maps every requirement type the analyzer is contracted to emit", () => {
    // The analyzer's own declared enumeration, from the prompt contract.
    const emitted = [
      "TECHNICAL", "FINANCIAL", "ELIGIBILITY", "EXPERT", "PROJECT_EXPERIENCE",
      "FORMAT", "SUBMISSION_RULE", "DECLARATION", "ANNEX", "SCHEDULE",
      "FORM", "METHODOLOGY", "COMPANY_PROFILE",
    ];
    for (const type of emitted) {
      assert.match(
        PANEL,
        new RegExp(`^\\s*${type}: "`, "m"),
        `${type} is emitted by the analyzer and must have a label`,
      );
    }
  });

  it("humanizes an unmapped value instead of shouting the raw enum", () => {
    assert.equal(humanizeEnumValue("FORMAT"), "Format");
    assert.equal(humanizeEnumValue("SUPPORTING_DOCUMENT"), "Supporting document");
    assert.equal(humanizeEnumValue("RELEVANT_EXPERIENCE"), "Relevant experience");
    assert.equal(humanizeEnumValue("UNKNOWN"), "Unknown");
    // Degenerate input is returned unchanged rather than becoming empty.
    assert.equal(humanizeEnumValue(""), "");
    assert.equal(humanizeEnumValue("   "), "   ");
  });

  it("falls back through the humanizer, not the raw value", () => {
    assert.match(
      PANEL,
      /REQ_TYPE_LABELS\[row\.requirementType\] \?\? humanizeEnumValue\(row\.requirementType\)/,
    );
  });
});
