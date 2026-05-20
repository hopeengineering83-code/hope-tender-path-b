/**
 * Deep-reasoning critic-rewriter refinement.
 *
 * Replaces the single-pass `refineProposalWithAI` with a two-step
 * cognitive loop, modelled on how senior bid reviewers actually
 * improve a draft:
 *
 *   STEP 1 — CRITIQUE. Claude reads the draft + weak axes + extracted
 *            evaluation criteria and produces a STRUCTURED critique:
 *            named defects with locations, cited evidence, proposed
 *            fixes. The critique is a free-standing artifact (saved
 *            for diagnostics).
 *
 *   STEP 2 — REWRITE. A second Claude call takes the critique and the
 *            draft, applies every defect's proposed fix, and emits the
 *            revised proposal markdown.
 *
 * Iteration:
 *   – Runs up to `maxIterations` times (default 2).
 *   – Each iteration scores the revised output; if the score lifts by
 *     < 2 points OR the score crosses the threshold OR the AI returns
 *     thin output, the loop exits.
 *   – Tracks a `refinementHistory` log of (axis, before, after, lift)
 *     tuples — this is the "failure-mode memory" the gap analysis
 *     called out as missing in the legacy refiner. Future iterations
 *     see the prior history and avoid repeating the same failed
 *     instructions.
 *
 * Returns the FINAL revised markdown (already cleaned through
 * cleanClientLanguage by the caller), the cumulative critique log
 * (for `GeneratedDocument.contentSummary`), and the final quality
 * score. Returns null if every attempt failed or AI is not
 * configured — caller falls back to the original markdown.
 */

import { critiqueProposalWithAI, critiqueProposalWithTools, rewriteProposalWithCritique } from "../ai";
import { formatComprehensionForPrompt, type DeepTenderComprehension } from "./evaluation-criteria-extractor";
import { formatConstraintsForCritique, formatViolationsForCritique, validateConstraints, violationsAsWeakAxes } from "./constraint-validator";
import { executeProposalTool, PROPOSAL_TOOL_DEFS, type ToolEvidenceInventory } from "./proposal-tools";
import type { QualityScore } from "./proposal-quality-scorer";

export type DeepRefinementInput = {
  initialMarkdown: string;
  initialScore: QualityScore;
  scoreMarkdown: (markdown: string) => QualityScore;
  cleanMarkdown: (markdown: string) => string;
  tenderTitle: string;
  clientName: string;
  primarySector: string;
  topProjectNames: string[];
  topExpertNames: string[];
  comprehension?: DeepTenderComprehension | null;
  noFinancial?: boolean;
  /** Score at which iteration stops early. Default 90. */
  scoreThreshold?: number;
  /** Maximum critique → rewrite iterations. Default 2. */
  maxIterations?: number;
  /** Minimum point lift between iterations. Stops early when an iteration lifts by less than this. Default 2. */
  minLiftToContinue?: number;
  /**
   * Optional evidence inventory passed through to the tool-using
   * critic (gap #10). When supplied, the critic gets Anthropic
   * tool_use access to `search_company_knowledge`, `inspect_expert`,
   * `inspect_project` so it can verify claims and find missing
   * evidence mid-critique instead of relying solely on the static
   * prompt blob. Falls back to the tool-less critic on any error.
   */
  toolEvidence?: ToolEvidenceInventory | null;
};

export type DeepRefinementAttempt = {
  iteration: number;
  scoreBefore: number;
  weakAxesBefore: string[];
  scoreAfter: number;
  weakAxesAfter: string[];
  lift: number;
  status: "applied" | "rejected-low-score" | "rejected-thin-output" | "ai-error" | "critique-failed";
  critiqueLength: number;
};

export type DeepRefinementResult = {
  markdown: string;
  finalScore: QualityScore;
  attempts: DeepRefinementAttempt[];
  /** Concatenated critique markdown across all applied iterations. Useful for diagnostics. */
  critiqueLog: string;
};

const DEFAULT_SCORE_THRESHOLD = 90;
const DEFAULT_MAX_ITERATIONS = 2;
const DEFAULT_MIN_LIFT = 2;
/** A rewrite must retain at least 70% of the original length, matching the legacy refiner's heuristic. */
const MIN_OUTPUT_RATIO = 0.7;

/**
 * Build a short text block summarising what was tried in prior
 * iterations. Injected into the next critique prompt so Claude knows
 * what NOT to repeat. Empty string when there's no history.
 */
