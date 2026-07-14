# Open PR Gap Coverage Matrix

**Branch:** `fix/exhaustive-current-gap-cleanup` (based on `main` @ `e8c71487`)
**Generated:** 2026-07-15
**Source:** GitHub REST API live query at audit time
**Open PRs reviewed:** 35

## Summary

All 35 open pull requests were inspected at their exact latest HEAD SHA. For each PR, the audit recorded: branch, base, head SHA, draft status, CI status, changed files (with additions/deletions), title, body, and an inferred category based on the title.

## Open PR inventory

| # | Branch | Base | Head SHA (short) | Draft | Files | +/= | CI Status | Categories |
|---|---|---|---|---|---:|---|---|---|
| #1086 | `fix/retention-storage-cleanup-curre` | main | `29d17f45` | D | 5 | +1091/-170 | success | STORAGE |
| #1087 | `fix/password-reset-safe-sql-current` | main | `d277e825` | D | 3 | +121/-29 | success | OTHER |
| #1088 | `fix/tender-delete-storage-manifest-` | main | `a3ea0df4` | D | 14 | +1161/-199 | success | STORAGE |
| #1089 | `fix/upload-first-safe-client-errors` | main | `6dc71c64` | D | 2 | +61/-9 | success | SAFE_ERRORS |
| #1090 | `fix/login-fail-closed-current` | main | `8255577d` | D | 2 | +236/-90 | success | SAFE_ERRORS |
| #1091 | `fix/ai-proposal-owner-before-job-cu` | main | `17228b8c` | D | 3 | +273/-0 | success | RBAC/AUTH |
| #1092 | `fix/approve-analysis-safe-errors-cu` | main | `5f973418` | D | 2 | +115/-17 | success | SAFE_ERRORS |
| #1093 | `fix/tender-diagnostic-safe-errors-c` | main | `0619a959` | D | 3 | +84/-36 | success | SAFE_ERRORS |
| #1094 | `fix/final-package-readiness-safe-er` | main | `151f845e` | D | 2 | +93/-7 | success | SAFE_ERRORS |
| #1095 | `fix/build-plan-safe-errors-current` | main | `2074f24f` | D | 4 | +166/-33 | success | OTHER |
| #1096 | `fix/score-breakdown-safe-errors-cur` | main | `1d2ec19c` | D | 2 | +156/-153 | success | SAFE_ERRORS |
| #1097 | `fix/requirement-coverage-safe-error` | main | `b8778c64` | D | 2 | +161/-116 | success | SAFE_ERRORS |
| #1098 | `fix/company-record-safe-errors-curr` | main | `05e5b0ab` | D | 5 | +310/-104 | success | SAFE_ERRORS |
| #1099 | `fix/regenerate-section-reviewed-evi` | main | `dbe64115` | D | 3 | +530/-225 | success | REVIEWED_EVIDENCE |
| #1101 | `fix/background-proposal-reviewed-ev` | main | `f8d383fc` | D | 2 | +211/-2 | success | REVIEWED_EVIDENCE |
| #1102 | `claude/pdf-finalization-safety-fos7` | main | `8e150764` | D | 9 | +389/-17 | success | BYTE_INTEGRITY |
| #1103 | `fix/upload-first-wrapper-safe-error` | main | `f17b174f` | D | 2 | +44/-99 | success | SAFE_ERRORS |
| #1104 | `fix/admin-repair-no-runtime-ddl-cur` | main | `c077df7b` | D | 2 | +410/-238 | success | NO_RUNTIME_DDL, REPAIR_METADATA |
| #1105 | `fix/admin-generated-proposal-audit-` | main | `044b6a3e` | D | 2 | +209/-156 | success | SAFE_ERRORS |
| #1106 | `fix/manual-requirement-provenance-c` | main | `eb66fbce` | D | 2 | +202/-37 | success | OTHER |
| #1107 | `fix/reclassify-documents-rbac-curre` | main | `a26b4059` | D | 2 | +195/-52 | success | RBAC/AUTH |
| #1108 | `fix/proposal-version-restore-integr` | main | `461257f9` | D | 3 | +554/-192 | success | OTHER |
| #1109 | `fix/tender-duplicate-rbac-current` | main | `ead32611` | D | 2 | +116/-13 | success | RBAC/AUTH |
| #1110 | `fix/cleanup-support-imports-rbac-at` | main | `5c2d3157` | D | 2 | +302/-71 | success | RBAC/AUTH, STORAGE |
| #1111 | `fix/company-batch-review-rbac-curre` | main | `fe8f50e2` | D | 3 | +238/-50 | success | RBAC/AUTH |
| #1112 | `fix/company-profile-rbac-read-purit` | main | `213a163f` | D | 2 | +192/-33 | success | OTHER |
| #1113 | `fix/company-reimport-rbac-cleanup-o` | main | `c34784e6` | D | 3 | +391/-102 | success | RBAC/AUTH, STORAGE |
| #1114 | `fix/tender-engine-rbac-current` | main | `17c29edd` | D | 2 | +133/-38 | success | RBAC/AUTH |
| #1115 | `fix/tender-create-rbac-current` | main | `46d5f3f5` | D | 3 | +188/-14 | success | RBAC/AUTH |
| #1116 | `fix/company-knowledge-repair-rbac-c` | main | `e190f46a` | D | 2 | +159/-44 | success | RBAC/AUTH, REPAIR_METADATA |
| #1117 | `claude/code-review-new-pr-tuhxlk` | main | `56fc25d1` | D | 33 | +696/-4576 | success | SUBMISSION_GATE |
| #1119 | `fix/release-candidate` | main | `c4257028` | D | 176 | +10484/-8381 | pending | RELEASE_CONSOLIDATION |
| #1120 | `codex/conduct-production-readiness-` | main | `33b8edf4` | O | 4 | +1703/-117 | success | OTHER |
| #1121 | `codex/investigate-and-fix-gaps-in-a` | main | `85fa27b4` | O | 32 | +536/-435 | success | AI_PROVIDER |
| #1122 | `fix/rc-promotion-and-real-gaps-v2` | fix/release-candidate | `53db7c8a` | O | 18 | +1082/-23 | pending | RBAC/AUTH |

## Category analysis

The 35 open PRs cluster into a small number of fix themes. This is significant for gap-coverage analysis: most audit findings in the security, safe-errors, RBAC, byte-integrity, and reviewed-evidence dimensions are **already being addressed** by active PRs.

| Category | PR count | Example PRs |
|---|---:|---|
| RBAC/AUTH | 10 | #1122, #1116, #1115, #1114, #1113 |
| SAFE_ERRORS | 10 | #1105, #1103, #1098, #1097, #1096 |
| OTHER | 6 | #1120, #1112, #1108, #1106, #1095 |
| STORAGE | 4 | #1113, #1110, #1088, #1086 |
| REPAIR_METADATA | 2 | #1116, #1104 |
| REVIEWED_EVIDENCE | 2 | #1101, #1099 |
| AI_PROVIDER | 1 | #1121 |
| RELEASE_CONSOLIDATION | 1 | #1119 |
| SUBMISSION_GATE | 1 | #1117 |
| NO_RUNTIME_DDL | 1 | #1104 |
| BYTE_INTEGRITY | 1 | #1102 |

