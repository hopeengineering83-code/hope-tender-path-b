// Source-quote validator + per-field extraction meta + per-chunk retry-once.
// Together these deliver the safe, additive part of the B-task: every AI
// Analyze chunk gets one transient-error retry, and any field that claims a
// source quote can be deterministically verified against the tender source.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSourceQuote, validateFieldSourceQuotes } from "../lib/engine/quality/source-quote-validator";
import { makeFieldMeta, isFieldVerified, isFieldProvisional } from "../lib/engine/metadata/field-extraction-meta";
import { isTransientChunkError } from "../lib/ai";

describe("validateSourceQuote — deterministic substring matcher", () => {
  const source = "Section 5 Evaluation Methodology\n\nTechnical Proposal: 70%   Financial Proposal: 30%\nPass/Fail prequalification applies.";

  it("VERIFIED when quote is an exact substring", () => {
    const r = validateSourceQuote("Technical Proposal: 70%", source);
    assert.equal(r.status, "QUOTE_VERIFIED");
    assert.equal(r.normalizedQuote, "Technical Proposal: 70%");
    assert.ok(r.matchIndex !== null && r.matchIndex >= 0);
  });

  it("VERIFIED even with whitespace differences", () => {
    const r = validateSourceQuote("Technical  Proposal:   70%", source);
    assert.equal(r.status, "QUOTE_VERIFIED");
  });

  it("VERIFIED case-insensitive", () => {
    const r = validateSourceQuote("technical proposal: 70%", source);
    assert.equal(r.status, "QUOTE_VERIFIED");
  });

  it("NOT_FOUND when AI fabricates a quote not in the source", () => {
    const r = validateSourceQuote("Technical Proposal: 65%", source);
    assert.equal(r.status, "QUOTE_NOT_FOUND");
    assert.equal(r.matchIndex, null);
  });

  it("NO_QUOTE_PROVIDED for empty / null quote", () => {
    assert.equal(validateSourceQuote("", source).status, "NO_QUOTE_PROVIDED");
    assert.equal(validateSourceQuote(null, source).status, "NO_QUOTE_PROVIDED");
    assert.equal(validateSourceQuote(undefined, source).status, "NO_QUOTE_PROVIDED");
    assert.equal(validateSourceQuote("   ", source).status, "NO_QUOTE_PROVIDED");
  });

  it("NOT_FOUND when source text is empty", () => {
    assert.equal(validateSourceQuote("some quote", "").status, "QUOTE_NOT_FOUND");
    assert.equal(validateSourceQuote("some quote", null).status, "QUOTE_NOT_FOUND");
  });

  it("does NOT paraphrase / stem / fuzz — must be a literal substring", () => {
    // "Technical scoring 70%" is a paraphrase of "Technical Proposal: 70%".
    // The validator must reject it; semantic equivalence is the caller's job.
    const r = validateSourceQuote("Technical scoring 70%", source);
    assert.equal(r.status, "QUOTE_NOT_FOUND");
  });
});

describe("validateFieldSourceQuotes — parallel report", () => {
  it("produces one entry per requested field", () => {
    const source = "Deadline: 12 September 2026. Submission to procurement@example.org.";
    const r = validateFieldSourceQuotes(
      [
        { field: "deadline", value: "2026-09-12", sourceQuote: "12 September 2026" },
        { field: "submissionEmail", value: "procurement@example.org", sourceQuote: "procurement@example.org" },
        { field: "fabricated", value: "TBD", sourceQuote: "this string is not in source" },
        { field: "noQuote", value: "X", sourceQuote: null },
      ],
      source,
    );
    assert.equal(r.deadline.status, "QUOTE_VERIFIED");
    assert.equal(r.submissionEmail.status, "QUOTE_VERIFIED");
    assert.equal(r.fabricated.status, "QUOTE_NOT_FOUND");
    assert.equal(r.noQuote.status, "NO_QUOTE_PROVIDED");
  });
});

