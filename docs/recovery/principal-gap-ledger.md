# Principal Recovery Gap Ledger

Authoritative baseline: `cb220c36d9396bb452d1b987ae467614853c8675`

Target branch: `release/consolidated-recovery-20260717`

Repair branch: `repair/principal-recovery-20260724`

This ledger is the release authority for the sole repair PR. A gap is closed only after its complete vertical slice has behavioral evidence. Source-text assertions, screenshots without persisted-state inspection, and successful HTTP responses without terminal-state inspection are not closure evidence.

## Audit A — Runtime and data flow

### SEC-001 — Native login fallback can place credentials in the URL

**Status:** OPEN — first repair slice.

**Reproduction evidence**

- `components/login-form.tsx` renders a form without `method` or `action` and relies on a hydrated React `onSubmit` handler.
- Before hydration, or when JavaScript fails, the browser default is a GET to the current login URL with named `email` and `password` controls.

**Root cause**

Authentication safety is owned only by client JavaScript. The server endpoint accepts JSON only and there is no safe native POST contract.

**Canonical owner**

- Authentication request contract: `app/api/auth/login/route.ts`
- Login presentation and progressive enhancement: `components/login-form.tsx`
- Login error-code presentation: `app/login/page.tsx`

**Directly and transitively affected files**

- `components/login-form.tsx`
- `app/login/page.tsx`
- `components/login-recovery-note.tsx`
- `app/api/auth/login/route.ts`
- `middleware.ts`
- `lib/security/csrf.ts`
- `e2e/anonymous/login-security.spec.ts` or the canonical anonymous login security spec
- `e2e/global-setup.ts`
- `.github/workflows/ci.yml`

**Impact**

- Database: no schema change.
- API: login must accept JSON and form-encoded POST without changing credential semantics.
- Queue/cache: none; all login responses must be `no-store`.
- Security: credential disclosure through URL, history, referrer, screenshots, logs, and diagnostics.
- UI: safe before hydration, safe without JavaScript, stable fixed-code errors.

**Code replaced or removed**

- Browser-default GET behavior.
- Unbounded URL-provided login `detail` rendering.
- Client dependence as the only submission path.

**Behavioral acceptance test**

1. Disable JavaScript, submit the real form, and prove the request method is POST.
2. Prove neither email nor password appears in URL, redirect location, history, page text, console output, or request URL.
3. Prove successful native POST redirects with 303 to `/dashboard` and failed native POST redirects with 303 to a fixed error code.
4. Prove hydrated login uses the same server contract and does not change secrecy guarantees.

### SEC-002 — Login messages and audit records disclose account identifiers or internal detail

**Status:** OPEN — included in first repair slice.

**Reproduction evidence**

- `app/login/page.tsx` accepts `error` and `detail` from query parameters.
- `components/login-recovery-note.tsx` renders those values.
- `app/api/auth/login/route.ts` writes the successful user's email into the audit description.
- The hydrated form appends server-provided `detail` or caught exception text to the visible error.

**Root cause**

No fixed public authentication error-code map and no single redaction boundary for authentication audit text.

**Canonical owner**

`app/api/auth/login/route.ts` owns public result codes; `app/login/page.tsx` owns fixed safe presentation.

**Directly and transitively affected files**

- `app/api/auth/login/route.ts`
- `app/login/page.tsx`
- `components/login-form.tsx`
- `components/login-recovery-note.tsx`
- `lib/audit.ts`
- authentication unit and browser tests

**Impact**

- Database: existing audit rows only; no production mutation permitted.
- API: stable codes replace public internal detail.
- Security: email and implementation-detail leakage.
- UI: generic actionable errors with request ID only where safe.

**Code replaced or removed**

- Raw query `detail` display.
- Email-bearing success audit description.
- Exception-message display for login failures.

**Behavioral acceptance test**

Attempt valid, invalid, unavailable-database, malformed, and rate-limited login flows. Assert a denylist of submitted email, submitted password, Prisma/SQL text, stack text, and storage paths is absent from public output and captured logs.

