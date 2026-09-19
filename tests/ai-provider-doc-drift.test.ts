import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const catalog = require("../lib/ai-provider-catalog.cjs") as {
  CANONICAL_AI_PROVIDER_ORDER: readonly string[];
};

// ─── What this file proves ───────────────────────────────────────────────────
//
// The provider order was written down in a dozen places, and the copies
// disagreed. `.env.example`, `README.md`, `docs/ai-provider-order.md` and
// `docs/ai-provider-runbook.md` all told an operator that Z.ai was first, that
// the outbound attempt budget defaulted to 3, and that OpenRouter models had to
// end in `:free`. None of that was true of the code they were describing: the
// catalog leads with Gemini, the budget defaults to 10, and no `:free` rule
// exists anywhere in the registry.
//
// Docs cannot derive their prose from the catalog, so the CHECK derives instead.
// Every assertion below is computed from lib/ai-provider-catalog.cjs, so the
// next time the order changes these tests fail until the operator instructions
// are brought along with it.
//
// Deliberately NOT covered: historical audits and dated session logs under
// docs/audits/ and docs/*AUDIT*, which record the withdrawn policy as evidence
// of what was once true. Rewriting those would destroy the record.

/** The one authority. Every expectation below is derived from it. */
const ORDER = [...catalog.CANONICAL_AI_PROVIDER_ORDER];

/** Operator-facing display names, in canonical order. */
const DISPLAY: Record<string, string> = {
  gemini: "Gemini",
  groq: "Groq",
  mistral: "Mistral",
  zai: "Z.ai",
  cerebras: "Cerebras",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  together: "Together",
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
};

/** Active operator instruction. Historical audits are intentionally absent. */
const ACTIVE_SURFACES = [
  ".env.example",
  "README.md",
  "docs/ai-provider-order.md",
  "docs/ai-provider-runbook.md",
  "docs/FINAL_RELEASE_ACCEPTANCE_CHECKLIST.md",
  "scripts/check-env.mjs",
  "scripts/reconcile-gap-closure.mjs",
  "operator_handoff.md",
];

/**
 * The handoff's Session Log is dated historical evidence and legitimately
 * records the withdrawn policy as it stood. Only the active half above it is
 * current instruction, so only that half is checked.
 */
function read(path: string): string {
  const text = readFileSync(path, "utf8");
  if (path !== "operator_handoff.md") return text;
  const sessionLog = text.indexOf("\n## Session Log");
  return sessionLog === -1 ? text : text.slice(0, sessionLog);
}

/**
 * Resolve one arrow-separated segment to a provider, but only when the segment
 * IS the provider name rather than merely mentioning it. Without this, a
 * sentence that ends "...and no OpenRouter `:free` requirement" after the chain
 * reads as an eleventh chain entry.
 */
