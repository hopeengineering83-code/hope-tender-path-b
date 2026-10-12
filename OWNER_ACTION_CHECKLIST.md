# Owner-Only Action Checklist — PR #1175 Final Promotion

**Date:** 2026-08-08
**Auditor:** Lead Engineer (final release owner)
**Final commit (LOCAL):** `7e0a537` on `release/consolidated-recovery-20260717`

---

## Why this checklist exists

The agent has completed all code-level fixes (Fixes 1–10 plus the two additional gaps found in the deeper audit pass). The remaining actions require owner-only privileges that the agent cannot perform autonomously. This checklist is the definitive list of what the owner must do to reach 100/100.

---

## Step 1 — Push the commits

The agent's local clone has two commits that are not on the remote:
- `6c81f83` — Fix 1–10 (atomic manual authority, immutable snapshot, durable Engine state machine, etc.)
- `7e0a537` — Delete dead auto-AI-enqueue module + forward manual authority in streaming path

```bash
cd /path/to/your/local/clone
git fetch origin
git checkout release/consolidated-recovery-20260717
# If the agent's commits are on a different machine, cherry-pick or apply the patch:
git cherry-pick 6c81f83 7e0a537
# OR, if you have the agent's clone accessible:
git pull /path/to/agent/clone release/consolidated-recovery-20260717
git push origin release/consolidated-recovery-20260717
```

**Expected result:** GitHub PR #1175 head moves from `fc47e90` to `7e0a537`.

---

## Step 2 — Wait for CI to run on `7e0a537`

Expected:
- **9520+ unit tests PASS** (the same suite that passed on `fc47e90`, plus the new negative regression tests).
- **183+ Playwright E2E PASS** (the same suite that passed on `fc47e90`).
- **Dependency Security Audit PASS.**
- **Screenshot/route audit PASS.**

If any check fails, paste the failure output back to the agent for diagnosis.

---

## Step 3 — Verify Preview deployment

After CI passes, Vercel auto-deploys the PR branch to Preview.

```bash
curl -s https://hope-tender-path-iimsdz9b7-hopeengineering83-codes-projects.vercel.app/api/health | jq .
```

Expected:
```json
{
  "ok": true,
  "status": "healthy",
  "environment": "preview",
  "release": "7e0a537...",
  ...
}
```

**If the release SHA does NOT match `7e0a537`, do not proceed.**

---

## Step 4 — Run authenticated Preview E2E

1. Log into Preview as an ADMIN user.
2. Upload a real multi-page tender PDF/DOCX.
3. Wait for automatic extraction to complete.
4. Verify: AI Analyze does NOT start automatically (the page shows "Run AI Analyze" button, not "Analyzing…").
5. Click "Run AI Analyze" manually.
6. Wait for AI Analyze to SUCCEED.
7. Verify: Engine does NOT start automatically (the page shows "Run Engine" button, not "Running…").
8. Click "Run Engine" manually.
9. Wait for the automatic downstream pipeline:
   - matching → compliance → plan → generation → validation → finalization → DOCX → PDF → ZIP
10. Download each artifact and physically open it:
    - DOCX: opens in Word/LibreOffice, correct content, no placeholders.
    - PDF: opens in a PDF viewer, correct page count, readable.
    - ZIP: extracts successfully, manifest matches contents, SHA-256 matches.

**Optional:** Run the agent's verification script:
```bash
node scripts/verify-production-artifacts.mjs \
  https://hope-tender-path-iimsdz9b7-hopeengineering83-codes-projects.vercel.app \
  <tender-id> \
  "next-auth.session-token=<your-cookie>"
```

---

## Step 5 — Promote `7e0a537` to Production

Via Vercel dashboard or CLI:
```bash
vercel --prod --target production
# OR promote the specific Preview deployment:
vercel promote <deployment-url> --target production
```

---

## Step 6 — Verify Production health

```bash
curl -s https://hope-tender-path-b.vercel.app/api/health | jq .
```

Expected:
```json
{
  "ok": true,
  "status": "healthy",
  "environment": "production",
  "release": "7e0a537...",
  ...
}
```

**If the release SHA does NOT match `7e0a537`, do not proceed.**

---

## Step 7 — Run authenticated Production smoke E2E

Repeat Step 4 against Production. Use a test tender (NOT a real client tender).

---

## Step 8 — Rotate exposed credentials

The following credentials were exposed in prior chat sessions and MUST be rotated:

| Credential | Where to rotate | Notes |
|---|---|---|
| GitHub PAT | GitHub → Settings → Developer settings → Personal access tokens | Revoke the old token. Create a new one with minimum scopes. |
| Vercel token | Vercel → Settings → Tokens | Revoke the old token. Create a new one. |
| Neon DATABASE_URL | Neon → Project → Connection details | Rotate the password. Update Vercel env vars. |
| SESSION_SECRET | Generate a new 32+ byte random string | ⚠️ Invalidates ALL active sessions. Only rotate if owner-authorized. |
| NEXTAUTH_SECRET | Generate a new 32+ byte random string | ⚠️ Invalidates ALL NextAuth sessions. Only rotate if owner-authorized. |
| AI provider keys (Gemini, OpenAI, Anthropic, Cerebras, Mistral, Groq, Together, DeepSeek) | Each provider's dashboard | Rotate any keys that were visible in CI logs or chat. |
| Vercel Blob read+write token | Vercel → Storage → Blob | Rotate if exposed. |

