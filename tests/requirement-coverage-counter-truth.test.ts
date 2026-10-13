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

/**
 * Every state a row can be in, per the server's automationState union.
 *
 * ENFORCED_BY_PACKAGE and PACKAGE_RULE_VIOLATION were added when submission
 * RULES (financial separation, single-file consolidation, file format, file
 * naming) stopped being scored as evidence requirements. They are rows on
 * screen like any other, so they need a tile like any other — which is exactly
 * what this suite exists to enforce.
 */
const ROW_STATES = [
  "FULLY_VERIFIED",
  "PARTIALLY_VERIFIED",
  "AUTO_RESOLVING",
  "TRUE_EVIDENCE_GAP",
  "STALE_OR_INVALIDATED",
  "ENFORCED_BY_PACKAGE",
  "PACKAGE_RULE_VIOLATION",
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

  it("counts every one of the row states in some tile", () => {
    // Release-qualified + Partial + Automatic verification + Enforced by the
    // package + Gaps/unresolved, where the last is the union of the three
    // unresolved states.
    const tileSources = [
      "data.fullyCovered",
      "data.partiallyCovered",
      "data.sourceProcessing",
      "data.packageEnforcedRules",
      "unresolvedCount",
    ];
    for (const source of tileSources) {
      assert.ok(PANEL.includes(source), `tile source ${source} must be rendered`);
    }
    assert.match(
      PANEL,
      /const unresolvedCount = data\.trueEvidenceGaps \+ data\.staleOrInvalidated \+ \(data\.packageRuleViolations \?\? 0\);/,
      "the unresolved tile must include stale evidence and broken package rules",
    );
    // Five tiles cover seven states: the three unresolved states share one.
    assert.equal(ROW_STATES.length, 7);
    assert.equal(tileSources.length, 5);
  });

  it("uses one shared value for the tile, the chip count, and nothing else", () => {
    // Exactly three references: the definition, the tile, the chip.
    const references = PANEL.match(/unresolvedCount/g) ?? [];
    assert.equal(references.length, 4, "definition + tile value + tile colour + chip count");
    // Every automationState the server can return must be reachable from a
    // tile. A new state with no tile is the original defect returning.
    for (const state of ROW_STATES) {
      assert.ok(ROUTE.includes(`"${state}"`), `${state} must be produced by the route`);
      assert.ok(PANEL.includes(`"${state}"`), `${state} must be handled by the panel`);
    }
    // The old inline duplicate must not come back. Checked against the panel
    // with the single canonical definition line removed, so the definition
    // itself — which legitimately sums three fields — cannot satisfy the guard.
    const withoutDefinition = PANEL.replace(/^\s*const unresolvedCount = .*$/m, "");
    assert.doesNotMatch(
      withoutDefinition,
      /data\.trueEvidenceGaps \+ data\.staleOrInvalidated/,
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
    // The chip's number is unresolvedCount (gaps + stale + broken package
    // rules); the predicate must select exactly those three states.
    assert.match(
      PANEL,
      /filter === "UNRESOLVED"\) \{\s*return row\.automationState === "TRUE_EVIDENCE_GAP"\s*\|\| row\.automationState === "STALE_OR_INVALIDATED"\s*\|\| row\.automationState === "PACKAGE_RULE_VIOLATION";/,
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
