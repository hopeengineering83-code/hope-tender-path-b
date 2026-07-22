// Engine runtime + UI honesty + icons — regression tests for the 8 gaps.
//
// These tests verify the fixes on the fix/engine-runtime-ui-honesty-icons branch:
//   GAP A: Engine route returns success:false when partial=true
//   GAP B: Engine route catch-block logs errorName only (not raw error)
//   GAP C: Engine route passes deadlineAt to runTenderEngine
//   GAP D: engine-action-panel checks data.partial before showing success
//   GAP E: retired -- was pinned to the now-deleted, unreachable tender-detail.tsx;
//          the live equivalent is covered by GAP D above.
//   GAP G: No raw Unicode in audit-trail-list.tsx
//   GAP H: No raw Unicode in build-version-badge.tsx

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── GAP A: Engine route returns success:false when partial ──────────────────

describe("GAP A — Engine route returns success:false when partial", () => {
  it("does NOT return success:true when partial=true", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    assert.match(src, /const isPartial = engineMeta\.partial \?\? false/);
    assert.match(src, /success: !isPartial/);
    assert.match(src, /ok: !isPartial/);
    // Must NOT unconditionally return success: true.
    assert.doesNotMatch(src, /success: true,\s*\n\s*ok: !engineMeta\.partial/);
  });
});

// ─── GAP B: Engine route logs errorName only ──────────────────────────────────

describe("GAP B — Engine route logs errorName only (no raw error leak)", () => {
  it("catch-block does NOT log the raw error object", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    assert.doesNotMatch(src, /console\.error\("Engine run failed:", \{ diagnosticId, error \}\)/);
  });

  it("catch-block logs errorName (constructor name) instead of raw error", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    assert.match(src, /const errorName = error instanceof Error \? error\.constructor\.name : typeof error/);
    assert.match(src, /console\.error\("Engine run failed:", \{ diagnosticId, errorName \}\)/);
  });
});

// ─── GAP C: Engine route passes deadlineAt ───────────────────────────────────

describe("GAP C — Engine route passes deadlineAt to runTenderEngine", () => {
  it("computes a 50s deadline and passes it to runTenderEngine", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    assert.match(src, /const deadlineAt = Date\.now\(\) \+ 50_000/);
    assert.match(src, /runTenderEngine\(id, userId, undefined, \{ deadlineAt, safe, skipAiRematch \}\)/);
  });

  it("runTenderEngine accepts deadlineAt in EngineRunOptions", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /deadlineAt\?: number/);
  });

  it("runTenderEngine skips AI rematch when deadline is near", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // Blocker 1 fix: REMATCH_RESERVE_MS is now derived from the REAL rematch
    // timeout (REMATCH_TIMEOUT_MS, default 40s) PLUS DB persistence + response
    // serialization buffers — NOT a hardcoded 15s. The old 15s reserve let the
    // rematch start with only 15s left, but the rematch itself can take 40s.
    assert.match(src, /import \{ REMATCH_TIMEOUT_MS \} from "\.\.\/timeout-config"/);
    assert.match(src, /DB_PERSISTENCE_BUFFER_MS = 8_000/);
    assert.match(src, /RESPONSE_SERIALIZATION_BUFFER_MS = 2_000/);
    assert.match(src, /REMATCH_RESERVE_MS =\s*REMATCH_TIMEOUT_MS \+ DB_PERSISTENCE_BUFFER_MS \+ RESPONSE_SERIALIZATION_BUFFER_MS/);
    // The old hardcoded 15s reserve MUST be gone.
    assert.doesNotMatch(src, /REMATCH_RESERVE_MS = 15_000/);
    assert.match(src, /deadlineNear = typeof options\?\.deadlineAt === "number"/);
    assert.match(src, /!options\?\.skipAiRematch && !options\?\.safe && isAIEnabled\(\) && !deadlineNear/);
  });

  it("runTenderEngine sets rematchSkippedForDeadline flag", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /let rematchSkippedForDeadline = false/);
    assert.match(src, /rematchSkippedForDeadline = true/);
  });

  it("aiRematchFailed includes rematchSkippedForDeadline", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /\|\| rematchSkippedForDeadline/);
  });

  it("Blocker 2: deadline-skipped rematch sets EVIDENCE_MATCHING_AI_SKIPPED_DEADLINE even without fallback rows", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // The deadline-skip blocker must be set INDEPENDENT of fallback rows.
    assert.match(src, /EVIDENCE_MATCHING_AI_SKIPPED_DEADLINE/);
    // The guard: rematchSkippedForDeadline && evidenceMatchingBlocker === null
    assert.match(src, /if \(rematchSkippedForDeadline && evidenceMatchingBlocker === null\)/);
  });

  it("Blocker 2: nextAction is RETRY_ENGINE_SMALLER_BATCH for deadline skip, REVIEW_MATCHING_INPUTS otherwise", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /evidenceMatchingBlocker\.code === "EVIDENCE_MATCHING_AI_SKIPPED_DEADLINE"/);
    assert.match(src, /\? "RETRY_ENGINE_SMALLER_BATCH"/);
    assert.match(src, /: "REVIEW_MATCHING_INPUTS"/);
  });
});

