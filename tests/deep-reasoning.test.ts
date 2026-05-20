// Unit tests for the deep-reasoning feature (PR #384 / TENDER_DEEP_REASONING).
//
// Covers:
//   1. Feature-flag truthy parsing (`isDeepReasoningEnabled`).
//   2. The evaluation-criteria-extractor JSON parser and prompt
//      formatter — pure functions, no AI call.
//   3. The deep-reasoning-refiner orchestrator's graceful-null path
//      (no AI key configured) and its history-hint builder.
//   4. The lib/ai.ts critique + rewrite prompt builders — pure
//      functions exposed via __deepReasoningInternals for test access.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { __testing__ as flagInternals, isDeepReasoningEnabled, isToolUseGenerationEnabled } from "../lib/engine/feature-flags";
import {
  parseComprehensionJson,
  formatComprehensionForPrompt,
  extractDeepTenderComprehension,
} from "../lib/engine/evaluation-criteria-extractor";
import { __testing__ as refinerInternals, runDeepRefinement, type DeepRefinementAttempt } from "../lib/engine/deep-reasoning-refiner";
import { __deepReasoningInternals } from "../lib/ai";
import type { QualityScore } from "../lib/engine/proposal-quality-scorer";

describe("feature-flags — isDeepReasoningEnabled", () => {
  const previous = process.env.TENDER_DEEP_REASONING;

  it("accepts canonical truthy values", () => {
    for (const value of ["1", "true", "yes", "on", "TRUE", "True ", " yes "]) {
      assert.equal(flagInternals.isTruthy(value), true, `expected truthy: "${value}"`);
    }
  });

  it("rejects falsy and unknown values", () => {
    for (const value of ["", "0", "false", "no", "off", "perhaps", undefined]) {
      assert.equal(flagInternals.isTruthy(value), false, `expected falsy: "${value}"`);
    }
  });

  it("reads from TENDER_DEEP_REASONING when set", () => {
    process.env.TENDER_DEEP_REASONING = "true";
    assert.equal(isDeepReasoningEnabled(), true);
    process.env.TENDER_DEEP_REASONING = "false";
    assert.equal(isDeepReasoningEnabled(), false);
    delete process.env.TENDER_DEEP_REASONING;
    assert.equal(isDeepReasoningEnabled(), false);
    if (previous !== undefined) process.env.TENDER_DEEP_REASONING = previous;
  });

  it("reads from TENDER_TOOL_USE_GENERATION when set", () => {
    const prev = process.env.TENDER_TOOL_USE_GENERATION;
    process.env.TENDER_TOOL_USE_GENERATION = "true";
    assert.equal(isToolUseGenerationEnabled(), true);
    process.env.TENDER_TOOL_USE_GENERATION = "1";
    assert.equal(isToolUseGenerationEnabled(), true);
    process.env.TENDER_TOOL_USE_GENERATION = "false";
    assert.equal(isToolUseGenerationEnabled(), false);
    delete process.env.TENDER_TOOL_USE_GENERATION;
    assert.equal(isToolUseGenerationEnabled(), false);
    if (prev !== undefined) process.env.TENDER_TOOL_USE_GENERATION = prev;
  });
});

