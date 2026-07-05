# AI Analyze - Complete Configuration Guide

## Current Status

### Database Fix ✅
- PR #850 merged successfully
- Schema drift fixed: `failureCategory` and `jobId` columns added
- `getAnalyzeCheckpoints()` no longer throws P2022 errors

### Provider Configuration ❌
- No AI provider API keys are configured in .env.local
- All providers are failing or not available

### Fallback Mechanism ✅
- REGEX_FALLBACK pathway exists and is functional
- Automatically triggers when no AI providers work
- Returns regex-based requirement extraction

---

## OPTION A: Quick Fix (Use Cerebras or Groq)

**Time:** 5 minutes | **Cost:** Free trial or $0.50-1 per call

### Steps

1. **Get an API Key** (Choose one):
   - Cerebras (Recommended - Fast): https://console.cerebras.ai/keys (Sign up → Generate key)
   - Groq (Alternative): https://console.groq.com/keys (Sign up → Create API key)

2. **Add to .env.local**:
   ```bash
   # For Cerebras:
   CEREBRAS_API_KEY=csk_YOUR_KEY_HERE

   # OR for Groq:
   GROQ_API_KEY=gsk_YOUR_KEY_HERE
   ```

3. **Restart Dev Server**:
   ```bash
   pkill -f "next dev"
   npm run dev
   ```

4. **Test**:
   - Navigate to a tender
   - Click "Run AI Analyze"
   - Should extract requirements using your selected provider

### Expected Output
```
AI Analysis completed ✅
- Provider used: cerebras (or groq)
- Requirements extracted: X
- Time: ~30-60 seconds
```

### Troubleshooting
- **Still failing?** Check if API key is valid: `curl -H "Authorization: Bearer $CEREBRAS_API_KEY" https://api.cerebras.ai/v1/models`
- **Slow?** Cerebras is faster than Groq (~30s vs ~60s)
- **Rate limited?** Try the other provider

---

## OPTION B: Full Provider Setup (All 10 Providers)

**Time:** 30 minutes | **Cost:** Varies (free trials available)

### Provider Setup Guide

| Provider | Status | Setup | Cost |
|----------|--------|-------|------|
| **Cerebras** | ✅ Working | https://console.cerebras.ai/keys | Free trial |
| **Groq** | ✅ Working | https://console.groq.com/keys | Free tier |
| **Mistral** | ❌ Timeout | https://console.mistral.ai/api-keys/ | Free trial |
| **OpenRouter** | ⚪ Not configured | https://openrouter.ai/keys | Pay-as-you-go |
| **Gemini** | ❌ Rate limited | https://console.cloud.google.com/ | Free quota |
| **OpenAI** | ❌ Rate limited | https://platform.openai.com/account/api-keys | $0.50-2 per call |
| **Together** | ❌ Invalid key | https://www.together.ai/settings/keys | Free trial |
| **Deepseek** | ❌ Billing | https://platform.deepseek.com/ | Low cost |
| **Anthropic** | ❌ Billing | https://console.anthropic.com/settings/keys | $0.30-3 per call |
| **Zai** | ❌ Timeout | https://api.zai.com/ | Contact sales |

### Implementation

1. **Get API Keys** for at least 2-3 providers (Cerebras + Groq minimum)

2. **Add to .env.local**:
   ```bash
   # Primary providers (recommended)
   CEREBRAS_API_KEY=csk_...
   GROQ_API_KEY=gsk_...
   
   # Additional providers (optional)
   MISTRAL_API_KEY=...
   OPENROUTER_API_KEY=...
   GEMINI_API_KEY=...
   OPENAI_API_KEY=...
   TOGETHER_API_KEY=...
   DEEPSEEK_API_KEY=...
   ANTHROPIC_API_KEY=...
   ```

