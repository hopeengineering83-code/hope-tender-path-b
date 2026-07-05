# Deep Diagnostic: AI Analyze Blocking Issue

Since PR #850 (schema drift fix) is merged and env variables are configured, here's a systematic way to find the REAL problem.

## Step 1: Verify Schema Fix is Applied

```bash
# Check if failureCategory column exists in database
psql $DATABASE_URL -c "
  SELECT column_name FROM information_schema.columns 
  WHERE table_name = 'AiAnalyzeChunk' AND column_name IN ('failureCategory', 'jobId')
  ORDER BY column_name;
"
```

**Expected output:**
```
 column_name
--------------
 failureCategory
 jobId
(2 rows)
```

**If missing:** Run the migration manually:
```bash
npx prisma migrate deploy
```

---

## Step 2: Verify Environment Variables

```bash
# Check if AI provider keys are set
env | grep -iE "ANTHROPIC|CEREBRAS|GROQ|OPENAI|GEMINI|MISTRAL|DEEPSEEK|TOGETHER|OPENROUTER"
```

**Expected:** At least ONE provider key should appear

**If all missing:** Add to .env.local:
```bash
CEREBRAS_API_KEY="csk_YOUR_KEY"
# OR
GROQ_API_KEY="gsk_YOUR_KEY"
# OR
ANTHROPIC_API_KEY="sk-ant-YOUR_KEY"
```

---

## Step 3: Test Database Connectivity

```bash
# Test if database is accessible
psql $DATABASE_URL -c "SELECT 1 as connected"
```

**Expected:** `connected | 1`

**If fails:** Database server isn't running or credentials are wrong

---

## Step 4: Test Prisma Bootstrap

```bash
# Check if bootstrap created necessary tables
psql $DATABASE_URL -c "
  SELECT table_name FROM information_schema.tables 
  WHERE table_schema = 'public' AND table_name IN ('AiAnalyzeChunk', 'AiJob', 'Tender')
  ORDER BY table_name;
"
```

**Expected:** All 3 tables should exist

**If missing:** Bootstrap failed. Check /tmp/.log or restart the app:
```bash
npm run dev  # This triggers bootstrap in development mode
```

---

## Step 5: Check if getAnalyzeCheckpoints Works

Create file: `test-checkpoint.ts`
```typescript
import { getAnalyzeCheckpoints } from "./lib/ai-analyze-checkpoints";

async function test() {
  try {
    const result = await getAnalyzeCheckpoints("test-id", "test-user", "testhash");
    console.log("✓ getAnalyzeCheckpoints works:", result.length, "checkpoints");
  } catch (err) {
    console.log("✗ getAnalyzeCheckpoints failed:");
    console.log(err instanceof Error ? err.message : String(err));
    
    if (err instanceof Error && err.message.includes("does not exist")) {
      console.log("→ This is the P2022 error. Schema drift not fixed. Run: npx prisma migrate deploy");
    }
  }
  process.exit(0);
}

test().catch(console.error);
```

Run it:
```bash
npx tsx test-checkpoint.ts
```

---

## Step 6: Test Provider Chain

Create file: `test-providers.ts`
```typescript
import { buildProviderDiagnosticsSnapshot } from "./lib/ai-provider-health";

async function test() {
  const snapshot = buildProviderDiagnosticsSnapshot();
  
  console.log("Providers attempted:", snapshot.providersAttempted.length > 0 ? snapshot.providersAttempted : "NONE");
  console.log("Providers configured:", snapshot.perProvider.filter(p => p.configured).map(p => p.provider));
  console.log("Providers cooling down:", snapshot.providersCoolingDown);
  
  console.log("\nDetailed status:");
  snapshot.perProvider.forEach(p => {
    if (p.configured) {
      console.log(`  ${p.provider}: ${p.coolingDown ? '🔴 COOLING_DOWN' : '✓ AVAILABLE'} - Last error: ${p.lastErrorCategory || 'none'}`);
    }
  });
  
  if (snapshot.providersAttempted.length === 0) {
    console.log("\n✗ No AI providers configured! Add API keys to .env.local");
  }
  
  process.exit(0);
}

test().catch(console.error);
```

Run it:
```bash
npx tsx test-providers.ts
```

---

## Step 7: Test AI Analyze Endpoint Directly

```bash
# Get a valid tender ID first
TENDER_ID=$(psql $DATABASE_URL -t -c "SELECT id FROM \"Tender\" LIMIT 1")
USER_ID=$(psql $DATABASE_URL -t -c "SELECT \"userId\" FROM \"Tender\" LIMIT 1")

# Test the endpoint
curl -X POST "http://localhost:3000/api/tenders/$TENDER_ID/ai-analyze" \
  -H "Content-Type: application/json" \
  -H "Cookie: session=YOUR_SESSION_COOKIE" \
  -d '{}' 2>&1 | head -200
```

---

## Step 8: Check Application Logs

```bash
# View detailed logs
tail -f /tmp/dev.log | grep -iE "analyze|error|provider|timeout|failed"
```

Look for:
- `[ai-analyze]` messages
- `[bootstrap]` messages
- `[prisma]` messages
- Any ERROR level logs

---

## Most Likely Issues (in order)

### Issue A: No AI Provider Configured (30% likely)
**Symptom:** Provider chain shows 0 configured providers
**Fix:** Add at least one API key to .env.local

### Issue B: Provider Timeouts (25% likely)
**Symptom:** All providers show TIMEOUT in provider chain test
**Fix:** 
- Increase `OPENAI_COMPAT_DEFAULT_TIMEOUT_MS` to 30000
- Check network connectivity
- Verify provider API endpoints are accessible

### Issue C: Database Not Running (20% likely)
**Symptom:** "Connection refused" or "database not found"
**Fix:** Start PostgreSQL or check DATABASE_URL

### Issue D: Migration Not Applied (15% likely)
**Symptom:** "column 'failureCategory' does not exist"
**Fix:** Run `npx prisma migrate deploy`

### Issue E: Checkpoint Table Corrupt (10% likely)
**Symptom:** getAnalyzeCheckpoints works but returns stale data
**Fix:** Delete old checkpoints: `DELETE FROM "AiAnalyzeChunk" WHERE "createdAt" < NOW() - INTERVAL '7 days'`

---

## If Still Blocked After All Steps

Add to .env.local for debugging:
```bash
LOG_LEVEL="debug"
AI_ANALYSIS_TIMEOUT_MS="120000"
OPENAI_COMPAT_DEFAULT_TIMEOUT_MS="30000"
ENABLE_RUNTIME_SCHEMA_BOOTSTRAP="true"
```

Then:
1. Restart dev server
2. Run AI Analyze
3. Check logs for detailed error messages
4. Share the error message

---

## Quick Summary

If AI Analyze is blocked:
1. ✓ PR #850 merged (schema fixed)
2. ? At least ONE provider key configured?
3. ? Database running and accessible?
4. ? Migration applied (if using prisma migrate)?
5. ? Providers responding (not in cooldown)?

Use the diagnostic steps above to check each one.
