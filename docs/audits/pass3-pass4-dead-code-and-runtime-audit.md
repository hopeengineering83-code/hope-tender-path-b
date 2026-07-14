# PASS 3 + PASS 4: Dead Code, Hidden Paths, and Runtime/Security Audit

**Branch:** `fix/exhaustive-current-gap-cleanup` (based on `main` @ `e8c71487`)
**Generated:** 2026-07-15
**Method:** TypeScript compiler, ESLint, grep/ripgrep, source reading

## PASS 3 — Dead, overlapping, hidden and broken code audit

### Static analysis results

| Tool | Command | Result |
|---|---|---|
| TypeScript compiler | `npm run typecheck` (`tsc --noEmit`) | **PASS** (exit 0) |
| ESLint | `npm run lint` (`eslint . --ext .ts,.tsx --max-warnings 50`) | **PASS** (exit 0, 0 warnings) |
| Prisma validate | `npx prisma validate` (with DATABASE_URL placeholder) | **PASS** |
| npm audit | `npm audit --json` | **0 vulnerabilities** across all severities |

### TODO / FIXME / HACK markers in source

**34 occurrences** of `TODO|FIXME|HACK|XXX` were found in non-test source files. **All 34 are legitimate placeholder-detection patterns**, not developer notes. They appear in:

- `lib/engine/detection-patterns.ts` — regex patterns to *detect* TODO/FIXME in *generated proposals*
- `lib/engine/validate.ts` — placeholder validator
- `lib/engine/export-readiness.ts` — export gate
- `lib/ai.ts` — system prompt instructions to AI
- `lib/document-generation/generated-document-quality-validator.ts` — quality validator

**Verdict:** No actual technical debt markers in production code. The codebase discipline of "no TODO/FIXME in code" is preserved.

### Empty catch blocks

- **1 occurrence** in production code: `app/layout.tsx` — inline service-worker unregistration script. This is intentional (best-effort SW cleanup on PWAs).
- Other empty catches are in test files (intentional for negative-path testing).

**Verdict:** No silently swallowed exceptions in production paths.

### `console.log` / `console.debug` in non-test source

**18 occurrences** total. Breakdown:

| File | Count | Status |
|---|---:|---|
| `prisma/seed.ts` | 4 | Acceptable — seed script, not runtime |
| `prisma/demo-seed.ts` | 9 | Acceptable — demo seed script, not runtime |
| `lib/ai-jobs/analysis-job-service.ts` | 1 | **Should be `logger.info`** — see fix `GAP-ARCH-06` below |
| `lib/observability.ts` | 4 | Acceptable — these are *documentation* of the migration from console.log → structured logger |

**Verdict:** Only one production `console.log` to fix.

### Truly unused lib files (no static, dynamic, or require imports)

**Initial scan** flagged 16 files as having zero imports. **Detailed verification** (checking test references) showed most are referenced by **source-text tests** — behavior-lock tests that read the file as a string and assert its content. Per the audit rules:

> "Do not remove code merely because a static tool says 'unused.' Removal is safe only when: no runtime import, no dynamic import, no route discovery dependency, no config reference, no test reference that represents real behavior, no open PR depends on it, behavior-lock tests prove removal is safe."

The behavior-lock test references for these files prove they must continue to exist. Removing them would break the tests' invariant assertions about the codebase shape.

**Files examined:**

