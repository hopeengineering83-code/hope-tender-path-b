import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getProposalRuntimeProfile,
  resolveProposalExecutionBudget,
  PROPOSAL_EXECUTION_CEILING_SECONDS,
} from "../lib/ai-runtime-capability";

/**
 * THE DEFECT.
 * -----------
 * 2026-09-20, inspect run 35532974557, verbatim:
 *
 *   'Technical Proposal.pdf'
 *     mode='deterministic benchmark fallback + ...'
 *     FELL BACK BECAUSE: AI proposal timed out after 45 seconds
 *                        (in-pipeline guard before Vercel function timeout)
 *
 * and, from the live provider sweep minutes later:
 *
 *   ELIGIBLE NOW: ['gemini', 'groq', 'zai']
 *   gemini GENERATION_VERIFIED   groq GENERATION_VERIFIED   zai GENERATION_VERIFIED
 *
 * Three providers were verified FOR GENERATION and eligible to route. The
 * writer had everything it needed and ran out of wall clock — so the
 * deterministic fallback was code-controlled, not a provider or credit
 * condition. Successive sessions had attributed it to provider credit.
 *
 * WHY 45s. PROPOSAL_AI_TIMEOUT_MS returned 45_000 under ANTHROPIC_TIER=1 and
 * 220_000 otherwise, and generate-elite documented the 45s as sized for
 * "Vercel Hobby 60s". But proposal generation is a durable PROPOSAL_GENERATION
 * AiJob run by app/api/ai-jobs/run-next (maxDuration 300), not the 60s
 * synchronous route — and the same run measured ENGINE_RUN at 99 seconds and
 * PROPOSAL_GENERATION at 69, both past 60. A 60s-route budget was being spent
 * inside a 300s worker, and a module-level constant could not tell the two
 * apart.
 *
 * THE RULE PINNED HERE: the budget belongs to the execution context, and is
 * derived from that context's platform ceiling — never from ANTHROPIC_TIER,
 * which is an Anthropic account property (rate limits, output tokens) and says
 * nothing about how long a runtime may run.
 *
 * Both directions matter. Starving the worker loses the model; letting the
 * synchronous route inherit the worker's budget would overrun its own 60s
 * ceiling and trade a clean in-pipeline fallback for a hard platform kill.
 */

const ENV_KEYS = ["ANTHROPIC_TIER", "AI_PROPOSAL_TIMEOUT_MS", "ANTHROPIC_MAX_OUTPUT_TOKENS", "AI_PROPOSAL_LONG_ROUTE_ENABLED"] as const;

function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void) {
  const previous = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
  try { fn(); } finally {
    for (const k of ENV_KEYS) {
      const v = previous[k];
      if (v === undefined) delete process.env[k]; else process.env[k] = v as string;
    }
  }
}

