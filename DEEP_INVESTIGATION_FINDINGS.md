# Deep Investigation Findings - AI Analyze Fixes

## Summary

A pre-merge deep investigation of PR #853 found that the feature branch
`claude/optimistic-allen-ajgssl` was **4 commits behind `origin/main`** and
was therefore **missing PR #851's actual code changes** (timeout/token-cap fix).
This has been **RESOLVED** by merging `origin/main` into the branch.

All three critical AI Analyze fixes are now present and verified.

---

## Root Cause of the Investigation Alarm

PR #851's GitHub head SHA was `b581ae9e…` (the pre-squash branch tip). When the
PR was **squash-merged** into `main`, it landed as a NEW commit
`1302fe05 fix: permanent AI Analyze fix — Z.ai/Cerebras timeout 45s + analysis
token cap 8000 (#851)`. Searching the local repo for the old head SHA returned
nothing, which initially looked like "PR #851 not merged."

The reality: PR #851 **was** correctly squash-merged to `main`. Our feature
branch simply had not pulled main's latest commits:

```
origin/main (ahead of our branch by 4):
  1302fe05  PR #851 — timeout 45s + token cap 8000   ← the missing fix
  4a4512fd  Merge PR #852 (provider detection)
  921e79c1  Merge PR #850 (schema drift)
  345b43f4  PR #849 — central generation/export gate
```

`git merge origin/main` brought these in cleanly (no conflicts), because our
branch's direct commits for #850/#852 carried identical content to main's
squash-merges of the same logical changes.

---

## Verified State After Merge

### PR #850 — Schema Drift Fix ✅ VERIFIED
- `lib/prisma.ts` bootstrap creates `failureCategory` + `jobId` columns
- `ensureColumn()` backfills pre-existing tables
- Migration `20260623160000_add_ai_analyze_chunk_job_and_failure_columns` present
- Tests: 9/9 pass (`tests/ai-analyze-checkpoint-bootstrap.test.ts`)

### PR #851 — Timeout & Token Cap Fix ✅ NOW VERIFIED (was missing pre-merge)
- `CONSERVATIVE_CAPS.analysis`: **8000** (was 3000) — `lib/ai-provider-registry.ts:113`
- `ANALYSIS_TIMEOUT_MS = 45_000` for zai/cerebras (was 20_000) — line 120
- `getProviderTimeoutMs()` exists — line 506
- Wired into `generateWithZai` (`lib/ai.ts:1247`) and `generateWithCerebras` (`lib/ai.ts:1277`)
- Tests: 26/26 pass (`tests/ai-provider-registry.test.ts`)

### PR #852 — Provider Detection Fix ✅ VERIFIED
- `isCerebrasEnabled()` + `isZaiEnabled()` exist — `lib/ai.ts:93-99`
- `isAIEnabled()` checks all 10 canonical providers — `lib/ai.ts:86`

### PR #849 — Central Generation/Export Gate ✅ PULLED IN
- Arrived as part of the same merge; durable readiness records + submission-plan
  check fix.

---

## Why All Three AI Analyze Fixes Are Needed Together

| Without… | Symptom |
|----------|---------|
| #850 (schema) | `getAnalyzeCheckpoints` throws P2022 → Recovery Command Center error |
| #851 (timeout/tokens) | 20s timeout cuts off Z.ai (needs 15-40s); 3000-token cap truncates JSON → malformed response → all attempts exhausted → regex fallback |
| #852 (provider detection) | `isAIEnabled()` returns false when only Cerebras/Zai configured → AI path skipped entirely |

With all three, AI Analyze:
1. Passes the `isAIEnabled()` gate for any configured provider,
2. Gives Z.ai/Cerebras 45s and an 8000-token analysis budget to return complete JSON,
3. Persists checkpoints without schema errors.

---

## Verification Commands (post-merge)

```bash
grep -n "CONSERVATIVE_CAPS:" lib/ai-provider-registry.ts   # analysis: 8000
grep -n "ANALYSIS_TIMEOUT_MS = " lib/ai-provider-registry.ts # 45_000
grep -n "getProviderTimeoutMs" lib/ai.ts                    # imported + used 2x
npx tsc --noEmit                                            # clean
npx tsx --test tests/ai-provider-registry.test.ts          # 26/26 pass
npx tsx --test tests/ai-analyze-checkpoint-bootstrap.test.ts # 9/9 pass
```

---

## Outcome

- ✅ Branch synced with `origin/main`
- ✅ All three critical fixes (#850, #851, #852) present and tested
- ✅ TypeScript clean, targeted tests green
- ✅ PR #853 documentation is now accurate

**The pre-merge investigation served its purpose**: it caught that the branch
was missing #851's runtime fix before the documentation PR was merged. The gap
is now closed.
