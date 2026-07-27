# PR #1175 Five-Pass Coverage Ledger

Frozen source SHA: `01aa15406e397facb1d1cd373417641914a02d73`  
Status: **IN PROGRESS**

This ledger is intentionally fail-closed. `PARTIAL` means the category cannot yet be claimed as fully audited. Full coverage will not be claimed until every changed file and every transitive runtime dependency has a row and disposition.

## Repository inventory

| Measure | Observed |
|---|---:|
| PR commits | 638 |
| Changed files | 629 |
| Additions | 35,942 |
| Deletions | 27,771 |
| Discovered page patterns in screenshot artifact | 37 |
| Viewport screenshots | 237 |

## Category coverage

| Category | Status | Files/areas inspected | Findings / disposition |
|---|---|---|---|
| Tender intake/upload | PARTIAL | `lib/tender-upload-first.ts`, `lib/tender-upload-package.ts`, `/api/tenders/upload-first` call graph | F001 open: extraction/OCR remains request-bound; partial uploads are deleted on timeout/failure. |
| Company Review Inbox | PARTIAL | `app/dashboard/company/review/page.tsx`, legacy redirect, diagnostics API | F002 open: legal/financial/compliance absent from canonical UI/DTO. |
| Vault provenance policy | PARTIAL | `lib/vault-review-provenance.ts` | Durable byte/text/revision/field checks inspected; consumer sweep remains incomplete. |
| Legal review API | REVIEWED WITH FINDING | `app/api/company/legal-records/[id]/route.ts` | F003 open: stale-write race. Tenant filter and durable provenance present. |
| Financial review API | REVIEWED WITH FINDING | `app/api/company/financial-records/[id]/route.ts` | F003 open: stale-write race. |
| Compliance review API | REVIEWED WITH FINDING | `app/api/company/compliance-records/[id]/route.ts` | F003 open: stale-write race. |
| Final ZIP production path | PARTIAL | download route, scope, assembly, byte-integrity read | F004 open: manifest omits envelope/format; duplicate owner exists. Exact-entry hash recomputation is present. |
| Secondary ZIP workflow | PARTIAL | `lib/engine/workflow/zip-finalizer.ts` and consumers | Appears disconnected from production route and used by isolated tests; consumer/dead-code proof incomplete. |
| Generated DOCX/PDF/ZIP tests | REVIEWED WITH FINDING | `tests/generated-output-binary-inspection.test.ts`, downloaded artifact | F005 open: synthetic isolated bytes, not production full pipeline. |
| Golden path acceptance | REVIEWED WITH FINDING | `tests/golden-path-release-acceptance.test.ts` | Static fixture/scoring assertions only; not a real golden workflow. |
| Export gate tests | PARTIAL | two screenshot-export-gates test files | F006/F007 open: migration race and source-string proof. |
| CI workflow | PARTIAL | `.github/workflows/ci.yml`, downloaded exact-head artifact | F008 open: success evidence omits mandatory logs and totals. |
| Screenshot audit | PARTIAL | downloaded index, route manifest, summary, Review Inbox screenshots | F009 open: summary counter contradiction; render coverage does not prove behavior. |
| Vercel preview | PARTIAL | exact deployment metadata, `/api/version`, `/api/health`, scoped runtime log query | Exact SHA and basic health confirmed; authenticated workflow/runtime acceptance remains open. |
| PR/base graph | REVIEWED WITH FINDING | PR metadata and commit comparison | F010 open: head is one commit behind base-side history. |
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
| `lib/tender-upload-first.ts` | Yes | Upload authority and source persistence | browser multipart request | Tender/TenderFile, workflow runs, analysis queue | auth, role, tenant, file bytes | source inspection | F001 OPEN |
| `lib/tender-upload-package.ts` | Yes | Client/package batching limits | selected browser files | upload-first and append requests | package/file limits | source inspection | supports batching but does not remove request extraction |
| `app/dashboard/company/review/page.tsx` | Yes | Canonical review UI | diagnostics API | batch review APIs | authenticated reviewer UX | source + screenshots | F002 OPEN |
| `app/dashboard/company/review-board/page.tsx` | Yes | competing legacy route | old bookmarks | canonical Review Inbox | route authority | source inspection | redirect is appropriate |
| `app/api/company/knowledge/repair/route.ts` | Yes | Review Inbox DTO | CompanyDocument/records | review UI | tenant/privacy DTO | source inspection | F002 OPEN |
| `lib/vault-review-provenance.ts` | Yes | evidence eligibility authority | source bytes/text/fields | review/matching/generation/export | tenant-owned source and human review | source inspection | strong checks observed; full consumer sweep open |
| `app/api/company/legal-records/[id]/route.ts` | Yes | legal review mutation | reviewer request | LegalRecord/audit | tenant/role | source inspection | F003 OPEN |
| `app/api/company/financial-records/[id]/route.ts` | Yes | financial review mutation | reviewer request | FinancialRecord/audit | tenant/role | source inspection | F003 OPEN |
| `app/api/company/compliance-records/[id]/route.ts` | Yes | compliance review mutation | reviewer request | ComplianceRecord/audit | tenant/role | source inspection | F003 OPEN |
| `app/api/tenders/[id]/download/route.ts` | Yes | production file/ZIP export owner | release gates + generated bytes | user download + ExportPackage | role/tenant/final approval | source inspection | F004 OPEN; several fail-closed gates present |
| `lib/engine/final-zip-assembly.ts` | Yes | production archive builder | scoped entries + exact bytes | ZIP buffer/manifest | path safety/integrity | source + artifact hash inspection | F004 OPEN |
| `lib/engine/workflow/zip-finalizer.ts` | Yes | competing archive implementation | generated docs | test/workflow result | final approval/integrity | source inspection | ownership/dead-code proof open |
| `tests/generated-output-binary-inspection.test.ts` | Yes | claimed binary evidence | synthetic builders | acceptance artifact | none (isolated test) | artifact independently inspected | F005 OPEN |
| `tests/golden-path-release-acceptance.test.ts` | Yes | claimed golden path | static fixture | scoring assertions | none | source inspection | F005 OPEN |
| `tests/screenshot-export-gates-003-server.test.ts` | Transitive/unchanged | migration and export gate evidence | source strings/DB | CI result | DB migration | source inspection | F006/F007 OPEN |
| `tests/screenshot-export-gates-003-structural.test.ts` | Transitive/unchanged | migration and export gate evidence | source strings/DB | CI result | DB migration | source inspection | F006/F007 OPEN |
| `.github/workflows/ci.yml` | Yes | mandatory release proof | frozen SHA | check result/artifact | synthetic credentials/secrets | artifact inspection | F008 OPEN |

## Pass status

| Pass | Status | Current result |
|---|---|---|
| 1 — static/character-sensitive | IN PROGRESS | Findings F002, F004, F007; broad file sweep incomplete. |
| 2 — dataflow/database/concurrency | IN PROGRESS | Findings F001, F003, F006; schema/query sweep incomplete. |
| 3 — authority/security/tenant isolation | IN PROGRESS | Tenant filters observed in reviewed routes; adversarial route sweep incomplete. |
| 4 — full product workflow/authority | IN PROGRESS | Findings F001, F002, F004; real end-to-end execution not completed. |
| 5 — falsification/runtime/release proof | IN PROGRESS | Findings F005, F008, F009, F010; basic preview identity/health confirmed. |