describe("evaluation-criteria-extractor — parseComprehensionJson", () => {
  it("returns null for non-JSON input", () => {
    assert.equal(parseComprehensionJson("not json at all"), null);
    assert.equal(parseComprehensionJson(""), null);
  });

  it("returns null for valid JSON that does not match the schema", () => {
    assert.equal(parseComprehensionJson("[1, 2, 3]"), null);
    // Top-level object with only unrelated fields and no signal
    assert.equal(parseComprehensionJson('{"foo": "bar"}'), null);
  });

  it("unwraps a markdown-fenced JSON block", () => {
    const fenced = "```json\n" + JSON.stringify({
      reasoning: "test",
      criteria: [{ criterion: "Technical Approach", weight: 40, mandatory: false, scoringMethod: "weighted", evidenceExpected: ["CVs"], sourceQuote: "Tech 40%" }],
      disqualifiers: [],
      prohibitions: [],
      totalWeightAccountedFor: 40,
    }) + "\n```";
    const parsed = parseComprehensionJson(fenced);
    assert.ok(parsed, "expected fenced JSON to parse");
    assert.equal(parsed!.criteria.length, 1);
    assert.equal(parsed!.criteria[0].criterion, "Technical Approach");
    assert.equal(parsed!.criteria[0].weight, 40);
    assert.equal(parsed!.criteria[0].scoringMethod, "weighted");
  });

  it("clamps invalid weights and defaults scoringMethod", () => {
    const parsed = parseComprehensionJson(JSON.stringify({
      reasoning: "x",
      criteria: [
        { criterion: "A", weight: -10, mandatory: true, scoringMethod: "garbage", evidenceExpected: [], sourceQuote: "" },
        { criterion: "B", weight: 250, mandatory: false, scoringMethod: "pass-fail", evidenceExpected: [], sourceQuote: "" },
        { criterion: "C", weight: "not-a-number", mandatory: false, evidenceExpected: [], sourceQuote: "" },
      ],
      disqualifiers: [],
      prohibitions: [],
      totalWeightAccountedFor: null,
    }));
    assert.ok(parsed);
    assert.equal(parsed!.criteria.length, 3);
    assert.equal(parsed!.criteria[0].weight, 0);          // clamp negative
    assert.equal(parsed!.criteria[0].scoringMethod, "unknown"); // invalid → unknown
    assert.equal(parsed!.criteria[0].mandatory, true);
    assert.equal(parsed!.criteria[1].weight, 100);        // clamp > 100
    assert.equal(parsed!.criteria[1].scoringMethod, "pass-fail");
    assert.equal(parsed!.criteria[2].weight, null);       // non-numeric → null
  });

  it("derives totalWeightAccountedFor when missing", () => {
    const parsed = parseComprehensionJson(JSON.stringify({
      reasoning: "x",
      criteria: [
        { criterion: "A", weight: 30, mandatory: false, scoringMethod: "weighted", evidenceExpected: [], sourceQuote: "" },
        { criterion: "B", weight: 70, mandatory: false, scoringMethod: "weighted", evidenceExpected: [], sourceQuote: "" },
      ],
      disqualifiers: [],
      prohibitions: [],
      // Omit totalWeightAccountedFor entirely
    }));
    assert.ok(parsed);
    assert.equal(parsed!.totalWeightAccountedFor, 100);
  });

  it("drops criteria with empty names and caps array sizes", () => {
    const parsed = parseComprehensionJson(JSON.stringify({
      reasoning: "x",
      criteria: [
        { criterion: "", weight: 10, mandatory: false, scoringMethod: "weighted", evidenceExpected: [], sourceQuote: "" },
        { criterion: "Good", weight: 10, mandatory: false, scoringMethod: "weighted", evidenceExpected: [], sourceQuote: "" },
      ],
      disqualifiers: [{ rule: "", triggerLanguage: "ignored" }, { rule: "Real rule", triggerLanguage: "x" }],
      prohibitions: ["", "  ", "Valid"],
      totalWeightAccountedFor: 10,
    }));
    assert.ok(parsed);
    assert.equal(parsed!.criteria.length, 1, "empty-name criterion is dropped");
    assert.equal(parsed!.criteria[0].criterion, "Good");
    assert.equal(parsed!.disqualifiers.length, 1, "empty rule disqualifier dropped");
    assert.equal(parsed!.disqualifiers[0].rule, "Real rule");
    assert.equal(parsed!.prohibitions.length, 1, "empty prohibitions dropped");
    assert.equal(parsed!.prohibitions[0], "Valid");
  });

  it("produces stable ids from criterion names", () => {
    const parsed = parseComprehensionJson(JSON.stringify({
      reasoning: "x",
      criteria: [
        { criterion: "Technical Approach & Methodology", weight: 40, mandatory: false, scoringMethod: "weighted", evidenceExpected: [], sourceQuote: "" },
      ],
      disqualifiers: [],
      prohibitions: [],
      totalWeightAccountedFor: 40,
    }));
    assert.ok(parsed);
    assert.equal(parsed!.criteria[0].id, "technical-approach-methodology");
  });
});

