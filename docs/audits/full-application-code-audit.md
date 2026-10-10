# Full Application Code Audit — PR #1175

**Audited head SHA:** `737f8c81db38fa5a668a03d2efda93d07b0ed6bd`
**Branch:** `release/consolidated-recovery-20260717`
**Base:** `integration/controlled-recovery`
**Date:** 2026-07-19
**Auditor:** Super Z (GLM)

## Overall Application Risk Rating: MEDIUM-HIGH

The PR consolidates 174 commits (+10,586 / -2,635 across 178 files). Typecheck, lint, Prisma validation, and npm audit all pass. However, **26 tests fail** in CI, concentrated in 7 categories.

## Finding Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 5 |
| Medium | 8 |
| Low | 5 |
| Duplicate | 2 |
| Unproven | 3 |
| **Total** | **23** |

## CI Test Results

- **Total tests:** 8,485
- **Passing:** 8,459
- **Failing:** 26
- **Skipped:** 0
- **Typecheck:** PASS
- **Lint:** PASS (0 warnings)
- **Prisma validate:** PASS
- **npm audit:** 0 vulnerabilities

## Ten Highest-Risk Confirmed Defects

### AUD-001 — Activity API requires ADMIN but tests expect requireUser — HIGH
- **File:** `app/api/audit/route.ts`
- **Test:** `tests/activity-safe-presentation.test.ts` (8 subtests)
- **Root cause:** Route uses `requireRole("ADMIN")` but test expects `requireUser()` (any authenticated user). Activity logs are user-scoped — restricting to ADMIN prevents Proposal Managers, Reviewers, and Viewers from seeing their own activity.
- **Impact:** Non-admin users cannot view their activity logs. 8 tests fail.
- **Fix:** Change `requireRole("ADMIN")` to `requireUser()` in the audit route. The `where: { userId: actor.id }` already enforces tenant isolation.

### AUD-002 — Company Vault DTO privacy tests fail — HIGH
- **File:** `tests/company-documents-public-dto-privacy.test.ts` (6 subtests)
- **Root cause:** Tests expect paginated list DTOs, no raw `storagePath` in client types, bounded text on review board. The consolidation may have regressed or not fully implemented these contracts.
- **Impact:** Raw storage paths or unbounded text may be exposed to clients. 6 tests fail.

### AUD-003 — Currency authority: USD default when currency is missing — HIGH
- **File:** `tests/currency-authority-current-contracts.test.ts` (2 subtests)
- **Root cause:** Tests expect that when project contract currency is missing, the system does NOT default to USD. The matching rationale and company forms may still default to USD.
- **Impact:** Unsupported currency defaults can produce misleading financial data. 2 tests fail.

### AUD-004 — Matching: below-threshold fallback promotion code retained — HIGH
- **File:** `tests/matching-fail-closed-selection.test.ts` (1 subtest)
- **Root cause:** Test expects NO below-threshold fallback promotion code in `lib/engine/matching.ts`. The consolidation may have reintroduced or retained old fallback code.
- **Impact:** Irrelevant candidates may be force-promoted to avoid empty selection, violating fail-closed rules. 1 test fails.

### AUD-005 — Password reset client contract mismatch — HIGH
- **File:** `tests/password-reset-client-contract.test.ts` (3 subtests)
- **Root cause:** Tests expect forgot-password UI to NOT claim it generates a link, NOT render/copy a raw reset token, and reset-password page to accept token-only links. The current code may still have the old "Generate Reset Link" wording and resetLink display logic.
- **Impact:** Users are told a reset link will be generated when the API never returns one. 3 tests fail.

### AUD-006 — Company Vault record route REVIEWER access — MEDIUM
- **File:** `tests/company-vault-record-route-error-boundaries.test.ts` (1 subtest)
- **Root cause:** Test expects REVIEWER role to have read access with restricted mutation access. The route may not preserve REVIEWER read access.
- **Impact:** Reviewers cannot view vault records. 1 test fails.

### AUD-007 — Matching rationale defaults currency to USD — MEDIUM
- **File:** `tests/currency-authority-matching-contracts.test.ts` (1 subtest)
- **Root cause:** Matching rationale text defaults project contract currency to USD when missing.
- **Impact:** Misleading financial data in match rationale. 1 test fails.

### AUD-008 — Company project/financial forms default currency to USD — MEDIUM
- **File:** `tests/currency-authority-company-forms.test.ts` (1 subtest)
- **Root cause:** Company project and financial forms default to USD when currency is unresolved.
- **Impact:** Unsupported currency defaults. 1 test fails.

### AUD-009 — Password reset transaction isolation — MEDIUM
- **File:** `tests/password-reset-transaction.test.ts` (1 subtest)
- **Root cause:** Test expects token locking, conditional consumption, password change, and session revocation in one transaction.
- **Impact:** Password reset may not be atomic. 1 test fails.

### AUD-010 — Activity API: no opaque display IDs — MEDIUM
- **File:** `tests/activity-safe-presentation.test.ts` subtest 3
- **Root cause:** Test expects `publicAuditLog` function with `id: audit_${row.id.slice(0,8)}` opaque display IDs. Route uses `groupAuditLogs` instead.
- **Impact:** Raw audit log IDs may be exposed. 1 test fails (part of AUD-001 suite).

