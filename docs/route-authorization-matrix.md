# Route Authorization Matrix — 2026-07-04

Audited at PR #936 head (`hotfix/metadata-repair-crash-and-snapshot-consistency`). 148 routable `route.ts` endpoints under `app/api`, plus the public share page.

**Auth helpers** (`lib/auth.ts`): `getSession()` L81 · `requireUser()` L123 · `requireRole(...roles)` L132. Roles: `ADMIN (A), PROPOSAL_MANAGER (PM), REVIEWER (REV), VIEWER (VIEW)`.
**Rate limits** (`lib/rate-limit.ts`): AI 20/min · API 300/min · MUTATION 30/min · AUTH 10/min · PASSWORD_RESET 5/15min · UPLOAD 5/min. "persistent" = DB-backed (`rateLimitPersistent`), otherwise in-memory per instance.
**Tenant-scoped:** Y = every user-owned query filters by `userId` / `tender:{userId}` / `companyId` · **Y\*** = a fallback or privileged path bypasses the scope · N/A = no user-owned entity.

| Route | Methods | Auth | Roles | Scoped | Rate-limited | Notes / risks |
|---|---|---|---|---|---|---|
| /api/auth/login | POST | public→session | public | N/A | AUTH (IP+email) | |
| /api/auth/logout | POST | session | any | N/A | no | |
| /api/auth/me | GET | getSession | any | Y (self) | no | |
| /api/auth/forgot-password | POST | public | public | N/A | PASSWORD_RESET persistent | |
| /api/auth/reset-password | POST | token | public | N/A | in lib | |
| /api/health | GET | public | public | N/A | no | liveness + release SHA |
| /api/version | GET | public | public | N/A | no | SHA + flags, no secrets |
| /api/locale | POST | public | public | N/A | no | cookie only |
| /api/ai/health | GET | **public** | **public** | N/A | no | **P2**: provider config/cooldown/models leak to anonymous |
| /api/upload | POST | requireRole | A, PM | Y | UPLOAD persistent | |
| /api/tenders/upload-first | POST | requireRole | A, PM | Y | MUTATION | |
| /api/tenders | GET/POST | getSession | any | Y | API / MUTATION | |
| /api/tenders/summary | GET | getSession | any | Y | API | |
| /api/tenders/[id] | GET/PUT/DELETE | getSession / requireRole(DEL) | any / A,PM | Y | MUTATION (PUT) | |
| /api/tenders/[id]/activity | GET | getSession | any | Y | no | |
| /api/tenders/[id]/advisory-resolutions | GET/POST | requireRole | A, PM | Y | MUTATION | |
| /api/tenders/[id]/ai-analyze | POST | requireRole | A, PM | Y | AI | |
| /api/tenders/[id]/ai-analyze/staged | GET | getSession | any | Y | no | |
| /api/tenders/[id]/ai-proposal | POST | requireRole | A, PM | Y | AI persistent | |
| /api/tenders/[id]/ai-rematch | POST | requireUser | any auth | Y | AI persistent | P2: VIEWER can trigger AI spend |
| /api/tenders/[id]/analysis-quality | GET | getSession | any | Y | no | |
| /api/tenders/[id]/approve-analysis | POST/DELETE | requireRole | A, PM | Y | MUTATION | |
| /api/tenders/[id]/authority-review | GET | requireRole | A, PM | Y | no | |
| /api/tenders/[id]/auto-finalize | POST | requireRole | A, PM | Y | MUTATION | see P0 fallback-eligibility finding (audit §9) |
| /api/tenders/[id]/bid-decision | GET/POST | requireRole | A, PM | Y | MUTATION | writes status "NO_BID" (outside canonical set) |
| /api/tenders/[id]/bid-strategy | GET | requireUser | any auth | Y | no | |
| /api/tenders/[id]/build-plan | POST | requireRole | A, PM | Y | no | |
| /api/tenders/[id]/build-plan/confirm | POST | requireRole | A, PM | Y | no | Serializable tx + optimistic guard |
| /api/tenders/[id]/controls | GET/POST | requireRole | A, PM | Y | MUTATION | |
| /api/tenders/[id]/controls/suggestions/reject | POST | requireRole | A, PM | **Y\*** | MUTATION | **P1**: `?? findFirst({id})` fallback drops userId scope (L69-70) |
| /api/tenders/[id]/copilot | POST | requireUser | any auth | Y | AI persistent | P2: any role |
| /api/tenders/[id]/copilot/messages | GET/DELETE | requireUser | any auth | Y | no | |
| /api/tenders/[id]/deduplicate-documents | POST | requireRole | A, PM | Y | MUTATION (IP-keyed) | P3: IP bucket |
| /api/tenders/[id]/deep-reasoning-summary | GET | requireUser | any auth | Y | no | |
| /api/tenders/[id]/documents/[docId] | GET/PUT | requireUser + role gate | GET: all / PUT: A,PM,REV | Y | MUTATION persistent | REVIEWER review-status mutation is by design |
| /api/tenders/[id]/documents/[docId]/comments | GET/POST/PATCH | requireUser | any auth | Y | MUTATION persistent | |
| /api/tenders/[id]/documents/[docId]/attach-original | POST | requireRole | A, PM | Y | MUTATION persistent | |
| /api/tenders/[id]/documents/[docId]/plan-action | POST | requireRole | A, PM | Y | MUTATION persistent | |
| /api/tenders/[id]/documents/bulk-review | POST | requireUser | any auth | Y | MUTATION persistent | |
| /api/tenders/[id]/download | GET | requireRole | A, PM | Y | no | ZIP/PDF/DOCX bytes; full gate re-check at download |
| /api/tenders/[id]/duplicate | POST | getSession | any | Y | MUTATION | |
| /api/tenders/[id]/engine | POST | requireRole | A, PM | Y | AI persistent | reads files w/o deletionStatus filter (P2 latent) |
| /api/tenders/[id]/evaluator-objections | GET/PATCH | requireRole | A, PM | Y | MUTATION | |
| /api/tenders/[id]/evaluator-simulation | POST | requireUser | any auth | Y | AI persistent | P2: any role |
| /api/tenders/[id]/export | POST | requireRole | A, PM | Y | MUTATION | P1: status flip + audit outside package tx |
| /api/tenders/[id]/export-readiness | GET | requireRole | A, PM, REV | Y | no | |
| /api/tenders/[id]/extraction-quality | GET | getSession | any | Y | no | |
| /api/tenders/[id]/files/[fileId] | GET/DELETE | getSession / requireRole(DEL) | any / A,PM | Y | MUTATION persistent | GET returns bytes, owner-scoped; DELETE hard-deletes (P1 lifecycle) |
| /api/tenders/[id]/gaps/[gapId] | PUT | requireRole | A, PM | Y | MUTATION persistent | |
| /api/tenders/[id]/generate | POST | requireRole | A, PM | Y | AI | gate-checked before create |
| /api/tenders/[id]/generate-missing-plan-files | POST | requireRole | A, PM | Y | MUTATION | |
| /api/tenders/[id]/generation-readiness | GET | getSession | any | Y | no | |
| /api/tenders/[id]/lifecycle | GET | requireRole | A, PM, REV | Y | no | |
| /api/tenders/[id]/link-vault-evidence | GET/POST | requireRole | A, PM | Y | MUTATION | |
| /api/tenders/[id]/link-vault-evidence-auto | POST | requireRole | A, PM | Y | MUTATION | |
| /api/tenders/[id]/matches | PUT | requireRole | A, PM | Y | MUTATION | |
| /api/tenders/[id]/matching-quality | GET | getSession | any | Y | no | |
| /api/tenders/[id]/metadata-override | GET/POST | requireRole | A, PM | Y | MUTATION | |
| /api/tenders/[id]/pipeline-diagnostic | GET | requireRole | A, PM | Y | no | |
| /api/tenders/[id]/pricing | GET/PUT | requireUser + gate | GET: all / PUT: A,PM | Y | MUTATION persistent | |
| /api/tenders/[id]/pricing/lines | POST | requireUser | any auth | Y | MUTATION persistent | |
| /api/tenders/[id]/pricing/lines/[lineId] | PATCH/DELETE | requireUser | any auth | Y | MUTATION persistent | |
| /api/tenders/[id]/proposal-evidence-readiness | GET | requireRole | A, PM, REV | Y | no | |
| /api/tenders/[id]/proposal-versions | GET | getSession | any | Y | no | |
| /api/tenders/[id]/proposal-versions/[versionId] | GET/DELETE/POST | getSession / requireRole | any / A,PM | **Y\*** | MUTATION | **P1**: DELETE (L52) tenderId-only; restore (L77) id-only — cross-tenant delete/restore + live-proposal overwrite |
| /api/tenders/[id]/proposal-versions/[versionId]/diff | GET | getSession | any | Y | no | |
| /api/tenders/[id]/re-extract-metadata | POST | requireUser + explicit A/PM check | A, PM | Y | MUTATION | ACTIVE-files-only; totalPages preserved |
| /api/tenders/[id]/readiness | GET | getSession | any | Y | no | |
| /api/tenders/[id]/readiness-score | GET | requireRole | A, PM, REV | Y | no | |
| /api/tenders/[id]/reclassify-documents | POST | requireRole | A, PM | Y | MUTATION (IP-keyed) | P3: IP bucket |
| /api/tenders/[id]/reconcile-docs | POST | requireRole | A, PM | Y | MUTATION | |
| /api/tenders/[id]/reconcile-state | POST | requireRole | A, PM | Y | no | |
| /api/tenders/[id]/regenerate-cvs | POST | requireUser | any auth | Y | AI persistent | P2: any role |
| /api/tenders/[id]/regenerate-section | POST | requireRole | A, PM | Y | AI persistent | |
| /api/tenders/[id]/release-snapshot | GET | requireRole | A, PM, REV | Y | no | |
| /api/tenders/[id]/repair-export-gaps | POST | requireRole | A, PM | Y | MUTATION | |
| /api/tenders/[id]/repair-metadata | POST | requireRole | A, PM | Y | MUTATION | P1: audit rows before write, non-tx |
| /api/tenders/[id]/repair-source-grounding | POST | requireRole | A, PM | Y | no | |
| /api/tenders/[id]/requirement-coverage | GET | requireRole | A, PM | Y | API | |
| /api/tenders/[id]/requirement-coverage/confirm | POST | requireRole | A, PM | Y | no | |
| /api/tenders/[id]/requirement-coverage/reject | POST | requireRole | A, PM | Y | no | |
| /api/tenders/[id]/requirement-coverage/set-support-level | POST | requireRole | A, PM | Y | no | |
| /api/tenders/[id]/score-breakdown | GET | requireRole | A, PM, REV | Y | API | |
| /api/tenders/[id]/share | POST/GET/DELETE | requireRole | A, PM | Y | MUTATION persistent | 32-byte token, expiry ≤365d, revocation |
| /api/tenders/[id]/submission-plan | GET | requireRole | A, PM, REV | Y | no | |
| /api/tenders/[id]/submission-plan/build | POST | requireRole | A, PM | Y | MUTATION | creates ZERO GeneratedDocument rows |
| /api/tenders/[id]/submission-plan/auto-classify | POST | requireRole | A, PM | Y | MUTATION | |
| /api/tenders/[id]/supersede-outside-plan | GET/POST | requireRole | A, PM | Y | MUTATION | |
| /api/tenders/[id]/traceability | GET | requireRole | A, PM | Y | no | |
| /api/tenders/[id]/validate | POST | requireRole + owner check | A, PM | Y | no | writes validationStatus "PASSED" (P1 vocabulary split) |
| /api/tenders/[id]/workflow-center | GET | requireRole | A, PM, REV | Y | no | |
| /api/documents | GET | getSession | any | Y | no | |
| /api/analytics | GET | getSession | any | Y | no | |
| /api/search | GET | getSession | any | Y | no | |
| /api/notifications | GET/PATCH | getSession | any | Y | MUTATION (PATCH) | |
| /api/settings | GET/PUT | getSession | any | Y (self) | MUTATION (PUT) | |
| /api/audit | GET | requireRole | ADMIN | Y (own rows) | no | |
| /api/jobs/[jobId] | GET | getSession | any | Y | no | |
| /api/ai-jobs | GET | requireUser | any auth | Y | no | |
| /api/ai-jobs/[id] | GET | requireUser | any auth | Y (+ADMIN bypass) | no | |
| /api/ai-jobs/run-next | GET/POST | worker secret / CRON / requireRole | A, PM or secret | claim-policy scoped | no | |
| /api/company | GET/PUT | getSession | any | Y | MUTATION (PUT) | P2: any role mutates |
| /api/company/documents | GET/DELETE | getSession | any | Y | MUTATION (DEL) | P2: bulk DELETE orphans storage bytes |
| /api/company/documents/[id] | GET/POST/DELETE | getSession / requireRole | any / A,PM | Y | MUTATION persistent | |
| /api/company/assets | GET/POST/DELETE | requireRole(POST) / getSession | A,PM / any | Y | MUTATION persistent | |
| /api/company/assets/[id] | GET | getSession | any | Y | no | |
| /api/company/experts | GET/POST | getSession / requireRole | any / A,PM | Y | MUTATION | |
| /api/company/experts/[id] | GET/PUT/PATCH/DELETE | mixed | PATCH: A,PM,REV · DEL: A,PM | Y | — | |
| /api/company/experts/batch | PATCH | getSession | any | Y | MUTATION | P2: any role |
| /api/company/projects | GET/POST | getSession / requireRole | any / A,PM | Y | MUTATION | |
| /api/company/projects/[id] | GET/PUT/PATCH/DELETE | mixed | PATCH: A,PM,REV · DEL: A,PM | Y | — | |
| /api/company/projects/batch | PATCH | getSession | any | Y | MUTATION | P2: any role |
| /api/company/compliance-records | GET/POST/DELETE | requireRole | GET: A,PM,REV · mut: A,PM | Y | API/MUTATION | |
| /api/company/legal-records | GET/POST/DELETE | requireRole | GET: A,PM,REV · mut: A,PM | Y | API/MUTATION | |
| /api/company/financial-records | GET/POST/DELETE | requireRole | GET: A,PM,REV · mut: A,PM | Y | API/MUTATION | |
| /api/company/ingestion-readiness | GET | getSession | any | Y | no | |
| /api/company/review-summary | GET | getSession | any | Y | no | |
| /api/company/reimport | POST | getSession | any | Y | MUTATION | P2: any role |
| /api/company/cleanup-support-imports | POST | getSession | any | Y | no | P2: any role |
| /api/company/knowledge/repair | GET/POST | getSession | any | Y | no | P2: any role |
| /api/company/plan-b-import | POST | getSession | **any auth** | Y | **no** | **P1**: no role gate, no size cap, mints trustLevel REVIEWED |
| /api/users | GET/POST | requireRole | ADMIN | N/A | MUTATION | |
| /api/users/[id] | GET/PUT/DELETE | mixed | self-or-admin | Y | no | |
| /api/system/readiness | GET | requireRole | ADMIN | N/A | no | |
| /api/system/deep-reasoning-estimate | POST | getSession | any | N/A | no | |
| /api/system/deep-reasoning-runs | GET | requireUser + role gate | A, PM | **N** | no | **P1**: query-string userId/tenderId filters, never constrained to actor — PM reads any user's runs |
| /api/ai-runtime | GET | requireRole | A, PM | N/A | no | |
| /api/ai-providers/diagnostics | GET | requireRole | A, PM | N/A | no | keys redacted |
| /api/admin/ai-environment-readiness | GET | requireRole | ADMIN | N/A | no | |
| /api/admin/ai-provider-health (+/test, /zai-diagnostic) | GET/POST | requireRole | ADMIN | N/A | no | POST resets cooldowns; ping-only |
| /api/admin/ai-usage | GET | requireRole | ADMIN | N (by design) | no | |
| /api/admin/db-stats | GET | ADMIN_SECRET bearer | secret | N/A | no | |
| /api/admin/diagnostics | GET | requireRole | ADMIN | N/A | no | DSN/keys redacted |
| /api/admin/generated-proposals/audit | GET | requireRole | ADMIN | N (by design) | no | |
| /api/admin/generated-proposals/reassess | POST | requireRole | ADMIN | N (by design) | no | |
| /api/admin/provider-health | GET | ADMIN_SECRET bearer | secret | N/A | no | |
| /api/admin/release-stuck-jobs | GET/POST | requireUser + ADMIN check | ADMIN | N (by design) | yes | |
| /api/admin/repair | POST | requireRole | ADMIN | N/A | 10/min | idempotent SQL repair |
| /api/cron/ai-analyze-retry | GET | CRON/worker secret | secret | N/A | no | never scheduled (P2) |
| /api/cron/cleanup-old-records | GET | CRON_SECRET | secret | N/A | no | purge filter dead (deletedAt never set) |
| /api/cron/deadline-alerts | GET | CRON_SECRET | secret | N/A | no | full-table scan (P3 index) |
| /api/internal/rate-guard | POST | getSession + origin/route allow-list | any auth | Y | AI persistent | SSRF-guarded |
| /share/[token] (page) | GET | signed token | public | token-scoped | no | atomic claim; read-only summary; no file bytes |

## Summary

- **148** routable endpoints; **9** public/session-free (login/logout/forgot/reset/health/version/locale/ai-health + share page); cron/admin-secret families gated by ≥16-char secrets.
- **3 unscoped-query routes on user-owned entities** (excluding by-design ADMIN tools): `proposal-versions/[versionId]` (DELETE/restore), `controls/suggestions/reject` (fallback), `system/deep-reasoning-runs`. These are the PR C P1 targets.
- Verified-safe patterns: share-link atomic claims, byte-serving ownership re-checks, cron secret enforcement, `internal/rate-guard` SSRF allow-list, no `x-internal`/debug/force-param bypasses anywhere.

## Required test proofs (PR C)

1. Cross-user route tests (real Postgres): user B calls each P1 route with user A's ids → 404/403 and zero rows mutated.
2. `plan-b-import`: VIEWER → 403; PM import defaults to `AI_DRAFT` trust; >10 MB body → 413.
3. `ai/health`: anonymous → 401 (or explicitly documented public with config redaction).
4. Role-floor tests for AI-trigger routes (`ai-rematch`, `copilot`, `evaluator-simulation`, `regenerate-cvs`) once the intended floor is decided.