describe("evaluation-criteria-extractor — formatComprehensionForPrompt", () => {
  it("renders header, criteria, disqualifiers, and prohibitions", () => {
    const text = formatComprehensionForPrompt({
      reasoning: "Found explicit scoring table",
      criteria: [
        { id: "tech", criterion: "Technical Approach", weight: 40, mandatory: true, scoringMethod: "weighted", evidenceExpected: ["CVs", "methodology narrative"], sourceQuote: "Technical 40%" },
      ],
      disqualifiers: [
        { id: "iso", rule: "ISO certification required", triggerLanguage: "without ISO 9001 will be rejected" },
      ],
      prohibitions: ["No joint ventures"],
      totalWeightAccountedFor: 40,
    });
    assert.match(text, /DEEP TENDER COMPREHENSION/);
    assert.match(text, /Reasoning: Found explicit scoring table/);
    assert.match(text, /Technical Approach.*40%/);
    assert.match(text, /MANDATORY/);
    assert.match(text, /Evidence expected: CVs; methodology narrative/);
    assert.match(text, /Disqualifying conditions/);
    assert.match(text, /ISO certification required/);
    assert.match(text, /Structural prohibitions/);
    assert.match(text, /No joint ventures/);
  });

  it("omits empty sections cleanly", () => {
    const text = formatComprehensionForPrompt({
      reasoning: "no explicit criteria found",
      criteria: [],
      disqualifiers: [],
      prohibitions: [],
      totalWeightAccountedFor: null,
    });
    assert.match(text, /DEEP TENDER COMPREHENSION/);
    assert.match(text, /Reasoning: no explicit criteria found/);
    assert.equal(text.includes("Evaluation criteria"), false);
    assert.equal(text.includes("Disqualifying conditions"), false);
    assert.equal(text.includes("Structural prohibitions"), false);
  });
});

describe("evaluation-criteria-extractor — extractDeepTenderComprehension graceful nulls", () => {
  it("returns null for empty / very short tender text without invoking AI", async () => {
    const result = await extractDeepTenderComprehension("");
    assert.equal(result, null);
    const tinyResult = await extractDeepTenderComprehension("Tender for X.");
    assert.equal(tinyResult, null);
  });
});

describe("deep-reasoning-refiner — buildHistoryHint", () => {
  it("returns empty string when no attempts", () => {
    assert.equal(refinerInternals.buildHistoryHint([]), "");
  });

  it("returns empty string when no attempt was applied", () => {
    const attempts: DeepRefinementAttempt[] = [
      { iteration: 1, scoreBefore: 60, weakAxesBefore: ["evidenceDensity"], scoreAfter: 60, weakAxesAfter: ["evidenceDensity"], lift: 0, status: "critique-failed", critiqueLength: 0 },
    ];
    assert.equal(refinerInternals.buildHistoryHint(attempts), "");
  });

  it("describes applied iterations with fixed and residual axes", () => {
    const attempts: DeepRefinementAttempt[] = [
      {
        iteration: 1,
        scoreBefore: 60,
        weakAxesBefore: ["evidenceDensity", "throughlineConsistency"],
        scoreAfter: 75,
        weakAxesAfter: ["throughlineConsistency"],
        lift: 15,
        status: "applied",
        critiqueLength: 800,
      },
    ];
    const text = refinerInternals.buildHistoryHint(attempts);
    assert.match(text, /Refinement history/);
    assert.match(text, /Iteration 1: score 60 → 75/);
    assert.match(text, /Fixed: evidenceDensity/);
    assert.match(text, /Still weak: throughlineConsistency/);
  });
});

