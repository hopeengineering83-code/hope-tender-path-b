import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { scorePageTextQuality, isExtractionCorrupted } from "../lib/engine/extraction-quality-gate";

describe("scorePageTextQuality", () => {
  it("flags GGG/symbol garbage text as corrupted", () => {
    const corruptedText = "G G G G G ■ ■ ■ → → G G G G ● ● ●";
    const result = scorePageTextQuality(corruptedText);
    assert.equal(result.isCorrupted, true);
    assert.ok(result.score < 40, `score should be < 40, got ${result.score}`);
  });

  it("flags text with high broken spacing as corrupted", () => {
    const brokenText = "T h e q u i c k b r o w n f o x j u m p s o v e r t h e l a z y d o g";
    const result = scorePageTextQuality(brokenText);
    assert.equal(result.isCorrupted, true);
  });

  it("passes clean English text", () => {
    const cleanText =
      "This is a clean tender document with proper submission instructions and evaluation criteria.";
    const result = scorePageTextQuality(cleanText);
    assert.equal(result.isCorrupted, false);
    assert.ok(result.score > 60, `score should be > 60, got ${result.score}`);
  });

  it("blank page is detected", () => {
    const result = scorePageTextQuality("   ");
    assert.equal(result.isBlank, true);
    assert.equal(result.score, 0);
  });

  it("high symbol noise is detected", () => {
    const noisyText = "■ ▲ ● ◆ ▼ ← → ↑ ↓ ↔ ♠ ♣ ♥ ♦ ★ ☆ ✓ ✗ ✘ ⊕ ⊗";
    const result = scorePageTextQuality(noisyText);
    assert.ok(
      result.symbolNoiseRatio > 0.15,
      `symbolNoiseRatio should be > 0.15, got ${result.symbolNoiseRatio}`,
    );
    assert.equal(result.isCorrupted, true);
  });

  it("isExtractionCorrupted returns true for corrupted text", () => {
    assert.equal(isExtractionCorrupted("G G G ■ ■ ■ → → G G G"), true);
  });

  it("isExtractionCorrupted returns false for clean text", () => {
    assert.equal(
      isExtractionCorrupted(
        "The Ministry of Finance hereby invites qualified firms to submit proposals.",
      ),
      false,
    );
  });

  it("returns isBlank true for empty string", () => {
    const result = scorePageTextQuality("");
    assert.equal(result.isBlank, true);
    assert.equal(result.score, 0);
  });

  it("returns isBlank true for fewer than 5 words", () => {
    const result = scorePageTextQuality("hello world");
    assert.equal(result.isBlank, true);
  });

  it("real tender-like text scores above 60", () => {
    const tenderText =
      "The Ministry of Public Works hereby invites tenders from qualified contractors " +
      "for the construction of a government office building. Submission deadline is " +
      "15 July 2026. All submissions must include technical proposal, financial proposal, " +
      "and company registration documents. Evaluation will be based on technical merit " +
      "and financial offer. Contact procurement@mpw.gov for queries.";
    const result = scorePageTextQuality(tenderText);
    assert.equal(result.isCorrupted, false);
    assert.ok(result.score > 60, `score should be > 60, got ${result.score}`);
  });

  it("text with moderate symbols (normal tender doc) is not corrupted", () => {
    const normalWithSomeSymbols =
      "Section 3.1 — Technical Requirements: The contractor shall provide " +
      "all necessary equipment (including tools and materials). Price: USD 50,000. " +
      "Deadline: 31/12/2026. Contact: info@example.com. Reference no.: TND-2026-001.";
    const result = scorePageTextQuality(normalWithSomeSymbols);
    assert.equal(result.isCorrupted, false);
  });

  it("repeated glyph sequences are detected as corrupted", () => {
    const repeatedGarbage = Array(50)
      .fill("G G G G G ■ ■ ■ → → ● ● ●")
      .join(" ");
    const result = scorePageTextQuality(repeatedGarbage);
    assert.equal(result.isCorrupted, true);
    assert.ok(result.score < 40, `score should be < 40, got ${result.score}`);
  });
});
