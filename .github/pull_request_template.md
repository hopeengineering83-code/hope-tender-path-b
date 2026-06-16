## Objective

<!-- State one coherent objective. Do not use "fix everything". -->

## Verified baseline

- Base branch: `main`
- Base commit SHA:
- Current implementation inspected:
- Relevant tests/logs inspected:

## Verified gap and evidence

<!-- Describe the actual code, test, log, or deployment evidence. Do not rely only on an earlier AI summary. -->

## Change-impact matrix

| Area | Changed? | Risk | Required proof |
|---|---|---|---|
| Authentication / sessions | No | — | Authorization tests if Yes |
| RBAC / tenant isolation | No | — | Two-user role-matrix tests if Yes |
| Tender creation / upload | No | — | Upload contract and storage-failure tests if Yes |
| Extraction / OCR | No | — | Quality and corruption tests if Yes |
| AI Analyze / fallback | No | — | Provider, fallback, promotion, and provenance tests if Yes |
| Requirements / source linkage | No | — | Source-file/page/quote tests if Yes |
| Expert / project matching | No | — | Deterministic and AI matching tests if Yes |
| Submission plan | No | — | Naming, order, and envelope tests if Yes |
| Document generation | No | — | DOCX/PDF quality tests if Yes |
| Review / approval | No | — | Role, ownership, and audit-history tests if Yes |
| Export / ZIP | No | — | Readiness, manifest, signature, and ZIP integrity tests if Yes |
| Prisma schema / migrations | No | — | Production migration-path and critical-schema tests if Yes |
| Storage / environment | No | — | Storage adapter and production-readiness tests if Yes |
| UI / recovery actions | No | — | Browser and action-registry tests if Yes |
| Observability / operations | No | — | Structured-log and failure-path evidence if Yes |

## Behaviour preserved

<!-- List current working behaviours that must remain unchanged. -->

## Explicit exclusions

<!-- State what this PR intentionally does not change. -->

## Database and data-safety statement

- [ ] No production data was accessed or modified during development/testing.
- [ ] Migration is additive/backward-compatible, or no migration is included.
- [ ] Object-storage and database compensation paths were tested where applicable.
- [ ] Existing legitimate records and generated-document versions are preserved.

## Validation evidence

- [ ] `npm ci`
- [ ] `npm run audit:release-integrity`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] Production-equivalent migration path validated
- [ ] Critical schema check passed
- [ ] Vercel preview is READY

## Representative workflow verification

- [ ] Upload persisted at least one source file
- [ ] Extraction state matched stored content
- [ ] AI Analyze completed or returned an explicitly labelled fallback/recovery action
- [ ] Requirements retained source linkage
- [ ] Submission plan and generation gates behaved correctly
- [ ] Final package checks were unaffected or revalidated

## Rollback

- Rollback condition:
- Rollback method:
- Data compatibility after rollback:

## Remaining risks

<!-- List unresolved risks. Use "None verified" only after checking. -->