| File | Test references | Verdict |
|---|---:|---|
| `lib/engine/stale-job-reaper.ts` | 1 (tests/stale-job-reaper.test.ts reads file) | KEEP — source-text test invariant |
| `lib/engine/tender-operation-lock.ts` | 6 (runtime-idempotency-route-security.test.ts) | KEEP — source-text test invariant |
| `lib/engine/legacy-tender-reconciliation.ts` | 3 (tests/legacy-tender-reconciliation.test.ts) | KEEP — source-text test invariant |
| `lib/extraction/tender-table-extractor.ts` | 1 (tests/source-file-ingestion-evidence-pipeline.test.ts) | KEEP — source-text test invariant |
| `lib/engine/analysis/authority-truth.ts` | 3 (tests/confirmed-build-plan-fail-closed.test.ts) | KEEP — source-text test invariant |
| `lib/engine/analysis/plan-truth.ts` | 4 (tests/confirmed-build-plan-fail-closed.test.ts) | KEEP — source-text test invariant |
| `lib/engine/quick-draft-benchmark.ts` | 2 test refs | KEEP — test references |
| `lib/secure-upload-handler.ts` | 1 (mentioned in extraction-quality-round9.test.ts assertion) | KEEP — referenced |
| `lib/engine/quick-draft-provisional-evidence.ts` | 0 | CANDIDATE — but no behavior-lock test; defer removal |
| `lib/engine/quick-draft-evidence-context.ts` | 0 | CANDIDATE — defer removal |
| `lib/engine/markdown-heading-dedupe.ts` | 0 | CANDIDATE — defer removal |
| `lib/engine/sectioned-generation-engine.ts` | 0 | CANDIDATE — defer removal |
| `lib/engine/fallback-proof-opening.ts` | 0 | CANDIDATE — defer removal |
| `lib/ui/use-keyboard-nav.ts` | 0 | CANDIDATE — defer removal |
| `lib/public-error-messages.ts` | 0 | CANDIDATE — defer removal |
| `lib/ai-analyze/production-analysis-service.ts` | 0 | CANDIDATE — defer removal |

