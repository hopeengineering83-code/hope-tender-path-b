# Production Reliability Runbook

This runbook covers common failure categories for the Hope Tender Path
application, what users see, what admins/developers should check, and safe
retry steps.

## Common Failure Categories

### 1. Upload Failed

**What the user sees:** "Upload failed" or "File could not be processed" on
the tender creation page. The tender is NOT created (all uploads are atomic —
if any file fails, no tender row is created).

**What to check:**
- File format: only PDF, DOCX, XLSX, CSV, TXT, PPTX, RTF are supported.
  Legacy .doc and .xls are rejected.
- File size: per-file limit is 10 MiB, batch limit is 30 MiB / 10 files.
- Empty files are rejected.
- Check server logs for `[upload-first]` entries with the diagnostic ID.
- If using Vercel Blob storage, verify `BLOB_READ_WRITE_TOKEN` is set and
  the Blob store is accessible.

**Safe retry:** Yes — re-upload the files. No tender was created, so no
cleanup is needed. If the same file is uploaded again to a different tender,
it will be accepted (content hash dedup is per-tender, not global).

**When NOT to retry:** If the error is "File type not supported" or "File
exceeds size limit" — fix the file first.

---

### 2. Extraction Failed

**What the user sees:** The tender is created but the extraction quality panel
shows "Extraction failed" or "Corrupted text detected." The tender status is
set to block AI Analyze.

**What to check:**
- Check the Extraction Quality panel for per-file status.
- If "OCR required" — the PDF is scanned (image-only). Set
  `PDF_OCR_ENABLED=true` and `ANTHROPIC_API_KEY` in the environment, then
  re-extract.
- If "Corrupted text" — the PDF text layer is garbage (icon fonts, encoding
  issues). OCR fallback should trigger automatically if configured.
- Check server logs for `[extract-text]` entries.
- For DOCX/XLSX: check if the file is password-protected or uses unsupported
  features (macros, ActiveX — these are rejected at upload time).

**Safe retry:** Yes — use the "Re-extract" button on the file. This updates
the file in place (no duplicate records). If re-extracting all files, be
aware this is a sequential operation that may time out on large tenders.

**When NOT to retry:** If the file is corrupted at the binary level — upload
a fresh copy.

---

### 3. OCR Timeout

**What the user sees:** "OCR timed out" or the extraction returns very little
text from a scanned PDF.

**What to check:**
- `PDF_OCR_TIMEOUT_MS` (default 40s) — increase if the PDF has many pages.
- `PDF_OCR_MAX_PAGES` (default 50) — for 80+ page PDFs, chunking is automatic.
- `ANTHROPIC_API_KEY` — must be set for OCR to work.
- Check if Anthropic is overloaded (529 error) — the system retries once
  after 2s, then surfaces `[OCR_RATE_LIMITED]`.
- Check `PDF_OCR_MAX_CONTINUATIONS` (default 3) — if the output is truncated,
  increase this.

**Safe retry:** Yes — re-extract the file after the timeout. Partial OCR
text is NOT stored (the system returns the timeout marker, not partial text).

**When NOT to retry:** If Anthropic is down (529 persists) — wait and retry
later.

---

### 4. AI Provider Timeout

**What the user sees:** "AI analysis failed" or the analysis status shows
"FAILED." The tender cannot proceed to generation until analysis succeeds or
a fallback is approved.

**What to check:**
- Check the AI Health panel for provider status.
- The automatic fallback order is: Gemini → Groq → Mistral → Z.ai →
  OpenRouter (only with a verified `:free` model). If all of them fail, the
  system falls back to regex extraction. Cerebras, OpenAI, Together, DeepSeek
  and Anthropic require paid access and are never contacted — if one shows
  `BILLING_BLOCKED`, that is the intended state, not a fault to fix.
- Check server logs for `[ai-analyze]` entries with the `failureCategory`.
- Check `AI_ANALYSIS_TIMEOUT_MS` (default 50s on Hobby, 240s on Pro).
- If using background mode (?mode=background), check the AiJob status in the
  database: `SELECT id, status, failureCategory FROM "AiJob" WHERE
  "tenderId" = '...' ORDER BY "createdAt" DESC LIMIT 1;`

**Safe retry:** Yes — re-run AI Analyze. The system automatically cleans up
stale RUNNING jobs >90s old before starting a new one. Background mode
preserves chunk checkpoints for resume.

**When NOT to retry:** If all providers are down (check the AI Health panel)
— wait for recovery. If the extraction is corrupted, fix extraction first.

---

### 5. Generation Failed

**What the user sees:** "Document generation failed" or generated documents
show "FAILED" status. The tender cannot be exported.

**What to check:**
- Check the Generation Readiness panel for blockers.
- Check server logs for `[generate]` entries.
- If documents are stuck in "GENERATING" status — this means the function
  was hard-killed by Vercel before it could mark them as FAILED. The cleanup
  cron (every 30 min) marks GENERATING docs older than 30 min as FAILED.
- Verify the submission plan is confirmed (Build Plan must be CONFIRMED
  before generation).
- Check if `GENERATION_IN_PROGRESS` is returned — this means another
  generation is already running for this tender. Wait for it to complete.