describe("deep-reasoning-refiner — runDeepRefinement no-op paths", () => {
  function dummyScore(total: number, weak: string[] = []): QualityScore {
    return {
      total,
      axes: {
        structureCompleteness: 10,
        evidenceDensity: 10,
        tableCoverage: 10,
        sectorVocabulary: 10,
        throughlineConsistency: 10,
        aiTraceFreedom: 10,
        complianceMatrixCoverage: 10,
        evaluatorMirrorCoverage: 10,
        winThemesPresence: 10,
        selfScorePresence: 10,
      },
      weakAxes: weak,
      notes: [],
    };
  }

  it("returns null when initial score already exceeds threshold", async () => {
    const result = await runDeepRefinement({
      initialMarkdown: "# Proposal\n\nContent.",
      initialScore: dummyScore(95, []),
      scoreMarkdown: () => dummyScore(95, []),
      cleanMarkdown: (md) => md,
      tenderTitle: "T",
      clientName: "C",
      primarySector: "water",
      topProjectNames: [],
      topExpertNames: [],
      scoreThreshold: 90,
    });
    assert.equal(result, null);
  });

  it("returns null when no weak axes are flagged", async () => {
    const result = await runDeepRefinement({
      initialMarkdown: "# Proposal\n\nContent.",
      initialScore: dummyScore(60, []),
      scoreMarkdown: () => dummyScore(60, []),
      cleanMarkdown: (md) => md,
      tenderTitle: "T",
      clientName: "C",
      primarySector: "water",
      topProjectNames: [],
      topExpertNames: [],
      scoreThreshold: 90,
    });
    assert.equal(result, null);
  });

  it("returns null gracefully when AI is unavailable (test env has no real keys)", async () => {
    // The test runner sets GEMINI_API_KEY to a placeholder. The critique
    // pass will fail to produce real output; refiner should return null
    // without throwing.
    const result = await runDeepRefinement({
      initialMarkdown: "# Proposal\n\nContent that should be refined.".repeat(50),
      initialScore: dummyScore(60, ["evidenceDensity", "throughlineConsistency"]),
      scoreMarkdown: () => dummyScore(60, ["evidenceDensity"]),
      cleanMarkdown: (md) => md,
      tenderTitle: "T",
      clientName: "C",
      primarySector: "water",
      topProjectNames: ["P1"],
      topExpertNames: ["E1"],
      scoreThreshold: 90,
      maxIterations: 1,
    });
    assert.equal(result, null);
  });
});

describe("lib/ai.ts — deep-reasoning prompt builders", () => {
  it("critique prompt includes tender metadata, weak axes, evidence, and the draft markdown", () => {
    const prompt = __deepReasoningInternals.buildCritiquePrompt({
      currentMarkdown: "# DRAFT MARKDOWN STARTS HERE",
      weakAxes: ["evidenceDensity", "throughlineConsistency"],
      axisScores: { evidenceDensity: 3, throughlineConsistency: 4 },
      tenderTitle: "Test Tender",
      clientName: "Test Client",
      primarySector: "water",
      topProjectNames: ["Sebeta WASH"],
      topExpertNames: ["Dr. Alemu"],
      comprehensionBlock: null,
    });
    assert.match(prompt, /Critique request/);
    assert.match(prompt, /Tender: "Test Tender"/);
    assert.match(prompt, /Client: Test Client/);
    assert.match(prompt, /Sector: water/);
    assert.match(prompt, /evidenceDensity \(score: 3/);
    assert.match(prompt, /throughlineConsistency \(score: 4/);
    assert.match(prompt, /Top projects available: Sebeta WASH/);
    assert.match(prompt, /Top experts available: Dr\. Alemu/);
    assert.match(prompt, /DRAFT MARKDOWN STARTS HERE/);
  });

  it("critique prompt embeds the comprehension block when supplied", () => {
    const prompt = __deepReasoningInternals.buildCritiquePrompt({
      currentMarkdown: "draft",
      weakAxes: ["evidenceDensity"],
      axisScores: { evidenceDensity: 5 },
      tenderTitle: "T",
      clientName: "C",
      primarySector: "water",
      topProjectNames: [],
      topExpertNames: [],
      comprehensionBlock: "## DEEP TENDER COMPREHENSION\nReasoning: x\n- Technical 40%",
    });
    assert.match(prompt, /Extracted evaluation criteria/);
    assert.match(prompt, /Technical 40%/);
  });

  it("rewrite prompt enforces no-financial when flagged", () => {
    const prompt = __deepReasoningInternals.buildRewritePrompt({
      currentMarkdown: "draft",
      critique: "fix A",
      tenderTitle: "T",
      clientName: "C",
      primarySector: "water",
      topProjectNames: [],
      topExpertNames: [],
      noFinancial: true,
    });
    assert.match(prompt, /TENDER IS TECHNICAL ONLY/);
    assert.match(prompt, /strip any cost\/budget\/pricing language/);
    assert.match(prompt, /fix A/);
  });

  it("rewrite prompt allows financial language when not flagged", () => {
    const prompt = __deepReasoningInternals.buildRewritePrompt({
      currentMarkdown: "draft",
      critique: "fix B",
      tenderTitle: "T",
      clientName: "C",
      primarySector: "water",
      topProjectNames: [],
      topExpertNames: [],
      noFinancial: false,
    });
    assert.match(prompt, /Financial language is permitted/);
    assert.match(prompt, /fix B/);
  });
});