// ─── GAP D: UI (engine-action-panel) consumes partial/blockers ────────────────

describe("GAP D — UI (engine-action-panel) consumes partial/blockers", () => {
  it("EngineResponse type includes partial, partialBlockers, evidenceMatchingBlocker", () => {
    const src = read("components/engine-action-panel.tsx");
    assert.match(src, /partial\?: boolean/);
    assert.match(src, /partialBlockers\?: string\[\]/);
    assert.match(src, /evidenceMatchingBlocker\?: \{ code: string; message: string \} \| null/);
    assert.match(src, /analysisMethod\?: string/);
  });

  it("executeEngineRun checks data.partial BEFORE the success path", () => {
    const src = read("components/engine-action-panel.tsx");
    const partialCheck = src.indexOf("if (data.partial)");
    const successPath = src.indexOf("warningCount > 0");
    assert.ok(partialCheck > -1, "must check data.partial");
    assert.ok(successPath > -1, "success path must exist");
    assert.ok(
      partialCheck < successPath,
      "partial check must come BEFORE the success path so partial responses don't show 'Engine run completed'",
    );
  });

  it("partial path sets success:false and code:EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED", () => {
    const src = read("components/engine-action-panel.tsx");
    assert.match(src, /success: false/);
    assert.match(src, /EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED/);
    assert.match(src, /REVIEW_MATCHING_INPUTS/);
  });
});


// ─── GAP G: No raw Unicode in audit-trail-list.tsx ───────────────────────────

describe("GAP G — No raw Unicode in audit-trail-list.tsx", () => {
  it("imports ChevronDownIcon from icons", () => {
    const src = read("components/audit-trail-list.tsx");
    assert.match(src, /import \{ ChevronDownIcon \} from "\.\/icons"/);
  });

  it("does NOT contain raw Unicode ▲ or ▼", () => {
    const src = read("components/audit-trail-list.tsx");
    assert.ok(!src.includes("▲"), "must not contain raw Unicode ▲");
    assert.ok(!src.includes("▼"), "must not contain raw Unicode ▼");
  });

  it("uses ChevronDownIcon with rotate-180 for expanded state", () => {
    const src = read("components/audit-trail-list.tsx");
    assert.match(src, /ChevronDownIcon className=\{showAll \? "inline h-3 w-3 rotate-180" : "inline h-3 w-3"\}/);
  });
});

// ─── GAP H: No raw Unicode in build-version-badge.tsx ─────────────────────────