function segmentProvider(segment: string): string | null {
  const cleaned = segment.replace(/[`*]/g, "").trim();
  if (cleaned.length > 30) return null;
  for (const [key, display] of Object.entries(DISPLAY)) {
    if (new RegExp(`^${display}\\b`, "i").test(cleaned)) return key;
  }
  return null;
}

/** Provider names in the order they appear in an arrow chain on one line. */
function arrowChains(text: string): string[][] {
  const chains: string[][] = [];
  for (const line of text.split("\n")) {
    if (!line.includes("→")) continue;
    const names = line
      .split("→")
      .map(segmentProvider)
      .filter((name): name is string => Boolean(name));
    if (names.length >= 4) chains.push(names);
  }
  return chains;
}

/**
 * A line that NAMES a withdrawn policy in order to deny it is the fix, not the
 * defect. Only assertions count.
 */
const NEGATION = /\b(no longer|withdrawn|stale|retired|there is no|does not|do not|is not|are not|never|no free-only|no minimum|no exclusion|not required|no OpenRouter|keep that withdrawn)\b/i;

function assertingLines(text: string, pattern: RegExp): string[] {
  return text
    .split("\n")
    .filter((line) => pattern.test(line) && !NEGATION.test(line));
}

describe("active operator instructions match the canonical provider order", () => {
  for (const path of ACTIVE_SURFACES) {
    it(`${path} contains no arrow chain that contradicts the catalog`, () => {
      for (const chain of arrowChains(read(path))) {
        // A chain may be a prefix or a subset, but the providers it does name
        // must appear in canonical relative order.
        const positions = chain.map((name) => ORDER.indexOf(name));
        const sorted = [...positions].sort((a, b) => a - b);
        assert.deepEqual(
          positions,
          sorted,
          `${path} lists providers as ${chain.join(" → ")}, which is not canonical order (${ORDER.join(" → ")})`,
        );
      }
    });

    it(`${path} does not claim Z.ai leads the chain`, () => {
      for (const line of assertingLines(read(path), /Z\.?ai[^\n]{0,40}\bis first\b/i)) {
        assert.fail(`${path} still claims Z.ai is first: ${line.trim()}`);
      }
    });
  }
});

describe("withdrawn provider policies are gone from active instructions", () => {
  const WITHDRAWN: Array<{ label: string; pattern: RegExp }> = [
    // The registry has no :free rule. Claiming one sends an operator hunting
    // for a configuration error that does not exist.
    { label: "OpenRouter must use a ':free' model", pattern: /must (?:end in|be an explicit)[^\n]{0,40}:free/i },
    { label: "non-':free' models are rejected", pattern: /non-`?':?free'?`?[^\n]{0,30}(?:are|is) (?:rejected|REJECTED)/i },
    { label: "zero-paid-only routing", pattern: /zero[- ]paid/i },
    { label: "two free providers are required", pattern: /two free providers/i },
    { label: "paid providers are excluded from automatic routing", pattern: /paid[- ]access provider[^\n]{0,60}(?:excluded|never automatically)/i },
  ];

  for (const path of ACTIVE_SURFACES) {
    for (const { label, pattern } of WITHDRAWN) {
      it(`${path} no longer states: ${label}`, () => {
        const offenders = assertingLines(read(path), pattern);
        assert.deepEqual(
          offenders.map((line) => line.trim()),
          [],
          `${path} still carries the withdrawn claim: ${label}`,
        );
      });
    }
  }
});

describe("the documented attempt budget matches the source default", () => {
  it("lib/ai.ts still defaults to the full chain length", () => {
    const source = read("lib/ai.ts");
    const match = source.match(/MAX_PROVIDER_ATTEMPTS_PER_REQUEST[\s\S]{0,400}?return (\d+);/);
    assert.ok(match, "could not read the attempt-budget default from lib/ai.ts");
    assert.equal(
      Number(match[1]),
      ORDER.length,
      "the default budget should be the whole canonical chain, so exhaustion means a real outage",
    );
  });

  for (const path of [".env.example", "README.md", "docs/ai-provider-order.md", "docs/ai-provider-runbook.md"]) {
    it(`${path} does not state the retired default of 3 attempts`, () => {
      const text = read(path);
      assert.doesNotMatch(text, /AI_MAX_PROVIDER_ATTEMPTS["`\s,(]*default[`\s]*`?3`?/i);
      assert.doesNotMatch(text, /(?:maximum of|at most|Max)\s+\**3\**\s+(?:ACTUAL|actual)?\s*outbound provider attempts/i);
    });
  }
});

describe("the numbered chain in docs/ai-provider-order.md is the catalog", () => {
  it("lists all ten providers in canonical order", () => {
    const text = read("docs/ai-provider-order.md");
    const listed: string[] = [];
    for (const line of text.split("\n")) {
      const match = line.match(/^(\d+)\.\s+(.*)$/);
      if (!match) continue;
      const key = Object.keys(DISPLAY).find((name) => new RegExp(`\\(\`${name}\`\\)`).test(match[2]));
      if (key) listed.push(key);
    }
    assert.deepEqual(listed, ORDER);
  });
});