### VAULT-001 — Primary and fallback importers have contradictory, destructive ownership

**Status:** OPEN.

**Reproduction evidence**

- `lib/company-knowledge-import-safe.ts` treats broad categories as support-only and deletes their draft expert/project records.
- `lib/company-knowledge-safety-import.ts` scans broad or unclassified documents and creates draft expert/project records.
- `lib/secure-upload-handler.ts` and `app/api/company/reimport/route.ts` run machine verification only when AI succeeds, not after deterministic fallback.

**Root cause**

Two importers independently decide document capability and lifecycle. Category is treated both as an exclusion rule and as a weak hint. The verification continuation is conditional on provider success rather than on created source-backed records.

**Canonical owner**

A single Company Vault ingestion service must own classification, extraction-quality decisions, non-destructive upsert, provenance creation, verification, and Review Inbox routing.

**Directly and transitively affected files**

- `lib/secure-upload-handler.ts`
- `app/api/company/reimport/route.ts`
- `lib/company-knowledge-import-safe.ts`
- `lib/company-knowledge-safety-import.ts`
- `lib/company-auto-verification.ts`
- `lib/company-support-doc-cleanup.ts`
- `lib/company-knowledge-ai.ts`
- `lib/extract-text.ts`
- `lib/extraction-quality.ts`
- Company Vault upload/reimport APIs and UI
- Review Inbox diagnostics and tests

**Impact**

- Database: duplicate/deleted experts and projects; stale trust state.
- API: contradictory counts and status.
- Queue: automatic work may stop after AI failure.
- Types/cache: ingestion readiness can be stale.
- Security: source ownership must remain company-scoped.
- UI: uncertain records disappear instead of becoming actionable.

**Code replaced or removed**

- Support-document draft deletion based only on category.
- Separate capability rules in primary and safety importers.
- Provider-success condition around source verification.

**Behavioral acceptance test**

Upload a mixed company profile containing exact expert and project claims, a dedicated CV, a project reference, and an uncertain record. Run once with AI success and once with AI unavailable. Assert identical provenance shape, dedicated-source precedence, no deletion of uncertain records, no duplicates, and one actionable Review Inbox entry for each unresolved claim.

### VAULT-002 — Company source provenance lacks one explicit extraction revision and page-level contract

**Status:** OPEN.

**Reproduction evidence**

- Company documents persist byte hash and extracted text, but source verification currently binds only document ID, byte hash/length, text hash, and character spans.
- Tender files persist page status, while Company Vault provenance does not expose a canonical extraction revision or page/span mapping.

**Root cause**

Company extraction metadata and source-verification provenance evolved independently.

**Canonical owner**

The CompanyDocument extraction record and provenance builder jointly own revision and page/span identity.

**Directly and transitively affected files**

- `prisma/schema.prisma`
- new migration for extraction revision/source-verification state
- `lib/secure-upload-handler.ts`
- `app/api/company/reimport/route.ts`
- `lib/vault-review-provenance.ts`
- Company document read APIs
- Review Inbox DTOs and UI
- matching/generation/export trust consumers

**Impact**

- Database: new revision/provenance columns may be required.
- API/type: source DTO expands.
- Cache: source-byte or extraction revision change must invalidate verification.
- UI: page/quote evidence can be inspected without exposing unrelated source text.

**Code replaced or removed**

- Implicit reliance on current text hash without explicit extraction revision.

**Behavioral acceptance test**

Verify a claim, alter source bytes, re-extract identical-looking text under a new revision, and alter one bound field. Each change must invalidate machine verification. Unchanged bytes, revision, text, page/span, and fields must remain verified.

### PIPE-001 — Job enqueue idempotency is check-then-create and races

**Status:** OPEN.

**Reproduction evidence**

- `enqueueJob` always calls `aiJob.create`.
- `lib/secure-upload-handler.ts` queries for an active AI job, then creates one.
- `app/api/ai-jobs/run-next/route.ts` queries for an active Engine job, then creates one.
- No unique key binds company, tender, source revision, stage, and owner.

**Root cause**

