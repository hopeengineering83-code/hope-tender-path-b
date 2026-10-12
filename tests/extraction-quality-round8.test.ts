/**
 * Regression tests for the extraction quality fixes (round 8).
 *
 * Tests the following fixes:
 * 1. OCR timeout (AbortController, 40s budget) — prevents Vercel 504s
 * 2. OCR error class distinction (auth/rate-limit/timeout markers)
 * 3. OCR max_tokens raised 8K → 16K + truncation detection
 * 4. PDF extractors raced with Promise.allSettled + 10s timeout each
 * 5. Best extractor picked by quality score, not text length
 * 6. Corruption detector min-length lowered 250 → 50 (closes 20-250 dead zone)
 * 7. Per-file deadline on upload-first (45s budget)
 * 8. ocrPageMarkers regex fixed to match actual OCR marker
 * 9. Phantom PDF_OCR_MAX_RACES env var removed
 * 10. maxDuration added to /api/company/documents/[id] POST
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("extraction quality — OCR timeout + error classes (round 8)", () => {
  const src = read("lib/extract-text.ts");

  it("adds AbortController with configurable timeout to OCR call", () => {
    assert.ok(src.includes("new AbortController()"), "must create AbortController for OCR timeout");
    assert.ok(src.includes("controller.abort()"), "must abort on timeout");
    assert.ok(src.includes("PDF_OCR_TIMEOUT_MS"), "must read PDF_OCR_TIMEOUT_MS env var");
    assert.ok(src.includes("clearTimeout(timer)"), "must clear the timeout timer in finally");
  });

  it("passes the abort signal to the Anthropic SDK call", () => {
    assert.ok(
      src.includes("{ signal: controller.signal }"),
      "must pass the abort signal to client.messages.create",
    );
  });

  it("distinguishes OCR timeout errors with a specific marker", () => {
    assert.ok(
      src.includes('"AbortError"') || src.includes("/abort/i.test(msg)"),
      "must detect AbortError",
    );
    assert.ok(
      src.includes("[OCR_TIMEOUT"),
      "must return [OCR_TIMEOUT...] marker on timeout",
    );
  });

  it("distinguishes OCR auth failures with a specific marker", () => {
    assert.ok(
      src.includes("/401|403|invalid api key|authentication/i"),
      "must detect auth failures",
    );
    assert.ok(
      src.includes("[OCR_AUTH_FAILED"),
      "must return [OCR_AUTH_FAILED...] marker on auth failure",
    );
  });

  it("distinguishes OCR rate-limit errors with a specific marker", () => {
    // After PR #998, the rate-limit detection was split into two branches:
    //   - /529|overloaded/i  → retried once with 2s backoff (transient)
    //   - /429|rate.?limit/i → terminal [OCR_RATE_LIMITED] marker
    // Both 429 and 529 are still detected and both produce the
    // [OCR_RATE_LIMITED] marker (529 only if the retry also fails).
    assert.ok(
      src.includes("/429|rate.?limit/i") || src.includes("/429|rate.?limit|overloaded/i"),
      "must detect 429/rate-limit errors",
    );
    assert.ok(
      src.includes("/529|overloaded/i"),
      "must detect 529/overloaded errors (retryable)",
    );
    assert.ok(
      src.includes("[OCR_RATE_LIMITED"),
      "must return [OCR_RATE_LIMITED...] marker on rate-limit",
    );
  });

  it("raises max_tokens from 8K to 16K for larger PDFs", () => {
    assert.ok(
      src.includes("max_tokens: 16_000"),
      "must use 16K max_tokens (raised from 8K)",
    );
    assert.ok(
      !src.includes("max_tokens: 8000"),
      "old 8K max_tokens must be removed",
    );
  });

  it("detects OCR truncation via stop_reason === max_tokens", () => {
    // After PR #998 (chunked OCR + continuation loop), the stop_reason check
    // moved into the claudeVisionOcrCall helper which returns { text, stopReason },
    // and the caller loops while stopReason === "max_tokens" to continue
    // extraction. The behavior (detect truncation, log warning) is preserved;
    // the literal string changed from `===` to `!==` because the loop
    // condition is inverted (continue WHILE max_tokens, break when NOT).
    assert.ok(
      src.includes('stopReason !== "max_tokens"') || src.includes('stop_reason === "max_tokens"'),
      "must detect truncation via stop_reason (loop break condition or direct check)",
    );
    assert.ok(
      src.includes("OCR truncated at max_tokens"),
      "must log a warning when OCR is truncated",
    );
  });

  it("treats OCR error markers as OCR failure (not extracted text)", () => {
    assert.ok(
      src.includes('isOcrErrorMarker = ocrText.startsWith("[OCR_")'),
      "must detect OCR error markers",
    );
    assert.ok(
      src.includes("!isOcrErrorMarker"),
      "must NOT store OCR error markers as extracted text",
    );
  });
});

describe("extraction quality — raced extractors + quality-based selection (round 8)", () => {
  const src = read("lib/extract-text.ts");

  it("races the 3 PDF extractors with Promise.allSettled", () => {
    assert.ok(
      src.includes("Promise.allSettled("),
      "must race extractors with Promise.allSettled (was sequential)",
    );
  });

  it("adds a per-extractor timeout (10s)", () => {
    assert.ok(
      src.includes("extractorTimeout") && src.includes("10_000"),
      "must have a 10s per-extractor timeout",
    );
  });

  it("picks best extractor by scorePageTextQuality, not text length", () => {
    assert.ok(
      src.includes("scorePageTextQuality"),
      "must use scorePageTextQuality to pick best extractor",
    );
    assert.ok(
      src.includes("quality.isCorrupted"),
      "must check isCorrupted when picking best extractor",
    );
  });
});

describe("extraction quality — corruption detector threshold (round 8)", () => {
  const src = read("lib/extraction-quality.ts");

  it("lowers corruption detector min-length from 250 to 50", () => {
    assert.ok(
      src.includes("if (length < 50)"),
      "must use 50 as the min-length (was 250 — closes the 20-250 char dead zone)",
    );
    assert.ok(
      !src.includes("if (length < 250)"),
      "old 250 min-length must be removed",
    );
  });
});

describe("extraction quality — request/worker ownership + OCR markers (round 8)", () => {
  const upload = read("lib/tender-upload-first.ts");
  const worker = read("lib/ai-jobs/tender-extraction-service.ts");

  it("removes request-time extraction deadlines by moving extraction to a durable job", () => {
    assert.doesNotMatch(upload, /extractTextFromBuffer|uploadDeadline|45_000/);
    assert.match(upload, /enqueueTenderFileExtractionJob/);
    assert.match(worker, /runTenderFileExtractionJob/);
  });

  it("fixes ocrPageMarkers regex to match the actual OCR marker", () => {
    assert.ok(
      worker.includes("[PDF text extracted via Claude vision OCR"),
      "worker must match '[PDF text extracted via Claude vision OCR...]'",
    );
    assert.ok(
      !worker.includes("\\[OCR text"),
      "old '[OCR text...]' regex must be removed",
    );
  });
});

describe("extraction quality — phantom env var removal (round 8)", () => {
  const envSrc = read("lib/ai-environment-readiness.ts");
  const checkEnvSrc = read("scripts/check-env.mjs");

  it("removes PDF_OCR_MAX_RACES from env-readiness declarations", () => {
    assert.ok(
      !envSrc.includes('status("PDF_OCR_MAX_RACES"'),
      "PDF_OCR_MAX_RACES declaration must be removed",
    );
  });

  it("removes PDF_OCR_MAX_RACES warning", () => {
    assert.ok(
      !envSrc.includes('warnings.push("PDF_OCR_MAX_RACES is not set'),
      "PDF_OCR_MAX_RACES warning must be removed",
    );
  });

  it("adds PDF_OCR_TIMEOUT_MS to env-readiness declarations", () => {
    assert.ok(
      envSrc.includes('status("PDF_OCR_TIMEOUT_MS"'),
      "PDF_OCR_TIMEOUT_MS declaration must be added",
    );
  });

  it("updates PDF_OCR_ENABLED warning to reflect default-on behavior", () => {
    assert.ok(
      envSrc.includes("OCR runs by default when ANTHROPIC_API_KEY is present"),
      "PDF_OCR_ENABLED warning must reflect that OCR is default-on",
    );
  });

  it("removes PDF_OCR_MAX_RACES from check-env.mjs", () => {
    assert.ok(
      !checkEnvSrc.includes('"PDF_OCR_MAX_RACES"'),
      "PDF_OCR_MAX_RACES must be removed from check-env.mjs",
    );
    assert.ok(
      checkEnvSrc.includes('"PDF_OCR_TIMEOUT_MS"'),
      "PDF_OCR_TIMEOUT_MS must be added to check-env.mjs",
    );
  });
});

describe("extraction quality — company documents maxDuration (round 8)", () => {
  const src = read("app/api/company/documents/[id]/route.ts");

  it("adds maxDuration = 60 to the company documents route", () => {
    assert.ok(
      src.includes("export const maxDuration = 60"),
      "must export maxDuration = 60 (was missing — Vercel defaulted to 10s)",
    );
  });
});
