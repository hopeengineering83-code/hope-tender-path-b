# PR #1175 Transitive Dependency Graph

Frozen source SHA: `01aa15406e397facb1d1cd373417641914a02d73`  
Audit status: **IN PROGRESS**

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
→ **current defect: synchronous `extractTextFromBuffer`/OCR in request**
→ inferred tender metadata
→ `Tender` + `TenderFile` transaction
→ package `TenderWorkflowRun` rows
→ source evidence enrichment/candidate pipeline
→ audit log
→ `queueAutomaticTenderPipeline`
→ AI analysis job
→ analysis revision
→ requirements and facts
→ submission plan
→ matching/generation continuation.

Required target graph:

request validation/hash/storage/minimal rows
→ deterministic `SOURCE_EXTRACTION` job keyed by company+tender+source hash+extraction revision+stage+purpose
→ per-file/per-page checkpoints
→ extraction terminal state
→ exact-once continuation into current analysis revision.

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

Current split:

- Review Inbox and diagnostics cover experts/projects.
- Legal/financial/compliance APIs exist but are not surfaced by the canonical Review Inbox.
- Three legal/financial/compliance write routes use ineffective `count === 1` concurrency checks without a read-revision predicate.

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

Current authority conflict:

- Production download route uses `lib/engine/final-zip-assembly.ts`.
- `lib/engine/workflow/zip-finalizer.ts` is a separate implementation used by isolated binary tests.
- Production manifest lacks envelope and format fields required to prove submission-plan compliance.

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

- Exact-head artifact preserves the build log and synthetic generated files but omits the configured migration/drift/release-integrity logs and all success logs for typecheck, lint, unit tests and Playwright.
- Screenshot detail index covers 37 page patterns × 3 viewports, but the summary contains a contradictory zero route-coverage count.