**Safe retry:** Yes — after fixing blockers, click Generate again. Stuck
GENERATING docs will be marked FAILED by the cron, allowing a new generation
to start.

**When NOT to retry:** If the AI provider is down — wait for recovery. If
the submission plan is not confirmed — confirm it first.

---

### 6. Export Blocked

**What the user sees:** The Export button is disabled or shows "Blocked." The
Export Readiness panel lists specific blockers.

**What to check:**
- Check the Export Readiness panel for the exact blocker list.
- Common blockers: unconfirmed submission plan, missing required documents,
  validation failures, source grounding gaps, tender facts not confirmed.
- Check the Final Package Manifest for document-level issues.
- Verify the canonical readiness score — if < 50, export is blocked.

**Safe retry:** Yes — after resolving all blockers, the export button will
become enabled. No cleanup is needed.

**When NOT to retry:** If blockers are not resolved — the gate is fail-closed
by design.

---

### 7. ZIP Creation Failed

**What the user sees:** "Download failed" or the ZIP download produces a
corrupted/empty file.

**What to check:**
- Check server logs for `[download]` entries.
- Verify `FINAL_ZIP_MAX_INPUT_BYTES` — if the total document size exceeds
  this, the route returns 413 before attempting ZIP assembly.
- Check if any generated document has no stored content (fileContent is null
  and storagePath is null) — this indicates a failed generation that was
  not properly marked as FAILED.
- Check for concurrent download attempts — each materializes the full ZIP
  in memory. Multiple concurrent downloads can OOM the function.

**Safe retry:** Yes — re-download. The ZIP is assembled fresh each time.

**When NOT to retry:** If the function is OOMing (check Vercel logs for
"Function exceeded memory limit") — reduce the package size or contact admin
to increase the function memory.

---

## Diagnostic IDs

All error responses include a diagnostic ID that can be used to correlate
client-side errors with server-side logs:

- **x-request-id header**: Set on every response by the middleware. Search
  logs with `requestId: "<id>"`.
- **error.digest**: Set by Next.js error boundaries on unhandled exceptions.
  Search logs with `digest: "<id>"`.
- **diagnosticId**: Set by some routes (extraction-quality, tender DELETE)
  in the response body. Search logs with `diagnosticId: "<id>"`.
- **correlationId**: Set by the tender DELETE route. Search logs with
  `correlationId: "<id>"`.

---

## Safe Retry Steps

1. **Upload**: Always safe to retry — no tender is created on failure.
2. **Re-extract**: Always safe — updates the file in place.
3. **AI Analyze**: Safe after waiting 90s (stale RUNNING job cleanup).
   Background mode preserves checkpoints for resume.
4. **Generate**: Safe after GENERATING docs are marked FAILED (automatic
   after 30 min, or manually by admin).
5. **Validate**: Always safe — read-only operation.
6. **Export**: Safe after all blockers are resolved.
7. **Download**: Always safe — ZIP is assembled fresh.

---

## When NOT to Retry

- **Upload**: If the file format is unsupported or the file is too large.
- **Extraction**: If the file is binary-corrupted — upload a fresh copy.
- **OCR**: If Anthropic is down (persistent 529).
- **AI Analyze**: If all providers are down — wait for recovery.
- **Generation**: If the submission plan is not confirmed.
- **Export**: If blockers are not resolved.
- **Download**: If the function is OOMing — reduce package size.

---

## Avoiding Vercel Deployment Churn

- Do NOT trigger manual Vercel deployments from the CLI.
- Let Vercel auto-deploy on merge to main.
- Preview deployments are created automatically for PRs — do not create
  additional preview deployments.
- If a build fails on Vercel, check the build logs for the specific error
  before pushing a fix. Common causes: missing env vars, Prisma generate
  failures, type errors.

---

## Release-Blocker Checklist for Reliability Issues

Before merging any PR that touches upload, extraction, AI analyze, generation,
validation, export, or storage:

- [ ] No raw Prisma error text in API responses (use `sanitizeErrorResponse`)
- [ ] No raw `error.message` in client `setError` calls (use `safeApiErrorMessage`)
- [ ] All mutation routes have idempotency checks (in-progress guard, unique
      constraint, or advisory lock)
- [ ] All long-running operations have explicit timeouts
- [ ] Failed operations mark status as FAILED (not stuck RUNNING)
- [ ] Cleanup cron covers: old AiJobs, ExportPackages, superseded
      GeneratedDocuments (with blob cleanup)
- [ ] Tender deletion cleans up all blob storage (source files + generated docs)
- [ ] Source-file deletion nullifies all references (requirements, ledger,
      overrides, emails)
- [ ] No `fileContent` blobs loaded in list/count endpoints
- [ ] All queries include `userId` scoping for tender-specific routes
- [ ] No N+1 query patterns in transaction-critical paths
- [ ] Rate limits on download, re-extract-all, and other expensive operations
- [ ] Error responses include diagnostic/request IDs
- [ ] `npm run build` passes without errors
- [ ] `npx tsc --noEmit` passes without errors
- [ ] `npm run lint` passes without errors
- [ ] All existing tests pass