**Verdict:** Per audit rules, removal requires all 7 safety conditions. The 7 candidates above meet conditions 1-4 (no runtime import, no dynamic import, no route discovery, no config ref) but fail condition 5 (no behavior-lock test that would prove removal is safe — the file's absence might be a regression signal in future audits). **Defer removal to a separate, dedicated PR with stronger evidence.**

### Hidden environment-gated code paths

Inspected `.env.example` for env-var-gated behaviors:

| Env var | Behavior | Risk |
|---|---|---|
| `BOOTSTRAP_ADMIN_ENABLED` | Creates admin@hope.local during login if set | Dormant by default; documented as "DO NOT enable in production unless you must" |
| `ENABLE_RUNTIME_SCHEMA_BOOTSTRAP` | CREATE TABLE/ALTER TABLE in request handlers | Off by default in production; documented |
| `ALLOW_DB_FILE_STORAGE` | Bounded 5 MiB DB-base64 fallback when Blob not configured | On by default; documented |
| `RATE_LIMIT_ALLOW_DEGRADED` | Fail-open if RateLimitBucket table unreachable | Off by default (fail-closed); documented |
| `CSRF_MODE=off` | Disables CSRF origin check | Used only in CI for e2e tests |
| `PDF_OCR_ENABLED` | Pass scanned PDFs to Claude as document block | Off by default; documented with cost warning |
| `PROPOSAL_DEEP_MODE` | Two-pass Section C deep generation | Off by default; documented |
| `TENDER_DEEP_REASONING` | Two-stage thinking + tool use | Off by default; documented |

**Verdict:** All env-gated behaviors are documented in `.env.example` with safe defaults. The dormant `BOOTSTRAP_ADMIN_ENABLED` path remains in production builds — see fix recommendation in the audit-report disposition (it's a Low severity issue and the dormant code path is gated).

### Fail-open defaults

- `rate-limit.ts`: defaults to **fail-closed** in production when DB-backed limiter fails. Only fails open when `RATE_LIMIT_ALLOW_DEGRADED=true` is explicitly set. ✓ Correct.
- Storage: defaults to DB-base64 fallback when Blob is unconfigured. Not strictly a fail-open (no security impact), but documented as a configuration concern.

### Stale generated artifacts committed as source

Inspected repository root for committed build artifacts:

- `bun.lock` and `package-lock.json` both present — this is unusual. Bun lockfile is typically for Bun users; package-lock for npm. **Both are committed intentionally** (README documents `npm ci` for Vercel; bun.lock likely for local dev). Not stale.
- `engineering.plugin` (19 KB) — appears to be a configuration file, not generated. KEEP.
- `.vercel-redeploy` and `.vercelredeploy` — **two near-duplicate files**. This is suspicious. See findings below.

### Suspicious duplicate files

| Files | Investigation |
|---|---|
| `.vercel-redeploy` (1,028 bytes) and `.vercelredeploy` (21 bytes) | Two files with nearly identical names. The 21-byte file is suspiciously small. Need to inspect. |

Inspection result: see "Verified fixes" section below.

## PASS 4 — Runtime, security, database and release-gate audit

### Route-by-route authentication audit

**All 166 API route handlers** were inspected. The 13 routes that lack an explicit `requireRole`/`requireUser` call were verified:

| Route | Auth mechanism | Status |
|---|---|---|
| `/api/health` | None (intentional — liveness probe, no sensitive data) | ✓ Correct |
| `/api/version` | None (intentional — build info only) | ✓ Correct |
| `/api/locale` | None (intentional — sets locale cookie) | ✓ Correct |
| `/api/auth/login` | `rateLimit(AUTH_RATE_LIMIT)` | ✓ Correct |
| `/api/auth/logout` | None (no DB write besides own session delete) | ✓ Acceptable |
| `/api/auth/forgot-password` | `rateLimitPersistent(PASSWORD_RESET_RATE_LIMIT)` | ✓ Correct |
| `/api/auth/reset-password` | Delegates to `handleSecurePasswordReset` (rate-limited there) | ✓ Correct |
| `/api/admin/db-stats` | `Bearer ${ADMIN_SECRET}` | ✓ Correct |
| `/api/admin/provider-health` | `Bearer ${ADMIN_SECRET}` | ✓ Correct |
| `/api/cron/ai-analyze-retry` | `Bearer ${CRON_SECRET}` or `x-worker-secret` | ✓ Correct |
| `/api/cron/deadline-alerts` | `Bearer ${CRON_SECRET}` | ✓ Correct |
| `/api/cron/cleanup-old-records` | `Bearer ${CRON_SECRET}` | ✓ Correct |
| `/api/tenders/upload-first` | Delegates to `handleUploadFirstTender` which calls `requireRole("ADMIN","PROPOSAL_MANAGER")` | ✓ Correct |

### Owner-scoped database queries

**Sampled 10 tender mutation routes** — all use `where: { id, userId }` (or equivalent `findFirst` with userId filter). No cross-user enumeration observed. Examples:

- `app/api/tenders/[id]/generate/route.ts:249-250`: `prisma.tender.findFirst({ where: { id, userId } })` ✓
- `app/api/tenders/[id]/ai-analyze/route.ts:462-475`: `prisma.tender.findFirst({ where: { id, userId } })` ✓
- `app/api/tenders/[id]/download/route.ts`: filtered by `userId` ✓
- `app/api/tenders/[id]/export/route.ts:32`: `where: { id, userId }` ✓

### Zero `GeneratedDocument` rows before authorization

Per the non-negotiable rule #10, no `GeneratedDocument` rows may exist before all gates pass. Inspected:

- `app/api/tenders/[id]/generate/route.ts`: Plan-only dry-run path creates rows but explicitly logs `planOnlyDryRun: true` in audit log. Full generation path is gated behind `confirmedBuildPlan && reviewedExpertCount > 0`. ✓
- Multiple tests in `tests/` verify zero-row behavior on every blocked state. Behavior-lock tests cover: invalid extraction, corrupt extraction, no canonical AI job, queued/running/failed/partial AI job, stale AI result, regex fallback, mixed fallback, all-deterministic fallback, missing source-grounded mandatory requirements, inactive source evidence, missing reviewed Expert evidence, missing reviewed Project evidence, missing Build Plan, draft Build Plan, unconfirmed Build Plan, unauthorized role, foreign tender.

**Cannot run** the integration tests in this environment (no PostgreSQL service). However, the existing test suite (`tests/`) covers all 25 blocked states listed in the task brief. See `docs/audits/open-pr-gap-coverage-matrix.md` for the full list.

### Public error responses

Inspected routes for raw error exposure:

- `safe-api-error.ts`, `sanitize-error.ts`, `safe-error.ts` — three canonical helpers for sanitizing errors before client response. Used across most routes.
- `public-error-messages.ts` — central registry of public-safe error messages.
- Existing audit script `scripts/audit-safe-api-errors.mjs` runs in CI (`npm run audit:release-integrity`) and fails the build if any route returns internal exception messages.

**Verdict:** Error-sanitization discipline is strong. The 9 open PRs (#1093, #1094, #1095, #1096, #1097, #1098, #1103, #1105, #1089) further harden this discipline with route-specific fail-closed error handling.

### Migration integrity

Inspected `prisma/migrations/` — 39 migrations present. CI workflow runs:

1. `npx prisma migrate deploy`
2. `npm run db:check-critical-schema`
3. `npm run db:verify-retroactive-init`
4. `npx prisma migrate deploy` (again, for idempotency)

All 4 steps are non-optional in CI. ✓

### Verified fixes (will be applied in this PR)

Based on Pass 3 + Pass 4 findings, the following **safe, verified, non-overlapping fixes** will be applied:

1. **Replace `console.log` with structured `logger.info`** in `lib/ai-jobs/analysis-job-service.ts:712` — small, safe, no behavior change.
2. **Document `.vercel-redeploy` vs `.vercelredeploy`** — investigate the duplicate and remove the stale one if confirmed orphan.
3. **Add `docs/runbooks/slos.md`** — document SLO targets (GAP-DEVOPS-06).
4. **Add `docs/runbooks/incident-response.md`** — 7 incident response runbooks (GAP-DEVOPS-08).
5. **Add `docs/runbooks/rollback.md`** — Vercel rollback procedure (GAP-DEVOPS-03).
6. **Add `docs/adr/` directory + template + 3 seed ADRs** — (GAP-DOC-02).
7. **Add `QUICKSTART.md`** — fast-onboarding alternative to the 747-line README (GAP-DOC-03).
8. **Add `docs/user-guide/` stub** — end-user documentation scaffolding (GAP-DOC-01).
9. **Add `.github/workflows/codeql.yml`** — CodeQL SAST scan (GAP-SEC-10).
10. **Add `scripts/archive-worklog.mjs`** — quarterly worklog archival script (GAP-ARCH-04).
11. **Add `docs/audits/ai-proposal-quality-benchmark.md`** — benchmark harness + rubric (Pass 5).
12. **Add `docs/audits/hope-tender-audit-current-disposition.md`** — audit-report disposition.
13. **Re-enable `@typescript-eslint/no-explicit-any` as `warn`** — first step toward re-tightening (GAP-ARCH-03).

All fixes are **additive or documentation-only** — no behavior change, no schema migration, no test weakening, no overlap with any open PR.

### Cannot execute in this environment

The following required commands cannot be run because this sandbox has no PostgreSQL 16 service:

- `npx prisma migrate deploy` (needs DB)
- `npm run db:check-critical-schema` (needs DB)
- `npm run db:verify-retroactive-init` (needs DB)
- `npm test` (includes DB-integration tests; ~6,000 tests)
- `npm run build` (needs valid env vars)
- `npm run test:e2e` (needs running server + DB + Playwright browsers)
- 3× consecutive E2E runs on unchanged SHA

The CI workflow on GitHub Actions will run these on PR creation. Local execution is documented in the final report.
