import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CANDIDATES_PER_MATCHER_BATCH,
  batchSizeForBudget,
  buildExpertUserPrompt,
  buildProjectUserPrompt,
  largestFittingBatch,
  tightestChainInputBudget,
} from "../lib/engine/ai-multi-perspective-matcher";
import { estimateInputTokens } from "../lib/ai-preflight";

/**
 * Every matcher batch was rejected before it was sent, on every tender, for a
 * reason entirely inside this repository.
 *
 * assessBatches sliced by MAX_CANDIDATES_PER_MATCHER_BATCH (20) and nothing
 * else. Measured against the owner's real 114-project / 28-expert vault:
 *
 *   PROJECT  fixed 2,069 tok + 283 tok/candidate  -> batch 20 = 8,416 tok
 *   EXPERT   fixed 2,567 tok + 481 tok/candidate  -> batch 20 = 10,665 tok
 *
 * against a Groq budget of 7,088 (gpt-oss free tier 8,000 TPM, less the
 * 512-token minimum useful response and preflight's 5% margin). The live log
 * recorded it verbatim: "Prompt exceeds the configured provider throughput
 * budget (7358 input tokens)" and "(9097 input tokens)".
 *
 * adaptiveBatchSize() was written for this and returns 10 for Groq — which
 * measurement confirms fits — but its only importer is lib/liveness.ts,
 * reporting `adaptiveBatchSizeAvailable: true`. A probe asserted the mitigation
 * existed while the code path it was written for ignored it.
 */

// Candidates deliberately vary in size: real project summaries differ by
// several times, which is what defeats extrapolating from the first one.
function projectCandidate(index: number, summaryChars: number) {
  return {
    id: `p${index}`,
    name: `Project ${index}`,
    clientName: `Client ${index}`,
    country: "Ethiopia",
    sector: null,
    serviceAreas: [] as string[],
    contractValue: null,
    currency: null,
    startDate: null,
    endDate: null,
    summary: "S".repeat(summaryChars),
    trustLevel: "SOURCE_VERIFIED",
  };
}

function expertCandidate(index: number, profileChars: number) {
  return {
    id: `e${index}`,
    fullName: `Expert ${index}`,
    title: "Senior Engineer",
    yearsExperience: 11,
    disciplines: ["Civil"],
    sectors: ["Healthcare"],
    certifications: [] as string[],
    profile: "P".repeat(profileChars),
    trustLevel: "SOURCE_VERIFIED",
  };
}

const REQUIREMENTS = "R".repeat(12_000);

function projectPrompt(sector: string) {
  return (batch: ReturnType<typeof projectCandidate>[]) =>
    buildProjectUserPrompt({
      tenderTitle: `Consultancy Services — ${sector}`,
      tenderRequirementsText: REQUIREMENTS,
      tenderCategory: sector,
      candidates: batch as unknown as Parameters<typeof buildProjectUserPrompt>[0]["candidates"],
    });
}

function walkBatches<T>(candidates: T[], build: (b: T[]) => string, budget: number): T[][] {
  const fixedTokens = estimateInputTokens(build([]));
  const perCandidateTokens = Math.max(1, estimateInputTokens(build(candidates.slice(0, 1))) - fixedTokens);
  const batches: T[][] = [];
  let index = 0;
  let guard = 0;
  while (index < candidates.length) {
    if (++guard > 10_000) throw new Error("batching did not terminate");
    const batch = largestFittingBatch(candidates.slice(index), build, budget, { fixedTokens, perCandidateTokens });
    assert.ok(batch.length >= 1, "a batch must always make progress");
    batches.push(batch);
    index += batch.length;
  }
  return batches;
}

