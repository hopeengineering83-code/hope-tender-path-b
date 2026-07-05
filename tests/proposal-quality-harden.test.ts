// Phase 19: Proposal quality hardening regression tests.
// Verifies boilerplate detection thresholds, aiTraceFreedom multiplier,
// and that document-quality-validator correctly gates on boilerplate.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateDocumentQuality } from "../lib/engine/document-quality-validator";
import { GENERIC_BOILERPLATE_PATTERNS } from "../lib/engine/detection-patterns";

// ── 1. validateDocumentQuality boilerplate detection ────────────────────────

describe("validateDocumentQuality — boilerplate detection", () => {
  function buildDocWithBoilerplate(lines: string[]) {
    return {
      name: "Test Doc",
      documentType: "TECHNICAL_PROPOSAL",
      fileContent: lines.join("\n\n"),
      storagePath: null,
    };
  }

  it("returns boilerplateHits array in result", () => {
    const result = validateDocumentQuality(buildDocWithBoilerplate(["Clean professional proposal text."]));
    assert.ok(Array.isArray(result.boilerplateHits), "boilerplateHits must be an array");
  });

  it("no boilerplate in clean document", () => {
    const result = validateDocumentQuality(buildDocWithBoilerplate([
      "Our methodology follows established engineering standards for water infrastructure design.",
      "We have completed similar infrastructure projects in the region, including gravity-fed schemes and pump stations.",
      "Each project was delivered within the contractual timeline and budget with full client acceptance.",
      "Our senior engineers hold relevant professional accreditations and carry out QA supervision throughout.",
    ]));
    assert.equal(result.boilerplateHits.length, 0, "clean document should have no boilerplate hits");
    assert.equal(result.status, "GOOD");
  });

  it("detects 1 boilerplate hit with no status change", () => {
    const result = validateDocumentQuality(buildDocWithBoilerplate([
      "Our team brings world-class engineering expertise to water infrastructure projects across the region.",
      "We have completed similar water supply and sanitation projects in Ethiopia and Kenya since 2012.",
      "Our technical approach is grounded in EBCS standards and WHO drinking-water guidelines throughout.",
      "All project deliverables are reviewed by a principal engineer before submission to the client.",
    ]));
    assert.ok(result.boilerplateHits.length >= 1, "should detect world-class boilerplate");
    assert.equal(result.status, "GOOD", "1 hit should not trigger warning or block");
  });

  it("warns when >= 3 boilerplate hits are detected", () => {
    // Exactly 3 boilerplate phrases, no pattern doubling
    const doc = buildDocWithBoilerplate([
      "We are committed to excellence in every infrastructure project we undertake across the region.",
      "Our engineers employ best practices in project delivery and quality assurance throughout construction.",
      "We look forward to the opportunity to demonstrate our technical capabilities on this assignment.",
      "Our team has the relevant skills and equipment to complete this work within the required schedule.",
    ]);
    const result = validateDocumentQuality(doc);
    assert.ok(result.boilerplateHits.length >= 3, `expected >= 3 hits, got ${result.boilerplateHits.length}`);
    assert.ok(
      result.qualityWarnings.some((w) => w.includes("boilerplate")),
      "should have boilerplate quality warning",
    );
    assert.ok(result.boilerplateHits.length < 5, `test content must stay under 5 hits to avoid BLOCKED; got ${result.boilerplateHits.length}`);
    assert.notEqual(result.status, "BLOCKED", "3-4 boilerplate hits should warn, not block");
  });

  it("blocks when >= 5 boilerplate hits are detected", () => {
    const doc = buildDocWithBoilerplate([
      "We are committed to excellence in every project we undertake.",
      "Our world-class team of qualified professionals uses state-of-the-art technology.",
      "We are excited to submit this proposal to showcase our cutting-edge solutions.",
      "Our proven track record demonstrates unparalleled expertise in the sector.",
      "We look forward to the opportunity to deliver streamlined operations.",
      "It would be an honour to serve as your implementation partner.",
    ]);
    const result = validateDocumentQuality(doc);
    assert.ok(result.boilerplateHits.length >= 5, `expected >= 5 hits, got ${result.boilerplateHits.length}`);
    assert.equal(result.status, "BLOCKED", "5+ boilerplate hits should block");
  });

  it("blocked boilerplate document gets score 40", () => {
    const doc = buildDocWithBoilerplate([
      "We are committed to excellence in every project we undertake.",
      "Our world-class team of qualified professionals uses state-of-the-art technology.",
      "We are excited to submit this proposal to showcase our cutting-edge solutions.",
      "Our proven track record demonstrates unparalleled expertise in the sector.",
      "We look forward to the opportunity to deliver streamlined operations.",
      "It would be an honour to serve as your implementation partner.",
    ]);
    const result = validateDocumentQuality(doc);
    if (result.status === "BLOCKED" && result.boilerplateHits.length >= 5 && result.placeholders.length === 0 && result.aiTrace.length === 0 && !result.envelopeMismatch) {
      assert.equal(result.score, 40, "boilerplate-only block should score 40");
    }
  });

  it("placeholder blocker takes precedence over boilerplate in score (score < 40)", () => {
    const doc = buildDocWithBoilerplate([
      "[INSERT client name] committed to excellence",
      "world-class team uses state-of-the-art technology",
      "excited to submit this cutting-edge proposal",
      "proven track record demonstrates unparalleled expertise",
      "look forward to the opportunity for streamlined operations",
    ]);
    const result = validateDocumentQuality(doc);
    assert.ok(result.placeholders.length > 0, "should detect placeholder");
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.score <= 35, "placeholder blocker score should be <= 35");
  });
});

