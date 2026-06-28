# Z.ai Coding Plan Fix — Apply These Files

## The Problem
Your Z.ai API key is from the **GLM Coding Plan**, which only includes
`glm-4-coding` and `glm-4v-coding` — NOT `glm-4-flash`.

The code's allowlist only accepted `glm-4-flash`, so even if you set
`ZAI_PROPOSAL_MODEL=glm-4-coding` in Vercel, the guard rejected it and
forced `glm-4-flash` — which your Coding Plan key can't access.

## The Fix (3 files to update)

### File 1: `lib/ai-provider-registry.ts`
Copy this file to your repo, replacing the existing one.
The only change is in the `ZAI_VALID_MODEL_CODES` Set (around line 496)
which now includes all Z.ai model codes across all plan types.

### File 2: `app/api/admin/ai-provider-health/zai-diagnostic/route.ts`
Copy this file to your repo (new file). It's a diagnostic endpoint that
tests your Z.ai API key against multiple model names and tells you
exactly which models work and which don't.

### File 3: `tests/zai-model-regression.test.ts`
Copy this file to your repo, replacing the existing one.
Updated to require glm-4-coding + glm-4v-coding in the allowlist.

## How to Apply

1. Download the 3 files from this folder:
   - `ai-provider-registry.ts` → copy to `lib/ai-provider-registry.ts`
   - `zai-diagnostic-route.ts` → copy to `app/api/admin/ai-provider-health/zai-diagnostic/route.ts`
   - `zai-model-regression.test.ts` → copy to `tests/zai-model-regression.test.ts`

2. Commit and push:
   ```bash
   git add lib/ai-provider-registry.ts app/api/admin/ai-provider-health/zai-diagnostic/route.ts tests/zai-model-regression.test.ts
   git commit -m "fix(zai): add Coding Plan models to allowlist + diagnostic endpoint"
   git push origin main
   ```

3. Wait for Vercel to deploy (2-3 minutes)

4. Set these Vercel env vars (Settings → Environment Variables):
   ```
   ZAI_BASE_URL = https://open.bigmodel.cn/api/paas/v4
   ZAI_PROPOSAL_MODEL = glm-4-coding
   ZAI_ANALYSIS_MODEL = glm-4-coding
   ZAI_FAST_MODEL = glm-4-coding
   ```

5. Redeploy in Vercel (Deployments → click the latest → Redeploy)

6. After redeploy, test at:
   https://hope-tender-path-b.vercel.app/api/admin/ai-provider-health/zai-diagnostic
   (Login as admin first)

7. Then go to the AI Health panel and click "Test provider chain"
   Z.ai should now show OK with model glm-4-coding

## Alternative: Just Remove ZAI_API_KEY
If you don't want to deal with the Coding Plan, simply DELETE the
ZAI_API_KEY env var from Vercel. Z.ai will show "Not configured" instead
of "Failed". Your app will use Cerebras/Mistral/Groq (which are already
working).
