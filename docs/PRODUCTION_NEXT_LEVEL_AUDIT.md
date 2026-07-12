# Hope Tender Proposal Generator — Production Next-Level Audit

Branch: `fix/production-next-level-full-audit-no-deploy`
Base: current `main`

## Deployment prohibition

This branch must remain draft and unmerged. `vercel.json` sets `git.deploymentEnabled` to `false`. Do not run Vercel preview, production, promote, rollback, or manual deployment commands.

## Open-PR isolation

PRs #1053 and #1054 were inspected read-only. Do not modify, close, rebase, cherry-pick, or merge them. This branch must independently reconcile only verified gaps from current `main`.

## Non-negotiable rules

- Tender files control scope, requirements, filenames, order, deadline, submission instructions, and formats.
- Company Vault is the only factual source for Hope's qualifications, projects, experts, licences, finances, experience, and capability evidence.
- Tender quotations prove buyer requirements, never Hope's capability.
- Never invent evidence or company facts.
- Provider order remains exactly: Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic.
- Anthropic remains last.
- Regex, deterministic parsing, fallback, partial, stale, failed, or deadline-skipped analysis cannot authorize generation or export.
- Zero `GeneratedDocument` rows may be created or reactivated before valid source bytes, complete extraction, current trusted AI, grounded requirements, real Company Vault evidence, and a current confirmed Build Plan.
- Final ZIP remains fail-closed.
- Every read and mutation must enforce role, ownership, company, and workspace boundaries.
- Public errors and logs must not expose raw provider, Prisma, SQL, storage, token, or stack information.

## Initial score

Weighted score: **48/100**.

| Domain | Weight | Score | Finding |
|---|---:|---:|---|
| Tender scope and grounding | 15 | 10 | Core grounding exists; source revision invalidation remains incomplete. |
| Company Vault evidence integrity | 15 | 11 | Main has improved provenance controls, but all persistence consumers need verification. |
| AI Analyze truth and runtime | 15 | 8 | Stale-hash and duplicate-job fixes exist only in open PR work; current main requires independent verification. |
| Generation persistence safety | 15 | 6 | Multiple creators exist; one transactional invariant is not proven across all paths. |
| File-byte and storage integrity | 15 | 3 | Universal persisted SHA-256 and exact-byte verification are not proven. |
| PDF and final ZIP safety | 10 | 5 | Strong gates exist, but exact-byte manifest parity and rollback behavior need proof. |
| Authorization and tenant isolation | 10 | 3 | Controls exist but route-complete cross-tenant coverage is incomplete. |
| CI, migrations, and acceptance | 5 | 2 | Many tests exist; too many are static/source-shape rather than DB/concurrency execution. |

## Gap register

### Critical

1. **Universal generation gate** — Audit every `GeneratedDocument.create`, `createMany`, `upsert`, regeneration, AI proposal, CV, missing-plan, restore, and PDF-finalization path. Recheck readiness inside the same transaction or stable lock immediately before persistence.
2. **Zero-row invariant** — Add DB-backed tests proving every failed prerequisite leaves zero new or reactivated document rows.
3. **Byte integrity** — Persist SHA-256, byte length, MIME, detected format, integrity status, and verification timestamp for tender files, Vault assets, and generated documents. Verify actual bytes before validation, approval, PDF finalization, export readiness, and ZIP inclusion.
4. **Source revision invalidation** — Source deletion, replacement, re-extraction, or hash change must transactionally stale requirements, evidence, Build Plans, documents, validation, approval, PDFs, and manifests while preserving audit history.
5. **AI-job idempotency** — Use database-level serialization or uniqueness for active jobs by user/company, tender, job type, and current content hash. Prove exactly one active job under concurrent requests.
6. **Final ZIP exact-byte parity** — Build manifest from the exact included bytes and verify filename, order, revision, digest, length, format, validation, and approval.

### High