test("no candidate is dropped, duplicated or reordered", () => {
  // The invariant that protects evidence completeness: matching must see every
  // candidate exactly once, whatever the batching does.
  const candidates = Array.from({ length: 114 }, (_, i) => projectCandidate(i, 400 + (i % 7) * 300));
  const budget = tightestChainInputBudget();
  const batches = walkBatches(candidates, projectPrompt("Healthcare"), budget);

  const seen = batches.flat().map((c) => c.id);
  assert.equal(seen.length, candidates.length, "candidate count changed");
  assert.deepEqual(seen, candidates.map((c) => c.id), "candidates were reordered or duplicated");
});

test("every batch fits the budget, across sectors and candidate sizes", () => {
  // Sector-agnostic by construction — the size comes from measured tokens, not
  // from any sector rule. These cases prove a road or water vault batches on
  // its own evidence exactly as a healthcare one does.
  const sectors = [
    "Healthcare / Medical Facility Design",
    "Roads and Bridges",
    "Water Supply and Sanitation",
    "Geotechnical Investigation",
    "Urban Planning and Master Planning",
    "Construction Supervision",
    "Industrial Facilities",
    "EOI / Consultant Selection",
  ];
  const budget = tightestChainInputBudget();

  for (const sector of sectors) {
    for (const [label, sizes] of [
      ["uniform small", () => 300],
      ["uniform large", () => 2_400],
      ["mixed", (i: number) => 200 + (i % 11) * 400],
    ] as Array<[string, (i: number) => number]>) {
      const candidates = Array.from({ length: 40 }, (_, i) => projectCandidate(i, sizes(i)));
      const build = projectPrompt(sector);
      for (const batch of walkBatches(candidates, build, budget)) {
        const tokens = estimateInputTokens(build(batch));
        assert.ok(
          tokens <= budget || batch.length === 1,
          `${sector} / ${label}: a ${batch.length}-candidate batch cost ${tokens} tokens against a ${budget} budget`,
        );
      }
    }
  }
});

test("expert batches fit too, and the two categories size independently", () => {
  const budget = tightestChainInputBudget();
  const experts = Array.from({ length: 28 }, (_, i) => expertCandidate(i, 500 + (i % 5) * 400));
  const build = (batch: ReturnType<typeof expertCandidate>[]) =>
    buildExpertUserPrompt({
      tenderTitle: "Consultancy Services",
      tenderRequirementsText: REQUIREMENTS,
      evaluationMethodology: "M".repeat(3_000),
      candidates: batch as unknown as Parameters<typeof buildExpertUserPrompt>[0]["candidates"],
    });

  const batches = walkBatches(experts, build, budget);
  for (const batch of batches) {
    const tokens = estimateInputTokens(build(batch));
    assert.ok(tokens <= budget || batch.length === 1, `expert batch cost ${tokens} against ${budget}`);
  }
  // An expert entry costs more than a project entry, so expert batches are
  // smaller. A single shared constant could not have served both.
  assert.ok(batches[0].length <= MAX_CANDIDATES_PER_MATCHER_BATCH);
});

test("one candidate's contribution is bounded, so no single candidate can overflow", () => {
  // The builders slice summary and profile at 800 chars each, so a 200,000-char
  // record costs the same as a 900-char one. I expected an oversized candidate
  // to need a batch of its own; it cannot arise, which is the stronger
  // property — per-candidate cost has a ceiling regardless of vault data.
  const build = projectPrompt("Healthcare");
  const fixed = estimateInputTokens(build([]));
  const small = estimateInputTokens(build([projectCandidate(0, 400)])) - fixed;
  const huge = estimateInputTokens(build([projectCandidate(0, 200_000)])) - fixed;

  assert.ok(huge < small + 250, `a 200,000-char record costs ${huge} tokens vs ${small} for a small one`);
  assert.ok(huge < 400, `one candidate costs ${huge} tokens — the builder's slice is not bounding it`);
});

