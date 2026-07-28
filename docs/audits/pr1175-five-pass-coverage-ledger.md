# PR #1175 Five-Pass Coverage Ledger

Governing source SHA: `ec0eaa83af3d3616bf935b9a3f950af734bcc6ca`
Governing base SHA: `b3c9db5de89a2a665e61a83facbff0f276f9983c`
Audit branch: `audit/pr1175-complete-five-pass-forensic-audit`
Previous published audit checkpoint: `41c802d2b518d89e7b122a81efafbc536a3dde7c`
Status: **IN PROGRESS — DO NOT MERGE**

This ledger is intentionally fail-closed. `PARTIAL` means the category cannot yet be claimed as fully audited. Full coverage will not be claimed until every changed file and every transitive runtime dependency has a row and disposition.

The initial rows in this file came from the earlier audit frozen at
`01aa1540…`. They remain useful historical evidence but do not override the
current-head dispositions below.

## Repository inventory

| Measure | Observed |
|---|---:|
| PR commits | 656 |
| Changed files | 656 |
| Additions | 40,012 |
| Deletions | 28,533 |
| Discovered page patterns in screenshot artifact | 37 |
| Viewport screenshots | 237 |

## Category coverage

| Category | Status | Files/areas inspected | Findings / disposition |
|---|---|---|---|
| Tender intake/upload | FIXED LOCAL / RUNTIME OPEN | both tender upload handlers, package ledgers, `tender-extraction-service.ts`, job registry, UI worker wake-up | F001 fixed locally: verified source/package rows own exact hash-bound extraction jobs; request paths no longer extract or directly queue analysis. Isolated-DB concurrency/deletion and exact-preview proof remain open. |
| Company Review Inbox | FIXED LOCAL / RUNTIME OPEN | `app/dashboard/company/review/page.tsx`, legacy redirect, diagnostics API, all three support review routes | F002 fixed locally: bounded paginated DTOs and explicit approve/return-to-draft actions now cover legal, financial and compliance records. |
| Vault provenance policy | PARTIAL | `lib/vault-review-provenance.ts` | Durable byte/text/revision/field checks inspected; consumer sweep remains incomplete. |
| Legal review API | VERIFIED CI | list/create/detail routes + provenance consumer | Revision/source-bound optimistic write passed isolated PostgreSQL concurrency and authenticated route tests; unsupported manual creation now remains `MANUAL_DRAFT`. |
| Financial review API | VERIFIED CI | list/create/detail routes + provenance consumer | Revision/source-bound optimistic write passed isolated PostgreSQL concurrency and authenticated route tests; unsupported manual creation now remains `MANUAL_DRAFT`. |
| Compliance review API | VERIFIED CI | list/create/detail routes + provenance consumer | Revision/source-bound optimistic write passed isolated PostgreSQL concurrency and authenticated route tests; unsupported manual creation now remains `MANUAL_DRAFT`. |
| Final ZIP production path | FIXED LOCAL / RUNTIME OPEN | download route, scope, canonical plan format/envelope inference, assembly, byte-integrity read | F004 fixed locally: one owner; manifest carries exact name/order/envelope/format/length/hash and rejects duplicate plan positions before reopened exact-byte verification. |
| Secondary ZIP workflow | REMOVED | deleted `lib/engine/workflow/zip-finalizer.ts`; all former consumers reconnected | Consumer sweep found test-only use. Tests now exercise the production assembler instead of a disconnected implementation. |
| Generated DOCX/PDF/ZIP tests | REVIEWED WITH FINDING | `tests/generated-output-binary-inspection.test.ts`, downloaded artifact | F005 open: synthetic isolated bytes, not production full pipeline. |
| Golden path acceptance | REVIEWED WITH FINDING | `tests/golden-path-release-acceptance.test.ts` | Static fixture/scoring assertions only; not a real golden workflow. |
| Export gate tests | PARTIAL | two screenshot-export-gates test files + CI migration owner | F006 fixed locally: no migration subprocess remains in parallel test bodies; F007 source-string proof remains open. |
| CI workflow | PARTIAL | `.github/workflows/ci.yml`, downloaded exact-head artifact | F008 open: success evidence omits mandatory logs and totals. |
| Screenshot audit | PARTIAL | downloaded index, route manifest, summary, Review Inbox screenshots | F009 open: summary counter contradiction; render coverage does not prove behavior. |
| Vercel preview | PARTIAL | supplied screenshot deployment `aed98737…`, governing deployment `ec0eaa83…`, scoped runtime queries | Historical screenshot log lines have expired; screenshot binds a P2022 failure to `aed98737…`. Governing deployment has no retained error/500 logs but no authenticated acceptance traffic. |
| PR/base graph | REVIEWED | current PR metadata and comparison | F010 from the donor audit is stale; this branch was created from the current frozen PR #1175 head. |
| Authentication/password reset | NOT STARTED | — | Required Pass 3 scope. |
| Tenant isolation across all routes | NOT STARTED | — | Required Pass 3 scope. |
| AI job leases/retries/checkpoints | NOT STARTED | — | Required Pass 2 scope. |
| Prisma schema and every migration | NOT STARTED | — | Required Pass 2 scope. |
| Canonical workflow snapshot consumers | NOT STARTED | — | Required Pass 4 scope. |
| Matching and selected-evidence policy | NOT STARTED | — | Required Pass 4 scope. |
| Generation/regeneration gates | NOT STARTED | — | Required Pass 4 scope. |
| PDF finalization owner | NOT STARTED | — | Required Pass 4/5 scope. |
| GitHub workflows other than CI/screenshot | NOT STARTED | — | Required release scope. |
| Security configuration/secrets/public DTOs | NOT STARTED | — | Required Pass 3/5 scope. |

