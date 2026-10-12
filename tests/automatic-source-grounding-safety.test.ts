import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractSourceGroundingKeyPhrases,
  findBestSourceGroundingQuote,
  MIN_AUTOMATIC_GROUNDING_CONFIDENCE,
} from "../lib/engine/repair-source-grounding";

describe("automatic source-grounding safety", () => {
  it("requires at least 50 percent confidence", () => {
    assert.equal(MIN_AUTOMATIC_GROUNDING_CONFIDENCE, 0.5);
  });

  it("rejects two generic terms when a requirement provides several specific terms", () => {
    const phrases = extractSourceGroundingKeyPhrases(
      "Legal eligibility registration licensing grade certificate consulting authority",
    );
    const weak = [
      "The general instructions discuss eligibility and registration.",
      "No licence, grade certificate, consulting authority, or legal evidence is stated here.",
    ].join(" ").replace("No licence, grade certificate, consulting authority, or legal evidence is stated here.", "The remaining clauses concern delivery timing only.");
    assert.equal(findBestSourceGroundingQuote(phrases, weak), null);
  });

  it("accepts a compact passage containing at least three coherent specific terms", () => {
    const phrases = extractSourceGroundingKeyPhrases(
      "Legal eligibility registration licensing grade certificate consulting authority",
    );
    const source = [
      "[Page 4]",
      "The consulting firm shall demonstrate legal eligibility through a current registration, valid licence, and Grade 1 certificate issued by the competent authority.",
    ].join("\n");
    const match = findBestSourceGroundingQuote(phrases, source);
    assert.ok(match);
    assert.ok(match.confidence >= 0.5);
    assert.ok(match.quote.length <= 500);
    assert.match(match.quote, /legal eligibility/i);
    assert.match(match.quote, /registration/i);
    assert.match(match.quote, /licence/i);
  });

  it("does not let terms outside the persisted 500-character quote justify the match", () => {
    const phrases = ["registration", "licensing", "certificate", "authority"];
    const source = `registration ${"x".repeat(520)} licensing certificate authority`;
    assert.equal(findBestSourceGroundingQuote(phrases, source), null);
  });
});
