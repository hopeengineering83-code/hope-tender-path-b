# Post-1053/1054 Production Gap Closure

Branch: `agent/all-production-gaps-post-1053-1054-no-deploy`  
Base: `main@f6a45804e9bcda5482e2c6397b893b61e76c3ebf`

## Control rules

- Draft PR only. Do not merge.
- Do not modify PR #1055.
- Do not trigger Vercel preview, production, promote, or rollback operations.
- Preserve `vercel.json` with `git.deploymentEnabled: false`.
- Keep final generation, approval, PDF, and ZIP paths fail-closed.
- Keep provider order exactly Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic.
- Never treat tender quotations as Company Vault capability evidence.
- Never claim completion without executable CI, PostgreSQL concurrency, byte-tampering, and authenticated isolation evidence.

## Verified baseline

The corrected behavior from PRs #1053 and #1054 is present on `main` through direct squash commits even though GitHub records those PRs as closed rather than merged.

## Gap register

### Critical

1. Replace the 32-bit, incomplete AI-job advisory lock with a deterministic blocking 64-bit lock over actor, tender, job type, and current content hash.
2. Remove test-runner termination from the DB concurrency suite and prove all concurrent callers converge on one non-null job and one chunk set.
3. Add SHA-256, byte length, detected format, integrity status, and verification timestamp to tender files, Company Vault documents/assets, and generated documents.
4. Treat every legacy or unverifiable file as UNKNOWN and fail closed.
5. Verify actual bytes and storage availability before extraction, validation, approval, PDF finalization, ZIP assembly, and download.
6. Apply one transactional generation-readiness recheck immediately before every GeneratedDocument create/createMany/reactivation path.
7. Add DB-backed zero-row tests for every failed prerequisite.
8. Invalidate requirements, evidence, Build Plan, documents, validation, approval, PDF, and package state when a source revision changes.
9. Build final ZIP manifests from the exact included bytes and verify digest, length, signature, name, order, revision, validation, and approval.

### High

10. Make PDF supersede/create atomic and clean orphaned storage on failure.
11. Centralize owner/company/workspace/role authorization for all touched routes and bind supplied IDs relationally.
12. Standardize safe public errors and sanitized structured logging.
13. Enforce actual streamed/read byte limits rather than trusting Content-Length.
14. Prove background-worker claim, retry, chunk, and outage behavior.
15. Replace remaining source-shape tests with executable route, database, storage-byte, concurrency, and browser tests.

## Staged execution

- Stage 1: AI-job idempotency and test-runner safety.
- Stage 2: Schema/migration and byte-integrity primitives.
- Stage 3: Upload, storage, validation, approval, PDF, and ZIP integration.
- Stage 4: Universal transactional GeneratedDocument persistence gate and source revision invalidation.
- Stage 5: Authorization, safe errors, resource limits, worker reliability, and full acceptance.

## Current progress

- Stage 1 in progress.
- Vercel deployments remain disabled.
- PR #1055 remains untouched.
- Merge decision: **DO NOT MERGE** until every critical/high item is complete and all executable checks pass.
