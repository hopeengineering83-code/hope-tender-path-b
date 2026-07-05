# Runbook: Security Incident (Leaked Key / Suspected Breach)

## When to use

Use this runbook when an API key or credential has been leaked, when a
session token may have been stolen, or when there is any sign of unauthorized
access to the production database or AI providers. **Treat this as a P0
incident — speed of rotation matters more than perfect forensics.**

Trigger this runbook if:
- A provider dashboard (Z.ai, Cerebras, OpenRouter, etc.) shows suspicious
  API usage spikes you cannot attribute to your deployment.
- A key appears in a public place (git history, a Slack screenshot, a Vercel
  log line, a support ticket attachment).
- An audit log entry (`/api/audit`) shows admin actions from an IP or user
  that should not have access.
- A user reports seeing another user's data (cross-tenant leak).

## Symptoms

- **Unusual API usage:** a provider's monthly token spend jumps 5–10× without
  a corresponding product change. Provider dashboards show requests from IPs
  outside your deployment regions.
- **Leaked key in logs / git:** `git log -p | grep -E '(sk-|AIza|Bearer )'`
  returns hits, or Vercel logs show a raw `Authorization:` header value.
- **Audit anomalies:** `/api/audit` records actions from a user id that the
  admin does not recognize, or actions at times the user was not active.
- **Auth spikes:** `/api/auth/login` returns 200 for an unusually high number
  of requests from a single IP (brute-force or session-stuffing pattern).
- **Cross-tenant data:** a user reports seeing tenders or files belonging to
  another company.

## Immediate steps (first 10 minutes — rotate first, investigate second)

1. **Rotate ALL AI provider keys immediately.** Do not wait for confirmation;
   rotate every key in Vercel → Settings → Environment Variables:
   - `ZAI_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`,
     `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`,
     `OPENAI_API_KEY`, `TOGETHER_API_KEY`, `DEEPSEEK_API_KEY`,
     `ANTHROPIC_API_KEY`
   - Generate fresh keys in each provider console and revoke the old ones at
     the provider side (not just in Vercel — revoke at the source).
   - Update Vercel env vars for Production / Preview / Development.

2. **Rotate `DATABASE_URL` if a DB credential was exposed.** In the Neon
   console: rotate the project password, then update `DATABASE_URL` in
   Vercel. If the connection string itself leaked, treat the Neon project as
   compromised and follow `neon-switch.md` to migrate to a fresh project.

3. **Revoke all active sessions.** Truncate the session table so every user
   is forced to log in again:
   ```bash
   # Run against the production DATABASE_URL — destructive, only in incident
   psql "$DATABASE_URL" -c 'TRUNCATE TABLE "Session" CASCADE;'
   ```
   Also rotate `AUTH_SECRET` / `NEXTAUTH_SECRET` in Vercel (this invalidates
   all signed session cookies even if some rows survived).

4. **Force password reset for ADMIN accounts.** Use the secure-password-reset
   flow (`lib/secure-password-reset.ts`) or set a temporary password and
   notify each admin out-of-band.

5. **Redeploy** so the rotated env vars take effect:
   ```bash
   git commit --allow-empty -m "chore: redeploy after key rotation (security incident)" && git push
   ```

6. **Communicate internally** — page the on-call lead and the security
   contact. Do NOT post user-facing comms yet; wait until scope is known.

## Recovery steps

1. **Check the audit log** — pull all entries from the suspected incident
   window:
   ```bash
   # Admin only — requires ADMIN session cookie
   curl -s "https://YOUR_DEPLOYMENT_URL/api/audit?since=2026-06-21T00:00:00Z" \
     -H "Cookie: $ADMIN_COOKIE" | jq .
   ```
   Look for: admin actions from unfamiliar IPs, bulk exports, mass downloads,
   `ADMIN_RELEASE_STUCK_JOBS` calls you did not make.

2. **Check provider usage logs** — each provider console shows per-key
   request logs. Identify the time of first suspicious request; that
   bounds the exposure window. Anything before key rotation is potentially
   compromised.

3. **Check Vercel access log** — Vercel → Project → Logs → filter the
   incident window. Look for 200s on admin-only routes from non-admin IPs,
   or spikes in `/api/tenders/[id]/files/[fileId]` downloads.

4. **Check git history for the leak** (if key appeared in a commit):
   ```bash
   git log --all -p | grep -E '(sk-[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{35})'
   ```
   If found, the key must be considered leaked even if the commit was
   force-pushed away — GitHub caches commits.

5. **Notify affected users** if PII or tender content was exposed. Be honest
   about scope and timeline. Provide remediation (free credit monitoring is
   not relevant here, but tender content exposure may have commercial
   implications).

6. **Notify affected providers** — if a key was used to run unauthorized
   workloads, file a support ticket with the provider so they can refund /
   block the abusive traffic and you do not pay for it.

7. **Apply forward-fixes** — if the leak came from a code path that logged
   a key or returned it in an API response, open a P0 ticket to harden that
   path. The `provider-health-redaction` test exists to prevent this; verify
   it is still green.

## Verification

- Every AI provider key in Vercel is newer than the incident start time, and
  the old key is revoked at the provider console (verify by attempting a
  request with the old key — it must return 401/403).
- `Session` table is empty; every user must re-authenticate.
- `AUTH_SECRET` has been rotated and redeployed.
- `/api/ai/health` returns `ok: true` with the new keys (runtime-verified).
- Audit log shows no new entries from the compromised user / IP.
- No suspicious traffic in provider dashboards after rotation.
- `provider-health-redaction.test.ts` and `security-hardening.test.ts`
  pass locally and in CI.

## Escalation

- **On-call lead + security contact:** page immediately on suspicion; do not
  wait for confirmation. The cost of a false alarm is tiny; the cost of a
  slow rotation is catastrophic.
- **Legal / compliance:** notify if PII or regulated content was exposed, or
  if the breach may trigger contractual notification clauses with customers.
- **Provider security teams:** notify each affected provider's security contact
  so they can flag the leaked key across their network.
- **Law enforcement:** defer to legal counsel; typically only relevant if the
  attacker is identifiable and the loss is material.
- **Post-mortem:** mandatory within 24 hours. Cover: how the key leaked,
  exposure window, what data may have been accessed, rotation timeline,
  prevention (CI secret scanning, redaction tests, access controls). File as
  a confidential doc — do not include any non-rotated secrets in the writeup.
