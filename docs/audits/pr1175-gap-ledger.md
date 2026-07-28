# PR #1175 Five-Pass Gap Ledger

Audit branch: `audit/pr1175-complete-five-pass-forensic-audit`
Frozen governing SHA: `ec0eaa83af3d3616bf935b9a3f950af734bcc6ca`
Base SHA reported by PR: `b3c9db5de89a2a665e61a83facbff0f276f9983c`  
Status: **IN PROGRESS — do not merge**

This ledger records only findings supported by source or runtime evidence. A finding is not closed until its regression test, persisted-state proof, runtime proof and transitive checks are recorded.

## PR1175-F001 — Expensive extraction and OCR execute inside tender upload requests

- Severity: CRITICAL
- Pass: 2 / 4 / 5
- Status: FIXED_LOCAL — database/runtime acceptance open
- Canonical owner: tender source-ingestion job pipeline
- Primary files: `lib/tender-upload-first.ts`, `app/api/tenders/upload-first/route.ts`, tender file append/upload routes, extraction job handlers
- Reproduction: upload a multi-file package containing files whose extraction approaches the request budget.
- Root cause: the request stored each file and immediately awaited `extractTextFromBuffer`, while the registered durable extraction producer had no production caller. Company upload similarly trusted request-time extracted text.
- User impact: valid large tender packages can time out, be rolled back, require manual re-upload, or never obtain a durable resumable extraction identity.
- Fix: request handlers persist verified bytes/source/package state and exact
  content-hash-bound extraction jobs. The canonical worker exclusively owns
  extraction, metadata enrichment and continuation; company ingestion forces
  background re-extraction.
- Regression proof: new wiring contract failed 7/7 before and passes 7/7 after;
  affected transitive suite 382/382. Two-worker deletion/cancellation and exact
  preview runtime proof remain open.

## PR1175-F002 — Review Inbox omits legal, financial and compliance records

- Severity: HIGH
- Pass: 1 / 4 / 5
- Status: FIXED_LOCAL — database/runtime acceptance open
- Canonical owner: Company Vault Review Inbox
- Primary files: `app/dashboard/company/review/page.tsx`, `app/api/company/knowledge/repair/route.ts`
- Reproduction: open `/dashboard/company/review`; only experts and projects have review queues and controls.
- Root cause: diagnostics DTO, pagination, state and UI model only handled expert/project records even though legal/financial/compliance review APIs existed.
- User impact: legally sensitive records require hidden/direct API use and have no visible source quote, page, provenance, approve/reject control or review outcome in the canonical inbox.
- Fix: the canonical diagnostics endpoint now returns bounded, independently
  paginated DTOs for all three support families; the single Review Inbox
  exposes evidence state and routes approve/return-to-draft decisions through
  the existing durable-provenance mutation routes. Raw extracted source text
  is not returned.
- Regression proof: the new focused contract failed before implementation and
  passes 4/4 after; the related privacy, RBAC, provenance and concurrency set
  passes 60/60. Authenticated preview acceptance remains open.

## PR1175-F003 — Legal/financial/compliance review writes have ineffective concurrency guards

- Severity: HIGH
- Pass: 2 / 3 / 5
- Status: VERIFIED_CI
- Canonical owner: vault review mutation service
- Primary files: `app/api/company/legal-records/[id]/route.ts`, `app/api/company/financial-records/[id]/route.ts`, `app/api/company/compliance-records/[id]/route.ts`
- Reproduction target: read a record, modify it or its source concurrently,
  then submit approval based on the stale read.
- Current-head result: the earlier finding was stale. All three routes already
  bind `updateMany` to the record `updatedAt`, source identity, source text,
  source byte hash/length/integrity metadata and extraction metadata; a
  mismatch returns `409 CONCURRENT_UPDATE` and does not write the audit event.
- Regression proof: 3/3 static route predicates pass locally. Exact child
  checkpoint CI run `30377357481` executed the isolated PostgreSQL two-writer
  test with `RUN_DB_INTEGRATION=true`; stale record/source revisions were
  rejected for all three families. The related real authenticated route suite
  also passed 8/8. The overall run failed only on a workboard documentation
  assertion (8,918/8,919 tests); that assertion is fixed locally.

## PR1175-F004 — Final ZIP manifest authority is incomplete and duplicated

