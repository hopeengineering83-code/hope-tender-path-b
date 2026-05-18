# Deep-reasoning mode (`TENDER_DEEP_REASONING`)

A set of Claude-driven capabilities that bring the proposal engine closer to interactive Claude.ai quality. Every capability is gated behind a single env var (`TENDER_DEEP_REASONING`) and is additive — when the flag is unset, the engine behaves identically to the legacy pipeline.

## Contents

1. [What it adds](#what-it-adds)
2. [How to enable](#how-to-enable)
3. [Cost model](#cost-model)
4. [Per-tender flow](#per-tender-flow)
5. [Per-module reference](#per-module-reference)
6. [Diagnostics](#diagnostics)
7. [Troubleshooting](#troubleshooting)

---

## What it adds

| Capability | Replaces / augments | Source |
|---|---|---|
| **Semantic tender comprehension** | Regex-only requirement priority inference | [`evaluation-criteria-extractor.ts`](../lib/engine/evaluation-criteria-extractor.ts) |
| **Semantic match-to-criteria alignment** | Lexical match scores without rationale | [`semantic-match-aligner.ts`](../lib/engine/semantic-match-aligner.ts) |
| **Constraint / prohibition validator** | No constraint reasoning beyond presence/absence flags | [`constraint-validator.ts`](../lib/engine/constraint-validator.ts) |
| **Critic-rewriter refinement** | Single-pass `refineProposalWithAI` | [`deep-reasoning-refiner.ts`](../lib/engine/deep-reasoning-refiner.ts) |
| **Tool-use during critique** | Static context blob, no mid-write search | [`proposal-tools.ts`](../lib/engine/proposal-tools.ts) + [`generateWithClaudeTools` in `ai.ts`](../lib/ai.ts) |

Two additional improvements ship unconditionally (not behind the flag) because they have no AI cost and only tighten existing behaviour:

- **Depth-weighted scoring axes** — `structureCompleteness` weights each section by body depth (filler counts 0; <60 chars counts 0; <200 chars counts 0.5; <600 chars counts 0.85; ≥600 counts 1.0). `tableCoverage` only counts rows where ≥2 cells carry non-filler content.
- **Per-persona slicing in the evaluator simulator** — each persona reads only the proposal sections relevant to their domain instead of the full markdown.

---

## How to enable

Set the env var in your deployment environment:

```bash
TENDER_DEEP_REASONING=true
```

Accepted truthy values: `"1"`, `"true"`, `"yes"`, `"on"` (case-insensitive). Anything else (including unset) is OFF.

**Recommended combinations:**

| Vercel plan | Anthropic tier | Recommendation |
|---|---|---|
| Hobby (60s function timeout) | Tier 1 / 2 | **Leave OFF.** Critique + rewrite ≈ 30–60 s; combined with the first generation call this routinely exceeds 60 s. |
| Pro (300s function timeout) | Tier 1 | Leave OFF or run carefully with `MAX_REFINEMENT_ATTEMPTS=1`. |
| Pro (300s) | Tier 2+ | **Recommended ON.** Comfortable budget. |
| Enterprise + Tier 3+ | — | **Recommended ON.** |

---

## Cost model

Each refinement iteration adds two Claude calls (critique + rewrite). One iteration is the default; `MAX_REFINEMENT_ATTEMPTS` can raise it. Per-tender Claude call breakdown when the flag is ON:

| Step | Calls | When it runs |
|---|---|---|
| Semantic tender comprehension | 1 | Once per generation |
| Match-to-criteria alignment | 1 | Once per generation, only if comprehension found criteria |
| Generation (parallel or single) | 1 or 4 | Unchanged from legacy |
| Critique | 1–2 | Per refinement iteration, when quality score < threshold |
| Rewrite | 1–2 | Per refinement iteration |
| **Total (typical)** | **5–9 Claude calls** | vs 1–5 calls on the legacy path |

The critic-with-tools path may add 1–5 extra internal turns per critique call (capped at `MAX_TOOL_TURNS = 6`).

If cost is a concern, leave the flag OFF in development and turn it on selectively for high-stakes tenders.

---

## Per-tender flow

```
┌──────────────────────────────────────────────────────────────────┐
│  Tender intake (uploads, AI analysis, matching, compliance)      │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
                ┌────────────────────────────┐
                │  generate-elite.ts entry   │
                └────────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────┐
        │ [flag ON] extractDeepTenderComprehension   │
        │ Claude reads tender → structured criteria, │
        │ disqualifiers, prohibitions (JSON)         │
        └────────────────────────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────┐
        │ [flag ON] alignMatchesToEvaluatorCriteria  │
        │ Claude scores each expert × project        │
        │ against each criterion (0–10 + rationale)  │
        └────────────────────────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────┐
        │  Build aiInput with comprehension block +  │
        │  alignment block injected into prompt      │
        └────────────────────────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────┐
        │  Generation (Claude / Gemini / GPT-4o)     │
        └────────────────────────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────┐
        │  Quality score (depth-weighted axes)       │
        └────────────────────────────────────────────┘
                             │
                             ▼
         ┌──────────────────────────────────────────┐
         │ [flag ON, score < threshold]             │
         │  runDeepRefinement loop                  │
         │   1. validateConstraints sweep           │
         │   2. critiqueProposalWithTools (with     │
         │      search_company_knowledge etc.)      │
         │   3. fall back to critiqueProposalWithAI │
         │   4. rewriteProposalWithCritique         │
         │   5. rescore; iterate until threshold    │
         │      OR no improvement OR no violations  │
         └──────────────────────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────┐
        │  [flag OFF or no improvement]              │
        │   legacy refineProposalWithAI loop         │
        └────────────────────────────────────────────┘
                             │
                             ▼
                 GeneratedDocument written
```

---

## Per-module reference

### `evaluation-criteria-extractor.ts`

Exports `extractDeepTenderComprehension(tenderText)` → `DeepTenderComprehension | null`.

**Output shape:**
```ts
{
  reasoning: string,
  criteria: Array<{
    id: string,
    criterion: string,
    weight: number | null,
    mandatory: boolean,
    scoringMethod: "pass-fail" | "weighted" | "binary" | "narrative" | "unknown",
    evidenceExpected: string[],
    sourceQuote: string,
  }>,
  disqualifiers: Array<{
    id: string,
    rule: string,
    triggerLanguage: string,
  }>,
  prohibitions: string[],
  totalWeightAccountedFor: number | null,
}
```

Falls back to null on any failure; the regex analyser still runs as the baseline.

### `semantic-match-aligner.ts`

Exports `alignMatchesToEvaluatorCriteria({ tenderTitle, clientName, comprehension, experts, projects })` → `AlignmentReport | null`.

Single Claude call. Input bounds: top 6 experts + top 6 projects, top 8 criteria by weight, profiles truncated to 1200 chars each. Output bounds: ≤200 alignments, ≤30 coverage records.

### `constraint-validator.ts`

Exports `validateConstraints(comprehension, proposalMarkdown)` — **pure function, no AI cost.**

Pattern library (see [`constraint-validator.ts`](../lib/engine/constraint-validator.ts)) currently covers:

| Prohibition family | Trigger language detected |
|---|---|
| Joint ventures / consortia | `joint venture with`, `JV partner`, `consortium of/with/partner` |
| Subcontracting | `subcontracted to/with/the`, `subcontractor will/shall/to` |
| Blacklist / debarment / sanctions | `blacklisted`, `debarred`, `under sanctions` |
| Foreign ownership | `foreign-owned`, `wholly foreign`, `registered abroad` |
| Financial content in technical envelope | `our price is`, `ETB X total`, `USD Y per`, `fee schedule attached` |
| Advance payment requests | `advance payment of N%`, `mobilisation fee of N` |
| Alliance / partnership / teaming | `strategic alliance with`, `in partnership with [Capital]` |
| Additional cost to client | `client will purchase/procure/acquire`, `client to license` |
| Contract assignment / transfer | `assign the contract`, `transfer the contract`, `contract may be assigned` |
| Bespoke / no-boilerplate | `leading firm in the region`, `world-class expertise`, etc. |

Disqualifier checks include a `≥N years` tenure verifier against `founded in YYYY` claims.

### `deep-reasoning-refiner.ts`

Exports `runDeepRefinement(input)`. Each iteration:

1. Runs `validateConstraints` and adds synthetic `constraintProhibition` / `constraintDisqualifier` axes to the weak set when violations are found.
2. Calls `critiqueProposalWithTools` first (tool-using critic) when `toolEvidence` is supplied; falls back to `critiqueProposalWithAI` on null.
3. Calls `rewriteProposalWithCritique`.
4. Re-scores the rewrite; keeps it only if the score lifts AND no critical violations remain.

Stops on threshold, no improvement, thin output, or `MAX_REFINEMENT_ATTEMPTS`. Tracks an `attempts[]` log with `weakAxesBefore` and `weakAxesAfter` per iteration so subsequent critique prompts see "what was fixed last time" via the history hint.

### `proposal-tools.ts`

Three Anthropic-compatible tools:

- `search_company_knowledge(query, type, max_results)` — token-overlap search across experts + projects.
- `inspect_expert(name)` — full profile by partial name.
- `inspect_project(name)` — full profile by partial name.

Executor is pure and operates on the in-memory `ToolEvidenceInventory` the orchestrator pre-loads. No DB round-trips inside the tool-use loop.

---

## Diagnostics

When `TENDER_DEEP_REASONING` is ON, look for these log lines in the generation log:

```
[generate-elite] Deep comprehension: N criteria, M disqualifier(s), K prohibition(s). Total weight accounted for: 100.
[generate-elite] Semantic alignment: X alignment(s), Y criterion coverage record(s).
[deep-reasoning-refiner] Iteration 1/2: 72 → 84 (+12). Weak axes remaining: 1 (constraints: 0).
[ai:tools] @anthropic-ai/sdk not installed — tool-use unavailable.    # only if SDK missing
```

When the flag is OFF you'll see the legacy line:

```
[generate-elite] Refinement attempt 1/1: 72 → 81 (+9). Weak axes remaining: 2.
```

If you don't see ANY `Deep comprehension:` line on a tender that has uploaded text, check that `ANTHROPIC_API_KEY` is set — the extractor no-ops silently when no AI provider is configured.

---

## Troubleshooting

**"I set the flag but I don't see any difference."**
Check three things in this order:
1. `TENDER_DEEP_REASONING` is set to a truthy value (`"true"`, `"1"`, `"yes"`, or `"on"`). `"True"` and `"on "` work; `"enabled"` does not.
2. At least one AI provider is configured (`ANTHROPIC_API_KEY` preferred). Without one, every deep-reasoning entry point returns null and the legacy path runs.
3. The tender has substantive uploaded text. The comprehension extractor no-ops on inputs shorter than ~200 chars.

**"My function is timing out on Vercel Hobby."**
Deep-reasoning adds 5–8 Claude calls. The Hobby 60s budget is tight. Either move to Vercel Pro or set `TENDER_DEEP_REASONING` OFF on Hobby deployments.

**"The critique is being skipped."**
Look for `critique pass returned empty or thin output` in the logs. The critique pass needs ≥50 chars of output; Claude occasionally returns near-empty content under load. The iteration is logged as `critique-failed` and the refiner falls back to the next iteration's plain-critic path.

**"The rewriter is rejecting my refined output."**
Look for `rewrite returned thin output` — the rewriter rejects output that's less than 70% of the input length, to guard against accidental section deletion. If you genuinely want the refiner to shrink the document, that path is currently not supported and is intentional.

**"Tool use isn't being called."**
The tool-using critic only runs when `toolEvidence` is supplied AND `ANTHROPIC_API_KEY` is set AND `@anthropic-ai/sdk` is importable. The default integration in `generate-elite.ts` always supplies the inventory, but if you've forked the refiner directly check that you're passing `toolEvidence` through.
