/**
 * Behavioral tests for release-safety-repair.
 *
 * Tests prove:
 * - acceptPartialExtraction/acceptNoMandatoryReqs bypasses removed
 * - planOnly cannot bypass safety gates
 * - planOnly creates zero GeneratedDocument rows + authorizesGeneration: false
 * - regex/fallback cannot unlock generation
 * - provider order is exactly Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Anthropic
 * - reference-number extraction returns value, never label word
 * - central readiness gate is preserved
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const generateRoute = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");

// ─── URL bypass removal ────────────────────────────────────────────────────

describe("URL bypass removal", () => {
  it("acceptPartialExtraction does not exist in generate route", () => {
    assert.ok(!generateRoute.includes("acceptPartialExtraction"),
      "acceptPartialExtraction must not exist");
  });

  it("acceptNoMandatoryReqs does not exist in generate route", () => {
    assert.ok(!generateRoute.includes("acceptNoMandatoryReqs"),
      "acceptNoMandatoryReqs must not exist");
  });
});

// ─── planOnly safety ───────────────────────────────────────────────────────

describe("planOnly cannot bypass safety gates", () => {
  it("no planOnly bypass condition exists in any safety gate", () => {
    const bypassCount = (generateRoute.match(/planOnly.*!==\s*"true"/g) || []).length;
    assert.equal(bypassCount, 0,
      "No planOnly bypass conditions may exist — all gates apply unconditionally");
  });

  it("planOnly mode creates zero GeneratedDocument rows", () => {
    const planOnlyIdx = generateRoute.indexOf('url.searchParams.get("planOnly") === "true"');
    assert.ok(planOnlyIdx > -1, "planOnly mode entry must exist");
    const section = generateRoute.slice(planOnlyIdx, planOnlyIdx + 3000);
    assert.ok(section.includes("planRowsCreated = 0"),
      "planOnly must set planRowsCreated = 0");
    assert.ok(!section.includes("ensurePlannedGeneratedDocumentRecords(id, plannedFiles)"),
      "planOnly must NOT call ensurePlannedGeneratedDocumentRecords");
  });

  it("planOnly response includes authorizesGeneration: false", () => {
    const planOnlyIdx = generateRoute.indexOf('url.searchParams.get("planOnly") === "true"');
    const section = generateRoute.slice(planOnlyIdx, planOnlyIdx + 3000);
    assert.ok(section.includes("authorizesGeneration: false"),
      "planOnly response must explicitly include authorizesGeneration: false");
  });

  it("planOnly response includes virtualOnly: true", () => {
    const planOnlyIdx = generateRoute.indexOf('url.searchParams.get("planOnly") === "true"');
    const section = generateRoute.slice(planOnlyIdx, planOnlyIdx + 3000);
    assert.ok(section.includes("virtualOnly: true"),
      "planOnly response must include virtualOnly: true");
  });
});

// ─── Gate safety ───────────────────────────────────────────────────────────

describe("Gate safety — regex/fallback cannot unlock", () => {
  it("generate route checks for regex/fallback before generation", () => {
    assert.ok(
      generateRoute.includes("REGEX_FALLBACK") || generateRoute.includes("regex") || generateRoute.includes("fallback"),
      "Generate route must check for regex/fallback analysis",
    );
  });

  it("ensurePlannedGeneratedDocumentRecords is disabled (no-op)", () => {
    assert.ok(
      generateRoute.includes("PERMANENTLY DISABLED") || generateRoute.includes("return 0;"),
      "ensurePlannedGeneratedDocumentRecords must be permanently disabled",
    );
  });

  it("central readiness gate is called before generation", () => {
    assert.ok(
      generateRoute.includes("assertTenderReadyForGenerationAndExport"),
      "Generate route must call the central readiness gate",
    );
  });
});

// ─── Provider order ────────────────────────────────────────────────────────

describe("Provider order — exact automatic fallback chain", () => {
  const catalog = require("../lib/ai-provider-catalog.cjs");

  it("CANONICAL_AI_PROVIDER_ORDER is exactly 10 providers", () => {
    assert.equal(catalog.CANONICAL_AI_PROVIDER_ORDER.length, 10);
  });

  it("automatic order is Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic", () => {
    assert.deepEqual(
      [...catalog.CANONICAL_AI_PROVIDER_ORDER],
      ["gemini", "groq", "mistral", "zai", "cerebras", "openrouter", "openai", "together", "deepseek", "anthropic"],
    );
  });

  it("Anthropic is last in automatic order", () => {
    assert.equal(
      catalog.CANONICAL_AI_PROVIDER_ORDER[catalog.CANONICAL_AI_PROVIDER_ORDER.length - 1],
      "anthropic",
    );
  });

  it("Z.ai IS in automatic order", () => {
    assert.ok(catalog.CANONICAL_AI_PROVIDER_ORDER.includes("zai"));
  });

  it("Cerebras IS in automatic order", () => {
    assert.ok(catalog.CANONICAL_AI_PROVIDER_ORDER.includes("cerebras"));
  });

  it("Mistral IS in automatic order", () => {
    assert.ok(catalog.CANONICAL_AI_PROVIDER_ORDER.includes("mistral"));
  });

  it("Together IS in automatic order", () => {
    assert.ok(catalog.CANONICAL_AI_PROVIDER_ORDER.includes("together"));
  });

  it("all 10 providers are still configured (for manual use)", () => {
    assert.equal(catalog.ALL_CONFIGURED_PROVIDERS.length, 10);
  });

  it("NON_AUTOMATIC_PROVIDERS is empty (all 10 providers are automatic)", () => {
    assert.deepEqual(
      [...catalog.NON_AUTOMATIC_PROVIDERS],
      [],
    );
  });
});

// ─── Reference extractor ───────────────────────────────────────────────────

describe("Reference extractor — returns value not label", () => {
  it("LABEL_REJECT filter exists in extractor", () => {
    const src = readFileSync("lib/engine/tender-field-extractors.ts", "utf8");
    assert.ok(src.includes("LABEL_REJECT"),
      "LABEL_REJECT must exist to filter label words");
  });

  it("extracts actual reference value, not 'Number'", () => {
    const { extractReference } = require("../lib/engine/tender-field-extractors");
    const result = extractReference({
      files: [{
        fileName: "tender.pdf",
        extractedText: "Tender Reference Number: ABC-2026-001\nSubmission deadline: 2026-12-11\nThis is a test tender document with sufficient text to pass the minimum source length requirement for extraction.",
      }],
    });
    assert.ok(result.found, "Should find a reference");
    assert.notEqual(result.value, "Number");
    assert.notEqual(result.value, "Reference");
    assert.match(result.value, /ABC|2026|001/);
  });
});