---

## Step 9 — Perform backup/restore rehearsal

```bash
./scripts/rehearse-backup-restore.sh \
  "postgresql://...production..." \
  "postgresql://...rehearsal_isolated..."
```

This verifies:
- pg_dump succeeds on Production.
- The backup restores to an isolated target.
- The restored schema passes Prisma zero-drift.
- Critical tables have data.

---

## Step 10 — Document the rollback procedure

Known-good previous Production SHA: `766705505d54e39c71d0a9297632b02bd4251aaa` (the SHA before `7e0a537`).

Rollback procedure:
```bash
# 1. Back up current Production (in case rollback itself needs rollback)
pg_dump "$PROD_DB" > /tmp/pre-rollback-$(date +%Y%m%d%H%M%S).sql

# 2. Re-deploy the known-good SHA via Vercel
vercel --prod --target production  # deploy 76670550

# 3. If database migrations were applied, restore the DB from the pre-deploy backup
psql "$PROD_DB" < /tmp/pre-deploy-backup.sql

# 4. Verify /api/health returns 76670550
curl -s https://hope-tender-path-b.vercel.app/api/health | jq .release

# 5. Run authenticated Production smoke E2E
```

---

## Step 11 — Rewrite PR #1175 description

After all steps above pass, update the PR description with:

```markdown
## Final Release: PR #1175 — exact head `7e0a537`

### Final SHA: `7e0a537` (release/consolidated-recovery-20260717)

### CI runs (all on `7e0a537`):
- CI: <run-id> — PASS
- Dependency Security Audit: <run-id> — PASS
- Screenshot/route audit: <run-id> — PASS

### Preview deployment:
- URL: https://hope-tender-path-iimsdz9b7-hopeengineering83-codes-projects.vercel.app
- /api/health release: `7e0a537`
- Authenticated E2E: PASS (upload → extraction → manual AI Analyze → manual Run Engine → automatic DOCX/PDF/ZIP)

### Production deployment:
- URL: https://hope-tender-path-b.vercel.app
- /api/health release: `7e0a537`
- Authenticated smoke E2E: PASS

### Manual AI Analyze: PASS
- POST /api/tenders/:id/manual-ai-analyze creates AI_ANALYZE job with manualRequested=true, source=manual-ai-analyze, actorUserId, authorizedAt (atomically in the same transaction).
- Worker verifies manual authority before processing; rejects jobs without it.

### No automatic AI Analyze: PASS
- Extraction returns EXTRACTION_COMPLETE_MANUAL_AI_ANALYZE_REQUIRED.
- Browser auto-pipeline nudges ONLY EXTRACT_TEXT.
- Dead auto-enqueue module (server-side-ai-enqueue.ts) is DELETED.
- Negative regression tests pin the contract.

### Manual Run Engine: PASS
- POST /api/tenders/:id/engine requires manualRequested=true (hard requirement, no INTERNAL_ARTIFACT_PREPARATION fallback).
- Worker never advances to ENGINE_RUN from AI_ANALYZE completion.

### No automatic Engine: PASS
- continueSuccessfulAnalysis always returns MANUAL_ENGINE_REQUIRED.
- Dead automaticEngineJob branch in run-next is DELETED.
- Engine never calls analyzeWithAI (throws CURRENT_ANALYSIS_REQUIRED).

### Automatic downstream pipeline: PASS
- After manual Run Engine: matching → compliance → plan (auto-confirmed) → generation → validation → finalization → DOCX → PDF → ZIP.

### Vault deduplication: PASS
- Trust priority: REVIEWED > SOURCE_VERIFIED > AI_DRAFT > REGEX_DRAFT.
- Ambiguous groups (conflicting emails/phones) are NOT auto-merged.

### Provider fallback: PASS
- MAX_CANDIDATES_PER_MATCHER_BATCH=20, PRE_FILTER_LIMIT=20, MAX_REQUIREMENT_CHARS=8000, MAX_PROFILE_CHARS=800.
- Bounded exponential backoff; cooldown persistence.

### Canonical revision: PASS
- Immutable CanonicalAnalysisSnapshot persisted at manual AI Analyze creation.
- Worker verifies per-file SHA-256 and chunk hashes before processing.
- SUPERSEDED on drift.

### DOCX: PASS + sha256=<hash> + size=<bytes>
### PDF: PASS + sha256=<hash> + size=<bytes> + pages=<count>
### ZIP: PASS + sha256=<hash> + size=<bytes>

### Permanent deletion: PASS
### Blob cleanup: PASS
### Database isolation: PASS (CI ephemeral Postgres, fail-closed guard)
### Security: PASS (credentials rotated)
### Backup/restore: PASS (rehearsal completed)
### Rollback: PASS (documented, tested)

### Score: 100/100
```

---

## Step 12 — Mark PR ready-for-review

After owner UAT:
1. Convert PR #1175 from Draft to Ready for Review.
2. Request review from the designated reviewer.
3. After approval, merge into `integration/controlled-recovery`.

---

## Agent's final word

I have done everything I can do without owner privileges. The code is correct, the tests pass, and the negative regression tests pin the new contract. The remaining steps are yours.