## Audited-file detail

| Path | Changed? | Why in scope | Upstream | Downstream | Security boundary | Tests/evidence | Disposition |
|---|---|---|---|---|---|---|---|
| `lib/tender-upload-first.ts` | Yes | Upload authority and source persistence | browser multipart request | Tender/TenderFile, workflow runs, extraction queue | auth, role, tenant, file bytes | failing-before/passing-after wiring contract + transitive suite | F001 FIXED_LOCAL |
| `lib/tender-upload-package.ts` | Yes | Client/package batching limits | selected browser files | upload-first and append requests | package/file limits | source inspection | supports batching but does not remove request extraction |
| `app/dashboard/company/review/page.tsx` | Yes | Canonical review UI | bounded diagnostics API | expert/project batch and support-record detail review APIs | authenticated reviewer UX | failing-before/passing-after contract + privacy suite | F002 FIXED_LOCAL |
| `app/dashboard/company/review-board/page.tsx` | Yes | competing legacy route | old bookmarks | canonical Review Inbox | route authority | source inspection | redirect is appropriate |
| `app/api/company/knowledge/repair/route.ts` | Yes | Review Inbox DTO | CompanyDocument/all five evidence families | review UI | tenant/privacy DTO | focused contract + privacy/RBAC/provenance suite | F002 FIXED_LOCAL |
| `lib/vault-review-provenance.ts` | Yes | evidence eligibility authority | source bytes/text/fields | review/matching/generation/export | tenant-owned source and human review | source inspection | strong checks observed; full consumer sweep open |
| `app/api/company/legal-records/[id]/route.ts` | Yes | legal review mutation | reviewer request | LegalRecord/audit | tenant/role/revision | 3/3 static + exact-CI PostgreSQL concurrency + 8/8 authenticated route suite | F003 VERIFIED_CI |
| `app/api/company/financial-records/[id]/route.ts` | Yes | financial review mutation | reviewer request | FinancialRecord/audit | tenant/role/revision | 3/3 static + exact-CI PostgreSQL concurrency + 8/8 authenticated route suite | F003 VERIFIED_CI |
| `app/api/company/compliance-records/[id]/route.ts` | Yes | compliance review mutation | reviewer request | ComplianceRecord/audit | tenant/role/revision | 3/3 static + exact-CI PostgreSQL concurrency + 8/8 authenticated route suite | F003 VERIFIED_CI |
| `app/api/company/{legal,financial,compliance}-records/route.ts` | Yes | support-record creation | authenticated manager input | support-record draft | role/tenant/trust authority | new manual-draft contract | F020 FIXED_LOCAL |
| `app/api/tenders/[id]/download/route.ts` | Yes | production file/ZIP export owner | release gates + generated bytes | user download + ExportPackage | role/tenant/final approval | focused manifest/route contracts | F004 FIXED_LOCAL; persisted runtime proof open |
| `lib/engine/final-zip-scope.ts` | Yes | package scope and manifest authority producer | confirmed plan/generated docs | exact ordered entries | plan/envelope/format separation | failing-before/passing-after authority contract | F004 FIXED_LOCAL |
| `lib/engine/final-zip-assembly.ts` | Yes | sole production archive builder | authoritative scoped entries + exact bytes | ZIP buffer/manifest | path/order/metadata/integrity | 213/213 affected assertions | F004 FIXED_LOCAL |
| `lib/engine/workflow/zip-finalizer.ts` | Removed | competing archive implementation | test-only consumers | disconnected result | duplicated final approval/integrity | complete consumer sweep | removed; no runtime consumer |
| `tests/generated-output-binary-inspection.test.ts` | Yes | claimed binary evidence | synthetic builders + canonical assembler | acceptance artifact | none (isolated test) | artifact independently inspected | F005 OPEN: canonical owner, still not full pipeline |
| `tests/golden-path-release-acceptance.test.ts` | Yes | claimed golden path | static fixture | scoring assertions | none | source inspection | F005 OPEN |
| `tests/screenshot-export-gates-003-server.test.ts` | Yes | migration and export gate evidence | source strings/DB | CI result | DB behavior | failing-before/passing-after ownership contract | F006 FIXED_LOCAL / F007 OPEN |
| `tests/screenshot-export-gates-003-structural.test.ts` | Yes | migration and export gate evidence | source strings/DB | CI result | DB behavior | 73/73 related assertions | F006 FIXED_LOCAL / F007 OPEN |
| `tests/migration-test-ownership.test.ts` | New | migration execution ownership | CI workflow + migration suites | test-runner safety | shared migration state | failing-before 1/2, passing-after 2/2 | F006 FIXED_LOCAL |
| `.github/workflows/ci.yml` | Yes | mandatory release proof | frozen SHA | check result/artifact | synthetic credentials/secrets | artifact inspection | F008 OPEN |

