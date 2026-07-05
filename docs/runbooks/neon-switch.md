# Runbook: Neon Database Switch

## When to use

Use this runbook when you need to switch the app from one Neon Postgres
project to another — typically because the current project has hit transfer
or compute limits, or because you need to migrate to a different Neon
account / region.

> **The full step-by-step checklist lives in
> [`scripts/neon-switch-checklist.md`](../../scripts/neon-switch-checklist.md).**
> This file is a pointer so operators browsing `docs/runbooks/` can find it.

## Symptoms that trigger a switch

- Neon dashboard shows the current project is over quota (compute hours,
  storage, or data transfer) and will not reset until the billing window
  rolls over.
- Neon compute refuses to start, or starts and immediately suspends.
- A security incident requires rotating the entire database (see
  [`security-incident.md`](./security-incident.md)).
- You need to migrate to a different Neon region for latency or compliance
  reasons.

## Quick summary (see the checklist for the authoritative steps)

1. **Generate a FRESH backup** from the current production database using
   `pg_dump` — do NOT use the stale `hope-tender-safe-no-aijob-20260604`
   backup referenced in older docs.
2. **Create a new Neon project** and restore the backup with `pg_restore`.
3. **Update `DATABASE_URL` in Vercel** (Production / Preview / Development)
   to the new pooled connection string.
4. **Redeploy** — the Vercel build runs `node scripts/migrate-deploy-safe.mjs`
   which executes `prisma migrate deploy` (NOT `db push` — `db push` would
   drop `SubmissionPlanState`).
5. **Verify schema** with `scripts/check-critical-schema.mjs` and
   `scripts/verify-retroactive-init.mjs`.
6. **Smoke test** — `/api/health` returns 200, login works, AI Analyze
   works, file uploads work.
7. **Run blob migration dry-run** —
   `DRY_RUN=true npx tsx scripts/migrate-db-files-to-blob.ts`.

## Critical warnings

- **Never run `npm run db:push`** against the new project. It would DROP
  `SubmissionPlanState` and other tables that exist in the DB but not in
  `schema.prisma`. The Vercel build uses `prisma migrate deploy` only.
- **Always generate a fresh backup before switching.** The old
  `hope-tender-safe-no-aijob-20260604-001438.dump` backup is stale
  (audit DOC-003, 2026-06-20).
- **No connection strings are hardcoded** in the codebase — the app reads
  `DATABASE_URL` only from environment variables. Updating Vercel env vars
  is sufficient; no code change is needed.

## Verification

- `/api/health` returns 200 with `ok: true`, `status: "healthy"`, and all
  five critical tables (`RateLimitBucket`, `PasswordResetToken`,
  `SubmissionPlanState`, `AiAnalyzeChunk`, `AiJob`) are `true`.
- Login works; tenders load; file uploads succeed.
- `/api/ai/health` returns 200 with provider status.
- The dashboard provider-health panel renders without errors.
- The "Last successful switch" line at the bottom of
  `scripts/neon-switch-checklist.md` is updated with the date.

## Escalation

- **On-call engineer:** page if `pg_restore` reports missing-table or
  permission-denied errors, or if `/api/health` is 503 after the switch.
- **Neon support:** open a ticket at https://console.neon.tech/support if
  the new project refuses connections or the restore fails.
- **Rollback plan:** if the new project is broken, revert `DATABASE_URL` in
  Vercel to the previous value and redeploy. The old project is not deleted
  during the switch — keep it for at least one week as a fallback.

## Source of truth

**Authoritative checklist:**
[`scripts/neon-switch-checklist.md`](../../scripts/neon-switch-checklist.md)

Last reviewed: 2026-06-21 (DOC-002 — added this pointer file).
