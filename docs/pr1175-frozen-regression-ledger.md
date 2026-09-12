# PR #1175 Frozen Regression Ledger

This ledger freezes behavior already accepted on
`release/consolidated-recovery-20260717`. It is evidence, not a new product
feature. A candidate change is rejected if it breaks any contract below unless
the owner contract explicitly proves the old behavior wrong.

## Acceptance rule

Use `PRESERVE → REPRODUCE → FIX → REGRESSION MATRIX → REAL RUNTIME → ACCEPT`.
Run the focused dependency-cone tests while developing, then the complete
matrix and exact-head CI before accepting a commit. Database tests must use the
CI disposable PostgreSQL service or another explicitly isolated test database;
never Production.

## Frozen behavioral contracts

| Area | Frozen contract | Behavioral evidence |
| --- | --- | --- |
| Database/auth | Login, role and tenant isolation remain enforced; Company Vault rows do not cross tenants; tests refuse Production DBs. | `auth-rbac-isolation`, `ai-job-tenant`, `company-asset-security`, `ci-neon-isolation-regression`, authenticated Playwright isolation |
| Source/extraction | Only ACTIVE readable source files participate; bytes/text/hash/revision remain reproducible; stale work is invalidated; content is lossless through the final page. | `ai-analyze-source-traceability`, `analysis-input-hash-jobtype-binding`, `p1-hash-semantics-source-bytes`, `source-revision-*`, `large-requirement-persistence` |
| AI Analyze | Manual authority, exact canonical order/model, ten-attempt budget, all configured paid/free providers, model-aware preflight, malformed-response fallthrough, sequential durable chunks, stale-promotion refusal, and honest deterministic fallback remain intact. | `manual-authority-negative-regression`, `ai-provider-chain-policy`, `exact-model-propagation`, `provider-fallback-chain`, `ai-analysis-capacity-concurrency-regression`, `durable-ai-analyze-workflow`, `fallback-never-authorizes-generation` |
| Engine/BuildPlan | Existing fail-closed analysis authority remains; confirmed BuildPlan is authoritative; stale/hash/tenant mismatches are refused; no SubmissionPlanRevision substitution. | `engine-route-worker-analysis-authority-postgres`, `build-plan-authority-model`, `confirmed-build-plan-fail-closed`, `grounding-and-buildplan-enforcement` |
| Generation/validation | Generated identity and actual bytes are validated; Authority Review reads visible content; historical values do not create false pricing leakage; current pricing does not leak; criteria and source financial rules are preserved. | `generated-document-quality-final-enforcement`, `artifact-identity-*`, `authority-review`, `proposal-price-leakage-*`, `evaluation-criteria-*`, `financial-separation-*` |
| Export | Mandatory coverage is authoritative; readiness surfaces converge; blocked exports cannot appear READY; PDF/ZIP bytes and current BuildPlan membership are real and exclude internal artifacts. | `canonical-coverage-blocks-export`, `canonical-readiness-authority`, `export-byte-readiness`, `final-zip-manifest-authority`, `pipeline-produces-real-zip-end-to-end` |
| Security | Secrets remain redacted; auth/tenant isolation, dependency audit, security controls, and test credential isolation remain intact. | `provider-diagnostic-secret-safety`, `provider-health-redaction`, `auth-rbac-isolation`, `foundation-security-headers`, dependency audit, CodeQL/CI |

## Frozen runtime scenarios

The matrix must cover these behaviors, not merely source-string assertions:

1. Short tender: one lossless chunk; early provider success can promote AI.
2. Approximately 12K tender: request shape preserves useful early-chain
   diversity; chunks are sequential and deterministic for the source/config
   contract.
3. Large tender: multiple deterministic, lossless sequential chunks.
4. Early providers fail and a later configured provider succeeds.
5. Every provider fails: a source-grounded `FALLBACK_DRAFT` is staged and never
   claims `AI_SUCCEEDED`.
6. Fallback plus retry: fallback remains reviewable, approved fallback is not
   auto-rearmed, and retry state is represented without destructive overwrite.
7. Source revision changes: prior job/chunk/build-plan authority is invalidated.
8. Requirements persist and final-chunk mandatory requirements survive merge.
9. Engine → confirmed BuildPlan → generation → validation → Authority Review →
   readiness remains fail-closed and tenant-safe.
10. Real DOCX, PDF, and final ZIP bytes open and contain only current confirmed
    BuildPlan artifacts.

## Required command matrix

Focused provider/chunk/fallback cone:

```bash
node --import tsx --test \
  tests/ai-analysis-capacity-concurrency-regression.test.ts \
  tests/ai-provider-attempt-budget.test.ts \
  tests/ai-provider-chain-policy.test.ts \
  tests/exact-model-propagation.test.ts \
  tests/provider-fallback-chain.test.ts \
  tests/provider-request-budget-regression.test.ts \
  tests/merge-analysis-results.test.ts \
  tests/durable-ai-analyze-workflow.test.ts \
  tests/fallback-never-authorizes-generation.test.ts
```

Isolated-PostgreSQL transition cone:

```bash
RUN_DB_INTEGRATION=true node --import tsx --test \
  tests/analysis-provider-exhaustion-recovers-db-integration.test.ts \
  tests/engine-route-worker-analysis-authority-postgres.test.ts \
  tests/build-plan-db-integration.test.ts \
  tests/artifact-identity-live-conversion-postgres.test.ts \
  tests/pipeline-produces-real-zip-end-to-end.test.ts
```

Static and complete local acceptance:

```bash
npx prisma generate
npm run typecheck
npm run lint
npm test
npm run build
```

Exact-head acceptance additionally requires the GitHub CI PostgreSQL and
authenticated Playwright job, dependency security, route/screenshot audit, a
fresh matching Preview SHA, healthy `/api/health`, and the retained-tender live
run. `UNVERIFIED` and `OWNER ACTION REQUIRED` are never counted as passes.