- Severity: HIGH
- Pass: 1 / 4 / 5
- Status: FIXED_LOCAL — authenticated persisted-package/runtime acceptance open
- Primary files: `lib/engine/final-zip-assembly.ts`, `lib/engine/final-zip-scope.ts`, `app/api/tenders/[id]/download/route.ts`
- Root cause: production manifest entries contain filename/order/hash/byte length but omit envelope and format; a separate workflow ZIP finalizer is exercised by binary tests but is not the production download owner.
- Impact: stored manifest cannot fully prove tender envelope/format compliance; tests can pass against a disconnected implementation.
- Fix: removed the disconnected workflow finalizer and moved every affected
  binary/behavioral test to `assembleFinalSubmissionZip`. Canonical scope
  entries now carry a unique positive exact plan order, inferred submission
  envelope and canonical plan format. The persisted production manifest
  records those fields with exact filename, byte length and SHA-256; assembly
  sorts by plan order, rejects duplicate plan positions, reopens the archive
  and recomputes each entry's length and hash.
- Regression proof: the new authority contract failed 3/3 before
  implementation and passes 3/3 after. The broader affected scope, assembly,
  Build Plan, PDF, release-package, static-safety and binary-inspection set
  passes 213/213; TypeScript, ESLint and release-integrity audits are clean.
  An authenticated isolated-database download proving the persisted
  `ExportPackage.manifestJson` remains open.

## PR1175-F005 — Exact-head generated-file evidence is synthetic, not full-pipeline acceptance

- Severity: HIGH
- Pass: 5
- Status: OPEN
- Evidence: downloaded exact-head artifact `exact-head-acceptance-01aa154...`
- Observed: DOCX contains two paragraphs with no TOC, heading hierarchy, header, footer or branding; PDF is one synthetic page; ZIP contains only those two synthetic files.
- Root cause: `tests/generated-output-binary-inspection.test.ts` constructs
  bytes directly. It now calls the canonical production assembler, but still
  bypasses upload, persisted analysis, planning, matching, review and the
  authenticated download route.
- Impact: artifact proves isolated file parsing/hash parity only, not upload → extraction → analysis → plan → matching → generation → review → PDF → ZIP.
- Required fix: realistic fixtures and an authenticated persisted full-pipeline test using production owners.

## PR1175-F006 — Migration-owning tests can race on shared migration state

- Severity: HIGH
- Pass: 2 / 5
- Status: FIXED_LOCAL — exact CI proof pending
- Primary files: `tests/screenshot-export-gates-003-server.test.ts`, `tests/screenshot-export-gates-003-structural.test.ts`
- Root cause: both test files shell out to `npx prisma migrate deploy` from the test runner against the shared `DATABASE_URL`.
- Impact: parallel tests can contend on `_prisma_migrations`, producing nondeterministic failures or masking migration defects.
- Fix: removed all four in-test migration subprocesses. The CI workflow is
  the single migration owner: it deploys the complete history, runs a second
  serialized deploy to prove idempotency, and only then starts the parallel
  test runner. Database row-behavior assertions remain in their existing
  suites.
- Regression proof: the new ownership contract failed before implementation
  and passes 2/2 after; the related CI/migration/source suites pass 73/73 and
  TypeScript is clean. Exact-head CI must still prove the serialized steps and
  database suites together.

## PR1175-F007 — Source-string assertions are presented as release gates

- Severity: MEDIUM
- Pass: 1 / 5
- Status: OPEN
- Primary files: `tests/screenshot-export-gates-003-server.test.ts`, `tests/screenshot-export-gates-003-structural.test.ts`
- Root cause: assertions search source strings/regex ordering instead of executing handlers and persisted behavior. The structural suite itself admits it does not execute authenticated routes.
- Impact: a route can contain the expected text while runtime authorization, branching, transactionality or response behavior remains wrong.
- Required fix: retain narrowly useful structure checks only as supplemental tests and add handler/HTTP/database behavior tests for every load-bearing gate.

## PR1175-F008 — Exact-head CI evidence artifact omits required command logs

