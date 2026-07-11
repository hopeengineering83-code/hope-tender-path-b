# Production Engine Full Gap-Closure Specification

Repository: `hopeengineering83-code/hope-tender-path-b`
Branch: `fix/production-engine-full-gap-closure-no-deploy`
Target: `main`

## Deployment lock

Do not run any Vercel deploy, promote, rollback, or production command. Keep this PR draft and unmerged. Preserve the branch-specific `vercel.json` rule that disables Vercel Git deployments for this branch. Use local checks and GitHub Actions only.

## Non-negotiable rules

- Tender files control scope, requirements, submission instructions, filenames, order, deadlines, and formats.
- Company Vault is the only factual source for Hope's capability evidence.
- Tender quotations prove the buyer's requirement, never Hope's qualification.
- Never invent evidence, experts, projects, certificates, finances, dates, or claims.
- Provider order is exactly: Z.ai, Cerebras, Mistral, Groq, OpenRouter, Gemini, OpenAI, Together, DeepSeek, Anthropic.
- Anthropic remains last. Regex/deterministic fallback is never AI success.
- Partial, stale, failed, fallback-derived, or deadline-skipped analysis cannot unlock generation or export.
- Create zero `GeneratedDocument` rows before valid extraction, current trusted AI, source-grounded requirements, real vault evidence, and a current confirmed Build Plan.
- Final ZIP remains fail-closed. PLANNED, PENDING, SUPERSEDED, stale, missing-byte, wrong-format, unvalidated, unapproved, duplicate, or unknown-integrity files cannot enter it.
- Enforce roles, ownership, company boundaries, and cross-user isolation.
- Never expose raw Prisma/provider errors, SQL, stack traces, paths, Blob URLs, tokens, or keys.
- Do not use user-facing “metadata” wording.

## Required fixes

### Evidence provenance

Remove tender-source-only fallback entries from normal compliance matrices. Store AI matching failures as unmatched-requirement diagnostics only. Require a valid active same-company Company Vault evidence ID before any compliance row can exist or count toward coverage. Provider failure, timeout, deadline skip, or regex fallback must create zero trusted evidence rows.

### Canonical release truth

Use one canonical release decision across lifecycle, next action, health score, generation readiness, Bid Control, workflow center, final submission, export readiness, and ZIP. Do not infer blockers by searching unrelated arrays for strings. Transport `ok:true` must never mean workflow-ready.

### Transactional generation gate

Place one authoritative gate immediately before every document create, upsert, regeneration, CV generation, support-file creation, PDF finalization, restored-file promotion, and supersede/create operation. Recheck it inside the persistence transaction or under a stable lock. Rejection must leave zero new or reactivated document rows.

### Source revision integrity

Validate every source file referenced by Tender Facts, requirements, evidence, analysis binding, Build Plan, and generated-document provenance. Re-extraction, replacement, deletion, or byte/hash change must atomically stale downstream requirements, evidence, plans, documents, validation, approval, PDFs, and manifests while preserving audit history.

### Byte integrity

Persist and verify SHA-256, byte length, MIME/format, and verification status for tender files, vault assets, generated documents, restored inline content, Blob-backed files, finalized PDFs, and every ZIP entry. Read real bytes before validation, approval, export, PDF finalization, and ZIP inclusion. Validate magic signatures, not extensions. Unknown, empty, missing, mismatched, or wrong-format bytes fail closed. The manifest must contain filename, order, document/revision IDs, byte length, SHA-256, format, validation, approval, and inclusion time based on the exact included bytes.

### PDF and ZIP safety

Integrate valid parts of PR #1048: use an upstream-safe PDF creation gate; require source and target base-name match; require real `%PDF` bytes; support string and object filename policies; transact supersede plus replacement create; lock concurrent finalization; rollback database state and clean orphaned Blob bytes on failure. New PDFs remain validation/review pending. Required formats and exact filenames must be enforced by the final ZIP gate.

### Document state and concurrency

Enforce allowed transitions from PLANNED to GENERATED to passed validation to approved/export-ready. Approval requires current real bytes, correct format, passed validation, current source/plan binding, and authorized review. Null legacy validation cannot pass. Never reactivate SUPERSEDED rows through broad filename lookup. Use stable tender/operation/filename lock keys and consistent P2002 convergence.

### AI runtime and jobs

Keep provider order unchanged. Validate configured models and context limits. Preflight skips do not consume attempt budget. Deadline skips return partial/blocked and create no evidence. `/api/ai-jobs/run-next` must return a sanitized retryable database-unavailable result without claiming or mutating a job. Add database-enforced active-job idempotency by tender, job type, actor/company, and current content hash. Non-retryable jobs are never rearmed; jobs never finalize while chunks remain active.

### Authorization and errors

Centralize tender access for owner, company workspace, and explicit audited admin support. VIEWER and REVIEWER cannot trigger AI, evidence, plan, generation, PDF, approval, or export mutations outside intended review authority. Bind all supplied IDs relationally. Enforce request-size limits on actual read bytes. Public errors use stable code, safe message, retryability, next action, and diagnostic ID. Logs record only safe class/code, route, operation, and diagnostic ID.

### Vercel and database reliability

Do not deploy this branch. Verify migrations on isolated disposable PostgreSQL, unique migration timestamps, bounded Neon retry/prewarm behavior, no runtime schema creation in place of migrations, bounded DOCX/PDF/OCR memory, durable background AI work, and authenticated fail-closed cron routes.

## Required executable tests

- Prisma-backed tests for requirement coverage, lifecycle, workflow center, generation readiness, engine, AI Analyze/recovery, generation, validation, approval, PDF finalization, export readiness, source revision, and ZIP download.
- Full happy path from source bytes through strict ZIP.
- Every missing prerequisite asserts zero new `GeneratedDocument` rows.
- AI failure, partial, stale, regex, provider exhaustion, deadline skip, and DB outage assert zero trusted evidence and zero documents.
- Referenced source deletion/replacement blocks downstream state.
- Wrong extension/body, empty bytes, missing Blob, hash mismatch, duplicate names, object-form naming, missing required PDF, and tampered ZIP entry fail closed.
- Concurrent AI, engine, generation, regeneration, PDF, approval, and ZIP requests produce one consistent active result.
- Cross-user/company and all role scenarios.
- Rendered panel tests prove no UI says Ready while the canonical backend gate blocks.

## Validation

```bash
npm ci
npx prisma generate
npm run typecheck
npm run lint
RUN_DB_INTEGRATION=true npm test
npm run build
```

Use only an isolated disposable PostgreSQL database. Never use production data.

## Completion standard

Keep the PR draft, unmerged, and deployment-disabled. List exact files, migrations, test results, unresolved risks, rollback plan, and overlap with every open PR. Do not claim perfect, complete, production-ready, or all fixed unless every executable and DB-backed acceptance test passes.