describe("FieldExtractionMeta — provenance + verification predicates", () => {
  it("AI + QUOTE_VERIFIED ⇒ verified", () => {
    const meta = makeFieldMeta({ source: "AI", confidence: "HIGH", sourceQuote: "x", quoteValidation: { status: "QUOTE_VERIFIED", normalizedQuote: "x", matchIndex: 0 } });
    assert.equal(isFieldVerified(meta), true);
    assert.equal(isFieldProvisional(meta), false);
  });

  it("AI + QUOTE_NOT_FOUND ⇒ NOT verified (AI may have fabricated)", () => {
    const meta = makeFieldMeta({ source: "AI", confidence: "HIGH", quoteValidation: { status: "QUOTE_NOT_FOUND", normalizedQuote: "y", matchIndex: null } });
    assert.equal(isFieldVerified(meta), false);
  });

  it("MANUAL_CONFIRMED ⇒ verified without needing a quote", () => {
    const meta = makeFieldMeta({ source: "MANUAL_CONFIRMED", confidence: "HIGH" });
    assert.equal(isFieldVerified(meta), true);
  });

  it("REPAIR_ENDPOINT requires a verified quote", () => {
    const noQuote = makeFieldMeta({ source: "REPAIR_ENDPOINT", confidence: "HIGH" });
    assert.equal(isFieldVerified(noQuote), false);
    const verified = makeFieldMeta({ source: "REPAIR_ENDPOINT", confidence: "HIGH", quoteValidation: { status: "QUOTE_VERIFIED", normalizedQuote: "z", matchIndex: 5 } });
    assert.equal(isFieldVerified(verified), true);
  });

  it("REGEX ⇒ provisional", () => {
    const meta = makeFieldMeta({ source: "REGEX", confidence: "LOW" });
    assert.equal(isFieldProvisional(meta), true);
    assert.equal(isFieldVerified(meta), false);
  });
});

describe("isTransientChunkError — chunk retry classifier", () => {
  it("classifies the common transient errors as transient", () => {
    for (const msg of [
      "429 too many requests",
      "rate limit exceeded",
      "tokens per minute quota exceeded",
      "request timed out after 60000ms",
      "aborted via AbortController",
      "malformed JSON returned by AI",
      "no JSON object in response",
      "JSON parse error",
      "empty response from provider",
    ]) {
      assert.equal(isTransientChunkError(new Error(msg)), true, `should be transient: ${msg}`);
    }
  });

  it("non-transient errors are NOT retried", () => {
    for (const msg of [
      "401 unauthorized",
      "403 forbidden",
      "model not found",
      "invalid_request",
      "permanent configuration error",
    ]) {
      assert.equal(isTransientChunkError(new Error(msg)), false, `should NOT be transient: ${msg}`);
    }
  });

  it("handles non-Error values without throwing", () => {
    assert.equal(isTransientChunkError(null), false);
    assert.equal(isTransientChunkError(undefined), false);
    assert.equal(isTransientChunkError("429"), true);
    assert.equal(isTransientChunkError({ message: "rate limit" }), false); // object without Error shape
  });
});

describe("lib/ai.ts wires the retry-once helper into the chunk loop", () => {
  const source = readFileSync("lib/ai.ts", "utf8");

  it("defines analyzeOneChunkWithRetry + the transient classifier", () => {
    assert.match(source, /async function analyzeOneChunkWithRetry/);
    assert.match(source, /export function isTransientChunkError/);
    assert.match(source, /CHUNK_RETRY_BACKOFF_MS/);
  });

  it("the chunk loop calls the retry wrapper (not the bare analyzeOneChunk)", () => {
    assert.match(source, /await analyzeOneChunkWithRetry/);
  });

  it("retries ONLY for transient errors (non-transient re-throws)", () => {
    assert.match(source, /if \(!isTransientChunkError\(err\)\) throw err/);
  });
});