// ── 2. GENERIC_BOILERPLATE_PATTERNS completeness ────────────────────────────

describe("GENERIC_BOILERPLATE_PATTERNS coverage", () => {
  const EXPECTED_PHRASES = [
    "committed to excellence",
    "world-class",
    "cutting-edge",
    "proven track record",
    "innovative solutions",
    "best practices",
    "state-of-the-art",
    "streamlined operations",
    "enhanced efficiency",
    "second to none",
  ];

  for (const phrase of EXPECTED_PHRASES) {
    it(`detects phrase: "${phrase}"`, () => {
      const hit = GENERIC_BOILERPLATE_PATTERNS.some((re) => re.test(phrase));
      assert.ok(hit, `GENERIC_BOILERPLATE_PATTERNS must detect: "${phrase}"`);
    });
  }

  it("has at least 15 patterns", () => {
    assert.ok(
      GENERIC_BOILERPLATE_PATTERNS.length >= 15,
      `expected >= 15 boilerplate patterns, got ${GENERIC_BOILERPLATE_PATTERNS.length}`,
    );
  });
});

// ── 3. aiTraceFreedom multiplier = 3 (static audit) ────────────────────────

describe("proposal-quality-scorer aiTraceFreedom multiplier hardened to 3", () => {
  it("aiTraceFreedom uses multiplier of 3 per trace hit (not 2)", () => {
    const src = readFileSync("lib/engine/proposal-quality-scorer.ts", "utf8");
    assert.ok(
      src.includes("traces.length * 3"),
      "aiTraceFreedom must use multiplier 3 (was 2) to penalise AI traces more harshly",
    );
    assert.ok(
      !src.includes("traces.length * 2"),
      "old multiplier of 2 must not remain in proposal-quality-scorer.ts",
    );
  });
});

// ── 4. authority-review uses shared patterns ────────────────────────────────

describe("authority-review upgraded to shared detection patterns", () => {
  it("imports AI_TRACE_PATTERNS and PLACEHOLDER_PATTERNS from detection-patterns", () => {
    const src = readFileSync("lib/engine/authority-review.ts", "utf8");
    assert.ok(src.includes("AI_TRACE_PATTERNS"), "must import AI_TRACE_PATTERNS");
    assert.ok(src.includes("PLACEHOLDER_PATTERNS"), "must import PLACEHOLDER_PATTERNS");
  });

  it("uses AI_TRACE_PATTERNS.some() for detection (not local regex)", () => {
    const src = readFileSync("lib/engine/authority-review.ts", "utf8");
    assert.ok(
      src.includes("AI_TRACE_PATTERNS.some"),
      "authority-review must use AI_TRACE_PATTERNS.some() for AI trace detection",
    );
  });

  it("uses PLACEHOLDER_PATTERNS.some() for detection (not local regex)", () => {
    const src = readFileSync("lib/engine/authority-review.ts", "utf8");
    assert.ok(
      src.includes("PLACEHOLDER_PATTERNS.some"),
      "authority-review must use PLACEHOLDER_PATTERNS.some() for placeholder detection",
    );
  });

  it("does not use old narrow local AI_TRACE_RE regex", () => {
    const src = readFileSync("lib/engine/authority-review.ts", "utf8");
    assert.ok(
      !src.includes("const AI_TRACE_RE"),
      "old local AI_TRACE_RE constant must be removed in favour of shared AI_TRACE_PATTERNS",
    );
  });

  it("does not use old narrow local PLACEHOLDER_RE regex", () => {
    const src = readFileSync("lib/engine/authority-review.ts", "utf8");
    assert.ok(
      !src.includes("const PLACEHOLDER_RE"),
      "old local PLACEHOLDER_RE constant must be removed in favour of shared PLACEHOLDER_PATTERNS",
    );
  });

  it("new patterns (anthropic, gemini, lorem ipsum) are detected in documents", () => {
    const { runAuthorityReview } = require("../lib/engine/authority-review");
    const docs = [{
      id: "d1",
      name: "Test Doc",
      documentType: "TECHNICAL_PROPOSAL",
      contentSummary: "This was generated by Anthropic claude.ai. Lorem ipsum dolor sit amet.",
      reviewNotes: null,
      exactFileName: null,
    }];
    const result = runAuthorityReview(docs, [], []);
    const hasPh = result.blockers.some((b: any) => b.code === "PLACEHOLDER");
    const hasAi = result.blockers.some((b: any) => b.code === "AI_TRACE");
    assert.ok(hasAi || hasPh, "should detect anthropic/claude/lorem ipsum via shared patterns");
  });
});
