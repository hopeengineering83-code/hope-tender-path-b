// Regression tests for quality gap fixes cherry-picked from Jules PR #662.
//
// Phase 17 cherry-picks the safe subset of Jules PR #662:
//   1. lib/engine/detection-patterns.ts — new shared PLACEHOLDER_PATTERNS and
//      AI_TRACE_PATTERNS constants so document-quality-validator and
//      authority-review use the same detection logic.
//   2. lib/engine/document-quality-validator.ts — imports from detection-patterns
//      instead of defining inline arrays; broader coverage of stub/AI patterns.
//   3. lib/safe-json.ts — generic safeParse<T> helper so engine files no longer
//      need inline try/catch wrappers around JSON.parse.
//   4. 9 API routes — explicit Prisma select clauses to prevent blob leakage
//      (fileContent, profile, extractedText never returned from list endpoints).
//   5. 4 API routes — bare JSON.parse replaced with safeParseJsonObject /
//      safeParseJsonArray so a malformed DB field cannot crash the route.
//   6. 5 engine files — inline safeJsonArray / safeArr local helpers replaced
//      with the canonical safe-json helpers.
//
// Destructive Jules changes NOT cherry-picked:
//   - ai-rematch route (486-line engine replaced with stub)
//   - download route (all export gates deleted)
//   - authority-review.ts (signature break + severity downgrades + regex bug)
//   - ai-multi-perspective-matcher.ts (entire engine gutted, stubs return [])
//   - export-readiness.ts (checkFullExportReadiness and donor checks deleted)

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { PLACEHOLDER_PATTERNS, AI_TRACE_PATTERNS } from "../lib/engine/detection-patterns";
import { validateDocumentQuality } from "../lib/engine/document-quality-validator";
import { safeParse, safeParseJsonArray, safeParseJsonObject } from "../lib/safe-json";
import { readFileSync } from "node:fs";

describe("detection-patterns — shared constants", () => {
  it("PLACEHOLDER_PATTERNS detects Bid-Team stub", () => {
    const text = "This section: Bid-Team to confirm before submission.";
    assert.ok(PLACEHOLDER_PATTERNS.some((re) => re.test(text)), "should detect Bid-Team stub");
  });

  it("PLACEHOLDER_PATTERNS detects MISSING_SOURCE", () => {
    const text = "Client name: MISSING_SOURCE";
    assert.ok(PLACEHOLDER_PATTERNS.some((re) => re.test(text)));
  });

  it("PLACEHOLDER_PATTERNS detects [INSERT something]", () => {
    const text = "Project: [INSERT PROJECT NAME]";
    assert.ok(PLACEHOLDER_PATTERNS.some((re) => re.test(text)));
  });

  it("PLACEHOLDER_PATTERNS detects TBD", () => {
    const text = "Submission deadline: TBD";
    assert.ok(PLACEHOLDER_PATTERNS.some((re) => re.test(text)));
  });

  it("AI_TRACE_PATTERNS detects 'as an AI'", () => {
    const text = "As an AI language model, I cannot provide...";
    assert.ok(AI_TRACE_PATTERNS.some((re) => re.test(text)));
  });

  it("AI_TRACE_PATTERNS detects knowledge cutoff phrase", () => {
    const text = "My knowledge cutoff prevents me from knowing recent events.";
    assert.ok(AI_TRACE_PATTERNS.some((re) => re.test(text)));
  });

  it("clean proposal prose does not trigger PLACEHOLDER_PATTERNS", () => {
    const text = "Acme Consulting Engineers PLC delivered the Adama Water Supply Scheme (ETB 85M, MoWIE, 2019–2022).";
    assert.ok(!PLACEHOLDER_PATTERNS.some((re) => re.test(text)), "clean evidence prose should not trigger placeholder detection");
  });
});

