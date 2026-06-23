# Deep Investigation Findings - AI Analyze Fixes

## 🚨 CRITICAL ISSUE: PR #851 Code Changes NOT in Repository

### Finding
- PR #851 claims to be **merged** (merged_at: 2026-06-23T16:38:38Z)
- PR #851's commit SHA: `b581ae9ec85dd357f33affbe47c24a590121a251` 
- **Status: THIS COMMIT DOES NOT EXIST IN ANY BRANCH**
- Searched: all branches, all commits, git log --all
- Result: **NOT FOUND**

### What PR #851 Claims to Have Fixed

PR #851 described these critical fixes:

| Component | Before | After | Location |
|-----------|--------|-------|----------|
| Analysis token cap (zai/cerebras) | 3000 | 8000 | lib/ai-provider-registry.ts |
| Z.ai timeout | 20s | 45s | lib/ai-provider-registry.ts |
| Cerebras timeout | 20s | 45s | lib/ai-provider-registry.ts |
| Registry timeout wiring | Not passed | Passed via getProviderTimeoutMs() | lib/ai.ts |

### Current Code Reality

**lib/ai-provider-registry.ts:**
```typescript
const CONSERVATIVE_CAPS: ProviderOutputCaps = { analysis: 3000, proposal: 4000, fast: 1200 };
const DEFAULT_TIMEOUT_MS = 20_000;

zai: {
  outputCaps: CONSERVATIVE_CAPS,  // analysis: 3000 ← STILL TOO LOW
  timeoutMs: DEFAULT_TIMEOUT_MS,  // 20s ← STILL TOO SHORT
}

cerebras: {
  outputCaps: CONSERVATIVE_CAPS,  // analysis: 3000 ← STILL TOO LOW
  timeoutMs: DEFAULT_TIMEOUT_MS,  // 20s ← STILL TOO SHORT
}
```

### Impact

**AI Analyze will STILL FAIL because:**

1. **Token cap truncates complex JSON (3000 tokens insufficient)**
   - AI Analyze JSON requires: summary + 20+ requirement fields + evaluation criteria + client details (20+ fields)
   - 3000 tokens truncates response → malformed JSON → provider fails
   - According to PR #851: "3000 truncates the complex JSON; 8000 is sufficient and within free-tier"

2. **Timeout too short for Z.ai and Cerebras**
   - Z.ai glm-4.7-flash needs 15-40 seconds for complex analysis
   - Cerebras gpt-oss-120b same
   - 20s timeout → TIMEOUT → attempt consumed
   - According to PR #851: "glm-4.7-flash needs 15-40s on large analysis prompts"

3. **Attempt budget exhausted**
   - According to PR #851: "With the 20s timeout, the sequence is:
     - Zai → TIMEOUT (attempt 1 consumed)
     - Cerebras → may also fail (truncated JSON from 3000 token cap) (attempt 2 consumed)  
     - Mistral → TIMEOUT (attempt 3 consumed)
     - → ATTEMPT_BUDGET_EXHAUSTED
     - → regex fallback → workflow stuck"

---

## What IS Actually Fixed

### PR #850 ✅ VERIFIED IN CODE
**Schema Drift Fix**
- Verified commit: `de223fce`
- Changes confirmed in lib/prisma.ts:
  ```typescript
  "failureCategory" TEXT,
  "jobId" TEXT,
  await ensureColumn(client, "AiAnalyzeChunk", "failureCategory", "TEXT");
  await ensureColumn(client, "AiAnalyzeChunk", "jobId", "TEXT");
  ```
- Migration file exists: `prisma/migrations/20260623160000_add_ai_analyze_chunk_job_and_failure_columns/migration.sql`
- Status: ✅ Actual code changes present

