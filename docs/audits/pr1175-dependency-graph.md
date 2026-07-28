# PR #1175 Transitive Dependency Graph

Governing source SHA: `ec0eaa83af3d3616bf935b9a3f950af734bcc6ca`
Audit branch: `audit/pr1175-complete-five-pass-forensic-audit`
Audit status: **IN PROGRESS — DO NOT MERGE**

This document records the end-to-end authority graph being audited. It is not a claim that every node is closed.

## 1. Tender source intake

`/dashboard/tenders/new`
→ `POST /api/tenders/upload-first`
→ `handleUploadFirstTender`
→ request authentication and role gate
→ persistent rate limit
→ multipart batch validation
→ package-session parsing and replay lookup
→ file signature/MIME validation
→ storage adapter `putFile`
→ persisted-byte integrity inspection
→ `Tender` + `TenderFile` + package `TenderWorkflowRun` rows
→ exact source-hash-bound `EXTRACT_TEXT` job
→ canonical extraction worker
→ optimistic extraction persistence and truncation disclosure
→ current-source metadata/enrichment
→ all-active-file/package readiness recheck
→ canonical AI analysis job
→ analysis revision
→ requirements and facts
→ submission plan
→ matching/generation continuation.

The request-bound extraction root is fixed locally. Deletion/cancellation,
two-worker concurrency, and exact-preview continuation still require
isolated-database/runtime proof.

## 2. Company Vault review authority

Company source upload
→ `CompanyDocument`
→ byte-integrity authority
→ extraction revision
→ expert/project/legal/financial/compliance record
→ source-verification provenance
→ `/dashboard/company/review`
→ privacy-safe diagnostics DTO
→ reviewer decision
→ optimistic revision check
→ durable review provenance
→ audit event
→ canonical `canUseVaultRecord` eligibility
→ matching/generation/export consumers.

Current local result:

- Review Inbox and diagnostics cover experts, projects, legal, financial and
  compliance records through bounded paginated DTOs.
- Manual support-record creation remains `MANUAL_DRAFT`; it does not stamp a
  reviewer identity or approval timestamp.
- Legal/financial/compliance approval uses the existing tenant-owned source,
  exact record/source revision predicate and durable provenance builder.
- Static concurrency predicates pass, and exact child-checkpoint CI executed
  the isolated PostgreSQL two-writer and authenticated review-route suites.

## 3. Tender release authority

Tender sources + source hashes
→ extraction revision/state
→ analysis revision/state
→ requirements revision
→ confirmed Build Plan
→ current evidence selection
→ generated document revision
→ validation/review/PDF state
→ `getFinalSubmissionReadiness`
→ `assertTenderReadyForGenerationAndExport`
→ release-state/API DTO
→ UI panels and next action
→ download/PDF/ZIP owners.

Audit rule: every dependent success must be invalidated when an upstream controlling revision changes.

Requirement coverage subgraph:

```text
active TenderFile bytes/text/page count
→ TenderRequirement source file/page/exact quote
→ ComplianceMatrix support level
→ mapRequirementsToEvidence
→ FULLY_MET | PARTIALLY_MET | NEEDS_TRACE | NOT_MET
→ requirement coverage API + three coverage panels
→ release snapshot + lifecycle next action
→ generation/export eligibility
```

FULL/SUBSTANTIAL alone is no longer release coverage. The exact quote must be
meaningful, page-valid and contained in the active tenant-owned tender file.
The former direct support-level mutation fallback is removed, and the heatmap
is now one row per requirement instead of one row per compliance link.

## 4. Generated files and final ZIP

Confirmed plan item
→ generation gate
→ selected eligible evidence
→ genuine document bytes
→ persisted SHA-256/byte length/MIME/detected format
→ validation
→ authority review
→ approved PDF finalization where required
→ final download gate
→ `buildFinalZipEntries`
→ read bytes with verified integrity
→ signature validation
→ `assembleFinalSubmissionZip`
→ reopened ZIP exact-byte verification
→ `ExportPackage` manifest and package hash
→ response.

Current disposition:

- The production download route and every affected binary/behavioral test use
  `lib/engine/final-zip-assembly.ts`; the disconnected workflow finalizer is
  removed.
- `buildFinalZipEntries` supplies exact plan order, envelope and canonical
  plan format. Assembly rejects duplicate plan positions and persists those
  fields with filename, byte length and SHA-256.
- The generated archive is reopened and every entry is verified against that
  manifest. Authenticated isolated-database proof of the persisted
  `ExportPackage` row remains open.

## 5. CI and release proof

Frozen SHA
→ Prisma validate/generate/migrate
→ schema checks and zero drift
→ release-integrity audit
→ typecheck/lint/tests/build
→ authenticated Playwright and tenant isolation
→ exact-head evidence artifact
→ exact-head route screenshot artifact
→ matching Git-triggered Vercel preview
→ `/api/version` and `/api/health`
→ synthetic workflow acceptance
→ runtime logs
→ final evidence ledger.

Current evidence gap:

- The earlier downloaded artifact preserves the build log and synthetic
  generated files but omits mandatory command proof. The local fix records all
  16 mandatory commands in exact-head-bound logs plus an NDJSON exit/duration
  ledger and refuses to publish a success artifact when any entry is absent.
  Exact CI artifact inspection is still required before closure is claimed.
- The historical screenshot detail index covers 37 page patterns × 3
  viewports, but its compact summary overloaded route coverage as a missing
  count. The local producer now derives both artifacts from one versioned
  `{expected, covered, uncovered, percent}` summary and rejects contradictory
  uncovered details before write. Exact-preview artifact proof remains open.

## 6. Review-provenance schema compatibility

```text
Prisma schema review fields
→ additive migration 20260727130000
→ migrate-deploy-safe
→ check-critical-schema information_schema query
→ pure critical-schema evaluator
→ fail deployment on a missing authority-bearing column
→ runtime compatibility loader excludes support evidence fail-closed
→ engine/generation/bid-strategy consumers
→ sanitized public job diagnostic
```

The prior critical-schema script did not enumerate the
`LegalRecord`/`FinancialRecord`/`CompanyComplianceRecord` review columns, so
its success could not disprove the screenshot P2022. The canonical contract
now requires all three tables and their `trustLevel`, reviewer, review notes,
and source-document fields. Applying migrations to an isolated preview
database remains an infrastructure prerequisite; compatibility code is not a
substitute for that migration.
