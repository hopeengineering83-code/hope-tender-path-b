# Controlled Integration and Release Policy

This repository uses a staged integration model to prevent overlapping AI-generated changes from weakening or deleting previously verified work.

## Authoritative branches

- `main`: current production code. No AI coding agent may merge directly to this branch.
- `integration/production-engine-2026-06`: combines reviewed feature work one lane at a time.
- `release/production-engine-2026-06`: frozen release candidate. It moves only after integration passes all required gates.

## Feature lanes

- `feature/database-schema-cleanup`: Prisma schema, migrations, constraints, upgrade safety.
- `feature/upload-storage-reliability`: upload, storage, retrieval, extraction, and recovery.
- `feature/resumable-ai-analysis`: AI job execution, interruption, resume, idempotency, and provider recovery.
- `feature/release-integrity-tests`: CI, migration verification, Playwright, deployment verification, and release gates.

## Mandatory operating rules

1. A feature branch must be based on the current integration branch before implementation begins.
2. A feature PR must target `integration/production-engine-2026-06`, never `main`.
3. One PR must have one coherent subsystem objective.
4. Existing PRs #745, #746, and #747 are historical reference material only and must not be merged.
5. Shared high-risk files require integration-owner review:
   - `prisma/schema.prisma`
   - `prisma/migrations/**`
   - `lib/prisma.ts`
   - `lib/ai.ts`
   - `lib/rate-limit.ts`
   - `package.json`
   - `package-lock.json`
   - `next.config.*`
   - `vercel.json`
   - `.github/workflows/**`
6. Integrate one feature PR at a time and rerun cumulative checks before the next merge.
7. No install, test, migration, or build command may rewrite tracked source files.
8. A Vercel `READY` result proves only that a build deployed; it does not prove the tender workflow works.
9. The release branch may accept only release-blocking fixes. New features return to integration.
10. The only production PR is `release/production-engine-2026-06` to `main`.

## Required integration evidence

- `npm ci`
- `npx prisma validate`
- `npx prisma generate`
- database integration tests
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:e2e`
- `git diff --exit-code`

## Required release evidence

- Production-equivalent migration history succeeds on a fresh database.
- Upgrade migration succeeds from a representative existing database.
- Vercel preview is `READY` and `/api/health` reports the tested commit SHA.
- Authenticated upload, extraction, AI analysis, interruption/resume, evidence linkage, generation, review, DOCX/PDF output, and final ZIP workflow passes.
- Unauthorized and cross-user access tests pass.
- Rollback commit and data-compatibility statement are documented.

## Stop conditions

Stop integration immediately when a PR:

- changes files outside its declared lane without justification;
- combines unrelated changes;
- silently falls back to weaker security or storage behavior;
- uses runtime DDL as a substitute for production migrations;
- modifies source files during install, test, or build;
- removes existing tests or safeguards without equivalent replacement evidence;
- has a stale or misleading PR description;
- cannot identify the exact base commit it was built from.