test("batching still progresses when fixed overhead alone nearly fills the budget", () => {
  // Requirements text is the fixed cost every batch pays. If it ever grew past
  // the budget, batching must still send one candidate at a time rather than
  // stall or drop candidates — a larger-budget provider later in the chain can
  // serve it, and refusing would remove those candidates from matching.
  const candidates = Array.from({ length: 5 }, (_, i) => projectCandidate(i, 400));
  const build = projectPrompt("Healthcare");
  const tinyBudget = estimateInputTokens(build([])) + 10;

  const batches = walkBatches(candidates, build, tinyBudget);
  assert.equal(batches.flat().length, 5, "candidates were dropped under a tight budget");
  for (const batch of batches) assert.equal(batch.length, 1, "batches should degrade to one candidate");
});

test("the budget is read from provider configuration, not hardcoded here", () => {
  const budget = tightestChainInputBudget();
  assert.ok(budget > 0 && Number.isFinite(budget));
  // Tightest in the chain, so it must be far below a large-context provider.
  assert.ok(budget < 100_000, `budget ${budget} looks like a large-context provider, not the tightest`);
  // And it must leave operating headroom rather than filling the hard limit.
  assert.ok(budget < 7_270, `budget ${budget} leaves no headroom below the hard limit`);
});

test("batchSizeForBudget never returns zero and respects the ceiling", () => {
  assert.equal(batchSizeForBudget({ fixedTokens: 9_000, perCandidateTokens: 100, budgetTokens: 7_000 }), 1);
  assert.equal(batchSizeForBudget({ fixedTokens: 0, perCandidateTokens: 1, budgetTokens: 1_000_000 }), MAX_CANDIDATES_PER_MATCHER_BATCH);
  assert.equal(batchSizeForBudget({ fixedTokens: 1_000, perCandidateTokens: 500, budgetTokens: 6_000 }), 10);
});

/**
 * The first fix here was verified against the wrong function.
 *
 * assessBatches was made budget-driven and tested, but the engine does not call
 * it: it calls aiRematchExperts and aiRematchProjects, and both still sliced by
 * a fixed 20. The exact head recorded the consequence in production —
 *
 *   [ai-multi-perspective-matcher] PROJECT batch failed: ... groq: Prompt
 *   exceeds the configured provider throughput budget (7358 input tokens).
 *   [ai-multi-perspective-matcher] EXPERT batch failed: ... (9097 input tokens).
 *
 * — against a 6,397-token budget, while the tests were green. The tests were
 * green because they exercised the driver nobody calls.
 *
 * The sizing also omitted the system prompt, which travels with every matcher
 * request and which preflight counts, so each batch was priced ~191 tokens
 * light.
 *
 * These assertions are written against the builders the two shipped functions
 * use, and price the request the way preflight does: user prompt PLUS system
 * prompt.
 */

import { readFileSync } from "node:fs";
import { estimateTotalInputTokens } from "../lib/ai-preflight";

/** The composed system prompt, read from source so it cannot drift from it. */
function matcherSystemPrompt(): string {
  const source = readFileSync(new URL("../lib/engine/ai-multi-perspective-matcher.ts", import.meta.url), "utf8");
  const literal = (name: string) => {
    const match = source.match(new RegExp(`const ${name}\\s*=\\s*\`([\\s\\S]*?)\`;`));
    assert.ok(match, `could not read ${name} from source`);
    return match[1];
  };
  return literal("SYSTEM_PROMPT")
    .replace("${PERSPECTIVE_SPEC}", literal("PERSPECTIVE_SPEC"))
    .replace("${JSON_SHAPE}", literal("JSON_SHAPE"));
}

/** Groq's real input allowance, derived the way lib/ai-preflight.ts derives it. */
const GROQ_TPM = 8_000;
const GROQ_HARD_INPUT_LIMIT = GROQ_TPM - 512 - Math.max(128, Math.ceil(GROQ_TPM * 0.05));