7. **Canonical release truth** — Lifecycle, workflow center, next action, Tender Health, Generation Readiness, Bid Control, export readiness, PDF, and ZIP must consume one canonical release decision.
8. **Authorization coverage** — Centralize tender access for owner, company/workspace members, and explicit audited admin support. Bind all user-supplied IDs relationally.
9. **PDF atomicity** — Supersede and create replacement PDF in one transaction with stable locking and orphaned-storage cleanup.
10. **Public error hygiene** — Use one safe error mapper and structured sanitized logging across all mutation routes.
11. **Request and resource limits** — Enforce actual streamed/read byte limits; do not trust `Content-Length` alone. Bound DOCX, PDF, OCR, and AI memory/time usage.
12. **Background-worker reliability** — Database-unavailable workers must not claim jobs; non-retryable failures must not rearm; incomplete chunks must not finalize.

### Medium

13. Replace source-string release tests with executable route, Prisma, concurrency, storage-byte, and browser tests.
14. Verify migration history on isolated PostgreSQL and prohibit runtime schema repair as a substitute for migrations.
15. Verify all cron routes authenticate and fail closed.
16. Remove contradictory UI readiness states and stale wording such as user-facing “metadata”.

## Broad implementation strategy

### Stage 1 — Establish one release authority

- Create or complete one canonical release snapshot.
- Make all generation and export consumers use it.
- Remove inferred blocker searches and transport/readiness ambiguity.
- Fail closed for stale, partial, fallback, or unbound AI analysis.

### Stage 2 — Transactional persistence safety

- Enumerate every document persistence path.
- Apply the canonical gate immediately before persistence.
- Acquire a stable tender/operation/filename lock.
- Recheck the gate inside the lock/transaction.
- Enforce valid document-state transitions and P2002 convergence.
- Add zero-row and concurrency tests.

### Stage 3 — Byte integrity and source invalidation

- Add deterministic Prisma fields and migration where absent.
- Hash and identify actual bytes at upload/generation/finalization.
- Verify magic signatures and Blob availability.
- Invalidate downstream state transactionally on source revision changes.
- Backfill legacy rows as `UNKNOWN`, never trusted.

### Stage 4 — AI jobs and operational reliability

- Add database-level idempotency and concurrency tests.
- Preserve canonical provider order and Anthropic-last.
- Make deadlines and provider exhaustion return blocked partial states.
- Prevent DB-outage claims and non-retryable rearming.

### Stage 5 — Authorization, PDF, ZIP, and acceptance

- Centralize access resolution and audit admin support actions.
- Make PDF replacement atomic with storage cleanup.
- Build ZIP manifest from exact included bytes.
- Add role, tenant, tampering, missing-Blob, source-revision, and concurrent-request tests.
- Run complete isolated-PostgreSQL and browser acceptance.

## Required executable acceptance matrix

1. Full happy path: source bytes → extraction → trusted current AI → grounded requirements → Vault evidence → confirmed Build Plan → generation → byte validation → approval → PDF → strict ZIP.
2. Every missing prerequisite asserts zero new `GeneratedDocument` rows.
3. AI failure, regex fallback, stale hash, partial chunks, deadline skip, provider exhaustion, and DB outage create zero trusted evidence and zero documents.
4. Source deletion/replacement/hash change stales all downstream state and blocks ZIP.
5. Empty bytes, missing Blob, wrong magic signature, digest mismatch, duplicate names, missing PDF, and tampered ZIP fail closed.
6. Concurrent AI, engine, generation, regeneration, PDF, approval, and ZIP requests produce one consistent durable result.
7. Cross-user, cross-company, VIEWER, REVIEWER, PROPOSAL_MANAGER, and ADMIN scenarios.
8. Public-response and server-log sanitization tests.
9. Rendered UI tests prove no panel says Ready when the backend gate blocks.

## Validation commands

```bash
npm ci
npx prisma generate
npx prisma validate
npm run typecheck
npm run lint
RUN_DB_INTEGRATION=true npm test
npm run build
```

Use an isolated disposable PostgreSQL database. Never use production data.

## Five-pass review protocol

1. Scope, branch isolation, and no-deploy verification.
2. Evidence provenance, AI truth, provider order, and fallback blocking.
3. Persistence, transaction, concurrency, and zero-row verification.
4. Source revision, actual-byte integrity, PDF, ZIP, and manifest verification.
5. Authorization, errors, migrations, CI, browser isolation, and residual-gap scoring.

## Completion standard

Do not claim 100%, production-ready, complete, or all fixed unless every critical and high gap is implemented and all executable acceptance checks pass. Keep the PR draft and unmerged until then.
