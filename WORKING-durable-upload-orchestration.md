# WORKING — Durable Upload Orchestration and Real Acceptance

## Exact SHAs

- **Starting SHA (branch base):** `375941fb` (exact head of PR #1175 / `release/consolidated-recovery-20260717`)
- **main SHA:** `820c9cb0`
- **PR #1175 head SHA:** `375941fbd12ce0f9826991a5022ea386eedef0d6`
- **Production SHA:** `820c9cb0` (unchanged)

## Screenshots/Artifacts Inspected

- CI screenshot artifact `hope-tender-exact-head-route-screenshots-375941fb` (23.5 MB)
  - 79 routes × 3 viewports = 237 screenshots
  - audit-summary.json: `routeCoveragePercent: 100`, `critical: 0`, `horizontalOverflow: 0`, `warning: 0`
- VLM line-by-line inspection of:
  - `036-dashboard-tenders-new.png` (New Tender upload page) — NO GAPS
  - `033-dashboard-tenders-11111111-...png` (Tender detail/workspace) — NO GAPS
- Vercel preview: `https://hope-tender-path-b.vercel.app/api/version` → sha `820c9cb0` (production)

## Open-PR Overlap Matrix

| PR | Target | Files | Overlap with this workstream? |
|----|--------|-------|-------------------------------|
| #1175 | integration/controlled-recovery | (base) | No — this PR builds on it |
| #1258 | main | 5 files (action-center, generate-elite, operator_handoff, 2 tests) | No — DOCX/PDF rendering scope |
| #1259 | main | 1 file (operator_handoff.md) | No — documentation only |
| #1260 | release/consolidated-recovery | 9 files (tender-authority modules) | No — workstream #2, non-overlapping |

No overlap with any open PR. This workstream touches upload orchestration, job durability, and acceptance harness — none of which are in #1258, #1259, or #1260.

## Confirmed Additional Gaps (from 3-pass audit)

### Gap A — Client-side AI_ANALYZE trigger (real gap)
`app/dashboard/tenders/new/page.tsx` calls `triggerTenderUploadAutoPipeline(data)` from the browser after upload-first. This fires `POST /api/tenders/:id/ai-analyze?mode=background` from the client. If the browser is closed before the fetch completes, the job is never enqueued. The task says "Every UI status must come from durable server state."

**Fix:** Move the AI_ANALYZE enqueue from the client to the server-side upload-first handler. The client should only navigate to the tender detail page; the server enqueues the job as the final step of upload-first, after all batches are committed.

### Gap B — No idempotent intake session (real gap)
The current flow: upload-first creates the tender + first batch, returns `tenderId`, then the client appends additional batches via `/api/upload`. There is no intake session ID or idempotency key — if the client crashes between batch 1 and batch 2, the user must manually figure out which files were uploaded.

**Fix:** Add an `intakeSessionId` to the upload-first response. Additional batches include this session ID. The server tracks expected vs. received batches and only enqueues AI_ANALYZE when all batches are committed.

### Gap C — Synchronous whole-vault reprocessing (real gap)
`lib/secure-upload-handler.ts` line 239 calls `ingestCompanyVault(company.id)` synchronously during the upload request. This re-ingests the ENTIRE vault for every uploaded company document.

**Fix:** Replace with a per-document `VAULT_INGEST` job that processes only the newly uploaded document. The final ingestion revision is finalized only after the complete selected package is processed.

### Gap D — No capability-specific readiness for OCR (partial gap)
`lib/ai-environment-readiness.ts` already has OCR-specific readiness checks. But the UI's general "AI readiness" can show "ready" when scanned-PDF OCR is unavailable.

**Fix:** Add a `capabilityReadiness` resolver that separates analysis AI, proposal AI, OCR, storage, database, and worker dispatch. Surface the exact safe corrective action without exposing keys.

### Gap E — No durable retry for EXTRACT_TEXT and VAULT_INGEST (partial gap)
Retry exists for AI_ANALYZE (via `ai-analyze/retry-service.ts`) and the worker has generic retry logic. But EXTRACT_TEXT and vault ingestion don't have stage-specific checkpoint recovery.

**Fix:** Add stage-specific retry state and checkpoint recovery for EXTRACT_TEXT, VAULT_INGEST, and ENGINE_RUN.

### Gap F — No populated golden-path acceptance harness (real gap)
The existing tests use source-level assertions, not a populated end-to-end workflow with a sanitized company vault, reviewed experts/projects, brand assets, and a healthcare tender fixture.

**Fix:** Build a populated golden-path acceptance harness that verifies the complete gated workflow from upload to ZIP readiness.

## Proposed Changed Areas

1. `lib/tender-upload-first.ts` — server-side AI_ANALYZE enqueue after all batches
2. `lib/ui/auto-pipeline.ts` — deprecate client-side trigger (keep as no-op for backward compat)
3. `app/dashboard/tenders/new/page.tsx` — remove client-side auto-pipeline call
4. `lib/secure-upload-handler.ts` — replace synchronous vault reprocessing with VAULT_INGEST job
5. `lib/ai-jobs.ts` — add `VAULT_INGEST` job type
6. `lib/ai-job-handlers.ts` — add VAULT_INGEST handler
7. `lib/engine/capability-readiness.ts` (NEW) — capability-specific readiness resolver
8. `lib/engine/upload-intake-session.ts` (NEW) — idempotent intake session tracker
9. `tests/durable-upload-orchestration.test.ts` (NEW) — load-bearing regression tests
10. `tests/golden-path-acceptance.test.ts` (NEW) — populated golden-path acceptance harness

## Constraints

- Do NOT merge, retarget, deploy production, or run production migrations.
- Do NOT duplicate workstream #1 (DOCX/PDF rendering) or workstream #2 (tender-authority).
- Keep the PR draft.
- Do not resurrect components already deleted on PR #1175.