test("the batching the engine actually calls prices the system prompt too", () => {
  const system = matcherSystemPrompt();
  const budget = tightestChainInputBudget();
  const reserved = budget - estimateInputTokens(system);
  assert.ok(reserved > 0, "the system prompt alone must not exhaust the chain budget");

  // Candidates shaped like the owner's vault: profiles and summaries are
  // truncated by the builders, so size varies but is bounded.
  const experts = Array.from({ length: 28 }, (_, i) => ({
    id: `e${i}`,
    fullName: `Expert ${i}`,
    title: "Senior Engineer",
    yearsExperience: 10 + (i % 15),
    disciplines: ["Architecture", "Structural Engineering"],
    sectors: ["Health"],
    certifications: ["ECAE Grade 1"],
    profile: "p".repeat(400 + ((i * 97) % 1_200)),
    trustLevel: "SOURCE_VERIFIED" as const,
  }));
  const projects = Array.from({ length: 114 }, (_, i) => ({
    id: `p${i}`,
    name: `Project ${i}`,
    clientName: `Client ${i}`,
    country: "Ethiopia",
    sector: "Health",
    serviceAreas: [] as string[],
    contractValue: null,
    currency: null,
    startDate: null,
    endDate: null,
    summary: "s".repeat(300 + ((i * 131) % 1_500)),
    trustLevel: "SOURCE_VERIFIED" as const,
  }));

  const cases: ReadonlyArray<{ label: string; candidates: unknown[]; build: (batch: never[]) => string }> = [
    {
      label: "EXPERT",
      candidates: experts,
      build: ((batch: typeof experts) => buildExpertUserPrompt({
        tenderTitle: "Architectural Consultancy Services for a Specialty Medical Center",
        tenderRequirementsText: "R".repeat(12_000),
        evaluationMethodology: "M".repeat(3_000),
        candidates: batch,
      })) as never,
    },
    {
      label: "PROJECT",
      candidates: projects,
      build: ((batch: typeof projects) => buildProjectUserPrompt({
        tenderTitle: "Architectural Consultancy Services for a Specialty Medical Center",
        tenderRequirementsText: "R".repeat(12_000),
        tenderCategory: "Healthcare",
        candidates: batch,
      })) as never,
    },
  ];

  for (const { label, candidates, build } of cases) {
    const buildPrompt = build as unknown as (batch: unknown[]) => string;
    const fixedTokens = estimateInputTokens(buildPrompt([]));
    const perCandidateTokens = Math.max(1, estimateInputTokens(buildPrompt(candidates.slice(0, 1))) - fixedTokens);

    let index = 0;
    let batches = 0;
    let worst = 0;
    while (index < candidates.length) {
      const batch = largestFittingBatch(candidates.slice(index), buildPrompt, reserved, {
        fixedTokens,
        perCandidateTokens,
      });
      assert.ok(batch.length > 0, `${label} batching stalled`);
      // Priced exactly as preflight prices it.
      worst = Math.max(worst, estimateTotalInputTokens(buildPrompt(batch), system));
      index += batch.length;
      batches += 1;
      assert.ok(batches < 500, `${label} batching did not terminate`);
    }
    assert.ok(
      worst <= GROQ_HARD_INPUT_LIMIT,
      `${label} worst batch is ${worst} tokens, over Groq's ${GROQ_HARD_INPUT_LIMIT}-token input limit`,
    );
  }
});

test("no matcher batch loop strides by a fixed candidate count", () => {
  const source = readFileSync(new URL("../lib/engine/ai-multi-perspective-matcher.ts", import.meta.url), "utf8");
  // The exact shape of the shipped defect: a loop advancing by the constant
  // rather than by however many candidates actually fitted.
  const stride = /\+=\s*MAX_CANDIDATES_PER_MATCHER_BATCH/g;
  const found = source.match(stride) ?? [];
  assert.equal(
    found.length,
    0,
    `${found.length} batch loop(s) still advance by MAX_CANDIDATES_PER_MATCHER_BATCH instead of by what fitted`,
  );
});
