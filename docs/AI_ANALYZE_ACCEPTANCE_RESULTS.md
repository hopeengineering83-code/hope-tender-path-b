# AI Analyze Acceptance Results

**Template version:** 1.0
**Last filled:** _(fill in when you run the harness)_

---

## Deployment under test

| Field | Value |
|-------|-------|
| Deployment URL | _(fill in, e.g. https://hope-tender-path-b-hopeengineering83-codes-projects.vercel.app)_ |
| Deployment ID | _(fill in, e.g. dpl_xxx)_ |
| Git SHA | _(fill in, e.g. d96c8cc)_ |
| Vercel env | _(production / preview / development)_ |
| Test date | _(fill in, e.g. 2026-06-20)_ |
| Tester | _(fill in, e.g. GLM 5.2 + operator name)_ |
| AI providers configured | _(fill in, e.g. GEMINI_API_KEY, MISTRAL_API_KEY)_ |

---

## Automated test results

Run: `npx tsx --test tests/ai-analyze-acceptance-harness.test.ts tests/ai-analyze-regression-guards.test.ts`

| Test file | Tests | Pass | Fail | Result |
|-----------|-------|------|------|--------|
| `tests/ai-analyze-acceptance-harness.test.ts` | _ | _ | _ | _(PASS/FAIL)_ |
| `tests/ai-analyze-regression-guards.test.ts` | _ | _ | _ | _(PASS/FAIL)_ |

**Full suite:** Run `npm test` and record:
- Total tests: _
- Pass: _
- Fail: _
- Result: _(PASS/FAIL)_

---

## PATH 1: Digital multi-page tender — SUCCESS PATH

**Status: _(PASS/FAIL/PENDING)_**

### Automated checks
- [ ] Fixture exists with 5 page markers, M1-M4, evaluation criteria, submission constraints
- [ ] `deriveExtractionStatus` classifies digital tender as `FULL_EXTRACTION_AI_ANALYZED`
- [ ] `detectAnalysisSource` identifies `Analysis source: AI` as `AI`
- [ ] AI Analyze route writes `Analysis source: AI (re-run via AI Analyze button)` marker
- [ ] `AIRequirement` type includes all source-traceability fields
- [ ] Generation gate allows `AI` source
- [ ] Export gate allows `AI` source

### Manual authenticated steps
- [ ] 1. Logged in with dedicated test account
- [ ] 2. Created tender using `synthetic-digital-tender.md`
- [ ] 3. Extraction shows `FULL_EXTRACTION_AI_ANALYZED` (not "All Clear")
- [ ] 4. Page markers preserved (5 pages visible)
- [ ] 5. Metadata source-grounded (tenderTitle matches fixture, not placeholder)
- [ ] 6. AI Analyze clicked and completed
- [ ] 7. Analysis status = `AI_SUCCEEDED` + `Analysis source: AI` marker in notes
- [ ] 8. Requirements include sourcePage, sourceQuote, sourceFileName, sourceConfidence
- [ ] 9. Submission plan can proceed (button enabled)
- [ ] 10. Generation gate opens (Generate Proposal enabled)
- [ ] 11. Export gate opens (Export enabled after generation)

**Notes / issues found:**
_(fill in)_

---

## PATH 2: Weak / scanned tender — must NEVER show "All Clear"

**Status: _(PASS/FAIL/PENDING)_**

### Automated checks
- [ ] Fixture exists with garbled/symbol-noise text
- [ ] `isExtractionCorrupted` flags the garbled text as `true`
- [ ] `deriveExtractionStatus` returns a weak/corrupted status (never `FULL_EXTRACTION_AI_ANALYZED`)
- [ ] `deriveExtractionStatus` returns `EXTRACTION_CORRUPTED_AI_SKIPPED` when text is corrupted (overrides good metrics)
- [ ] `deriveExtractionStatus` returns `EXTRACTION_WEAK_REVIEW_REQUIRED` for empty file list
- [ ] Readiness scoring caps score for weak/corrupted statuses
- [ ] Extraction-quality panel references weak/corrupted statuses

### Manual authenticated steps
- [ ] 1. Logged in with test account
- [ ] 2. Created tender using `synthetic-scanned-weak-tender.md`
- [ ] 3. Extraction panel shows WEAK/CORRUPTED status (NOT "All Clear")
- [ ] 4. AI Analyze blocked or produces `REGEX_FALLBACK_FROM_WEAK_EXTRACTION`
- [ ] 5. Generation gate stays locked
- [ ] 6. Export gate stays locked

**Notes / issues found:**
_(fill in)_

---

## PATH 3: All AI providers unavailable — REGEX_FALLBACK_UNAPPROVED

**Status: _(PASS/FAIL/PENDING)_**

### Automated checks
- [ ] `detectAnalysisSource` identifies `REGEX_FALLBACK_AI_ERROR`, `REGEX_FALLBACK_AI_DISABLED`, `REGEX_FALLBACK_NO_TEXT`
- [ ] Fallback diagnostics maps all 9 categories correctly
- [ ] `AI_PROVIDERS_RATE_LIMITED` branch comes before `RATE_LIMIT` (ordering)
- [ ] Classifier redacts `sk-*`, `AIza*`, `Bearer *` from messages
- [ ] Only safe failure categories in the union (no raw provider bodies)
- [ ] Generation gate uses `ANALYSIS_REGEX_FALLBACK_UNAPPROVED`
- [ ] Export gate blocks `REGEX_FALLBACK_FROM_WEAK_EXTRACTION`
- [ ] AI Analyze route uses `buildAnalysisFallbackDiagnostics` (not raw `err.message`)
- [ ] AI Analyze route does NOT return `error: err.message`

### Manual authenticated steps
- [ ] 1. Simulated all providers unavailable (renamed env vars on PREVIEW deployment)
- [ ] 2. Logged in with test account on preview
- [ ] 3. Created tender using `synthetic-digital-tender.md`
- [ ] 4. Ran AI Analyze
- [ ] 5. Analysis status = `REGEX_FALLBACK_UNAPPROVED` or structured `NO_AI_PROVIDER_READY` error
- [ ] 6. Existing canonical requirements unchanged (not deleted)
- [ ] 7. Generation gate locked (`ANALYSIS_REGEX_FALLBACK_UNAPPROVED`)
- [ ] 8. Export gate locked
- [ ] 9. Fallback diagnostics show SAFE category (not raw error body)
- [ ] 10. No API key visible in UI, diagnostics, or Vercel logs
- [ ] 11. Restored env vars and redeployed

**Notes / issues found:**
_(fill in)_

---

## PATH 4: Failed retry after prior AI success — prior success preserved

**Status: _(PASS/FAIL/PENDING)_**

### Automated checks
- [ ] AI Analyze route strips old `Analysis source:` lines before writing new marker
- [ ] AI Analyze route strips old `Analysis fallback diagnostics:` lines
- [ ] `detectAnalysisSource` reads CURRENT notes (not stale)
- [ ] Generation gate uses `detectAnalysisSourceWithApproval` (reads at call time)
- [ ] Human approval is idempotent (upsert)
- [ ] Old AI marker + new regex marker → correctly shows `REGEX_FALLBACK_AI_ERROR`

### Manual authenticated steps
- [ ] 1. Logged in with test account
- [ ] 2. Created tender, ran AI Analyze successfully (PATH 1 pass)
- [ ] 3. Verified `AI_SUCCEEDED` + requirements populated
- [ ] 4. Simulated provider failure (renamed env vars on preview)
- [ ] 5. Re-ran AI Analyze
- [ ] 6. Analysis now shows `REGEX_FALLBACK_UNAPPROVED` (old AI marker stripped)
- [ ] 7. Generation gate now locked (was open after step 3)
- [ ] 8. Restored env vars and redeployed
- [ ] 9. Re-ran AI Analyze again
- [ ] 10. Analysis now shows `AI_SUCCEEDED` (regex marker stripped)
- [ ] 11. Generation gate open again

**Notes / issues found:**
_(fill in)_

---

## PATH 5: Resume behavior — only unfinished chunks resume

**Status: _(PASS/FAIL/PENDING)_**

### Automated checks
- [ ] `AiAnalyzeCheckpointProgress` includes `resumeAvailable` flag
- [ ] `resumeAvailable = completedChunks > 0 && completedChunks < totalChunks`
- [ ] `getCompletedChunkResults` filters by `SUCCEEDED` only
- [ ] `upsertAnalyzeChunkSucceeded` marks as `SUCCEEDED`
- [ ] `upsertAnalyzeChunkFailed` marks as `FAILED` (retryable)
- [ ] `upsertAnalyzeChunkStarted` re-marks `FAILED` as `RUNNING`
- [ ] `clearAnalyzeCheckpointsForContentHashMismatch` deletes stale-content chunks
- [ ] Progress percent = `completedChunks / totalChunks * 100`
- [ ] Checkpoint error messages redacted (no API key leakage)
- [ ] AI Analyze route uses `getCompletedChunkResults`
- [ ] AI Analyze route uses `clearAnalyzeCheckpointsForContentHashMismatch`

### Manual authenticated steps
- [ ] 1. Logged in with test account
- [ ] 2. Created tender with large source (concatenated fixture > 60K chars)
- [ ] 3. Ran AI Analyze — interrupted mid-run (timeout or manual cancel)
- [ ] 4. Tender detail shows partial analysis + "Resume" button
- [ ] 5. AiAnalyzeChunk table: some `SUCCEEDED`, some `RUNNING`/`FAILED`
- [ ] 6. Clicked "Resume"
- [ ] 7. Vercel logs show "Starting analysis of chunk N" only for unfinished chunks
- [ ] 8. Vercel logs do NOT show "Starting analysis" for already-succeeded chunks
- [ ] 9. Final result merges all chunks into single `AIAnalysisResult`
- [ ] 10. Analysis status = `AI_SUCCEEDED` after resume completes

**Notes / issues found:**
_(fill in)_

---

## Fixture safety verification

- [ ] `synthetic-digital-tender.md` contains no real API keys (sk-, AIza, gsk_, sk-or-, sk-ant-, dsk-)
- [ ] `synthetic-scanned-weak-tender.md` contains no real API keys
- [ ] All emails in fixtures use `@example-synth.org` domain
- [ ] All identifiers use `SYNTH-` prefix
- [ ] No production data, no real client names, no real financial figures
- [ ] No provider outputs stored in fixtures
- [ ] No test-only backdoors added to application source

---

## What could NOT be tested (requires credentials / live deployment)

_(Check all that were verified manually vs. left unverified)_

- [ ] Actual AI provider call returns valid analysis — verified manually in PATH 1
- [ ] Authenticated `POST /api/tenders/[id]/ai-analyze` returns 200 — verified manually in PATH 1
- [ ] DB-backed checkpoint persistence survives cold start — verified manually in PATH 5
- [ ] Vercel function timeout fires at expected boundary — verified manually in PATH 5
- [ ] End-to-end extraction from real PDF upload — verified manually in PATH 1 + 2

---

## Overall verdict

**Production-ready: _(YES/NO/CONDITIONAL)_**

**Conditions (if CONDITIONAL):**
_(list any remaining gaps that must be fixed before production traffic)_

**Sign-off:**
- Tester: _(name)_
- Date: _(date)_
- Deployment URL: _(url)_
- Git SHA: _(sha)_