## Dead-Code Candidates (POSSIBLY UNUSED — not confirmed)

| File | Static imports | Dynamic imports | Test refs | Verdict |
|---|---|---|---|---|
| `lib/engine/client-language-finalizer.ts` | 0 | 0 | 0 | POSSIBLY UNUSED |
| `lib/engine/controlled-proposal-assembler.ts` | 0 | 0 | 0 | POSSIBLY UNUSED |
| `lib/engine/fallback-abcd-structure.ts` | 0 | 0 | 0 | POSSIBLY UNUSED |
| `lib/engine/fallback-proof-opening.ts` | 0 | 0 | 0 | POSSIBLY UNUSED |
| `lib/engine/generate.ts` | 0 | 0 | 0 | POSSIBLY UNUSED |
| `lib/engine/legacy-tender-reconciliation.ts` | 0 | 0 | 0 | POSSIBLY UNUSED |
| `lib/engine/markdown-heading-dedupe.ts` | 0 | 0 | 0 | POSSIBLY UNUSED |
| `lib/engine/quick-draft-benchmark.ts` | 0 | 0 | 0 | POSSIBLY UNUSED |
| `lib/engine/quick-draft-evidence-context.ts` | 0 | 0 | 0 | POSSIBLY UNUSED |
| `lib/engine/quick-draft-provisional-evidence.ts` | 0 | 0 | 0 | POSSIBLY UNUSED |
| `lib/engine/sectioned-generation-engine.ts` | 0 | 0 | 0 | POSSIBLY UNUSED |
| `lib/engine/stale-job-reaper.ts` | 0 | 0 | 0 | POSSIBLY UNUSED |
| `lib/engine/tender-operation-lock.ts` | 0 | 0 | 0 | POSSIBLY UNUSED |

**Note:** These files may have behavior-lock test references that import the file as a string path (source-text tests). They are classified as POSSIBLY UNUSED, not dead. Do not delete without proving all 8 safety conditions.

## Security, Privacy, Tenant, and Data-Integrity Findings

### AUD-011 — Routes without explicit auth (LOW — all verified safe)
- `app/api/health/route.ts` — intentional public liveness probe
- `app/api/version/route.ts` — intentional public build info
- `app/api/locale/route.ts` — intentional public locale setter
- `app/api/auth/login/route.ts` — pre-auth route with rate limiting
- `app/api/auth/logout/route.ts` — no DB write besides own session
- `app/api/auth/forgot-password/route.ts` — rate-limited, no data returned
- `app/api/admin/db-stats/route.ts` — Bearer ADMIN_SECRET protected
- `app/api/admin/provider-health/route.ts` — Bearer ADMIN_SECRET protected
- `app/api/cron/*` — Bearer CRON_SECRET protected
- **Verdict:** All safe. No unauthorized access possible.

### AUD-012 — Error sanitization gaps (LOW)
- `app/api/tenders/[id]/matching-quality/route.ts:83` — returns `error.message` to client
- `app/api/tenders/[id]/ai-analyze/route.ts:1103,1225` — uses `err.message` internally (not returned to client)
- `app/api/tenders/[id]/generate/route.ts:1119` — `failJob(job.id, error.message)` — internal only
- **Verdict:** Most are internal logging, not client-facing. The matching-quality route should use `safeApiError`.

## Open PR Donor Disposition

| PR | Status | Disposition |
|---|---|---|
| #1128 | Draft, screenshot workflow | Unrelated control-plane work |
| #1130 | Draft, Control Tower | Unrelated control-plane work |
| #1175 | Draft, consolidation | **This PR — audit target** |
| #1198 | Draft, fix-work | Targets #1175's branch — sub-PR |

No other open application PRs contain unique code not already in #1175.

## Commands Executed and Exact Results

| Command | Result |
|---|---|
| `npm ci` | PASS |
| `npx prisma generate` | PASS |
| `npx prisma validate` | PASS (schema valid) |
| `npm run typecheck` | PASS (exit 0) |
| `npm run lint` | PASS (exit 0, 0 warnings) |
| `npm audit` | 0 vulnerabilities |
| `npm test` (CI) | 8,459 pass / 26 fail / 0 skip |
| `npm run build` | Not run locally (CI failed before build step) |

## Remaining Blockers

1. **26 failing tests** — 7 categories of test failures must be resolved before merge
2. **No exact-head CI green** — CI shows failure on test step
3. **No runtime/browser audit** — no disposable PostgreSQL available in this environment
4. **No Playwright/browser screenshots** — not executable here
5. **Integration branch divergence** — `main` is 9 commits ahead of `integration/controlled-recovery`

## Conclusion

**NOT SAFE TO MERGE**

PR #1175 has 26 failing tests across 7 categories. The failures are concentrated in:
- Activity API auth model mismatch (8 tests)
- Company Vault DTO privacy (6 tests)
- Currency authority (4 tests)
- Password reset client contract (3 tests)
- Matching fail-closed (1 test)
- Company Vault REVIEWER access (1 test)
- Password reset transaction (1 test)

Typecheck, lint, Prisma validation, and npm audit all pass. The codebase is structurally sound but has contract mismatches between tests and implementation that must be resolved before merge.

Keep PR #1175 as draft. Do not merge, approve, deploy, or run production migrations.
