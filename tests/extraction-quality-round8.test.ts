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
    assert.ok(
      src.includes("/429|rate.?limit|overloaded/i"),
      "must detect rate-limit errors",
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
    assert.ok(
      src.includes('stop_reason === "max_tokens"'),
      "must detect truncation via stop_reason",
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

describe("extraction quality — upload-first deadline + ocrPageMarkers (round 8)", () => {
  const src = read("lib/tender-upload-first.ts");

  it("adds a per-upload deadline (45s budget)", () => {
    assert.ok(
      src.includes("uploadDeadline") && src.includes("45_000"),
      "must have a 45s upload deadline",
    );
    assert.ok(
      src.includes("Date.now() > uploadDeadline"),
      "must check the deadline before each file",
    );
    assert.ok(
      src.includes("Time budget exceeded"),
      "must push a warning when deadline is exceeded",
    );
  });

  it("fixes ocrPageMarkers regex to match the actual OCR marker", () => {
    assert.ok(
      src.includes("\\[PDF text extracted via Claude vision OCR"),
      "ocrPageMarkers regex must match '[PDF text extracted via Claude vision OCR...]'",
    );
    assert.ok(
      !src.includes("\\[OCR text"),
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
