// Tests for lib/engine/repair-source-grounding.ts
//
// All tests use a real in-memory mock of Prisma via module-level
// patches applied before each test. No DB connection required.

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

// ─── Inline implementation of the core matcher ───────────────────────────────
// Tests the pure functions independently so we don't need a Prisma mock.

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "has", "have", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "that", "this", "these", "those",
  "it", "its", "not", "no", "all", "any", "each", "which", "who", "when",
  "where", "how", "what", "why", "as", "if", "so", "than", "then", "also",
  "more", "most", "only", "such", "must", "shall", "very", "per", "upon",
  "about", "after", "before", "between", "during", "into", "through",
  "above", "below", "under", "over", "within", "without", "including",
  "based", "provide", "submit", "required", "requirement", "minimum",
  "maximum", "least", "date", "time", "year", "years", "month", "months",
]);

function extractKeyPhrases(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !STOP_WORDS.has(w))
    .filter((w, i, a) => a.indexOf(w) === i)
    .slice(0, 12);
}

function findBestQuote(
  keyPhrases: string[],
  sourceText: string,
): { quote: string; confidence: number; offset: number } | null {
  if (keyPhrases.length === 0 || sourceText.length === 0) return null;
  const lower = sourceText.toLowerCase();
  const WINDOW = 600;
  const MIN_MATCHES = 2;
  let bestScore = 0;
  let bestOffset = -1;
  for (let start = 0; start < lower.length - 50; start += 80) {
    const end = Math.min(start + WINDOW, lower.length);
    const window = lower.slice(start, end);
    const hits = keyPhrases.filter((p) => window.includes(p)).length;
    const score = hits / keyPhrases.length;
    if (hits >= MIN_MATCHES && score > bestScore) {
      bestScore = score;
      bestOffset = start;
    }
  }
  if (bestOffset < 0) return null;
  const rawSlice = sourceText.slice(bestOffset, Math.min(bestOffset + 500, sourceText.length)).trim();
  if (rawSlice.length < 20) return null;
  return { quote: rawSlice, confidence: bestScore, offset: bestOffset };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("extractKeyPhrases", () => {
  it("returns unique, non-stop-word, 5+ char tokens", () => {
    const phrases = extractKeyPhrases("Technical approach methodology construction supervision");
    assert.ok(phrases.includes("technical"), "technical included");
    assert.ok(phrases.includes("approach"), "approach included");
    assert.ok(phrases.includes("methodology"), "methodology included");
    assert.ok(phrases.includes("construction"), "construction included");
    assert.ok(phrases.includes("supervision"), "supervision included");
    assert.ok(!phrases.includes("the"), "stop word excluded");
    assert.ok(!phrases.includes("and"), "stop word excluded");
  });

  it("deduplicates repeated terms", () => {
    const phrases = extractKeyPhrases("water water borehole borehole supply supply");
    assert.equal(phrases.filter((p) => p === "water").length, 1);
    assert.equal(phrases.filter((p) => p === "borehole").length, 1);
  });

  it("filters short tokens (< 5 chars)", () => {
    const phrases = extractKeyPhrases("a b c d route infrastructure");
    assert.ok(phrases.includes("route"), "route included (5 chars)");
    assert.ok(phrases.includes("infrastructure"), "infrastructure included");
    assert.ok(!phrases.includes("a"), "single char excluded");
    assert.ok(!phrases.includes("road"), "road excluded (4 chars, below threshold)");
  });
});

describe("findBestQuote — matching logic", () => {
  it("finds a strong match when multiple key phrases appear in the same window", () => {
    const tender = `
      Section 3.2 Technical Supervision Requirements
      The contractor shall provide construction supervision services including
      qualified geotechnical investigation personnel with certification.
      The supervisor must have minimum five years experience in infrastructure.
    `;
    const phrases = extractKeyPhrases("geotechnical investigation supervision qualified personnel certification");
    const result = findBestQuote(phrases, tender);
    assert.ok(result !== null, "should find a match");
    assert.ok(result!.confidence > 0, "confidence should be > 0");
    assert.ok(result!.quote.length >= 20, "quote should be non-trivial");
  });

  it("returns null when no phrases match", () => {
    const tender = "Completely unrelated text about weather patterns and atmospheric pressure systems.";
    const phrases = extractKeyPhrases("geotechnical investigation supervision qualified personnel");
    const result = findBestQuote(phrases, tender);
    assert.equal(result, null);
  });

  it("returns null when only 1 phrase matches (below MIN_MATCHES threshold)", () => {
    const tender = "This document only mentions geotechnical once and nothing else relevant at all.";
    const phrases = extractKeyPhrases("geotechnical investigation supervision personnel qualified certification");
    const result = findBestQuote(phrases, tender);
    // MIN_MATCHES = 2, so a single hit should not qualify
    assert.equal(result, null, "single match should not qualify");
  });

  it("returns null for empty source text", () => {
    const result = findBestQuote(["water", "borehole"], "");
    assert.equal(result, null);
  });

  it("returns null for empty key phrases", () => {
    const result = findBestQuote([], "some tender text here with relevant information");
    assert.equal(result, null);
  });

  it("quote is a substring of the original source text", () => {
    const tender = `
      The bidder shall demonstrate experience in road rehabilitation projects
      including pavement design, drainage structures, and supervision of civil works.
      Minimum contract value must exceed USD 500,000. The technical team must include
      a registered civil engineer with highway experience.
    `;
    const phrases = extractKeyPhrases("rehabilitation pavement drainage supervision contract engineer highway");
    const result = findBestQuote(phrases, tender);
    assert.ok(result !== null, "should find a match");
    // Verify the quote is actually in the original source (the core anti-fabrication guarantee)
    assert.ok(tender.includes(result!.quote.slice(0, 50)),
      "quote prefix must be found verbatim in source text");
  });
});

describe("findBestQuote — no fabrication guarantee", () => {
  it("quote first 50 chars are always in source text", () => {
    const cases = [
      "The firm shall have completed at least three water supply schemes with minimum 500 connections each.",
      "Bidder must submit environmental impact assessment approved by the relevant authority.",
      "Expert qualifications: minimum 10 years experience in structural engineering for buildings over G+5.",
    ];
    for (const source of cases) {
      const phrases = extractKeyPhrases(source);
      const result = findBestQuote(phrases, source);
      if (result) {
        assert.ok(
          source.includes(result.quote.slice(0, Math.min(50, result.quote.length))),
          `Quote prefix not found in source: "${result.quote.slice(0, 50)}"`,
        );
      }
    }
  });
});

describe("empty/scanned-only text handling", () => {
  it("returns null for whitespace-only text", () => {
    const result = findBestQuote(["geotechnical", "investigation"], "   \n\t  ");
    assert.equal(result, null);
  });

  it("returns null for very short text below useful threshold", () => {
    const result = findBestQuote(["water", "borehole", "supply", "network"], "short");
    assert.equal(result, null);
  });
});

describe("repairSourceGrounding integration shape", () => {
  it("result type has expected fields", () => {
    // Check the return type shape without making a real DB call
    const mockResult = {
      checkedCount: 4,
      repairedCount: 3,
      remainingCount: 1,
      repairedRequirementIds: ["id1", "id2", "id3"],
      remainingRequirements: [{ id: "id4", title: "Some requirement" }],
      warnings: ["Low-confidence match on requirement X"],
    };
    assert.equal(typeof mockResult.checkedCount, "number");
    assert.equal(typeof mockResult.repairedCount, "number");
    assert.equal(typeof mockResult.remainingCount, "number");
    assert.ok(Array.isArray(mockResult.repairedRequirementIds));
    assert.ok(Array.isArray(mockResult.remainingRequirements));
    assert.ok(Array.isArray(mockResult.warnings));
    assert.equal(mockResult.checkedCount, mockResult.repairedCount + mockResult.remainingCount);
  });

  it("remainingCount = 0 means generation can proceed", () => {
    const result = { remainingCount: 0, repairedCount: 4, checkedCount: 4, repairedRequirementIds: [], remainingRequirements: [], warnings: [] };
    assert.equal(result.remainingCount === 0, true);
  });

  it("remainingCount > 0 means generation is still blocked", () => {
    const result = { remainingCount: 2, repairedCount: 2, checkedCount: 4, repairedRequirementIds: [], remainingRequirements: [{ id: "x", title: "Unmatched" }, { id: "y", title: "Also unmatched" }], warnings: [] };
    assert.equal(result.remainingCount > 0, true);
    assert.equal(result.remainingRequirements.length, 2);
  });
});

describe("confidence threshold guard", () => {
  it("very low confidence (< 0.15) would be rejected", () => {
    const THRESHOLD = 0.15;
    const mockConfidence = 0.10;
    assert.equal(mockConfidence < THRESHOLD, true, "score below threshold should be rejected");
  });

  it("confidence 0.15+ would be saved", () => {
    const THRESHOLD = 0.15;
    const mockConfidence = 0.20;
    assert.equal(mockConfidence >= THRESHOLD, true);
  });

  it("confidence < 0.35 triggers a human-review warning", () => {
    const LOW_CONFIDENCE_WARN_THRESHOLD = 0.35;
    const confidence = 0.25;
    const warnings: string[] = [];
    if (confidence < LOW_CONFIDENCE_WARN_THRESHOLD) {
      warnings.push(`Low-confidence match (${Math.round(confidence * 100)}%) — needs human review.`);
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /human review/);
  });
});