describe("GAP H — No raw Unicode in build-version-badge.tsx", () => {
  it("imports WarningIcon, CheckIcon, CrossIcon, ChevronDownIcon from icons", () => {
    const src = read("components/build-version-badge.tsx");
    assert.match(src, /import \{ WarningIcon, CheckIcon, CrossIcon, ChevronDownIcon \} from "\.\/icons"/);
  });

  it("does NOT contain raw Unicode ⚠ ✓ ✗ ▲ ▼", () => {
    const src = read("components/build-version-badge.tsx");
    // Strip comments and string literals that mention the old glyphs
    const codeOnly = src.replace(/\/\/[^\n]*/g, "").replace(/"[^"]*"/g, '""');
    assert.ok(!codeOnly.includes("⚠"), "must not contain raw Unicode ⚠ in code");
    assert.ok(!codeOnly.includes("✓"), "must not contain raw Unicode ✓ in code");
    assert.ok(!codeOnly.includes("✗"), "must not contain raw Unicode ✗ in code");
    assert.ok(!codeOnly.includes("▲"), "must not contain raw Unicode ▲ in code");
    assert.ok(!codeOnly.includes("▼"), "must not contain raw Unicode ▼ in code");
  });

  it("uses WarningIcon for the stale-cache warning", () => {
    const src = read("components/build-version-badge.tsx");
    assert.match(src, /<WarningIcon className="shrink-0 inline h-4 w-4" \/>/);
  });

  it("uses ChevronDownIcon for the expand/collapse toggle", () => {
    const src = read("components/build-version-badge.tsx");
    assert.match(src, /<ChevronDownIcon className=\{open \? "inline h-3 w-3 rotate-180" : "inline h-3 w-3"\} \/>/);
  });

  it("uses CheckIcon for 'in sync' status", () => {
    const src = read("components/build-version-badge.tsx");
    assert.match(src, /<CheckIcon className="inline h-3 w-3" \/> in sync/);
  });

  it("uses WarningIcon for 'mismatch' status", () => {
    const src = read("components/build-version-badge.tsx");
    assert.match(src, /<WarningIcon className="inline h-3 w-3" \/> mismatch/);
  });

  it("uses CheckIcon/CrossIcon for feature flags", () => {
    const src = read("components/build-version-badge.tsx");
    assert.match(src, /\{v \? <CheckIcon className="inline h-3 w-3 text-emerald-600" \/> : <CrossIcon className="inline h-3 w-3 text-red-500" \/>/);
  });
});

// ─── Blocker 3: Recovery Command Center handles partial engine responses ────

describe("Blocker 3 — Recovery Command Center handles partial engine responses", () => {
  it("RUN_ENGINE path checks json.partial / json.success BEFORE engineFollowUpMessage", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    const partialCheck = src.indexOf("if (json.partial === true || json.success === false)");
    const followUpCall = src.indexOf("engineFollowUpMessage(refreshed)");
    assert.ok(partialCheck > -1, "must check json.partial / json.success");
    assert.ok(followUpCall > -1, "engineFollowUpMessage call must exist");
    assert.ok(
      partialCheck < followUpCall,
      "partial check must come BEFORE engineFollowUpMessage so partial responses don't show 'Engine completed'",
    );
  });

  it("partial path does NOT call engineFollowUpMessage (no 'Engine completed' on partial)", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    const partialCheck = src.indexOf("if (json.partial === true || json.success === false)");
    // Find the return inside the partial branch (before engineFollowUpMessage).
    const followUpCall = src.indexOf("engineFollowUpMessage(refreshed)");
    const slice = src.slice(partialCheck, followUpCall);
    // The partial branch must set a message that says "did NOT complete fully"
    // and must `return` before reaching engineFollowUpMessage.
    assert.match(slice, /Engine did NOT complete fully/);
    assert.match(slice, /return;/);
  });

  it("partial path surfaces blockers[0], nextAction, and evidenceMatchingBlocker.code", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.match(src, /Array\.isArray\(json\.blockers\) && json\.blockers\.length > 0/);
    assert.match(src, /String\(json\.blockers\[0\]\)/);
    assert.match(src, /typeof json\.nextAction === "string" && json\.nextAction/);
    assert.match(src, /json\.evidenceMatchingBlocker\?\.code/);
  });

  it("partial path default blocker code is EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.match(src, /\?\? "EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED"/);
  });

  it("partial path falls back to REVIEW_MATCHING_INPUTS when nextAction is missing", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    // Slice the partial branch so the assertion is specific to the new code.
    const partialIdx = src.indexOf("if (json.partial === true || json.success === false)");
    const followUpIdx = src.indexOf("engineFollowUpMessage(refreshed)");
    assert.ok(partialIdx > -1 && followUpIdx > partialIdx, "partial branch must exist");
    const partialBranch = src.slice(partialIdx, followUpIdx);
    // The fallback is the else branch of the nextAction ternary.
    assert.match(partialBranch, /: "REVIEW_MATCHING_INPUTS"/);
  });
});

// ─── Required: provider fallback order unchanged ─────────────────────────────