function buildHistoryHint(attempts: DeepRefinementAttempt[]): string {
  if (attempts.length === 0) return "";
  const applied = attempts.filter((a) => a.status === "applied");
  if (applied.length === 0) return "";
  const lines = applied.map((a) => {
    const fixed = a.weakAxesBefore.filter((axis) => !a.weakAxesAfter.includes(axis));
    const residual = a.weakAxesAfter.filter((axis) => a.weakAxesBefore.includes(axis));
    const fixedNote = fixed.length > 0 ? `Fixed: ${fixed.join(", ")}` : "Fixed none";
    const residualNote = residual.length > 0 ? `Still weak: ${residual.join(", ")}` : "No residual weaknesses from this attempt";
    return `- Iteration ${a.iteration}: score ${a.scoreBefore} → ${a.scoreAfter} (lift +${a.lift}). ${fixedNote}. ${residualNote}.`;
  });
  return `\n## Refinement history (do not repeat instructions that failed)\n\n${lines.join("\n")}\n`;
}

/**
 * Orchestrate the critique → rewrite loop. Pure orchestration; the
 * actual AI calls live in `lib/ai.ts`. This module is the policy:
 * when to call which step, how to score, when to stop.
 */
export async function runDeepRefinement(input: DeepRefinementInput): Promise<DeepRefinementResult | null> {
  const scoreThreshold = input.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const maxIterations = Math.max(1, input.maxIterations ?? DEFAULT_MAX_ITERATIONS);
  const minLift = input.minLiftToContinue ?? DEFAULT_MIN_LIFT;

  // No-op when the input is already at threshold — caller likely
  // gated on `initialScore.total < threshold` but defend anyway.
  if (input.initialScore.total >= scoreThreshold || input.initialScore.weakAxes.length === 0) {
    return null;
  }

  const comprehensionBlock = input.comprehension && input.comprehension.criteria.length > 0
    ? formatComprehensionForPrompt(input.comprehension)
    : null;
  // Constraint checklist is independent of criteria: present when the
  // comprehension found any prohibition or disqualifier, even if no
  // weighted criteria were extracted.
  const constraintsChecklist = formatConstraintsForCritique(input.comprehension ?? null);

  let workingMarkdown = input.initialMarkdown;
  let workingScore = input.initialScore;
  const attempts: DeepRefinementAttempt[] = [];
  const critiqueChunks: string[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    // Constraint sweep BEFORE the per-iteration threshold check —
    // violations may justify continued refinement even when the
    // quality score has already crossed the threshold.
    const constraintResult = validateConstraints(input.comprehension ?? null, workingMarkdown);
    const violationsBlock = formatViolationsForCritique(constraintResult);
    const constraintAxes = violationsAsWeakAxes(constraintResult);
    // Synthesise an augmented weak-axes list that includes any
    // constraint violations the deterministic sweep found.
    const effectiveWeakAxes = Array.from(new Set([...workingScore.weakAxes, ...constraintAxes]));

    if (workingScore.total >= scoreThreshold && constraintResult.violations.length === 0) break;
    if (effectiveWeakAxes.length === 0) break;

    const axisScores: Record<string, number> = {
      ...workingScore.axes,
    };
    // Surface constraint axes with score 0 so the critic understands
    // their severity.
    for (const axis of constraintAxes) {
      axisScores[axis] = 0;
    }

    // Compose the full critic context block: history hint + criteria
    // comprehension + constraint checklist + detected violations. Any
    // subset may be empty; we join the non-empty parts.
    const contextBlocks = [
      comprehensionBlock,
      constraintsChecklist,
      violationsBlock,
      buildHistoryHint(attempts),
    ].filter((b): b is string => Boolean(b && b.trim().length > 0));
    const fullContext = contextBlocks.length > 0 ? contextBlocks.join("\n\n") : null;

    const critiqueInput = {
      currentMarkdown: workingMarkdown,
      weakAxes: effectiveWeakAxes,
      axisScores,
      tenderTitle: input.tenderTitle,
      clientName: input.clientName,
      primarySector: input.primarySector,
      topProjectNames: input.topProjectNames,
      topExpertNames: input.topExpertNames,
      comprehensionBlock: fullContext,
    };

    let critique: string | null = null;
    try {
      // Gap #10: when an evidence inventory is supplied, try the
      // tool-using critic first — it can call search/inspect tools
      // to verify claims and find missing evidence mid-critique.
      // Falls through to the tool-less critic on null (Claude
      // unavailable, tool-loop exhausted, etc.).
      if (input.toolEvidence) {
        critique = await critiqueProposalWithTools(
          critiqueInput,
          PROPOSAL_TOOL_DEFS,
          (toolName, toolInput) => executeProposalTool(toolName, toolInput, input.toolEvidence!),
        );
      }
      if (!critique || critique.trim().length < 50) {
        critique = await critiqueProposalWithAI(critiqueInput);
      }
    } catch (err) {
      console.warn(`[deep-reasoning-refiner] Critique iteration ${iteration} threw: ${err instanceof Error ? err.message : String(err)}`);
      attempts.push({
        iteration,
        scoreBefore: workingScore.total,
        weakAxesBefore: effectiveWeakAxes,
        scoreAfter: workingScore.total,
        weakAxesAfter: effectiveWeakAxes,
        lift: 0,
        status: "ai-error",
        critiqueLength: 0,
      });
      break;
    }

    if (!critique || critique.trim().length < 50) {
      attempts.push({
        iteration,
        scoreBefore: workingScore.total,
        weakAxesBefore: effectiveWeakAxes,
        scoreAfter: workingScore.total,
        weakAxesAfter: effectiveWeakAxes,
        lift: 0,
        status: "critique-failed",
        critiqueLength: critique?.length ?? 0,
      });
      console.info(`[deep-reasoning-refiner] Iteration ${iteration}: critique pass returned empty or thin output (${critique?.length ?? 0} chars). Stopping.`);
      break;
    }

    let rewritten: string | null = null;
    try {
      rewritten = await rewriteProposalWithCritique({
        currentMarkdown: workingMarkdown,
        critique,
        tenderTitle: input.tenderTitle,
        clientName: input.clientName,
        primarySector: input.primarySector,
        topProjectNames: input.topProjectNames,
        topExpertNames: input.topExpertNames,
        noFinancial: input.noFinancial === true,
      });
    } catch (err) {
      console.warn(`[deep-reasoning-refiner] Rewrite iteration ${iteration} threw: ${err instanceof Error ? err.message : String(err)}`);
      attempts.push({
        iteration,
        scoreBefore: workingScore.total,
        weakAxesBefore: effectiveWeakAxes,
        scoreAfter: workingScore.total,
        weakAxesAfter: effectiveWeakAxes,
        lift: 0,
        status: "ai-error",
        critiqueLength: critique.length,
      });
      break;
    }

    if (!rewritten || rewritten.trim().length < workingMarkdown.length * MIN_OUTPUT_RATIO) {
      attempts.push({
        iteration,
        scoreBefore: workingScore.total,
        weakAxesBefore: effectiveWeakAxes,
        scoreAfter: workingScore.total,
        weakAxesAfter: effectiveWeakAxes,
        lift: 0,
        status: "rejected-thin-output",
        critiqueLength: critique.length,
      });
      console.warn(`[deep-reasoning-refiner] Iteration ${iteration}: rewrite returned thin output (${rewritten?.length ?? 0} chars vs ${workingMarkdown.length}). Discarding.`);
      break;
    }

    const cleaned = input.cleanMarkdown(rewritten);
    const newScore = input.scoreMarkdown(cleaned);
    const lift = newScore.total - workingScore.total;

    // After the rewrite, recompute the effective weak-axes set
    // including any residual constraint violations.
    const postConstraintAxes = violationsAsWeakAxes(validateConstraints(input.comprehension ?? null, cleaned));
    const effectiveWeakAxesAfter = Array.from(new Set([...newScore.weakAxes, ...postConstraintAxes]));

    if (lift <= 0) {
      attempts.push({
        iteration,
        scoreBefore: workingScore.total,
        weakAxesBefore: effectiveWeakAxes,
        scoreAfter: newScore.total,
        weakAxesAfter: effectiveWeakAxesAfter,
        lift,
        status: "rejected-low-score",
        critiqueLength: critique.length,
      });
      console.info(`[deep-reasoning-refiner] Iteration ${iteration}: rewrite did not improve score (${workingScore.total} → ${newScore.total}). Discarding.`);
      break;
    }

    workingMarkdown = cleaned;
    workingScore = newScore;
    critiqueChunks.push(`### Iteration ${iteration} critique\n\n${critique.trim()}`);
    attempts.push({
      iteration,
      scoreBefore: workingScore.total - lift,
      weakAxesBefore: effectiveWeakAxes,
      scoreAfter: workingScore.total,
      weakAxesAfter: effectiveWeakAxesAfter,
      lift,
      status: "applied",
      critiqueLength: critique.length,
    });
    console.info(`[deep-reasoning-refiner] Iteration ${iteration}/${maxIterations}: ${workingScore.total - lift} → ${workingScore.total} (+${lift}). Weak axes remaining: ${effectiveWeakAxesAfter.length} (constraints: ${postConstraintAxes.length}).`);

    if (workingScore.total >= scoreThreshold) {
      console.info(`[deep-reasoning-refiner] Iteration ${iteration}: hit score threshold ${scoreThreshold}. Stopping.`);
      break;
    }
    if (lift < minLift) {
      console.info(`[deep-reasoning-refiner] Iteration ${iteration}: lift ${lift} < ${minLift} — diminishing returns. Stopping.`);
      break;
    }
  }

  const applied = attempts.filter((a) => a.status === "applied");
  if (applied.length === 0) {
    // No iteration produced an improvement — caller keeps the original.
    return null;
  }

  return {
    markdown: workingMarkdown,
    finalScore: workingScore,
    attempts,
    critiqueLog: critiqueChunks.join("\n\n"),
  };
}

/**
 * Pure utility exposed for tests — exercise the policy without
 * running real AI calls.
 */
export const __testing__ = { buildHistoryHint };