describe("a generation budget belongs to its execution context", () => {
  it("the durable worker does NOT inherit the 45s synchronous/Tier-1 budget", () => {
    // The exact failing configuration: Tier 1 set, running in the worker.
    withEnv({ ANTHROPIC_TIER: "1" }, () => {
      const budget = resolveProposalExecutionBudget("durable-worker");
      assert.equal(budget.ceilingSeconds, 300);
      assert.ok(
        budget.budgetMs > 45_000,
        `the worker was given ${budget.budgetMs}ms — the 45s route figure again`,
      );
      assert.equal(budget.budgetMs, 220_000, "300s ceiling minus the 80s post-work reserve");
    });
  });

  it("the synchronous route cannot accidentally inherit the long worker budget", () => {
    for (const tier of ["1", "2", "3", ""]) {
      withEnv(tier ? { ANTHROPIC_TIER: tier } : {}, () => {
        const budget = resolveProposalExecutionBudget("sync-route");
        assert.equal(budget.ceilingSeconds, 60);
        assert.equal(budget.budgetMs, 45_000, `tier=${tier || "unset"} gave the route ${budget.budgetMs}ms`);
        assert.ok(
          budget.budgetMs < PROPOSAL_EXECUTION_CEILING_SECONDS["sync-route"] * 1_000,
          "the route budget must stay strictly under its own platform ceiling",
        );
      });
    }
  });

  it("an explicit override may lower a budget but never raise it past the ceiling", () => {
    withEnv({ AI_PROPOSAL_TIMEOUT_MS: "600000" }, () => {
      assert.equal(resolveProposalExecutionBudget("sync-route").budgetMs, 45_000);
      assert.equal(resolveProposalExecutionBudget("durable-worker").budgetMs, 220_000);
    });
    withEnv({ AI_PROPOSAL_TIMEOUT_MS: "30000" }, () => {
      assert.equal(resolveProposalExecutionBudget("sync-route").budgetMs, 30_000, "an operator may lower it");
      assert.equal(resolveProposalExecutionBudget("durable-worker").budgetMs, 30_000);
    });
  });

  it("the Anthropic account tier no longer decides the wall clock", () => {
    const perTier = ["1", "2", "3", "4"].map((tier) =>
      withEnvValue({ ANTHROPIC_TIER: tier }, () => resolveProposalExecutionBudget("durable-worker").budgetMs));
    assert.equal(new Set(perTier).size, 1, `tier changed the worker budget: ${perTier.join(", ")}`);
  });

  it("every context leaves a real post-model reserve under its ceiling", () => {
    for (const context of ["sync-route", "durable-worker"] as const) {
      const budget = resolveProposalExecutionBudget(context);
      const ceilingMs = budget.ceilingSeconds * 1_000;
      assert.ok(budget.budgetMs < ceilingMs, `${context}: no reserve at all`);
      assert.ok(
        ceilingMs - budget.budgetMs >= 15_000,
        `${context}: only ${(ceilingMs - budget.budgetMs) / 1000}s left for enrichers, DOCX, PDF and persistence`,
      );
    }
  });

  it("the declared ceilings match the route files they are copied from", () => {
    // Next.js needs maxDuration to be a literal in the route module, so the
    // numbers are duplicated. This is the guard against silent drift.
    const sync = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    const worker = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
    const syncMax = Number(sync.match(/export const maxDuration\s*=\s*(\d+)/)?.[1]);
    const workerMax = Number(worker.match(/export const maxDuration\s*=\s*(\d+)/)?.[1]);
    assert.equal(syncMax, PROPOSAL_EXECUTION_CEILING_SECONDS["sync-route"]);
    assert.equal(workerMax, PROPOSAL_EXECUTION_CEILING_SECONDS["durable-worker"]);
  });

  it("each call site declares the context it actually runs in", () => {
    const worker = readFileSync("lib/ai-job-handlers-legacy.ts", "utf8");
    const route = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    assert.match(worker, /generateTenderDocuments\([^)]*execution:\s*"durable-worker"/s);
    assert.match(route, /generateTenderDocuments\([^)]*execution:\s*"sync-route"/s);
  });

  it("a genuine timeout still names the budget and the context so it is not misread as a provider failure", () => {
    const src = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.match(src, /AI proposal timed out after/);
    for (const field of ["context=", "ceiling=", "reserve=", "budget=", "requested=", "elapsed="]) {
      assert.ok(src.includes(field), `the timeout message omits ${field}`);
    }
    // And the deterministic fallback must remain reachable for real failures.
    assert.match(src, /fallbackProposalMarkdown\(/);
  });

  it("the profile still reports what configuration asked for, separately from what it may spend", () => {
    withEnv({ ANTHROPIC_TIER: "2" }, () => {
      const profile = getProposalRuntimeProfile(60);
      assert.equal(profile.proposalAiTimeoutMs, 220_000, "advisory request is unchanged");
      assert.equal(profile.effectiveProposalBudgetMs, 45_000, "but a 60s context may only spend 45s");
      assert.ok(profile.warnings.some((w) => w.includes("exceeds safe route budget")));
    });
  });
});

function withEnvValue<T>(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => T): T {
  let out!: T;
  withEnv(values, () => { out = fn(); });
  return out;
}