The queue has atomic claiming but not atomic enqueueing.

**Canonical owner**

`lib/ai-jobs.ts` must provide the sole database-enforced idempotent enqueue API.

**Directly and transitively affected files**

- `prisma/schema.prisma`
- new migration and migration verification
- `lib/ai-jobs.ts`
- `lib/ai-jobs/index.ts`
- `lib/secure-upload-handler.ts`
- `app/api/ai-jobs/run-next/route.ts`
- all AI/Engine enqueue callers
- retry and stale-job recovery services
- queue integration and concurrency tests

**Impact**

- Database: duplicate active jobs and duplicate downstream records.
- API: double click/refresh can report different job IDs.
- Queue: two workers can enqueue duplicate continuation work.
- Cache/UI: contradictory current state and polling.
- Security: idempotency key must include tenant ownership.

**Code replaced or removed**

- Every active-job `findFirst` followed by `create`.

**Behavioral acceptance test**

Run simultaneous upload, double-click, refresh, retry, and two-worker continuation attempts. Assert one AI analysis job per source revision and one Engine job per successful analysis revision, with every caller receiving the same canonical job ID.

### PIPE-002 — Engine continuation is not explicitly bound to the exact successful analysis revision

**Status:** OPEN.

**Reproduction evidence**

- Worker continuation checks `SUCCEEDED` and `autoContinue`, which is correct, but creates/reuses Engine by tender and user only.
- The current CI test inspects source text and fails because it captures an adjacent partial/failure retry block.

**Root cause**

Continuation policy is embedded in the HTTP route and lacks a behavioral service contract and revision-bound idempotency key.

**Canonical owner**

A dedicated server-side continuation service invoked by the worker route.

**Directly and transitively affected files**

- `app/api/ai-jobs/run-next/route.ts`
- new or existing continuation service under `lib/ai-jobs/`
- `lib/ai-jobs.ts`
- `lib/job-claim-policy.ts`
- `tests/automatic-upload-to-engine-workflow.test.ts`
- PostgreSQL queue integration tests

**Impact**

- Database/queue: wrong or duplicate Engine continuation.
- API: `nextJobId` may not identify the exact revision continuation.
- UI: stale Engine status can appear current.

**Code replaced or removed**

- Route-local check-then-create continuation.
- Source-text regular-expression assertions.

**Behavioral acceptance test**

Execute the isolated continuation service and prove: SUCCEEDED plus autoContinue queues/reuses one Engine job; PARTIAL_SUCCESS, FAILED, missing autoContinue, stale, superseded, and fallback-only outcomes queue none; concurrent successful attempts still return one job.

## Audit B — Competing, duplicate, and contradictory ownership

### TRUST-001 — Machine verification is falsely persisted as human REVIEWED

**Status:** OPEN.

**Reproduction evidence**

- `lib/company-auto-verification.ts` sets `trustLevel: "REVIEWED"`, `reviewedBy: "SYSTEM_AUTO_VERIFIED"`, and `reviewedAt`.
- Human-review consumers interpret REVIEWED as a genuine reviewer decision.

**Root cause**

Machine/source verification was grafted onto human-review columns instead of receiving an explicit trust state.

**Canonical owner**

The trust model in Prisma and `lib/vault-review-provenance.ts`.

**Directly and transitively affected files**

- `prisma/schema.prisma`
- trust migration
- `lib/company-auto-verification.ts`
- `lib/vault-review-provenance.ts`
- expert/project create, edit, batch-review, and list APIs
- matching eligibility
- generation readiness
- export readiness
- Review Inbox and status labels
- audit records and tests

**Impact**

- Database: false reviewer identity and timestamp.
- API/type: incorrect trust labels.
- Matching/generation: machine evidence cannot be distinguished from human approval.
- Export: final-package gate may accept fabricated review authority.
- UI/audit: misleading human-review history.

**Code replaced or removed**

- `SYSTEM_AUTO_VERIFIED` reviewer identity.
- Machine writes to human review fields.

**Behavioral acceptance test**