- Severity: HIGH
- Pass: 5
- Status: FIXED_LOCAL — exact CI artifact inspection pending
- Primary file: `.github/workflows/ci.yml`
- Evidence: downloaded artifact contains nine files and only `build-results/npm-build.log`; configured migration, idempotency, drift and release-integrity logs are absent.
- Root cause: artifact collection allows missing files with `if-no-files-found: warn` and does not preserve typecheck, lint, unit-test or Playwright logs on success.
- Impact: exact commands, exits, durations and test totals cannot be independently verified from the success artifact.
- Fix: every mandatory post-install CI command now runs through one recorder
  that streams output, writes a non-empty log and appends command arguments,
  exact source SHA, run ID, timestamps, duration, exit code and signal to an
  NDJSON ledger. A success-only verifier requires exactly one successful
  exact-head entry and non-empty log for all 16 commands. Exact-head artifacts
  are uploaded only after that verifier passes and use
  `if-no-files-found: error`; failed runs retain their separate diagnostics.
- Regression proof: the new completeness contract failed 3/3 before
  implementation and passes 3/3 after. Recorder/verifier behavior and related
  CI/migration contracts pass 36/36; YAML parses successfully; TypeScript,
  ESLint and release-integrity audits are clean. The next exact-head success
  artifact must still be downloaded and independently inspected.

## PR1175-F009 — Screenshot summary contains internally inconsistent coverage counters

- Severity: MEDIUM
- Pass: 5
- Status: OPEN
- Evidence: route screenshot artifact reports `routeCoveragePercent: 100` and no uncovered routes while `counts.routeCoverage` is `0`.
- Impact: release evidence contains contradictory coverage fields and cannot be treated as authoritative without inspecting the raw route index.
- Required fix: derive summary and detailed index from one canonical calculation and add schema/consistency assertions.

## PR1175-F010 — Donor audit branch was behind its base-side history

- Severity: MEDIUM
- Pass: 1 / 5
- Status: CLOSED_AS_STALE
- Evidence: that comparison described the obsolete donor audit. The current
  audit branch was created directly from the re-fetched PR #1175 head
  `ec0eaa83…`, which was rechecked unchanged before both published
  checkpoints.
- Required continuing control: stop and compare every intervening commit if
  the governing head moves.

## Current-head findings added after the donor audit

| ID | Severity | Pass | Status | Root cause / disposition |
|---|---|---|---|---|
| PR1175-F011 | CRITICAL | 3 | VERIFIED_LOCAL | Automatic ingestion fabricated `REVIEWED` plus `SYSTEM_AUTO_VERIFIED`. Canonical transition now produces `SOURCE_VERIFIED` with null human identity and repairs legacy fabricated rows. |
| PR1175-F012 | CRITICAL | 3/4 | VERIFIED_LOCAL | Generation automatically inserted signature/stamp assets. Both invocation paths and the competing mutator were removed; uploaded assets are not legal approval. |
| PR1175-F013 | HIGH | 1/2 | VERIFIED_LOCAL | A second unreachable `EXTRACT_TEXT` implementation remained in the legacy handler. It is removed; handler registration binds to the canonical service. |
| PR1175-F014 | HIGH | 2/4 | FIXED_LOCAL | Company upload trusted request-time text. It now persists pending extraction and queues `VAULT_INGEST` with `reExtractAll: true`; DB integration remains open. |
| PR1175-F015 | CRITICAL | 2/5 | FIXED_LOCAL / RUNTIME OPEN | Screenshot deployment queried `LegalRecord.trustLevel` before its database had the additive migration. Runtime evidence consumers fail closed through the compatibility loader, and the deploy-time critical-schema evaluator now requires every authority-bearing column. Isolated-preview migration and exact runtime proof remain open. |
| PR1175-F016 | HIGH | 5 | OPEN | Supplied preview showed bid-strategy HTTP 500. Later code routes support-record loads through the compatibility boundary, but no retained authenticated runtime request proves closure. |
| PR1175-F017 | HIGH | 4/5 | OPEN | Mandatory FULL/Covered rows were shown as UNKNOWN elsewhere. One revision-bound selector across panels remains to be proved. |
| PR1175-F018 | HIGH | 4/5 | OPEN | Required-document, Build Plan and PDF state disagreed across panels. Cross-route reconciliation remains open. |
| PR1175-F019 | MEDIUM | 4/5 | OPEN | Repeated competing blocker panels/actions obscure one next action. Canonical lifecycle action ownership remains open. |
| PR1175-F020 | HIGH | 3/4 | FIXED_LOCAL | Manual Legal/Financial/Compliance POST routes stamped unsupported entries `REVIEWED` with a reviewer identity even though durable provenance rejected them. Creation now persists explicit `MANUAL_DRAFT` with null reviewer/timestamp; only the source-backed review route can promote it. Database/runtime acceptance remains open. |
