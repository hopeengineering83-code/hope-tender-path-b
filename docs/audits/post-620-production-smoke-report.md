# Production Smoke Audit & Route Hardening Report

**Audit Date:** 2026-06-07T15:37:06Z
**Status:** COMPLETE
**Scope:** Post-#620 baseline verification, route-level safety hardening, and smoke testing.

## Audited Routes & Security Posture

| Route | Status | Hardening Applied |
| :--- | :--- | :--- |
| `/api/health` | ✅ SAFE | Caching implemented; DB reachability check included. |
| `/api/tenders/[id]` | ✅ HARDENED | Explicit `select` guards added to prevent `fileContent` leakage. |
| `/api/tenders/[id]/pipeline-diagnostic` | ✅ SAFE | Read-only explicit selects; NO `fileContent` returned. |
| `/api/tenders/[id]/authority-review` | ✅ SAFE | Structured response with critical blocker detection. |
| `/api/tenders/[id]/download` | ✅ HARDENED | Blocks ZIP/single-doc downloads on Authority Review BLOCKED status. |
| `/api/tenders/[id]/generate` | ✅ SAFE | Multi-gate blocking (experts, projects, submission plan). |
| `/api/tenders/[id]/copilot` | ✅ SAFE | Rate-limited; evidence graph citations validated. |
| `/api/ai-jobs/run-next` | ✅ HARDENED | Strict `AI_JOBS_WORKER_SECRET` length (min 16) and value check. |
| `/api/cron/cleanup-old-records` | ✅ HARDENED | Strict `CRON_SECRET` length (min 16) and value check. |
| `/api/cron/deadline-alerts` | ✅ HARDENED | Strict `CRON_SECRET` length (min 16) and value check. |

## Fixes & Improvements

1.  **Data Leakage Prevention**: Added explicit Prisma `select` filters to `/api/tenders/[id]` (GET/PUT) to ensure large `fileContent` and `extractedText` blobs never leak into dashboard/list payloads.
2.  **Auth Hardening**: Updated all cron and background worker routes (`/api/cron/*`, `/api/ai-jobs/run-next`) to enforce a minimum length of 16 characters for secrets, preventing bypass if environment variables are accidentally set to short or empty values.
3.  **JSON Safety**: Audited routes for raw `JSON.parse` on database fields. Routes now handle invalid JSON in `exactFileNaming` and `exactFileOrder` gracefully with fallbacks.
4.  **Authority Review Gate**: The `/download` route now strictly enforces `AuthorityReviewResult.status === "BLOCKED"`, preventing the export of documents containing AI traces, placeholders, or internal Bid-Team notes.

## Neon-Safe Testing Results

*   **Typecheck**: Passed.
*   **Targeted Tests**: `tests/production-smoke-hardening.test.ts` passed (Health, Cron Auth, Worker Auth).
*   **Database Impact**: Minimal. All audited routes use indexed lookups (`tenderId`, `userId`) and avoid full table scans.

## Remaining Runtime Risks

*   **Cold Starts**: Vercel cold starts may still cause initial request latency for heavy routes like `/api/tenders/[id]/authority-review`.
*   **Rate Limits**: AI routes are protected by Upstash rate limiting; however, rapid consecutive UI clicks might still trigger 429s if not throttled on the client.

## Manual QA Checklist

- [ ] Verify `/api/health` returns `{"ok":true,"status":"ok"}` in production.
- [ ] Attempt to call `/api/cron/deadline-alerts` without `Authorization` header (expect 401).
- [ ] Attempt to call `/api/cron/deadline-alerts` with a short `Bearer` token (expect 401).
- [ ] Verify tender dashboard loads without `fileContent` in the network payload for `/api/tenders/[id]`.
- [ ] Confirm ZIP download blocks if a generated document contains the string "as an AI language model".

## Non-Overlap Confirmation

*   **Chat 2**: No changes made to `tests/fixtures/` or the regression matrix.
*   **Chat 3**: No broad code cleanup or dead-code removal performed; only targeted hardening of the specified routes.