describe("document-quality-validator — uses shared detection patterns", () => {
  it("BLOCKED when content contains Bid-Team stub", () => {
    const result = validateDocumentQuality({
      name: "Technical Proposal",
      documentType: "TECHNICAL",
      fileContent: "Section A: Company Profile\n\nBid-Team to confirm registration number before submission.",
      storagePath: null,
    });
    assert.strictEqual(result.status, "BLOCKED");
    assert.ok(result.placeholders.length > 0);
  });

  it("BLOCKED when content contains AI trace (knowledge cutoff)", () => {
    const result = validateDocumentQuality({
      name: "Technical Proposal",
      documentType: "TECHNICAL",
      fileContent: "My knowledge cutoff means I cannot provide current project data.",
      storagePath: null,
    });
    assert.strictEqual(result.status, "BLOCKED");
    assert.ok(result.aiTrace.length > 0);
  });

  it("GOOD for clean substantive content (>= 200 chars, no stubs or AI traces)", () => {
    const result = validateDocumentQuality({
      name: "Technical Proposal",
      documentType: "TECHNICAL",
      fileContent: "Acme Consulting Engineers PLC has delivered the Adama Water Supply Scheme (ETB 85M, MoWIE, 2019–2022) with EPANET hydraulic design for a 45,000 m³/day system serving 380,000 beneficiaries in the Oromia region. The team is led by a Senior Water Engineer with 14 years of sector experience certified by the Ethiopian Construction Authority (Grade 1, Reg. ECA-C1-2008-0047).",
      storagePath: null,
    });
    assert.strictEqual(result.status, "GOOD");
  });
});

describe("safeParse — generic helper", () => {
  it("parses valid JSON", () => {
    const result = safeParse('{"key":"value"}', null);
    assert.deepStrictEqual(result, { key: "value" });
  });

  it("returns fallback for invalid JSON", () => {
    const result = safeParse("not json {{", null);
    assert.strictEqual(result, null);
  });

  it("returns fallback for null input", () => {
    const result = safeParse(null, "default");
    assert.strictEqual(result, "default");
  });

  it("safeParseJsonArray returns [] for invalid JSON", () => {
    const result = safeParseJsonArray("{ not an array }");
    assert.deepStrictEqual(result, []);
  });

  it("safeParseJsonObject returns {} for array JSON", () => {
    const result = safeParseJsonObject('["a","b"]');
    assert.deepStrictEqual(result, {});
  });
});

describe("phase 17 — API route Prisma select hardening (static audit)", () => {
  const BLOB_FIELDS = ["fileContent", "extractedText", "profile", "rawText", "content"];

  const ROUTES_UNDER_TEST = [
    "app/api/audit/route.ts",
    "app/api/company/compliance-records/route.ts",
    "app/api/company/experts/route.ts",
    "app/api/company/financial-records/route.ts",
    "app/api/company/legal-records/route.ts",
    "app/api/company/projects/route.ts",
    "app/api/notifications/route.ts",
    "app/api/tenders/[id]/controls/route.ts",
    "app/api/tenders/[id]/evaluator-objections/route.ts",
  ];

  for (const route of ROUTES_UNDER_TEST) {
    it(`${route} has at least one explicit Prisma select`, () => {
      const source = readFileSync(route, "utf8");
      assert.ok(
        source.includes("select:") && source.includes("true"),
        `${route} should have an explicit Prisma select clause`,
      );
    });
  }

  it("safeParse import present in deep-reasoning-runs route", () => {
    const source = readFileSync("app/api/system/deep-reasoning-runs/route.ts", "utf8");
    assert.ok(source.includes("safeParse"), "should import safeParse");
    assert.ok(!source.includes("JSON.parse(row.metadata)"), "should not have bare JSON.parse on row.metadata");
  });

  it("safeParseJsonObject used in ai-analyze route for job output parsing", () => {
    const source = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");
    assert.ok(source.includes("safeParseJsonObject"), "should use safeParseJsonObject");
  });
});
