import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXTRACTION_SCORE_GOOD_THRESHOLD,
  EXTRACTION_SCORE_WARN_THRESHOLD,
  EXTRACTION_SCORE_BLOCK_THRESHOLD,
  SOURCE_CONFIDENCE_HIGH,
  SOURCE_CONFIDENCE_ACCEPTABLE,
} from "../lib/engine/extraction-quality-gate";
import { scoreToSeverity, confidenceToSeverity } from "../lib/ui-tokens";

describe("confidence-thresholds: exported constants exist and are sensible", () => {
  it("EXTRACTION_SCORE_GOOD_THRESHOLD is a number >= 70", () => {
    assert.equal(typeof EXTRACTION_SCORE_GOOD_THRESHOLD, "number");
    assert.ok(EXTRACTION_SCORE_GOOD_THRESHOLD >= 70, "good threshold should be at least 70");
  });
  it("EXTRACTION_SCORE_WARN_THRESHOLD is a number between 40 and GOOD", () => {
    assert.equal(typeof EXTRACTION_SCORE_WARN_THRESHOLD, "number");
    assert.ok(EXTRACTION_SCORE_WARN_THRESHOLD < EXTRACTION_SCORE_GOOD_THRESHOLD, "warn < good");
    assert.ok(EXTRACTION_SCORE_WARN_THRESHOLD >= 40, "warn threshold should be at least 40");
  });
  it("EXTRACTION_SCORE_BLOCK_THRESHOLD is a number < WARN", () => {
    assert.equal(typeof EXTRACTION_SCORE_BLOCK_THRESHOLD, "number");
    assert.ok(EXTRACTION_SCORE_BLOCK_THRESHOLD < EXTRACTION_SCORE_WARN_THRESHOLD, "block < warn");
    assert.ok(EXTRACTION_SCORE_BLOCK_THRESHOLD >= 0, "block threshold should be non-negative");
  });
  it("SOURCE_CONFIDENCE_HIGH is between 0 and 1", () => {
    assert.ok(SOURCE_CONFIDENCE_HIGH > 0 && SOURCE_CONFIDENCE_HIGH <= 1);
  });
  it("SOURCE_CONFIDENCE_ACCEPTABLE is between 0 and SOURCE_CONFIDENCE_HIGH", () => {
    assert.ok(SOURCE_CONFIDENCE_ACCEPTABLE > 0 && SOURCE_CONFIDENCE_ACCEPTABLE < SOURCE_CONFIDENCE_HIGH);
  });
});

describe("confidence-thresholds: scoreToSeverity aligns with extraction thresholds", () => {
  it("score at GOOD threshold maps to good", () => {
    assert.equal(scoreToSeverity(EXTRACTION_SCORE_GOOD_THRESHOLD, { good: EXTRACTION_SCORE_GOOD_THRESHOLD, warn: EXTRACTION_SCORE_WARN_THRESHOLD }), "good");
  });
  it("score between WARN and GOOD maps to warning", () => {
    const mid = Math.floor((EXTRACTION_SCORE_WARN_THRESHOLD + EXTRACTION_SCORE_GOOD_THRESHOLD) / 2);
    assert.equal(scoreToSeverity(mid, { good: EXTRACTION_SCORE_GOOD_THRESHOLD, warn: EXTRACTION_SCORE_WARN_THRESHOLD }), "warning");
  });
  it("score below BLOCK threshold maps to poor", () => {
    assert.equal(scoreToSeverity(EXTRACTION_SCORE_BLOCK_THRESHOLD - 1, { good: EXTRACTION_SCORE_GOOD_THRESHOLD, warn: EXTRACTION_SCORE_WARN_THRESHOLD }), "poor");
  });
});

describe("confidence-thresholds: confidenceToSeverity aligns with source confidence constants", () => {
  it("confidence at HIGH threshold maps to good", () => {
    assert.equal(confidenceToSeverity(SOURCE_CONFIDENCE_HIGH), "good");
  });
  it("confidence between ACCEPTABLE and HIGH maps to warning", () => {
    const mid = (SOURCE_CONFIDENCE_ACCEPTABLE + SOURCE_CONFIDENCE_HIGH) / 2;
    assert.equal(confidenceToSeverity(mid), "warning");
  });
  it("confidence below ACCEPTABLE maps to poor", () => {
    assert.equal(confidenceToSeverity(SOURCE_CONFIDENCE_ACCEPTABLE - 0.01), "poor");
  });
});
