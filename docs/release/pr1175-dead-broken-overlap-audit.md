# PR #1175 Dead, Broken, and Overlapping Code Audit

- Parent PR: #1175
- Exact starting SHA: `4c37510578e0d725fecf8bc6e4f388dd807408b6`
- Audit branch: `fix/pr1175-dead-broken-overlap-audit`
- Product-fix commit: `01908cf5b1deaf057056ccf691962aa12ea81f42`
- Status: fixes applied; exact-head validation in progress

## Confirmed fixes applied

- Repaired the background `EXTRACT_TEXT` path so inferred fill-empty metadata is persisted through the canonical auto-fill authority before evidence enrichment and candidate classification.
- Removed the empty test-only analysis progress stub while retaining the real route-level non-destructive progress-preservation implementation.
- Stabilized workflow-sync callbacks in the export-readiness and final-submission panels.
- Removed the unused parallel `AiAnalyzeRunner` implementation and its source-text-only test contract.
- Removed the unused matching threshold helper while preserving the authoritative fail-closed `0.75` selection threshold in the live optimizer.
- Removed unused compatibility aliases that overlapped explicit durable, structured-extraction, and structured-hash authorities.
- Removed compiler-proven dead imports, locals, no-op helpers, abandoned nested scopes, and obsolete generation residues from the audited PR #1175 scope.
- Updated focused regression tests to exercise production implementations rather than dead aliases or test-only stubs.

## Safety invariants retained

- Tenant and company isolation.
- Durable review provenance and source-byte integrity.
- Fail-closed matching and strict-domain suppression.
- Build Plan, evidence, compliance, validation, approval, generation, PDF, ZIP, and export gates.
- Non-destructive AI analysis progress preservation.

No merge, deployment, production migration, production-data mutation, environment-variable change, or modification to `main` was performed.