### PR #852 ✅ VERIFIED IN CODE
**Provider Detection Fix**
- Verified commit: `1cc02394`
- Changes confirmed in lib/ai.ts:
  ```typescript
  export function isCerebrasEnabled() {
    return Boolean(process.env.CEREBRAS_API_KEY);
  }
  
  export function isZaiEnabled() {
    return Boolean(process.env.ZAI_API_KEY);
  }
  
  export function isAIEnabled() {
    return isCerebrasEnabled() || isZaiEnabled() || isGeminiEnabled() || ...
  }
  ```
- All 10 providers now checked
- Status: ✅ Actual code changes present

### PR #851 ❌ NOT VERIFIED
**Timeout & Token Cap Fix**
- Claimed to increase: analysis cap 3000→8000, timeouts 20s→45s
- Current code still has: analysis: 3000, timeouts: 20_000ms
- Status: ❌ Code changes NOT present in repository

---

## Hypothesis

Possible explanations for PR #851:

1. **PR was created but commit was never pushed** to the repository
2. **PR merge failed silently** in GitHub but shows as merged
3. **PR was squashed/rebased** and the commit hash changed
4. **Wrong repository** - the PR might be from a different clone/fork
5. **Staged but not committed** - changes made locally but never committed

---

## Testing Confirmation

To confirm AI Analyze would still fail without PR #851's fixes, we can test:

```bash
# Check current token cap
grep "analysis.*3000\|CONSERVATIVE_CAPS" lib/ai-provider-registry.ts
# Output: "analysis: 3000" ← STILL TOO LOW

# Check current timeout
grep "DEFAULT_TIMEOUT_MS\|20_000" lib/ai-provider-registry.ts
# Output: "const DEFAULT_TIMEOUT_MS = 20_000;" ← STILL TOO SHORT

# Check if getProviderTimeoutMs exists (PR #851 claimed to add this)
grep -n "getProviderTimeoutMs" lib/ai.ts
# Output: (likely not found)
```

---

## Recommendation

**DO NOT MERGE PR #853** until this is resolved because:

1. PR #853 documents PR #851 as merged, but it's not
2. The documentation would be inaccurate
3. AI Analyze is not actually fully fixed without PR #851's changes
4. Users would install fixes #850 and #852 but still experience timeout/truncation failures

---

## Next Steps

1. **Verify PR #851 status**
   - Is it actually merged to main?
   - Does the commit exist somewhere?
   - Should it be re-created and merged?

2. **Apply PR #851 fixes if missing**
   - Increase CONSERVATIVE_CAPS.analysis from 3000 to 8000
   - Increase DEFAULT_TIMEOUT_MS from 20_000 to 45_000
   - Add getProviderTimeoutMs() function if missing
   - Wire timeout values in generateWithZai and generateWithCerebras

3. **Update PR #853** 
   - Correct documentation to reflect actual status
   - Remove references to PR #851 if it's not actually merged
   - Or add PR #851's fixes and include them in PR #853

---

## Files to Check

```bash
# Verify current values
cat lib/ai-provider-registry.ts | grep -A 5 "CONSERVATIVE_CAPS\|DEFAULT_TIMEOUT"

# Check if getProviderTimeoutMs exists
grep -n "getProviderTimeoutMs\|getProviderTimeout" lib/ai.ts lib/ai-provider-*.ts

# Check generateWithZai signature
grep -A 10 "async function generateWithZai" lib/ai.ts

# Check generateWithCerebras signature
grep -A 10 "async function generateWithCerebras" lib/ai.ts
```

---

## Summary

| Fix | Status | Evidence |
|-----|--------|----------|
| PR #850 (Schema drift) | ✅ Merged & verified | Commit de223fce in history, code present |
| PR #852 (Provider detection) | ✅ Merged & verified | Commit 1cc02394 in history, code present |
| PR #851 (Timeout/tokens) | ❌ NOT MERGED | Commit b581ae9e NOT in history, code missing |

**Only 2 of 3 critical fixes are actually applied.**

AI Analyze still has the **timeout and token truncation vulnerabilities** that would cause it to fail.