Source-backed machine records become `SOURCE_VERIFIED` with machine provenance and no human reviewer. Only explicit authenticated review creates `REVIEWED`, reviewer ID, and review timestamp. Final approval/export stays fail-closed.

### TRUST-002 — Provenance producer and consumer use different evidence fields

**Status:** OPEN.

**Reproduction evidence**

- Auto-verification builds expert provenance from name/title/years only and project provenance without service areas.
- Durable-review consumption includes all expert disciplines, sectors, certifications and all project service areas and financial fields.

**Root cause**

The builder duplicates field lists instead of using the canonical field helpers consumed by validation.

**Canonical owner**

`expertReviewFields` and `projectReviewFields` in `lib/vault-review-provenance.ts`.

**Directly and transitively affected files**

- `lib/company-auto-verification.ts`
- `lib/vault-review-provenance.ts`
- edit endpoints that invalidate provenance
- matching/generation/export consumers
- trust and provenance tests

**Impact**

Machine verification can be immediately invalid or can omit material changed fields.

**Code replaced or removed**

All duplicated inline evidence-field arrays.

**Behavioral acceptance test**

The producer and consumer serialize the same ordered normalized field set. Changing any included expert discipline/sector/certification or project service/financial field invalidates verification.

### UI-001 — Two Company Vault review destinations compete

**Status:** OPEN.

**Reproduction evidence**

- `/dashboard/company/review` performs diagnostics, repair, and batch human review.
- `/dashboard/company/review-board` independently lists drafts and performs per-record and bulk approval, while instructing users to inspect the other page.

**Root cause**

Diagnostics and review actions were implemented as separate top-level authorities.

**Canonical owner**

One Review Inbox page and one review API contract. Diagnostics become a section of that page, not another authority.

**Directly and transitively affected files**

- `app/dashboard/company/review/page.tsx`
- `app/dashboard/company/review-board/page.tsx`
- `app/dashboard/company/review-board/readiness-presentation.ts`
- `components/company-subnav.tsx`
- `lib/dashboard-navigation.ts`
- company review/repair/list/batch APIs
- route inventory and browser tests

**Impact**

Contradictory counts, duplicate mutation controls, and users approving without source context.

**Code replaced or removed**

One competing review route becomes a redirect to the canonical Review Inbox; duplicate approval actions are removed.

**Behavioral acceptance test**

Every Company Vault unresolved item appears once in one Review Inbox. Every former review link navigates there. One mutation owner performs each review action and the rendered result matches persisted trust state.

### UI-002 — Workflow action, icon, label, state, and mutation ownership can drift

**Status:** OPEN.

**Reproduction evidence**

- `lib/ui/action-registry.ts`, `lib/tender-workflow-stages.ts`, `lib/ui/workflow-action-icons.ts`, `lib/semantic-icon-registry.ts`, and `lib/ui/workflow-live-state.ts` independently define overlapping labels, icons, stages, and actions.
- `app/api/tenders/[id]/workflow-center/route.ts` hardcodes action labels and action names again.

**Root cause**

Registries were added incrementally without selecting the minimum authoritative set or making compatibility layers derive from it.

**Canonical owner**

- Stage labels/targets: `lib/tender-workflow-stages.ts`
- Action IDs, labels, mutation owner, recovery behavior, and action icon meaning: `lib/ui/action-registry.ts`
- Live status presentation: `lib/ui/workflow-live-state.ts`
- General non-workflow semantic icons: `lib/semantic-icon-registry.ts`

`lib/ui/workflow-action-icons.ts` must become a compatibility projection or be removed after all consumers migrate.

**Directly and transitively affected files**

- all five registry files above
- `app/api/tenders/[id]/workflow-center/route.ts`
- workflow center, next-action, recovery command center, engine, analysis, matching, generation, approval, and export panels
- navigation and registry regression tests

**Impact**

Frozen buttons, duplicate mutations, contradictory blockers/next actions, and inconsistent icons.

**Code replaced or removed**

Inline workflow action definitions and independent icon labels.

**Behavioral acceptance test**