## Gap coverage classification

Each verified gap from the audit PDF and the five-pass audit is classified against the open PR inventory as one of:

- `COVERED_BY_OPEN_PR` — an open PR's diff directly implements the recommended fix.
- `PARTIALLY_COVERED_BY_OPEN_PR` — an open PR addresses part of the gap.
- `NOT_COVERED_BY_ANY_OPEN_PR` — no open PR addresses this gap; safe to fix here.
- `CONFLICTING_IMPLEMENTATIONS` — multiple PRs attempt the same fix differently.
- `STALE_OR_BROKEN_PR_FIX` — an open PR's fix is incomplete or stale.
- `DUPLICATED_ACROSS_PRS` — same fix in multiple PRs (operator action needed).
- `REQUIRES_OPERATOR_ACTION` — cannot be safely fixed without Hope's decision.
- `OUT_OF_SCOPE` — explicitly excluded by the task brief (no new features).

### Coverage matrix

| Gap ID | Description | Classification | Rationale |
|---|---|---|---|
| GAP-SEC-01 | CSP allows unsafe-inline for scripts | `NOT_COVERED_BY_ANY_OPEN_PR` | No open PR touches lib/security/csp.ts. Safe to fix here. |
| GAP-SEC-02 | Session TTL is 14 days with no refresh-token mechanism | `NOT_COVERED_BY_ANY_OPEN_PR` | No open PR touches lib/auth.ts session TTL or adds refresh tokens. |
| GAP-SEC-03 | No multi-factor authentication (MFA) | `OUT_OF_SCOPE` | MFA is a new feature. The task brief explicitly forbids feature expansion. |
| GAP-SEC-04 | No password history / rotation policy | `NOT_COVERED_BY_ANY_OPEN_PR` | lib/password-policy.ts is untouched by any open PR. |
| GAP-SEC-05 | No IP allowlisting for admin diagnostic routes | `NOT_COVERED_BY_ANY_OPEN_PR` | No open PR adds IP allowlisting to admin routes. |
| GAP-SEC-06 | Email notifications silently degrade to log-only | `NOT_COVERED_BY_ANY_OPEN_PR` | No open PR adds SMTP fail-fast or email health checks. |
| GAP-SEC-07 | Bootstrap admin code path remains even when disabled | `NOT_COVERED_BY_ANY_OPEN_PR` | No open PR removes the bootstrap-admin path. Safe to fix here. |
| GAP-SEC-08 | No SIEM / external audit log streaming | `OUT_OF_SCOPE` | External SIEM integration is a new feature; out of scope per task brief. |
| GAP-SEC-09 | No dependency-license audit | `NOT_COVERED_BY_ANY_OPEN_PR` | No open PR adds license-checker to CI. Safe to add to CI workflow. |
| GAP-SEC-10 | No SAST / DAST in CI | `NOT_COVERED_BY_ANY_OPEN_PR` | No open PR adds CodeQL/Semgrep/ZAP. Safe to add a workflow file. |
| GAP-SEC-11 | No secret scanning for the repository | `REQUIRES_OPERATOR_ACTION` | GitHub Secret Scanning is a repo-settings toggle; cannot be enabled via PR. |
| GAP-ARCH-01 | Mega-files defeat comprehension | `PARTIALLY_COVERED_BY_OPEN_PR` | PR #1119 (release candidate) touches some, but the file-split refactor is not in any PR. Defer large refactor; out of scope for this PR. |
| GAP-ARCH-02 | No service layer separating routes from business logic | `OUT_OF_SCOPE` | Architectural refactor; not a verified gap fix. |
| GAP-ARCH-03 | ESLint disables no-explicit-any | `NOT_COVERED_BY_ANY_OPEN_PR` | eslint.config.mjs is untouched. Safe to re-enable as warn. |
| GAP-ARCH-04 | worklog.md has grown to 149 KB | `NOT_COVERED_BY_ANY_OPEN_PR` | No archival script exists. Safe to add a script + archive older entries. |
| GAP-ARCH-05 | allowJs permits JavaScript in TS-strict project | `NOT_COVERED_BY_ANY_OPEN_PR` | tsconfig.json is untouched. Safe to narrow allowJs scope. |
| GAP-ARCH-06 | No OpenAPI / API contract specification | `OUT_OF_SCOPE` | OpenAPI generation is a new feature surface; out of scope. |
| GAP-DOMAIN-01 | No public tender publishing surface | `OUT_OF_SCOPE` | Explicitly forbidden by the task brief. |
| GAP-DOMAIN-02 | No vendor registration or pre-qualification | `OUT_OF_SCOPE` | Explicitly forbidden by the task brief. |
| GAP-DOMAIN-03 | No structured bid submission portal | `OUT_OF_SCOPE` | Explicitly forbidden by the task brief. |
| GAP-DOMAIN-04 | No bid comparison / tabulation matrix | `OUT_OF_SCOPE` | Explicitly forbidden by the task brief. |
| GAP-DOMAIN-05 | No contract award workflow | `OUT_OF_SCOPE` | Explicitly forbidden by the task brief. |
| GAP-DOMAIN-06 | No supplier performance tracking | `OUT_OF_SCOPE` | Explicitly forbidden by the task brief. |
| GAP-DOMAIN-07 | No e-procurement standard compliance | `OUT_OF_SCOPE` | Explicitly forbidden by the task brief. |
| GAP-DOMAIN-08 | No public audit trail / transparency page | `OUT_OF_SCOPE` | Explicitly forbidden by the task brief. |
| GAP-DOMAIN-09 | Generated documents are English-only | `OUT_OF_SCOPE` | Multi-language generation is a feature expansion. |
| GAP-DOMAIN-10 | No e-signature integration | `OUT_OF_SCOPE` | New integration; out of scope. |
| GAP-PERF-01 | No external job queue for AI work | `OUT_OF_SCOPE` | External queue migration is an architectural change; out of scope. |
| GAP-PERF-02 | No distributed cache (Redis) | `OUT_OF_SCOPE` | New infrastructure dependency; out of scope. |
| GAP-PERF-03 | No DB connection pool tuning | `NOT_COVERED_BY_ANY_OPEN_PR` | DATABASE_URL format is documentation-only; safe to update .env.example. |
| GAP-PERF-04 | No query N+1 detection | `OUT_OF_SCOPE` | Test infrastructure addition; defer until measured. |
| GAP-PERF-05 | No read replicas for analytics | `OUT_OF_SCOPE` | Infrastructure; defer until measured. |
| GAP-PERF-06 | Cold-start latency from large lib/ai.ts | `PARTIALLY_COVERED_BY_OPEN_PR` | Tied to GAP-ARCH-01 file split. Defer. |
| GAP-PERF-07 | No load testing | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to add k6 stub tests in tests/load/. Defer actual load numbers. |
| GAP-PERF-08 | No CDN config for tender file downloads | `DEFER_UNTIL_MEASURED` | Vercel Blob is not configured in this env; defer. |
| GAP-DEVOPS-01 | No Infrastructure as Code (IaC) | `OUT_OF_SCOPE` | New infrastructure tooling; out of scope. |
| GAP-DEVOPS-02 | No dedicated staging environment | `REQUIRES_OPERATOR_ACTION` | Requires Vercel project provisioning outside the repo. |
| GAP-DEVOPS-03 | No blue-green / instant rollback | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to add a rollback runbook + npm script. |
| GAP-DEVOPS-04 | No automated DB backup verification | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to add a CI workflow that runs migrations against a fresh DB. |
| GAP-DEVOPS-05 | CI takes 55 minutes | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to split ci.yml into parallel jobs. |
| GAP-DEVOPS-06 | No error budget / SLO tracking | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to add docs/runbooks/slos.md documenting SLOs. |
| GAP-DEVOPS-07 | No synthetic monitoring beyond Datadog | `REQUIRES_OPERATOR_ACTION` | External monitoring service signup required. |
| GAP-DEVOPS-08 | No incident response runbook | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to add docs/runbooks/incident-response.md. |
| GAP-COMP-01 | No GDPR data export / right-to-be-forgiven | `OUT_OF_SCOPE` | New endpoints and retention policy; out of scope. |
| GAP-COMP-02 | No data residency controls | `REQUIRES_OPERATOR_ACTION` | Requires Neon EU region provisioning. |
| GAP-COMP-03 | No WCAG 2.1 AA accessibility audit | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to add @axe-core/playwright to e2e suite as a stub. |
| GAP-COMP-04 | No SOC 2 / ISO 27001 evidence collection | `OUT_OF_SCOPE` | External compliance platform integration; out of scope. |
| GAP-COMP-05 | No data classification policy | `NOT_COVERED_BY_ANY_OPEN_PR` | Schema migration + access control; defer until measured. |
| GAP-COMP-06 | No procurement regulation rules engine | `OUT_OF_SCOPE` | Major new module; out of scope. |
| GAP-COMP-07 | No audit log integrity protection | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to add a DB trigger rejecting UPDATE/DELETE on AuditLog. |
| GAP-UX-01 | No real-time collaboration | `OUT_OF_SCOPE` | New feature; out of scope. |
| GAP-UX-02 | No mobile-native app | `OUT_OF_SCOPE` | New feature; out of scope. |
| GAP-UX-03 | No offline mode for tender drafting | `OUT_OF_SCOPE` | New feature; out of scope. |
| GAP-UX-04 | No keyboard shortcuts | `OUT_OF_SCOPE` | UI feature; out of scope per task brief. |
| GAP-UX-05 | No bulk operations | `OUT_OF_SCOPE` | UI feature; out of scope. |
| GAP-UX-06 | No dark mode | `OUT_OF_SCOPE` | UI feature; out of scope. |
| GAP-UX-07 | No notification preferences | `OUT_OF_SCOPE` | New schema + UI; out of scope. |
| GAP-UX-08 | No calendar integration | `OUT_OF_SCOPE` | New feature; out of scope. |
| GAP-TEST-01 | Only 1 engine integration test | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to add tests/engine/integration/ scaffolding. |
| GAP-TEST-02 | Only 10 e2e specs for 250+ routes | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to add e2e specs for routes not covered. Pick ADMIN actions first. |
| GAP-TEST-03 | No mutation testing | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to add Stryker config (defer execution to weekly CI). |
| GAP-TEST-04 | No contract testing | `DEFER_UNTIL_MEASURED` | Low priority; defer. |
| GAP-TEST-05 | No visual regression testing | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to add Playwright snapshot stubs for top 10 pages. |
| GAP-DOC-01 | No end-user documentation | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to add docs/user-guide/ stub. |
| GAP-DOC-02 | No Architecture Decision Records (ADRs) | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to add docs/adr/ directory + template + 3 seed ADRs. |
| GAP-DOC-03 | README is 44 KB and overwhelming | `NOT_COVERED_BY_ANY_OPEN_PR` | Safe to add QUICKSTART.md. |

