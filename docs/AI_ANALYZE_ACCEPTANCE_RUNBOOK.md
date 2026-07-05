# AI Analyze Acceptance Runbook

**Version:** 1.0
**Last updated:** 2026-06-20
**Codebase HEAD:** `d96c8cc` (PR #802 — "unify AI analysis truth") + `84d7143` (PR #803)
**Production deployment:** https://hope-tender-path-b-hopeengineering83-codes-projects.vercel.app

---

## Purpose

This runbook defines the **repeatable acceptance harness** that proves whether
the tender AI Analyze workflow actually works end to end. It is the authoritative
checklist for verifying that a deployment is safe to serve production traffic.

The harness has two layers:

1. **Automated contract tests** (`tests/ai-analyze-acceptance-harness.test.ts` +
   `tests/ai-analyze-regression-guards.test.ts`) — run via `npm test`. These
   verify the WIRING and CONTRACT of every stage without requiring a database,
   authenticated session, or live AI provider keys.

2. **Manual authenticated test steps** (this document, §6) — run by an operator
   against a live deployment using a **dedicated test tender/account**. These
   verify the actual end-to-end behavior including real AI provider calls.

> ⚠️ **Do NOT claim AI Analyze is "solved" or "production-ready" without
> completing BOTH layers.** The automated tests prove the code is wired
> correctly; the manual steps prove the live deployment actually works.

---

## What this harness CAN verify (automated, no credentials)

- The extraction-quality gate correctly classifies strong vs weak vs corrupted
  extraction (PATH 1 + PATH 2).
- The analysis-source detector correctly identifies `AI` vs
  `REGEX_FALLBACK_AI_ERROR` vs `UNKNOWN` based on `tender.notes` markers.
- The fallback-diagnostics classifier maps every failure category
  (TIMEOUT, RATE_LIMIT, AUTH_OR_ACCESS, MODEL_UNAVAILABLE, MALFORMED_AI_JSON,
  ALL_PROVIDERS_EXHAUSTED, AI_PROVIDERS_RATE_LIMITED, NO_PROVIDER_CONFIGURED,
  UNKNOWN_AI_FAILURE) and redacts API keys from the message.
- The checkpoint resume logic only re-runs unfinished chunks
  (`resumeAvailable = completedChunks > 0 && completedChunks < totalChunks`).
- The generation gate blocks when `analysisSource` is
  `REGEX_FALLBACK_UNAPPROVED`.
- The export gate blocks when `analysisExtractionStatus` is
  `REGEX_FALLBACK_FROM_WEAK_EXTRACTION`.
- The AI Analyze route writes the correct `Analysis source:` marker on success
  and strips old markers before writing a new one.
- Requirements include source-traceability fields (`sourcePage`, `sourceQuote`,
  `sourceFileName`, `sourceTenderFileId`, `sourceConfidence`,
  `sourceSectionHeading`).
- No raw provider error body appears in any safe error surface (the route uses
  `buildAnalysisFallbackDiagnostics` which redacts).

## What this harness CANNOT verify (requires credentials / live deployment)

- **The actual AI provider call returns a valid analysis.** The harness verifies
  the contract and wiring, not the live provider response. A provider could
  return a malformed JSON that passes sanitization but is semantically wrong —
  only a live call catches that.
- **The authenticated AI Analyze route `POST /api/tenders/[id]/ai-analyze`
  returns 200 with a real result.** The harness verifies the route's
  source-shape contract, not the live HTTP response. The route requires a valid
  session cookie.
- **The DB-backed checkpoint persistence survives a cold start.** The harness
  verifies the checkpoint logic contract, not the live DB writes. Vercel
  serverless cold starts reset in-memory state; only the `AiAnalyzeChunk` table
  persists across cold starts.
- **The Vercel function timeout fires at the expected boundary.** The harness
  verifies the timeout configuration is wired, not the live timeout. Vercel
  Hobby = 60s, Pro = 300s — the actual kill depends on the deployment tier.
- **The end-to-end extraction from a real PDF upload.** The harness verifies the
  extraction-quality gate logic, not the live PDF parsing. A real PDF may
  trigger edge cases (encrypted, password-protected, corrupted, mixed
  text/image) that the fixture doesn't cover.

These gaps are covered by the manual authenticated test steps in §6.

---

## The 5 Acceptance Paths

### PATH 1: Digital multi-page tender — SUCCESS PATH

**Goal:** Prove that a clean, digital, multi-page tender flows through the
entire pipeline: extraction → AI Analyze → source-grounded requirements →
verified submission plan → generation gate opens → export gate opens.

**Automated checks (run via `npm test`):**
- Fixture `synthetic-digital-tender.md` exists with 5 page markers, 4 mandatory
  requirements (M1-M4), evaluation criteria (70/30), submission constraints.
- `deriveExtractionStatus` classifies the digital tender metrics as
  `FULL_EXTRACTION_AI_ANALYZED`.
- `detectAnalysisSource` identifies `Analysis source: AI` notes as `AI`.
- AI Analyze route writes the `Analysis source: AI (re-run via AI Analyze button)` marker.
- `AIRequirement` type includes all source-traceability fields.
- Generation + export gates allow `AI` source through.

**Manual authenticated steps (§6.1):**
1. Log in to the deployment with a dedicated test account.
2. Create a new tender using `synthetic-digital-tender.md` as the source file.
3. Verify extraction succeeds — the extraction-quality panel shows
   `FULL_EXTRACTION_AI_ANALYZED` (NOT "All Clear" text — it must show the
   specific status).
4. Verify page markers are preserved — the tender detail page shows 5 pages.
5. Verify metadata is source-grounded — `tenderTitle` matches the fixture's
   cover-page title, not a placeholder.
6. Click "AI Analyze" and wait for completion.
7. Verify the analysis status becomes `AI_SUCCEEDED` (or equivalent success
   state — check the tender detail panel + the `Analysis source: AI` marker in
   notes).
8. Verify requirements include source file, page, quote, and confidence — open
   each requirement and confirm the `sourcePage`, `sourceQuote`,
   `sourceFileName`, `sourceConfidence` fields are populated (not null/empty).
9. Verify the submission plan can proceed — the "Build Submission Plan" button
   is enabled.
10. Verify the generation gate opens — the "Generate Proposal" button is enabled
    (not greyed out with a "REGEX_FALLBACK_UNAPPROVED" blocker).
11. Verify the export gate opens — the "Export" button is enabled after
    generation completes.

**Pass criteria:** All 11 manual steps pass + all automated PATH 1 checks pass.

---

### PATH 2: Weak / scanned tender — must NEVER show "All Clear"

**Goal:** Prove that a weak or scanned tender is correctly flagged and the
dashboard never falsely claims the extraction is clean.

**Automated checks:**
- Fixture `synthetic-scanned-weak-tender.md` exists with garbled/symbol-noise text.
- `isExtractionCorrupted` flags the garbled text as `true`.
- `deriveExtractionStatus` returns one of `EXTRACTION_WEAK_REVIEW_REQUIRED`,
  `REGEX_FALLBACK_FROM_WEAK_EXTRACTION`, `EXTRACTION_CORRUPTED_AI_SKIPPED`, or
  `OCR_REQUIRED` — NEVER `FULL_EXTRACTION_AI_ANALYZED`.
- `deriveExtractionStatus` returns `EXTRACTION_CORRUPTED_AI_SKIPPED` when text
  samples are corrupted, even if file metrics look good (corrupted text
  overrides good metrics).
- Readiness scoring caps the score for each weak status.
- The extraction-quality panel references weak/corrupted statuses (otherwise it
  would always show "All Clear").

**Manual authenticated steps (§6.2):**
1. Log in with the test account.
2. Create a new tender using `synthetic-scanned-weak-tender.md` as the source
   file (or upload a real scanned PDF that you know produces poor OCR).
3. Verify the extraction-quality panel shows a WEAK/CORRUPTED status — NOT
   "All Clear". Look for text like "Review Required", "Weak Extraction",
   "Corrupted", or "OCR Required".
4. Verify AI Analyze is either blocked or produces
   `REGEX_FALLBACK_FROM_WEAK_EXTRACTION`.
5. Verify the generation gate stays locked — "Generate Proposal" is greyed out
   with an analysis-source blocker.
6. Verify the export gate stays locked.

**Pass criteria:** The dashboard NEVER shows "All Clear" for this tender + all
automated PATH 2 checks pass.

---

### PATH 3: All AI providers unavailable — REGEX_FALLBACK_UNAPPROVED

**Goal:** Prove that when every configured AI provider fails (rate limit, auth
error, model unavailable, timeout, etc.), the analysis falls back to regex,
is marked as `REGEX_FALLBACK_UNAPPROVED`, existing requirements are NOT
destroyed, and no generation/export unlock occurs.

**Automated checks:**
- `detectAnalysisSource` identifies `REGEX_FALLBACK_AI_ERROR`,
  `REGEX_FALLBACK_AI_DISABLED`, `REGEX_FALLBACK_NO_TEXT` markers.
- `buildAnalysisFallbackDiagnostics` maps every error category correctly:
  - `all providers exhausted` → `ALL_PROVIDERS_EXHAUSTED`
  - `AI_PROVIDERS_RATE_LIMITED` → `AI_PROVIDERS_RATE_LIMITED` (distinct from
    singular `RATE_LIMIT`)
  - `timeout` → `TIMEOUT`
  - `429` → `RATE_LIMIT`
  - `401/403` → `AUTH_OR_ACCESS`
  - `no provider configured` → `NO_PROVIDER_CONFIGURED`
  - unknown → `UNKNOWN_AI_FAILURE`
- The classifier redacts `sk-*`, `AIza*`, `Bearer *` from the message.
- Only safe failure categories appear in the `AnalysisFallbackCategory` union.
- The generation gate uses code `ANALYSIS_REGEX_FALLBACK_UNAPPROVED`.
- The export gate blocks `REGEX_FALLBACK_FROM_WEAK_EXTRACTION`.
- The AI Analyze route uses `buildAnalysisFallbackDiagnostics` (not raw
  `err.message`).
- The AI Analyze route does NOT return `error: err.message` (no raw provider
  error body leakage).

**Manual authenticated steps (§6.3):**
1. **Simulate all providers unavailable:** In the Vercel project settings,
   temporarily rename all AI provider key env vars (e.g. add a `_DISABLED`
   suffix) so the runtime sees no configured providers. Redeploy to a preview
   environment. (Do NOT do this on production.)
2. Log in with the test account on the preview deployment.
3. Create a tender using `synthetic-digital-tender.md`.
4. Run AI Analyze.
5. Verify the analysis status becomes `REGEX_FALLBACK_UNAPPROVED` (or the
   route returns a structured error with `code: "NO_AI_PROVIDER_READY"` or
   similar).
6. Verify existing canonical requirements (if any were created before the
   provider outage) remain unchanged — they must NOT be deleted.
7. Verify no generation unlock occurs — "Generate Proposal" stays greyed out
   with `ANALYSIS_REGEX_FALLBACK_UNAPPROVED`.
8. Verify no export unlock occurs.
9. Verify the fallback diagnostics show a SAFE category (TIMEOUT, RATE_LIMIT,
   AUTH_OR_ACCESS, etc.) — NOT a raw provider error body.
10. Verify no API key appears anywhere in the UI, the diagnostics panel, or
    the Vercel function logs.
11. **Restore the env vars** and redeploy.

**Pass criteria:** All safe-failure behavior confirmed + no secrets leaked + all
automated PATH 3 checks pass.

---

### PATH 4: Failed retry after prior AI success — prior success preserved

**Goal:** Prove that if AI Analyze succeeded previously and a re-run fails, the
system correctly reflects the NEW failure (not stale success), and if the re-run
succeeds after a prior failure, the system correctly reflects the NEW success.

**Automated checks:**
- The AI Analyze route strips old `Analysis source:` and
  `Analysis fallback diagnostics:` lines before writing the new marker.
- `detectAnalysisSource` reads the CURRENT notes (not a stale cached value).
- The generation gate uses `detectAnalysisSourceWithApproval` which reads
  `tender.notes` at call time.
- Human approval of a prior regex fallback is idempotent (upsert, not create).
- A tender with old "Analysis source: AI" + new "Analysis source: regex fallback"
  correctly shows `REGEX_FALLBACK_AI_ERROR` (the old AI marker is stripped).

**Manual authenticated steps (§6.4):**
1. Log in with the test account.
2. Create a tender using `synthetic-digital-tender.md` and run AI Analyze
   successfully (PATH 1).
3. Verify the analysis shows `AI_SUCCEEDED` and requirements are populated.
4. **Simulate a provider failure:** temporarily disable the AI provider keys in
   Vercel (rename env vars) and redeploy to preview.
5. Re-run AI Analyze on the same tender.
6. Verify the analysis now shows `REGEX_FALLBACK_UNAPPROVED` — the prior
   `AI_SUCCEEDED` marker must NOT persist. The tender.notes must show
   `Analysis source: regex fallback (...)` (the old `Analysis source: AI` line
   must be stripped).
7. Verify the generation gate is now locked (it was open after step 3, now
   locked after step 5).
8. **Restore the env vars** and redeploy.
9. Re-run AI Analyze again.
10. Verify the analysis now shows `AI_SUCCEEDED` again — the
    `REGEX_FALLBACK_UNAPPROVED` marker must NOT persist.
11. Verify the generation gate is open again.

**Pass criteria:** The system always reflects the LATEST run's outcome + no
stale markers persist + all automated PATH 4 checks pass.

---

### PATH 5: Resume behavior — only unfinished chunks resume

**Goal:** Prove that if AI Analyze is interrupted mid-run (e.g. Vercel timeout
after chunk 3 of 5), the resume correctly re-runs ONLY the unfinished chunks
(chunk 4 and 5), and does NOT re-run the already-succeeded chunks (1, 2, 3).

**Automated checks:**
- `AiAnalyzeCheckpointProgress` includes `resumeAvailable` flag.
- `resumeAvailable = completedChunks > 0 && completedChunks < totalChunks`.
- `getCompletedChunkResults` only returns `SUCCEEDED` chunks (not `FAILED` or
  `RUNNING`).
- `upsertAnalyzeChunkSucceeded` marks a chunk as `SUCCEEDED` (not re-runnable).
- `upsertAnalyzeChunkFailed` marks a chunk as `FAILED` (retryable on resume).
- `upsertAnalyzeChunkStarted` re-marks a `FAILED` chunk as `RUNNING` (resume
  re-tries failed chunks).
- `clearAnalyzeCheckpointsForContentHashMismatch` deletes chunks with a
  different `contentHash` (stale checkpoints are cleared when content changes).
- The AI Analyze route uses `getCompletedChunkResults` to skip already-succeeded
  chunks.
- The AI Analyze route uses `clearAnalyzeCheckpointsForContentHashMismatch` to
  clear stale checkpoints.
- Checkpoint error messages are redacted (no API key leakage in
  `errorMessage`).

**Manual authenticated steps (§6.5):**
1. Log in with the test account.
2. Create a tender with a LARGE source document (e.g. concatenate
   `synthetic-digital-tender.md` 20 times to exceed the 60K char chunk
   threshold, forcing a multi-chunk analysis).
3. Run AI Analyze. If the run completes in one shot (no timeout), reduce
   `AI_ANALYSIS_TIMEOUT_MS` in the preview env to force a mid-run timeout.
4. Verify the run is interrupted — the tender detail page shows a partial
   analysis with a "Resume" button.
5. Check the `AiAnalyzeChunk` table (via Vercel logs or a DB query) — some
   chunks should be `SUCCEEDED` and some should be `RUNNING` or `FAILED`.
6. Click "Resume".
7. Verify the resume only re-runs the unfinished chunks — the Vercel logs
   should show "Starting analysis of chunk N" only for the unfinished chunk
   indices, NOT for the already-succeeded ones.
8. Verify the completed chunks are NOT repeated — the Vercel logs should NOT
   show "Starting analysis of chunk 1" if chunk 1 was already `SUCCEEDED`.
9. Verify the final result merges all chunks (succeeded + resumed) into a
   single `AIAnalysisResult`.
10. Verify the analysis status becomes `AI_SUCCEEDED` after the resume
    completes.

**Pass criteria:** Resume only re-runs unfinished chunks + completed chunks are
not repeated + all automated PATH 5 checks pass.

---

## Manual Authenticated Test Setup

### Test account requirements

- A **dedicated test account** on the deployment (do NOT use your production
  admin account).
- The test account must have `ADMIN` or `PROPOSAL_MANAGER` role (required to
  trigger AI Analyze).
- The test account must be on a **separate company/workspace** from any real
  production data (to avoid contaminating production tenders).

### Test tender requirements

- Use ONLY the synthetic fixtures in `tests/fixtures/ai-analyze/`:
  - `synthetic-digital-tender.md` — for PATH 1, 3, 4, 5
  - `synthetic-scanned-weak-tender.md` — for PATH 2
- Do NOT use production tender documents for acceptance testing.
- Do NOT upload real client documents, real financial figures, or real contact
  information.

### Provider key requirements

- For PATH 1, 2, 4, 5: at least one AI provider key must be configured in the
  deployment's environment (e.g. `GEMINI_API_KEY` or `MISTRAL_API_KEY`).
- For PATH 3: all provider keys must be temporarily disabled (renamed in the
  Vercel env settings). **Do this on a PREVIEW deployment, not production.**
- **Never store provider keys in fixtures, test files, or committed code.**
  Keys live only in the Vercel project's environment variables.

### Deployment target

- Manual tests should run against a **preview deployment** first, then against
  production after the preview passes.
- The production URL is:
  https://hope-tender-path-b-hopeengineering83-codes-projects.vercel.app
- The production health endpoint is:
  https://hope-tender-path-b-hopeengineering83-codes-projects.vercel.app/api/health

---

## Running the automated tests

```bash
# Install dependencies
npm ci

# Run the full acceptance harness + regression guards
npx tsx --test tests/ai-analyze-acceptance-harness.test.ts tests/ai-analyze-regression-guards.test.ts

# Or run them as part of the full suite
npm test
```

The automated tests do NOT require:
- A database (they use pure-function imports + source-shape assertions)
- An authenticated session (they don't call HTTP routes)
- Live AI provider keys (they don't make real AI calls)
- A Vercel deployment (they run locally)

---

## Recording results

After completing the automated + manual tests, fill in the results template at
`docs/AI_ANALYZE_ACCEPTANCE_RESULTS.md`. This creates a verifiable record that
the acceptance harness was run against a specific deployment on a specific date.

---

## When to re-run this harness

- Before every production deployment that touches the AI Analyze workflow
- After any change to `lib/ai.ts`, `lib/engine/analysis-source.ts`,
  `lib/engine/analysis-fallback-diagnostics.ts`, `lib/engine/extraction-quality-gate.ts`,
  `lib/ai-analyze-checkpoints.ts`, or `app/api/tenders/[id]/ai-analyze/route.ts`
- After any AI provider key rotation
- After any Vercel plan change (Hobby → Pro → Enterprise) that changes function
  timeout limits
- After any database migration that touches `TenderRequirement`,
  `AiAnalyzeChunk`, `AiJob`, or `ComplianceGap` tables
- Monthly as a production-readiness smoke test