## Pass status

| Pass | Status | Current result |
|---|---|---|
| 1 — static/character-sensitive | IN PROGRESS | F002/F004 fixed locally; F007 and the broad file sweep remain open. |
| 2 — dataflow/database/concurrency | IN PROGRESS | F001/F006/F013/F014 fixed locally and F003 verified in exact-checkpoint CI; extraction concurrency remains open. |
| 3 — authority/security/tenant isolation | IN PROGRESS | Tenant filters observed in reviewed routes; adversarial route sweep incomplete. |
| 4 — full product workflow/authority | IN PROGRESS | F001/F002/F004 fixed locally; real end-to-end execution not completed. |
| 5 — falsification/runtime/release proof | IN PROGRESS | F015 critical-schema detection fixed locally; exact audit-head CI/preview and F005/F008/F009 remain open. |

## Current-head closure evidence

- Automatic ingestion can produce `SOURCE_VERIFIED` only; it cannot fabricate
  an authenticated human reviewer.
- Generation and auto-finalize no longer apply signature/stamp assets without
  explicit human authorization.
- Tender extraction is owned by one durable worker and one deterministic
  source-hash-bound producer.
- Company upload persists pending extraction and forces canonical background
  re-extraction before Vault ingestion.
- The deploy-time critical-schema evaluator now requires every
  legal/financial/compliance review-provenance column. A missing
  `LegalRecord.trustLevel` produces a failing schema result before a
  migration-enabled deployment can serve traffic.
- The canonical Review Inbox now includes legal, financial and compliance
  records through bounded DTOs and durable review routes.
- Unsupported manual support records remain `MANUAL_DRAFT`; creation cannot
  fabricate human review authority.
- Final ZIP scope and assembly have one production owner. The stored manifest
  now binds exact filename, plan order, envelope, format, byte length and
  SHA-256 to bytes reopened from the generated archive.

Local evidence: TypeScript, ESLint, release-integrity audits, 382/382 affected
transitive assertions for the extraction checkpoint, 63/63
schema/migration/preview-regression assertions, and 60/60 related Review
Inbox/privacy/RBAC/provenance/concurrency assertions. The Final ZIP checkpoint
adds 213/213 affected scope/assembly/Build Plan/PDF/package/static-safety/binary
assertions. Migration ownership adds 73/73 related assertions. Database
integration is not claimed because no isolated PostgreSQL service is available
in this workspace.