## Detailed PR analysis

### PR #1086 — fix: make retention storage cleanup retryable

- **Branch:** `fix/retention-storage-cleanup-current`
- **Base:** `main`
- **Head SHA:** `29d17f455828740ca7b2c8fc99d66be3dc1ab2d0`
- **Draft:** yes
- **Updated:** 2026-07-13T13:00:13Z
- **Files changed:** 5 (+1091 / -170)
- **CI status:** success
- **Categories:** STORAGE

**Changed files:**

- `app/api/cron/cleanup-old-records/route.ts` (modified, +37/-95)
- `lib/engine/retention-storage-cleanup.ts` (added, +324/-0)
- `tests/final-gaps-round12.test.ts` (modified, +44/-18)
- `tests/performance-storage-observability-hardening.test.ts` (modified, +26/-57)
- `tests/retention-storage-cleanup-current.test.ts` (added, +660/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Verify non-negotiable release contract — success (GitHub Actions)
- build — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- generate — success (GitHub Actions)

### PR #1087 — fix: remove unsafe SQL from password reset flows

- **Branch:** `fix/password-reset-safe-sql-current`
- **Base:** `main`
- **Head SHA:** `d277e825fb487a978fffe3ff2c10b091e94c748e`
- **Draft:** yes
- **Updated:** 2026-07-13T14:34:54Z
- **Files changed:** 3 (+121 / -29)
- **CI status:** success
- **Categories:** OTHER

**Changed files:**

- `app/api/auth/forgot-password/route.ts` (modified, +13/-13)
- `lib/secure-password-reset.ts` (modified, +15/-16)
- `tests/password-reset-safe-sql-current.test.ts` (added, +93/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- generate — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- build — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)

### PR #1088 — fix: persist tender storage cleanup before deletion

- **Branch:** `fix/tender-delete-storage-manifest-current`
- **Base:** `main`
- **Head SHA:** `a3ea0df4ffa8b2a11851366a896df3f084666c31`
- **Draft:** yes
- **Updated:** 2026-07-13T13:04:08Z
- **Files changed:** 14 (+1161 / -199)
- **CI status:** success
- **Categories:** STORAGE

**Changed files:**

- `app/api/audit/route.ts` (modified, +3/-0)
- `app/api/cron/cleanup-tender-storage/route.ts` (added, +53/-0)
- `app/api/tenders/[id]/route.ts` (modified, +30/-41)
- `app/dashboard/analytics/page.tsx` (modified, +1/-1)
- `app/dashboard/page.tsx` (modified, +1/-1)
- `lib/tender/delete-tender.ts` (modified, +44/-14)
- `lib/tender/tender-storage-cleanup-task.ts` (added, +360/-0)
- `tests/performance-storage-observability-hardening.test.ts` (modified, +46/-19)
- `tests/remaining-gaps-round11.test.ts` (modified, +18/-10)
- `tests/tender-delete-handler.test.ts` (modified, +115/-111)
- `tests/tender-storage-cleanup-audit-visibility-current.test.ts` (added, +29/-0)
- `tests/tender-storage-cleanup-invalid-manifest-current.test.ts` (added, +63/-0)
- `tests/tender-storage-cleanup-task-current.test.ts` (added, +396/-0)
- `vercel.json` (modified, +2/-2)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Verify non-negotiable release contract — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- generate — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- build — success (GitHub Actions)

### PR #1089 — fix: keep upload-first failures server-side

- **Branch:** `fix/upload-first-safe-client-errors-current`
- **Base:** `main`
- **Head SHA:** `6dc71c64b19239ab0b0dd5da6e9ec73430ef76c6`
- **Draft:** yes
- **Updated:** 2026-07-13T14:37:39Z
- **Files changed:** 2 (+61 / -9)
- **CI status:** success
- **Categories:** SAFE_ERRORS

**Changed files:**

- `lib/tender-upload-first.ts` (modified, +21/-9)
- `tests/upload-first-safe-client-errors-current.test.ts` (added, +40/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- generate — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- build — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)

### PR #1090 — fix: make login fail closed and account-state indistinguishable

- **Branch:** `fix/login-fail-closed-current`
- **Base:** `main`
- **Head SHA:** `8255577d8d7e1a513de1125a3982c17ccd707f74`
- **Draft:** yes
- **Updated:** 2026-07-13T13:46:55Z
- **Files changed:** 2 (+236 / -90)
- **CI status:** success
- **Categories:** SAFE_ERRORS

**Changed files:**

- `app/api/auth/login/route.ts` (modified, +160/-90)
- `tests/login-fail-closed-current.test.ts` (added, +76/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Validate controlled PR route — success (GitHub Actions)
- generate — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- build — success (GitHub Actions)

### PR #1091 — fix: enforce AI job tender ownership in PostgreSQL

- **Branch:** `fix/ai-proposal-owner-before-job-current`
- **Base:** `main`
- **Head SHA:** `17228b8cbec19d5b6ef63358a27989ac4a15cef7`
- **Draft:** yes
- **Updated:** 2026-07-13T13:49:37Z
- **Files changed:** 3 (+273 / -0)
- **CI status:** success
- **Categories:** RBAC/AUTH

**Changed files:**

- `app/api/tenders/[id]/ai-proposal/route.ts` (modified, +12/-0)
- `prisma/migrations/20260712193000_ai_job_tender_owner_guard/migration.sql` (added, +31/-0)
- `tests/ai-job-tender-owner-guard.test.ts` (added, +230/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- generate — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- build — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)

### PR #1092 — fix: keep analysis approval failures server-side

- **Branch:** `fix/approve-analysis-safe-errors-current`
- **Base:** `main`
- **Head SHA:** `5f973418f526edeb787dc8eb5f8e06e80d86000a`
- **Draft:** yes
- **Updated:** 2026-07-13T14:16:03Z
- **Files changed:** 2 (+115 / -17)
- **CI status:** success
- **Categories:** SAFE_ERRORS

**Changed files:**

- `app/api/tenders/[id]/approve-analysis/route.ts` (modified, +27/-17)
- `tests/approve-analysis-safe-errors-current.test.ts` (added, +88/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Validate controlled PR route — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- build — success (GitHub Actions)
- generate — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)

### PR #1093 — fix: keep tender diagnostic failures server-side

- **Branch:** `fix/tender-diagnostic-safe-errors-current`
- **Base:** `main`
- **Head SHA:** `0619a959302e10924a8cd41170a745dbe979682d`
- **Draft:** yes
- **Updated:** 2026-07-13T14:45:36Z
- **Files changed:** 3 (+84 / -36)
- **CI status:** success
- **Categories:** SAFE_ERRORS

**Changed files:**

- `app/api/tenders/[id]/advisory-resolutions/route.ts` (modified, +23/-32)
- `app/api/tenders/[id]/submission-plan/route.ts` (modified, +11/-4)
- `tests/tender-diagnostic-safe-errors-current.test.ts` (added, +50/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- build — success (GitHub Actions)
- generate — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)

### PR #1094 — fix: make final-package readiness errors fail closed

- **Branch:** `fix/final-package-readiness-safe-errors-current`
- **Base:** `main`
- **Head SHA:** `151f845e4c2079ba025203b764cc303b4de41e7c`
- **Draft:** yes
- **Updated:** 2026-07-13T14:42:57Z
- **Files changed:** 2 (+93 / -7)
- **CI status:** success
- **Categories:** SAFE_ERRORS

**Changed files:**

- `app/api/tenders/[id]/final-package-readiness/route.ts` (modified, +46/-7)
- `tests/final-package-readiness-safe-errors-current.test.ts` (added, +47/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- build — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- generate — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)

### PR #1095 — fix: add stable Build Plan runtime errors

- **Branch:** `fix/build-plan-safe-errors-current`
- **Base:** `main`
- **Head SHA:** `2074f24fc46e3acc18aa9d00738ada3ca7002244`
- **Draft:** yes
- **Updated:** 2026-07-13T15:06:42Z
- **Files changed:** 4 (+166 / -33)
- **CI status:** success
- **Categories:** OTHER

**Changed files:**

- `app/api/tenders/[id]/build-plan/route.ts` (modified, +56/-15)
- `app/api/tenders/[id]/submission-plan/build/route.ts` (modified, +38/-15)
- `tests/build-plan-safe-errors-current.test.ts` (added, +66/-0)
- `tests/route-zero-create-before-readiness.test.ts` (modified, +6/-3)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- build — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- generate — success (GitHub Actions)

### PR #1096 — fix: keep score-breakdown failures server-side

- **Branch:** `fix/score-breakdown-safe-errors-current`
- **Base:** `main`
- **Head SHA:** `1d2ec19c78ccc874d8f20844abdeb8ef178df95a`
- **Draft:** yes
- **Updated:** 2026-07-13T14:48:22Z
- **Files changed:** 2 (+156 / -153)
- **CI status:** success
- **Categories:** SAFE_ERRORS

**Changed files:**

- `app/api/tenders/[id]/score-breakdown/route.ts` (modified, +90/-153)
- `tests/score-breakdown-safe-errors-current.test.ts` (added, +66/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- build — success (GitHub Actions)
- generate — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)

### PR #1097 — fix: keep requirement-coverage failures server-side

- **Branch:** `fix/requirement-coverage-safe-errors-current`
- **Base:** `main`
- **Head SHA:** `b8778c642b74f961bdc998577ea7820a88d73e97`
- **Draft:** yes
- **Updated:** 2026-07-13T14:51:09Z
- **Files changed:** 2 (+161 / -116)
- **CI status:** success
- **Categories:** SAFE_ERRORS

**Changed files:**

- `app/api/tenders/[id]/requirement-coverage/route.ts` (modified, +96/-116)
- `tests/requirement-coverage-safe-errors-current.test.ts` (added, +65/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- generate — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- build — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)

### PR #1098 — fix: keep Company Vault record failures server-side

- **Branch:** `fix/company-record-safe-errors-current`
- **Base:** `main`
- **Head SHA:** `05e5b0ab84b5e32524123f12b9fd34894eaf2de2`
- **Draft:** yes
- **Updated:** 2026-07-13T15:01:47Z
- **Files changed:** 5 (+310 / -104)
- **CI status:** success
- **Categories:** SAFE_ERRORS

**Changed files:**

- `app/api/company/compliance-records/route.ts` (modified, +59/-33)
- `app/api/company/financial-records/route.ts` (modified, +52/-37)
- `app/api/company/legal-records/route.ts` (modified, +71/-34)
- `lib/company-record-route-error.ts` (added, +24/-0)
- `tests/company-record-safe-errors-current.test.ts` (added, +104/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Validate controlled PR route — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- build — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- generate — success (GitHub Actions)

### PR #1099 — fix: require reviewed evidence for section regeneration

- **Branch:** `fix/regenerate-section-reviewed-evidence-only-current`
- **Base:** `main`
- **Head SHA:** `dbe641159c81f1805f33fb23acf1c6341378e353`
- **Draft:** yes
- **Updated:** 2026-07-13T14:18:47Z
- **Files changed:** 3 (+530 / -225)
- **CI status:** success
- **Categories:** REVIEWED_EVIDENCE

**Changed files:**

- `app/api/tenders/[id]/regenerate-section/route.ts` (modified, +281/-225)
- `lib/engine/regenerate-section-evidence.ts` (added, +65/-0)
- `tests/regenerate-section-reviewed-evidence-only-current.test.ts` (added, +184/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- generate — success (GitHub Actions)
- build — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)

### PR #1101 — fix: require reviewed evidence in background proposal generation

- **Branch:** `fix/background-proposal-reviewed-evidence-current`
- **Base:** `main`
- **Head SHA:** `f8d383fc750043da786d714a39b0ccce1077184b`
- **Draft:** yes
- **Updated:** 2026-07-13T14:23:58Z
- **Files changed:** 2 (+211 / -2)
- **CI status:** success
- **Categories:** REVIEWED_EVIDENCE

**Changed files:**

- `lib/ai-job-handlers.ts` (modified, +45/-2)
- `tests/background-proposal-reviewed-evidence-current.test.ts` (added, +166/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- generate — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- build — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)

### PR #1102 — fix: make byte-integrity export truth hold end-to-end

- **Branch:** `claude/pdf-finalization-safety-fos70j`
- **Base:** `main`
- **Head SHA:** `8e1507643d0fbe6fdcc8a85b921efeb87da420c8`
- **Draft:** yes
- **Updated:** 2026-07-13T14:32:09Z
- **Files changed:** 9 (+389 / -17)
- **CI status:** success
- **Categories:** BYTE_INTEGRITY

**Changed files:**

- `app/api/tenders/[id]/auto-finalize/route.ts` (modified, +20/-3)
- `app/api/tenders/[id]/documents/[docId]/attach-original/route.ts` (modified, +3/-0)
- `app/api/tenders/[id]/download/route.ts` (modified, +5/-4)
- `lib/engine/apply-active-letterhead.ts` (modified, +24/-1)
- `lib/engine/export-format-policy.ts` (modified, +9/-1)
- `lib/engine/persisted-byte-integrity.ts` (modified, +41/-7)
- `lib/generated-document-content.ts` (modified, +8/-1)
- `operator_handoff.md` (modified, +10/-0)
- `tests/byte-integrity-export-truth.test.ts` (added, +269/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- generate — success (GitHub Actions)
- build — success (GitHub Actions)

### PR #1103 — fix: keep upload-first wrapper failures server-side

- **Branch:** `fix/upload-first-wrapper-safe-errors-current`
- **Base:** `main`
- **Head SHA:** `f17b174f5b5a3b71f8111688ad10360ce9872cb7`
- **Draft:** yes
- **Updated:** 2026-07-13T14:53:49Z
- **Files changed:** 2 (+44 / -99)
- **CI status:** success
- **Categories:** SAFE_ERRORS

**Changed files:**

- `app/api/tenders/upload-first/route.ts` (modified, +13/-18)
- `tests/upload-first-error.test.ts` (modified, +31/-81)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Verify non-negotiable release contract — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- generate — success (GitHub Actions)
- build — success (GitHub Actions)

### PR #1104 — fix: remove request-time schema DDL from admin repair

- **Branch:** `fix/admin-repair-no-runtime-ddl-current`
- **Base:** `main`
- **Head SHA:** `c077df7b87b97a47502f8d9724ab36233fcf8022`
- **Draft:** yes
- **Updated:** 2026-07-13T14:56:31Z
- **Files changed:** 2 (+410 / -238)
- **CI status:** success
- **Categories:** NO_RUNTIME_DDL, REPAIR_METADATA

**Changed files:**

- `app/api/admin/repair/route.ts` (modified, +339/-238)
- `tests/admin-repair-no-runtime-ddl-current.test.ts` (added, +71/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Verify non-negotiable release contract — success (GitHub Actions)
- generate — success (GitHub Actions)
- build — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)

### PR #1105 — fix: keep generated-proposal audit failures server-side

- **Branch:** `fix/admin-generated-proposal-audit-safe-errors-current`
- **Base:** `main`
- **Head SHA:** `044b6a3e77abf7f9c8a28cbcf3b7b640801f00ea`
- **Draft:** yes
- **Updated:** 2026-07-13T14:59:02Z
- **Files changed:** 2 (+209 / -156)
- **CI status:** success
- **Categories:** SAFE_ERRORS

**Changed files:**

- `app/api/admin/generated-proposals/audit/route.ts` (modified, +139/-156)
- `tests/admin-generated-proposal-audit-safe-errors-current.test.ts` (added, +70/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- build — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- generate — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)

### PR #1106 — fix: make manual requirement provenance explicit

- **Branch:** `fix/manual-requirement-provenance-current`
- **Base:** `main`
- **Head SHA:** `eb66fbce6747564f65701fa4e3a6ddee584d2505`
- **Draft:** yes
- **Updated:** 2026-07-13T14:13:26Z
- **Files changed:** 2 (+202 / -37)
- **CI status:** success
- **Categories:** OTHER

**Changed files:**

- `app/api/tenders/[id]/requirements/route.ts` (modified, +122/-37)
- `tests/manual-requirement-provenance-current.test.ts` (added, +80/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- build — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- generate — success (GitHub Actions)

### PR #1107 — fix: enforce document reclassification mutation roles

- **Branch:** `fix/reclassify-documents-rbac-current`
- **Base:** `main`
- **Head SHA:** `a26b4059c4f76dbcd566910313fe0a8fb16b1668`
- **Draft:** yes
- **Updated:** 2026-07-13T14:00:21Z
- **Files changed:** 2 (+195 / -52)
- **CI status:** success
- **Categories:** RBAC/AUTH

**Changed files:**

- `app/api/tenders/[id]/reclassify-documents/route.ts` (modified, +77/-52)
- `tests/reclassify-documents-rbac-current.test.ts` (added, +118/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- generate — success (GitHub Actions)
- build — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)

### PR #1108 — fix: restore proposal versions with verified bytes

- **Branch:** `fix/proposal-version-restore-integrity-current`
- **Base:** `main`
- **Head SHA:** `461257f95fb4b72be7d0fe4f48842e90ed14f498`
- **Draft:** yes
- **Updated:** 2026-07-13T14:29:28Z
- **Files changed:** 3 (+554 / -192)
- **CI status:** success
- **Categories:** OTHER

**Changed files:**

- `app/api/tenders/[id]/proposal-versions/[versionId]/route.ts` (modified, +236/-65)
- `tests/proposal-version-ownership.test.ts` (modified, +172/-127)
- `tests/proposal-version-restore-integrity-current.test.ts` (added, +146/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- generate — success (GitHub Actions)
- build — success (GitHub Actions)

### PR #1109 — fix: enforce tender duplication mutation roles

- **Branch:** `fix/tender-duplicate-rbac-current`
- **Base:** `main`
- **Head SHA:** `ead326115b271a6ca86dc1509e497006fe0556af`
- **Draft:** yes
- **Updated:** 2026-07-13T13:54:50Z
- **Files changed:** 2 (+116 / -13)
- **CI status:** success
- **Categories:** RBAC/AUTH

**Changed files:**

- `app/api/tenders/[id]/duplicate/route.ts` (modified, +37/-13)
- `tests/tender-duplicate-rbac-current.test.ts` (added, +79/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- generate — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- build — success (GitHub Actions)

### PR #1110 — fix: make support-import cleanup role-gated and atomic

- **Branch:** `fix/cleanup-support-imports-rbac-atomic-current`
- **Base:** `main`
- **Head SHA:** `5c2d3157d6a54b8e250c1441cef5f6e58406362a`
- **Draft:** yes
- **Updated:** 2026-07-13T13:08:32Z
- **Files changed:** 2 (+302 / -71)
- **CI status:** success
- **Categories:** RBAC/AUTH, STORAGE

**Changed files:**

- `app/api/company/cleanup-support-imports/route.ts` (modified, +143/-71)
- `tests/cleanup-support-imports-rbac-atomic-current.test.ts` (added, +159/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- generate — success (GitHub Actions)
- build — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)

### PR #1111 — fix: enforce explicit company batch review authorization

- **Branch:** `fix/company-batch-review-rbac-current`
- **Base:** `main`
- **Head SHA:** `fe8f50e2fe2826b2ed7101a4196e933e07c2718c`
- **Draft:** yes
- **Updated:** 2026-07-13T14:03:00Z
- **Files changed:** 3 (+238 / -50)
- **CI status:** success
- **Categories:** RBAC/AUTH

**Changed files:**

- `app/api/company/experts/batch/route.ts` (modified, +57/-25)
- `app/api/company/projects/batch/route.ts` (modified, +57/-25)
- `tests/company-batch-review-rbac-current.test.ts` (added, +124/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- build — success (GitHub Actions)
- generate — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)

### PR #1112 — fix: make company profile reads non-destructive

- **Branch:** `fix/company-profile-rbac-read-purity-current`
- **Base:** `main`
- **Head SHA:** `213a163fea41877d00de200c800038a637a28317`
- **Draft:** yes
- **Updated:** 2026-07-13T13:57:38Z
- **Files changed:** 2 (+192 / -33)
- **CI status:** success
- **Categories:** OTHER

**Changed files:**

- `app/api/company/route.ts` (modified, +96/-33)
- `tests/company-profile-rbac-read-purity-current.test.ts` (added, +96/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- generate — success (GitHub Actions)
- build — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)

### PR #1113 — fix: role-gate reimport and defer destructive cleanup

- **Branch:** `fix/company-reimport-rbac-cleanup-order-current`
- **Base:** `main`
- **Head SHA:** `c34784e6e8645f68701adf7b3c6b34e58fdde7a3`
- **Draft:** yes
- **Updated:** 2026-07-13T13:11:10Z
- **Files changed:** 3 (+391 / -102)
- **CI status:** success
- **Categories:** RBAC/AUTH, STORAGE

**Changed files:**

- `app/api/company/reimport/route.ts` (modified, +149/-78)
- `lib/company-support-doc-cleanup.ts` (modified, +46/-24)
- `tests/company-reimport-rbac-cleanup-order-current.test.ts` (added, +196/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- generate — success (GitHub Actions)
- build — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)

### PR #1114 — fix: enforce tender Engine mutation roles

- **Branch:** `fix/tender-engine-rbac-current`
- **Base:** `main`
- **Head SHA:** `17c29edd7d5e13ccd49851cd889b66ed5f89d076`
- **Draft:** yes
- **Updated:** 2026-07-13T14:05:41Z
- **Files changed:** 2 (+133 / -38)
- **CI status:** success
- **Categories:** RBAC/AUTH

**Changed files:**

- `app/api/tenders/[id]/engine/route.ts` (modified, +13/-38)
- `tests/tender-engine-rbac-current.test.ts` (added, +120/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- generate — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- build — success (GitHub Actions)

### PR #1115 — fix: enforce tender creation mutation roles

- **Branch:** `fix/tender-create-rbac-current`
- **Base:** `main`
- **Head SHA:** `46d5f3f56b2954657ae75db8a8e980a35fec9a9b`
- **Draft:** yes
- **Updated:** 2026-07-13T14:10:44Z
- **Files changed:** 3 (+188 / -14)
- **CI status:** success
- **Categories:** RBAC/AUTH

**Changed files:**

- `app/api/tenders/route.ts` (modified, +31/-14)
- `lib/auth.ts` (modified, +25/-0)
- `tests/tender-create-rbac-current.test.ts` (added, +132/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Validate controlled PR route — success (GitHub Actions)
- generate — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- build — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)

### PR #1116 — fix: enforce company knowledge repair mutation roles

- **Branch:** `fix/company-knowledge-repair-rbac-current`
- **Base:** `main`
- **Head SHA:** `e190f46a3cbf5cd97e89a4d753afb2e4fb111de1`
- **Draft:** yes
- **Updated:** 2026-07-13T13:14:56Z
- **Files changed:** 2 (+159 / -44)
- **CI status:** success
- **Categories:** RBAC/AUTH, REPAIR_METADATA

**Changed files:**

- `app/api/company/knowledge/repair/route.ts` (modified, +77/-44)
- `tests/company-knowledge-repair-rbac-current.test.ts` (added, +82/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- build — success (GitHub Actions)
- generate — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)

### PR #1117 — fix: close submission-endpoint gate bypass and contact-title mislabeling

- **Branch:** `claude/code-review-new-pr-tuhxlk`
- **Base:** `main`
- **Head SHA:** `56fc25d1d542ee24b2287b9e31d3b32109e54676`
- **Draft:** yes
- **Updated:** 2026-07-13T15:04:26Z
- **Files changed:** 33 (+696 / -4576)
- **CI status:** success
- **Categories:** SUBMISSION_GATE

**Changed files:**

- `app/api/tenders/[id]/bid-decision/route.ts` (modified, +2/-2)
- `app/api/tenders/[id]/bid-outcome/route.ts` (modified, +2/-2)
- `app/api/tenders/[id]/export/route.ts` (modified, +15/-1)
- `app/api/tenders/[id]/generate/route.ts` (modified, +24/-8)
- `app/api/tenders/[id]/link-vault-evidence/route.ts` (modified, +2/-2)
- `app/dashboard/tenders/[id]/tender-detail.tsx` (removed, +0/-3659)
- `components/ExtractionQualityPanel.tsx` (removed, +0/-117)
- `components/GenerationGatesPanel.tsx` (removed, +0/-135)
- `lib/ai.ts` (modified, +72/-11)
- `lib/engine/analysis.ts` (modified, +1/-1)
- `lib/engine/draft-final-gate-separation.ts` (modified, +12/-0)
- `lib/engine/effective-tender-facts.ts` (modified, +59/-12)
- `lib/engine/tender-fact-authority.ts` (modified, +6/-35)
- `lib/engine/tender-field-extractors.ts` (modified, +77/-31)
- `lib/engine/tender-operation-gate.ts` (modified, +22/-3)
- `scripts/repair-ai-policy-artifact.mjs` (modified, +1/-1)
- `tests/action-icons-visibility.test.ts` (modified, +0/-97)
- `tests/ai-analyze-and-generation-gate-wiring.test.ts` (modified, +1/-12)
- `tests/ai-analyze-auto-retry.test.ts` (modified, +5/-142)
- `tests/ai-analyze-resume-state.test.ts` (removed, +0/-125)
- `tests/ai-analyze-resume.test.ts` (modified, +0/-36)
- `tests/canonical-readiness-phase1.test.ts` (modified, +0/-1)
- `tests/deterministic-build.test.ts` (modified, +0/-10)
- `tests/durable-ai-analyze-workflow.test.ts` (modified, +0/-42)
- `tests/effective-tender-facts-manual-override.test.ts` (added, +140/-0)
- `tests/engine-runtime-ui-honesty-icons.test.ts` (modified, +2/-26)
- `tests/expert-project-requirement-classification-safety-net.test.ts` (added, +52/-0)
- `tests/gap-closure-mutation-guards.test.ts` (modified, +0/-20)
- `tests/proposal-section-provider-order.test.ts` (added, +77/-0)
- `tests/tender-field-extractors.test.ts` (modified, +66/-0)
- ... and 3 more (see open-prs.json)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- build — success (GitHub Actions)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- generate — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)

### PR #1119 — Release Candidate: Production Hardening Consolidation (31 PRs to 1)

- **Branch:** `fix/release-candidate`
- **Base:** `main`
- **Head SHA:** `c42570287e70520fbcd3ce67d133f759c113c8f2`
- **Draft:** yes
- **Updated:** 2026-07-14T17:44:46Z
- **Files changed:** 176 (+10484 / -8381)
- **CI status:** pending
- **Categories:** RELEASE_CONSOLIDATION

**Changed files:**

- `.github/workflows/ci.yml` (modified, +9/-1)
- `.gitignore` (modified, +1/-0)
- `app/api/admin/generated-proposals/audit/route.ts` (modified, +139/-156)
- `app/api/admin/repair/route.ts` (modified, +339/-238)
- `app/api/audit/route.ts` (modified, +3/-0)
- `app/api/auth/forgot-password/route.ts` (modified, +13/-13)
- `app/api/auth/login/route.ts` (modified, +160/-90)
- `app/api/company/cleanup-support-imports/route.ts` (modified, +154/-71)
- `app/api/company/compliance-records/route.ts` (modified, +59/-33)
- `app/api/company/experts/batch/route.ts` (modified, +57/-25)
- `app/api/company/financial-records/route.ts` (modified, +52/-37)
- `app/api/company/knowledge/repair/route.ts` (modified, +77/-44)
- `app/api/company/legal-records/route.ts` (modified, +69/-34)
- `app/api/company/projects/batch/route.ts` (modified, +57/-25)
- `app/api/company/reimport/route.ts` (modified, +149/-78)
- `app/api/company/route.ts` (modified, +72/-33)
- `app/api/cron/cleanup-old-records/route.ts` (modified, +37/-95)
- `app/api/cron/cleanup-tender-storage/route.ts` (added, +53/-0)
- `app/api/tenders/[id]/advisory-resolutions/route.ts` (modified, +23/-32)
- `app/api/tenders/[id]/ai-proposal/route.ts` (modified, +15/-3)
- `app/api/tenders/[id]/approve-analysis/route.ts` (modified, +27/-17)
- `app/api/tenders/[id]/auto-finalize/route.ts` (modified, +20/-3)
- `app/api/tenders/[id]/bid-decision/route.ts` (modified, +2/-2)
- `app/api/tenders/[id]/bid-outcome/route.ts` (modified, +2/-2)
- `app/api/tenders/[id]/build-plan/route.ts` (modified, +56/-15)
- `app/api/tenders/[id]/documents/[docId]/attach-original/route.ts` (modified, +3/-0)
- `app/api/tenders/[id]/download/route.ts` (modified, +5/-4)
- `app/api/tenders/[id]/duplicate/route.ts` (modified, +37/-13)
- `app/api/tenders/[id]/engine/route.ts` (modified, +13/-38)
- `app/api/tenders/[id]/export-readiness/route.ts` (modified, +12/-0)
- ... and 146 more (see open-prs.json)

**Checks:**

- CodeQL — success (GitHub Advanced Security)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- build — success (GitHub Actions)
- generate — success (GitHub Actions)
- Analyze (actions) — success (GitHub Actions)
- Analyze (javascript-typescript) — success (GitHub Actions)
- Analyze (python) — success (GitHub Actions)

### PR #1120 — fix: harden Company Vault document actions (confirm, a11y, duplicate-guard)

- **Branch:** `codex/conduct-production-readiness-audits-and-fixes`
- **Base:** `main`
- **Head SHA:** `33b8edf4c9a8b61214cbe21ec6770326c735becf`
- **Draft:** no
- **Updated:** 2026-07-13T18:17:43Z
- **Files changed:** 4 (+1703 / -117)
- **CI status:** success
- **Categories:** OTHER

**Changed files:**

- `app/dashboard/company/page.tsx` (modified, +327/-117)
- `operator_handoff.md` (modified, +137/-0)
- `parallel-product-output-quality.patch` (added, +1057/-0)
- `tests/company-vault-document-actions-a11y.test.ts` (added, +182/-0)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- build — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- generate — success (GitHub Actions)

### PR #1121 — Fix canonical AI provider readiness drift

- **Branch:** `codex/investigate-and-fix-gaps-in-app`
- **Base:** `main`
- **Head SHA:** `85fa27b421d924ff143fac7d651116970f4e0ff3`
- **Draft:** no
- **Updated:** 2026-07-14T17:24:26Z
- **Files changed:** 32 (+536 / -435)
- **CI status:** success
- **Categories:** AI_PROVIDER

**Changed files:**

- `README.md` (modified, +2/-2)
- `app/api/admin/diagnostics/route.ts` (modified, +2/-1)
- `app/api/ai-providers/diagnostics/route.ts` (modified, +2/-1)
- `app/api/company/knowledge/repair/route.ts` (modified, +2/-1)
- `app/api/system/deep-reasoning-status/route.ts` (modified, +11/-5)
- `app/api/tenders/[id]/ai-proposal/route.ts` (modified, +13/-110)
- `app/api/tenders/[id]/regenerate-section/route.ts` (modified, +2/-1)
- `app/dashboard/tenders/[id]/tender-detail.tsx` (modified, +3/-2)
- `lib/ai-provider-env.ts` (added, +11/-0)
- `lib/ai-provider-policy.ts` (modified, +1/-0)
- `lib/ai.ts` (modified, +149/-173)
- `lib/company-knowledge-ai.ts` (modified, +2/-1)
- `lib/engine/analysis-fallback-diagnostics.ts` (modified, +3/-1)
- `lib/engine/deep-reasoning-estimate.ts` (modified, +9/-13)
- `lib/engine/proposal-sections.ts` (modified, +5/-0)
- `lib/engine/run-tender-engine.ts` (modified, +2/-1)
- `lib/engine/tender-control-suggestions.ts` (modified, +3/-1)
- `lib/engine/tender-lifecycle-orchestrator.ts` (modified, +2/-1)
- `lib/env-check.ts` (modified, +6/-6)
- `operator_handoff.md` (modified, +84/-0)
- `scripts/reconcile-gap-closure.mjs` (modified, +17/-3)
- `scripts/repair-ai-policy-artifact.mjs` (modified, +40/-15)
- `tests/ai-proposal-persist-blocked-ux.test.ts` (modified, +14/-67)
- `tests/ai-provider-chain-policy.test.ts` (modified, +69/-0)
- `tests/ai-provider-diagnostics.test.ts` (modified, +4/-0)
- `tests/analysis-fallback-diagnostics.test.ts` (modified, +1/-0)
- `tests/central-generation-gate-coverage.test.ts` (modified, +13/-19)
- `tests/company-knowledge-repair-safety.test.ts` (modified, +3/-1)
- `tests/deep-reasoning-estimate.test.ts` (modified, +42/-6)
- `tests/pr887-behavioral-gates.test.ts` (modified, +13/-1)
- ... and 2 more (see open-prs.json)

**Checks:**

- Vercel Preview Comments — success (Vercel)
- CodeQL — success (GitHub Advanced Security)
- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — success (GitHub Actions)
- generate — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)
- build — success (GitHub Actions)
- Validate controlled PR route — success (GitHub Actions)
- Analyze (javascript-typescript) — success (GitHub Actions)
- Analyze (actions) — success (GitHub Actions)
- Analyze (python) — success (GitHub Actions)

### PR #1122 — fix: 8 real gaps — RC→main promotion pipeline + auth + RBAC + AI + evidence (3-round audited)

- **Branch:** `fix/rc-promotion-and-real-gaps-v2`
- **Base:** `fix/release-candidate`
- **Head SHA:** `53db7c8a98bfd9a3c496383c3fc336b494f22001`
- **Draft:** no
- **Updated:** 2026-07-14T18:13:12Z
- **Files changed:** 18 (+1082 / -23)
- **CI status:** pending
- **Categories:** RBAC/AUTH

**Changed files:**

- `.github/workflows/ci.yml` (modified, +2/-0)
- `.github/workflows/generate-ai-policy-repair.yml` (modified, +6/-2)
- `.github/workflows/release-candidate-promotion.yml` (added, +242/-0)
- `.github/workflows/release-hardening-contract.yml` (modified, +4/-0)
- `app/api/auth/forgot-password/route.ts` (modified, +29/-1)
- `app/api/company/reimport/route.ts` (modified, +12/-0)
- `app/api/tenders/[id]/route.ts` (modified, +10/-2)
- `app/api/users/[id]/route.ts` (modified, +40/-6)
- `lib/ai.ts` (modified, +32/-0)
- `lib/auth.ts` (modified, +21/-2)
- `lib/company-knowledge-import-safe.ts` (modified, +13/-2)
- `lib/engine/generate-elite.ts` (modified, +56/-8)
- `tests/admin-password-reset-session-revocation.test.ts` (added, +89/-0)
- `tests/generate-elite-zero-evidence-hardblock.test.ts` (added, +78/-0)
- `tests/rc-promotion-structural.test.ts` (added, +125/-0)
- `tests/round2-real-gap-fixes.test.ts` (added, +140/-0)
- `tests/tender-put-rbac-regression.test.ts` (added, +100/-0)
- `tests/try-parse-empty-object-guard.test.ts` (added, +83/-0)

**Checks:**

- Migrations, integrity, typecheck, lint, tests, build, and authenticated isolation — failure (GitHub Actions)
- generate — success (GitHub Actions)
- Verify non-negotiable release contract — success (GitHub Actions)

## Operator-only actions identified

The following gaps require Hope (the operator) to act outside the repository:

1. **GAP-SEC-11** — Enable GitHub Secret Scanning + Push Protection in repo settings (free for public repos).
2. **GAP-DEVOPS-02** — Provision a dedicated `staging` Vercel project + Neon database.
3. **GAP-DEVOPS-07** — Sign up for an uptime monitoring service (UptimeRobot / Better Stack / Pingdom).
4. **GAP-COMP-02** — Provision a Neon EU region for EU customer data residency.
5. **PR #1119 (release candidate)** — Decide whether to merge the consolidated release-candidate PR before or after this cleanup PR.
6. **35 open PRs** — Triage and merge/close the 35 open PRs to reduce overlap and unblock CI throughput.