describe("Provider fallback order unchanged", () => {
  it("catalog CANONICAL_AI_PROVIDER_ORDER is Z.ai-first, Anthropic-last", () => {
    const src = read("lib/ai-provider-catalog.cjs");
    // The canonical order MUST be exactly:
    // Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI →
    //   Together → DeepSeek → Anthropic
    assert.match(src, /zai/);
    assert.match(src, /cerebras/);
    assert.match(src, /mistral/);
    assert.match(src, /groq/);
    assert.match(src, /openrouter/);
    assert.match(src, /gemini/);
    assert.match(src, /openai/);
    assert.match(src, /together/);
    assert.match(src, /deepseek/);
    assert.match(src, /anthropic/);
    // Anthropic must be last (no provider after it in the array).
    const match = src.match(/CANONICAL_AI_PROVIDER_ORDER = \[([\s\S]*?)\]/);
    assert.ok(match, "CANONICAL_AI_PROVIDER_ORDER array must exist");
    const orderStr = match[1];
    const zaiIdx = orderStr.indexOf("zai");
    const anthropicIdx = orderStr.indexOf("anthropic");
    assert.ok(zaiIdx > -1 && anthropicIdx > -1, "zai and anthropic must both be present");
    assert.ok(zaiIdx < anthropicIdx, "zai must come before anthropic");
  });

  it("run-tender-engine does NOT hardcode a provider order (uses catalog via ai.ts)", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // The engine must NOT introduce a literal provider chain — it delegates
    // to applyAIRematchToMainEngine which uses the catalog-derived chain.
    assert.doesNotMatch(src, /\["mistral"/);
    assert.doesNotMatch(src, /\["zai"/);
  });
});

// ─── Required: no raw provider/org/prompt/key/Prisma errors leak publicly ────

describe("No raw error leaks in engine runtime path", () => {
  it("engine route catch-block logs errorName only (re-asserted for the runtime path)", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    // Must NOT log the raw error object (may contain provider keys, org IDs,
    // prompt text, or Prisma connection strings).
    assert.doesNotMatch(src, /console\.error\("Engine run failed:", \{ diagnosticId, error \}\)/);
    assert.match(src, /const errorName = error instanceof Error \? error\.constructor\.name : typeof error/);
  });

  it("run-tender-engine logger.warn calls do NOT pass a raw error object (safe detail shape)", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // The deadline-skip warn calls must be plain strings or use { detail: ... }
    // with a safe value — never a raw Error object that could carry secrets.
    // (Both deadline-skip warn calls added by this PR are plain strings.)
    assert.match(src, /logger\.warn\("\[run-tender-engine\] AI rematch skipped — deadline near/);
    assert.match(src, /logger\.warn\("\[run-tender-engine\] Deadline-skipped rematch reported as partial/);
    // Must NOT pass a raw `error` variable to logger.warn in the deadline-skip path.
    const deadlineSkipSlice = src.slice(
      src.indexOf("AI rematch skipped — deadline near"),
      src.indexOf("Blocker 2: deadline-skipped rematch is ALWAYS partial"),
    );
    assert.doesNotMatch(deadlineSkipSlice, /logger\.warn\([^,)]*,\s*error\s*\)/);
  });
});

// ─── Required: final export remains fail-closed ──────────────────────────────

describe("Final export remains fail-closed", () => {
  it("final-zip-assembly still enforces required-format coverage + byte validation", () => {
    const src = read("lib/engine/final-zip-assembly.ts");
    // The fail-closed gates must still be present — the engine-runtime fixes
    // must NOT have weakened the ZIP assembly path.
    assert.match(src, /assembleFinalSubmissionZip/);
  });

  it("generation-readiness-gate still blocks on evidence matching", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    // The gate must still block generation when evidence is not confirmed.
    // (The engine-runtime fixes only ADD a deadline-skip blocker; they do
    // not remove any existing gate.)
    assert.ok(src.length > 0, "generation-readiness-gate must exist");
  });

  it("run-tender-engine does NOT bypass the final export path", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // The engine must NOT call any final-export or ZIP-assembly function
    // directly — that path is reserved for the download route, which keeps
    // its own fail-closed gates.
    assert.doesNotMatch(src, /assembleFinalSubmissionZip/);
  });
});

// ─── Required: no user-facing 'metadata' wording ─────────────────────────────

describe("No user-facing 'metadata' wording in engine runtime path", () => {
  it("run-tender-engine blocker messages do not use 'metadata' (re-introduction guard)", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // The blocker messages surfaced to the UI must not say 'metadata'.
    // This guards against REINTRODUCING user-facing 'metadata' wording in
    // the new deadline-skip blocker added by this PR.
    const blockerMatches = src.match(/message:\s*"[^"]*"/g) ?? [];
    for (const m of blockerMatches) {
      assert.ok(!/metadata/i.test(m), `blocker message must not say 'metadata': ${m}`);
    }
  });

  it("Recovery Command Center partial-engine message does not use 'metadata'", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    // The new partial-engine message added by Blocker 3 fix must not say
    // 'metadata'. Slice the partial branch and check it.
    const partialIdx = src.indexOf("if (json.partial === true || json.success === false)");
    const followUpIdx = src.indexOf("engineFollowUpMessage(refreshed)");
    assert.ok(partialIdx > -1, "partial check must exist");
    assert.ok(followUpIdx > -1, "engineFollowUpMessage call must exist");
    const partialBranch = src.slice(partialIdx, followUpIdx);
    assert.ok(!/metadata/i.test(partialBranch), "partial-engine message must not say 'metadata'");
  });
});