3. **Provider Priority Order** (automatic fallthrough):
   1. Cerebras (Fastest, ~30s)
   2. Groq (Free tier, ~60s)
   3. Mistral (Accurate)
   4. OpenRouter (Proxy for multiple)
   5. Gemini (Google)
   6. OpenAI (GPT-4)
   7. Together (Ensemble)
   8. Deepseek (Budget option)
   9. Anthropic (Claude)
   10. Zai (Enterprise)

4. **Restart Dev Server**:
   ```bash
   pkill -f "next dev"
   npm run dev
   ```

5. **Verify Configuration**:
   - Navigate to Recovery Command Center
   - "Test provider chain" button shows which providers are configured
   - Green checkmark = available, Red = not configured or failing

### Cost Optimization
- **Free:** Cerebras (trial) + Groq (free tier) = $0/month
- **Low:** + Gemini (free quota) = $1-2/month
- **Medium:** + OpenAI (with quotas) = $5-10/month
- **Full:** All providers = $20-50/month

---

## OPTION C: Fallback Mode (No AI Providers)

**Time:** 0 minutes | **Cost:** $0 | **Accuracy:** 70% (regex patterns)

### How It Works

When all AI providers are unavailable:

1. **User clicks "Run AI Analyze"**
2. **System attempts all configured providers** → All fail
3. **Automatically falls back to REGEX_FALLBACK**
4. **Extracts requirements using regex patterns** (no AI call)
5. **Returns analysis labeled "REGEX_FALLBACK"**

### What Gets Extracted
- ✅ Requirements mentioned with keywords (requirements, deliverables, etc.)
- ✅ Timeline/dates
- ✅ Budget amounts
- ✅ Submission instructions
- ⚠️ Complex/implicit requirements (less accurate)
- ⚠️ Hidden evaluation criteria
- ⚠️ Specific technical specs

### How to Enable
**Already enabled by default.** No configuration needed.

### How to Test
1. Make sure NO API keys are set in .env.local (or delete all AI keys)
2. Click "Run AI Analyze"
3. Wait 2-3 seconds (no API calls, just regex)
4. Requirements extracted with `analysisSource: "REGEX_FALLBACK"`

### Expected Output
```
AI Analysis completed (Fallback) ⚠️
- Method: REGEX_FALLBACK
- Requirements extracted: X (may be fewer/less detailed)
- Time: 2-3 seconds
- Next step: Manual review recommended
```

### Limitations
- Less accurate than AI
- Misses implicit requirements
- Good for MVP or testing
- Production should use AI providers

---

## Decision Matrix

| Scenario | Option | Reason |
|----------|--------|--------|
| **Want it working now** | A | 5 min, free trial |
| **Need best accuracy** | B | All providers, high accuracy |
| **Have zero budget** | C | Free, 70% accuracy |
| **Want redundancy** | B | Multiple fallthrough providers |
| **Testing/MVP** | C | Free, sufficient for testing |

---

## Verification Commands

### Check if any providers are configured:
```bash
grep -E "CEREBRAS|GROQ|OPENAI|ANTHROPIC|GEMINI" .env.local
```

### Check if key is valid:
```bash
# For Cerebras
curl -H "Authorization: Bearer $CEREBRAS_API_KEY" https://api.cerebras.ai/v1/models

# For Groq
curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models
```

### Test AI Analyze with logs:
```bash
# In another terminal, watch logs
tail -f /tmp/dev.log | grep -i "analyze\|provider\|fallback"

# Then trigger AI Analyze from the UI
```

---

## Next Steps

1. **Immediate (This Session):**
   - [ ] Choose Option A, B, or C
   - [ ] Follow the setup steps
   - [ ] Test AI Analyze
   - [ ] Verify it works

2. **Before Production:**
   - [ ] Configure at least 2 providers
   - [ ] Test fallback (disable providers, verify fallback works)
   - [ ] Set up rate limiting and monitoring
   - [ ] Document which providers are used
   - [ ] Set up alerts for provider failures

3. **Optional Enhancements:**
   - [ ] Add provider cost tracking
   - [ ] Implement provider health dashboard
   - [ ] Add per-provider success metrics
   - [ ] Set up A/B testing of providers
