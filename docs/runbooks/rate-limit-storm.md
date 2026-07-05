# Runbook: Rate Limit Storm (User Hits 429 on Every Request)

## When to use

Use this runbook when a user is hitting rate limits on every request and
cannot use the app. The Hope Tender Path app enforces several rate-limit
buckets (auth, mutation, AI, upload, general API). Each bucket has a
token-window policy; if a user is in a retry loop or the limiter itself is
misbehaving, they can see 429s on every call.

Trigger this runbook when:
- A user reports "every click returns 429" or "the app is unusable".
- Vercel logs show a single user/IP returning 429 across multiple distinct
  endpoints within seconds.
- The `RateLimitBucket` table shows a single `keyHash` with a `count` far
  exceeding the configured limit (a stuck counter).

## Symptoms

- Every API call from a single user returns **HTTP 429** with a
  `Retry-After` header.
- The user's dashboard shows the "rate limited" toast repeatedly, even
  after waiting several minutes.
- Vercel logs show the `[rate-limit]` line indicating the bucket that
  rejected the request.
- The user may also be in a client-side retry loop — the browser keeps
  retrying the failed request, which burns through the next window's tokens
  as soon as they reset.
- In `production` with `RATE_LIMIT_ALLOW_DEGRADED` unset, the limiter logs
  `[rate-limit] Persistent limiter unavailable; request denied` if the DB is
  flaky — that is a different problem (DB outage, see `database-outage.md`)
  but produces the same user-visible symptom.

## Immediate steps (first 5 minutes)

1. **Identify the affected user and bucket.** Ask the user (or check Vercel
   logs) for the exact endpoint and the `Retry-After` value. The bucket
   name is encoded in the rate-limit key — check the policy table in
   `lib/rate-limit.ts`:
   | Bucket | Limit | Window |
   | --- | --- | --- |
   | `AI_RATE_LIMIT` | 20 | 60s |
   | `API_RATE_LIMIT` | 300 | 60s |
   | `MUTATION_RATE_LIMIT` | 30 | 60s |
   | `AUTH_RATE_LIMIT` | 10 | 60s |
   | `PASSWORD_RESET_RATE_LIMIT` | 5 | 15 min |
   | `UPLOAD_RATE_LIMIT` | 5 | 60s |

2. **Check the `RateLimitBucket` table for a stuck counter:**
   ```bash
   psql "$DATABASE_URL" -c \
     "SELECT \"keyHash\", count, \"resetAt\", \"updatedAt\"
      FROM \"RateLimitBucket\"
      ORDER BY count DESC LIMIT 20;"
   ```
   A `count` far above the configured limit with a `resetAt` in the past
   indicates the reset logic did not fire (rare). A `count` at the limit
   with `resetAt` in the future is normal throttling.

3. **Verify the user is not in a client-side retry loop.** Ask the user to
   hard-refresh and *stop* clicking. Many "rate limit storms" are a single
   retry loop magnified by the browser — the underlying trigger was one
   failed request, but the retries keep the bucket full.

4. **Confirm `/api/health` is 200** — if it is 503, the limiter is failing
   closed because the DB is down (see `database-outage.md`). The user's 429
   is a symptom of the DB outage, not a rate-limit problem.

5. **Communicate** — tell the user directly (Slack / email if possible):
   "We see you are being rate-limited. Please stop clicking for 60 seconds
   and then refresh. We are investigating."

## Recovery steps

1. **Reset the affected bucket(s).** The simplest path is to clear the
   stuck row(s):
   ```bash
   # Identify the keyHash from step 2 above, then:
   psql "$DATABASE_URL" -c \
     "DELETE FROM \"RateLimitBucket\" WHERE \"keyHash\" = '<the-stuck-hash>';"
   ```
   To reset all buckets (nuclear option — affects every user):
   ```bash
   psql "$DATABASE_URL" -c 'TRUNCATE TABLE "RateLimitBucket";'
   ```
   Use the targeted delete whenever possible.

2. **If the user is in a genuine client-side retry loop**, advise them to:
   - Close all browser tabs of the app.
   - Wait 60 seconds (one full window).
   - Reopen and log in fresh.
   The `ai-analyze-recovery-panel` and other polling components should
   back off, but a stuck browser tab can keep firing.

3. **Consider a temporary limit increase.** If a legitimate user has a real
   workload that exceeds the default (e.g. an admin doing a bulk re-analyze
   across 50 tenders), set in Vercel env:
   ```
   AI_RATE_LIMIT_LIMIT=60
   AI_RATE_LIMIT_WINDOW_MS=60000
   ```
   Redeploy. **Revert this as soon as the bulk operation is complete** —
   high limits defeat the abuse protection.

4. **Check the in-memory fallback.** If the DB-backed limiter is failing,
   the code falls back to an in-memory limiter (`rateLimit` in
   `lib/rate-limit.ts`). On Vercel serverless, each function instance has
   its own in-memory map — so the in-memory limiter is *per-instance* and
   effectively allows `limit × instance_count` requests. This is why the
   DB-backed limiter is preferred. If `RATE_LIMIT_ALLOW_DEGRADED=true` is
   set, the limiter fails open in degraded mode; verify this is intentional
   for your environment.

5. **Forward-fix the retry loop.** If a specific client component is
   retrying too aggressively (no exponential backoff, no jitter), open a
   ticket to add backoff. The `rate-limit-safety.test.ts` and
   `auth-login-rate-limit.test.ts` tests guard this; verify they pass.

## Verification

- The affected user can load the dashboard, open a tender, and trigger one
  AI Analyze without seeing a 429.
- `RateLimitBucket` for the user's key hashes shows `count` well below the
  limit and `resetAt` advancing normally as new requests come in.
- `/api/health` returns 200 (DB is healthy, limiter DB-backed).
- Vercel logs show no new `[rate-limit]` rejections for the user over a
  10-minute observation window.
- Other users are unaffected (a targeted `DELETE` should not have touched
  their buckets).

## Escalation

- **On-call engineer:** page if the rate limiter is failing closed for
  *every* user (DB-backed limiter unavailable and `RATE_LIMIT_ALLOW_DEGRADED`
  not set), or if 429s persist after bucket reset + waiting one full window.
- **Database team:** if the `RateLimitBucket` table is unreadable or the
  `psql` query itself errors, follow `database-outage.md`.
- **Security review:** if a single IP / user is generating the storm via
  what looks like scripted abuse (not a retry loop), consider blocking the
  IP at the Vercel edge (Vercel → Settings → Firewall) and audit the
  account for compromise (see `security-incident.md`).
- **Post-mortem:** file within 48 hours if the storm affected more than one
  user or required a temporary limit increase. Cover: root cause (stuck
  counter, retry loop, scripted abuse), detection time, mitigation, and the
  forward-fix (backoff logic, alerting on high `count` rows, etc.).