Static registry tests prove one owner per mutation and one icon meaning per action. Browser tests iterate every visible workflow control and prove it mutates through the canonical owner, navigates to it, or presents a blocker with an active recovery action.

## Audit C — Security, CI, deployment, and output

### SEC-003 — CI does not exercise production CSRF behavior and can retain credential-bearing browser diagnostics

**Status:** OPEN.

**Reproduction evidence**

- `.github/workflows/ci.yml` sets `CSRF_MODE: "off"` for authenticated Playwright.
- Failed CI uploads Playwright reports and browser test results.
- Authentication tests submit credentials through the real login endpoint.

**Root cause**

CI optimized for functional coverage without a separate secrecy-safe authentication project and sanitization boundary.

**Canonical owner**

`.github/workflows/ci.yml` and Playwright authentication fixtures.

**Directly and transitively affected files**

- `.github/workflows/ci.yml`
- `playwright.config.ts`
- `e2e/global-setup.ts`
- login browser tests
- diagnostic upload/sanitization script

**Impact**

CSRF regressions can pass; traces/reports can retain POST bodies or account identifiers.

**Code replaced or removed**

- Global CSRF disable for the authenticated suite.
- Unfiltered upload of authentication diagnostics.

**Behavioral acceptance test**

Run strict same-origin CSRF in CI. Run login secrecy tests with trace/video/screenshots disabled or sanitized. Scan produced artifacts and logs for submitted emails/passwords and fail if found.

### CI-001 — Current exact-head CI failure is a brittle source-text test

**Status:** OPEN.

**Reproduction evidence**

`tests/automatic-upload-to-engine-workflow.test.ts` captures a source substring beginning at the partial/failure retry block and then asserts that the substring does not contain `PARTIAL_SUCCESS` or `FAILED`, although the actual Engine condition requires `SUCCEEDED`.

**Root cause**

The test reads implementation text instead of executing continuation behavior.

**Canonical owner**

The worker continuation behavioral test suite.

**Directly and transitively affected files**

- `tests/automatic-upload-to-engine-workflow.test.ts`
- continuation service
- worker route
- test runner configuration

**Impact**

CI blocks a correct condition and provides no concurrency proof.

**Code replaced or removed**

Regular-expression source inspection.

**Behavioral acceptance test**

The six required continuation cases execute against an isolated fake repository and PostgreSQL integration path.

### REL-001 — Build, authenticated workflow, document inspection, ZIP verification, and preview identity are unproven

**Status:** OPEN — final acceptance gate.

**Reproduction evidence**

- Exact-head route/screenshot audit completed successfully with no reported overflow.
- Main CI passed migrations, integrity audit, typecheck, and lint, then failed in unit tests; build and authenticated Playwright were skipped.
- A Vercel status exists for the baseline SHA, but the complete acceptance contract was not executed against a frozen repaired head.

**Root cause**

The test chain stops at the first failure and no single exact-head evidence bundle currently covers generated Word/PDF/ZIP bytes plus deployment identity.

**Canonical owner**

CI release verification workflow and exact-head audit workflow.

**Directly and transitively affected files**

- `.github/workflows/ci.yml`
- exact-head route/screenshot workflow
- deployment verification scripts
- document generation and export routes
- ZIP manifest/integrity implementation
- failure-injection and tenant-isolation tests

**Impact**

Release readiness cannot be asserted.

**Code replaced or removed**

Temporary recovery markers are removed only after route/workflow/script consumers prove they are unused. No evidence file is deleted merely because it looks temporary.

**Behavioral acceptance test**

On one frozen PR SHA, run the five required verification passes, open generated Word/PDF files, recompute every ZIP entry and manifest hash, verify two-user/two-company isolation, review runtime logs, and prove preview deployment SHA equality. Any missing evidence keeps this gap open.

## Closure order

1. SEC-001 and SEC-002
2. SEC-003
3. TRUST-001 and TRUST-002
4. VAULT-001 and VAULT-002
5. PIPE-001 and PIPE-002 / CI-001
6. UI-001 and UI-002
7. REL-001 final five-pass verification
