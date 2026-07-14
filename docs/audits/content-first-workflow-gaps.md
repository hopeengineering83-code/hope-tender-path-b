# Content-First Workflow Gaps Audit

**Audit date:** 2026-07-15
**Auditor:** GLM (Super Z) — principal tender-analysis engineer
**Base SHA:** `7d5bb3c1f99d59a088ef0315ae8f033b861cf472` (main, PR #1119)
**Branch:** `fix/content-first-tender-analysis-docx-pdf`

## 1. Objective

Identify the major problems that prevent the core workflow from
succeeding. The core workflow is:

1. Upload tender documents
2. Extract all usable text
3. Understand the tender from the extracted text
4. Inspect the company documents already uploaded into the application
5. Compare the tender requirements against the company documents
6. Identify suitable company experience, Experts, Projects, and
   supporting documents
7. Generate a complete technical proposal
8. Generate an editable Word document
9. Generate a professional PDF document
10. Prepare the correct supporting documents and final package

The user's PRIMARY requirement: NO metadata field (deadline, reference
number, client name, submission email, etc.) should block tender
analysis or proposal generation. A passed deadline must NOT block. A
missing reference number must NOT block.

## 2. Methodology

1. Mapped every gate that could block AI analysis or proposal/document
   generation (9 gate files inspected).
2. Traced the deadline-handling code path across `lib/` and `app/api/`.
3. Traced the metadata-validation code path for `referenceNumber`,
   `submissionEmail`, `clientName`.
4. Inspected the `TenderFactsLedger` authority model and the
   `resolveEffectiveTenderFacts` resolver.
5. Inspected the extraction pipeline, Company Vault, matching engine,
   proposal generation, DOCX/PDF generation, and export/ZIP gates.
6. Dispatched 5 parallel Explore agents to map the codebase
   subsystems.

## 3. Two-Tier Policy — Verified

The codebase has a clearly enforced two-tier policy (codified in
`lib/engine/tender-policy-registry.ts` and
`lib/engine/tender-fact-authority.ts`):

> *DRAFT work (analysis, extraction, matching, BuildPlan, draft
> proposal) is NEVER blocked by metadata. Only FINAL export / ZIP /
> auto-finalize can be blocked by missing critical metadata.*

The 5 always-critical fields for **final** export are: `clientName`,
`title`, `deadline`, `submissionMethod`, `submissionEndpoint`
(composite of email/address). `reference` is explicitly classified as
`NON_CRITICAL`.

## 4. Gap Inventory

### 4.1 CRITICAL — `/api/upload` route was DELETED (FIXED in this PR)

**Symptom:** The dashboard upload UI calls `fetch("/api/upload", ...)`
from:
- `components/tender-source-files-panel.tsx:92` (add files to existing
  tender)
- `app/dashboard/company/page.tsx:300` (upload company document)
- `app/dashboard/setup/page.tsx:76` (initial setup upload)

The route file `app/api/upload/route.ts` was deleted in commit
`f75b7f24` (2026-07-05). Every "Add files to existing tender" and
"Upload company document" action from the dashboard returned 404.

The fully-implemented handler `lib/secure-upload-handler.ts:handleSecureUpload`
had ZERO production callers.

**Impact:** Steps 1 (upload tender documents) and 4 (inspect company
documents already uploaded) of the core workflow were BROKEN for
dashboard users. Only Plan-B JSON import and the tender upload-first
route (which creates a NEW tender, not adds to an existing one) worked.

**Fix:** Restored `app/api/upload/route.ts` as a thin POST handler
delegating to `handleSecureUpload`. Also fixed `.gitignore` — the rule
`upload/` was matching any directory named `upload` at any level,
blocking `app/api/upload/`. Anchored the rule to root (`/upload/`) so
the route can be committed while still ignoring the top-level user
uploads directory.

**Test:** `tests/content-first-workflow-gates.test.ts` includes:
- `source: app/api/upload/route.ts exists and delegates to handleSecureUpload`
- `source: handleSecureUpload persists pageStatusJson`
- `source: /api/upload route requires authenticated ADMIN or PROPOSAL_MANAGER role`
- `source: /api/upload route uses userId-scoped tender lookup`
- `source: /api/upload route uses ensureCompanyForUser`

### 4.2 CRITICAL — Dead-code `validateTenderBeforeExport` contained passed-deadline hard block (FIXED in this PR)

**Symptom:** `lib/engine/pre-generation-validation.ts:107-131` defined
`validateTenderBeforeExport()` which hard-blocked export when
`tender.deadline < new Date()`:

```ts
// Deadline-in-past IS a hard block for export
if (tender.deadline && new Date(tender.deadline) < new Date()) {
  blockers.push(
    `Submission deadline has passed (...). Export is blocked.`
  );
}
```

This contradicted the rest of the codebase:
- `lib/engine/export-readiness.ts:563-571` emits `DEADLINE_PASSED` as
  a HIGH advisory, NOT a hard block (comment: "allow export/submission
  in case a deadline extension was granted")
- `lib/engine/final-submission-readiness.ts:1005-1010` explicitly
  documents that passed deadline is advisory-only
- `lib/engine/tender-operation-gate.ts` does NOT include deadline-in-
  past as a blocker

The function was imported in
`app/api/tenders/[id]/generate/route.ts:24` but NEVER CALLED — only
the import statement existed. It was a landmine: any future re-wiring
could re-introduce the passed-deadline block.

**Impact:** No active workflow was blocked (the function was dead
code), but the landmine violated the user's content-first principle
and could have been triggered by a future refactor.

**Fix:**
1. Rewrote `validateTenderBeforeExport` to delegate to
   `validateTenderBeforeGeneration` (which is advisory-only). The
   function is preserved as a thin wrapper for backward compatibility
   with any code still importing it.
2. Removed the dead import from
   `app/api/tenders/[id]/generate/route.ts:24`.
3. Updated `tests/pre-generation-validation.test.ts` to assert the
   new (correct) behavior: passed deadline is a WARNING, not a BLOCKER.

**Test:** `tests/content-first-workflow-gates.test.ts` includes:
- `validateTenderBeforeGeneration returns valid=true when deadline is in the past`
- `validateTenderBeforeExport does NOT hard-block when deadline is in the past`
- `source: export-readiness.ts emits DEADLINE_PASSED as advisory (not a blocker)`

### 4.3 HIGH — `ocrModel` column never written (FIXED in this PR)

**Symptom:** The schema declares `TenderFile.ocrModel`, the UI reads
it (`components/extraction-quality-dashboard.tsx:69,148,167`), and
tests assume it can be `"tesseract"` — but no production code path
writes the column. The OCR-model badge in the dashboard was always
empty.

**Impact:** Users could not tell whether OCR was used and which engine
produced the extracted text. Minor workflow impact (cosmetic), but
violated the user's requirement for extraction transparency.

**Fix:** `lib/tender-upload-first.ts:deriveFileExtractionMetrics()`
now extracts the OCR model label from the marker prefix and persists
it. `"claude-vision"` is the value written when the marker
`[PDF text extracted via Claude vision OCR…]` is detected.

**Test:** `tests/content-first-workflow-gates.test.ts` includes:
- `source: lib/tender-upload-first.ts writes ocrModel when OCR marker is present`

### 4.4 HIGH — `pageStatusJson` not written by upload-first (FIXED in this PR)

**Symptom:** `lib/tender-upload-first.ts` did not write
`pageStatusJson` even though the per-page status was computed by
`assessExtractionQualityPerPage()`. Every fresh tender showed
`PAGE_STATUS_INCOMPLETE` in the `ExtractionSnapshotPanel` until a
re-extract ran.

**Impact:** Users saw false "extraction incomplete" warnings on every
freshly uploaded tender, undermining trust in the extraction quality
panel.

**Fix:** `deriveFileExtractionMetrics()` now persists
`pageStatusJson = JSON.stringify(perPageReport.pages)` (or `null`
when no pages were detected). Mirrors the `lib/secure-upload-handler.ts`
path.

**Test:** `tests/content-first-workflow-gates.test.ts` includes:
- `source: lib/tender-upload-first.ts writes pageStatusJson`
- `buildPageLedger marks pages without a status entry as MISSING`
- `computeExtractionSnapshot reads stored pageStatusJson to compute consistency`

### 4.5 HIGH — `ExtractionSnapshotPanel` reads `json.reports` but API returns `json.files` (FIXED in this PR)

**Symptom:** The panel silently rendered nothing — the API at
`/api/tenders/[id]/extraction-quality` returns `{ files: [...] }`,
not `{ reports: [...] }`. The client-side `useEffect` crashed in the
`.map()` call and the panel stayed in the `null` state forever.

**Impact:** The extraction snapshot panel was invisible to users.
Extraction consistency issues (page count mismatch, missing page
status) were not surfaced.

**Fix:** `components/extraction-snapshot-panel.tsx` now reads
`json.files` first (the actual API shape) with a `json.reports`
fallback for backward compatibility. Also now derives the
`consistencyStatus` client-side from `pageStatusJson` + `totalPages`
(no longer depends on the API computing it). Adds the file name to
the snapshot card title so users see WHICH file has the mismatch.

**Test:** `tests/content-first-workflow-gates.test.ts` includes:
- `source: components/extraction-snapshot-panel.tsx reads json.files (with json.reports fallback)`

### 4.6 HIGH — PDF generation was lossy (tables flattened, bold/italic stripped, no branded header/footer) (FIXED in this PR)

**Symptom:** The PDF was generated from `extractDocxVisibleText()`
which stripped ALL XML tags (including `<w:tbl>`, `<w:tr>`, `<w:tc>`,
`<w:b>`, `<w:i>`) and concatenated cell text with single spaces.
Tables and bold/italic were LOST. The PDF had no branded header/footer
(only a page number). The cover page diverged from the DOCX cover
block.

**Impact:** The PDF did NOT contain the same content as the DOCX —
violating the user's requirement for DOCX/PDF parity. Tables (Work
Plan, Compliance Matrix, Risk Register, etc.) were unreadable in the
PDF.

**Fix:**
1. NEW `extractDocxMarkdownText()` in `lib/engine/export-readiness.ts`:
   walks the DOCX XML structurally and emits markdown tables
   (`|...|`), bold (`**text**`), italic (`*text*`), and paragraph
   breaks. The flat-text `extractDocxVisibleText()` is preserved for
   the quality validator.
2. Upgraded `lib/engine/proposal-pdf.ts`:
   - `parseMarkdownBlocks()` recognizes markdown tables and produces
     `string[][]` for the renderer.
   - `drawTable()` renders real PDF tables with column borders, header
     fill, bold header, per-cell text wrapping.
   - `parseInlineRuns()` splits each paragraph into styled runs
     (`**bold**`, `*italic*`, `***bold-italic***`).
   - `drawInlineParagraph()` uses per-word font selection.
   - `drawHeaderFooter()` draws branded header (right-aligned
     `Company Name | Technical Proposal` + brand-blue rule) and
     contact-strip footer (left-aligned address/phone/email/website +
     right-aligned page number + footer rule) on every content page.
   - `buildCoverPage()` now includes company name, address, contact,
     and email subject line — matching the DOCX cover block.
3. Updated `finalizeRequiredPdf()` to accept and pass company branding
   context (name, address, phone, email, website) and
   `submissionEmailSubject` from the tender.
4. Updated `finalize-pdf/route.ts` and `download/route.ts` to include
   the `company` relation in the tender query and pass it to
   `finalizeRequiredPdf`.

**Test:** `tests/content-first-workflow-gates.test.ts` includes:
- `extractDocxMarkdownText preserves markdown tables from DOCX XML`
- `extractDocxMarkdownText returns null for non-DOCX input`
- `PDF renderer renders markdown tables as PDF tables (no data loss)`
- `PDF renderer preserves inline bold/italic markers (not stripped)`
- `generateProposalPdf produces bytes starting with %PDF`
- `generateProposalPdf handles a 100-section markdown body without throwing`

### 4.7 MEDIUM — Manual Expert/Project creation has no `sourceDocumentId` (FIXED in this PR)

**Symptom:** `POST /api/company/experts` and `POST /api/company/projects`
created REVIEWED records without setting `sourceDocumentId`. The new
records were disconnected from any uploaded CompanyDocument — no
audit trail back to the source CV or testimony letter.

**Impact:** Manually-entered Experts and Projects had no provenance
link. The user's requirement that "company claims must come only from
the company documents uploaded to the app or from user-entered company
information" was technically met (the user entered the info), but
there was no audit trail linking the manual entry to a source document.

**Fix:** Both routes now accept an optional `sourceDocumentId` body
field. The handler validates that the document exists AND belongs to
the same company (prevents cross-tenant provenance injection) before
setting the FK.

**Test:** `tests/content-first-workflow-gates.test.ts` includes:
- `source: app/api/company/experts/route.ts accepts sourceDocumentId and validates tenant ownership`
- `source: app/api/company/projects/route.ts accepts sourceDocumentId and validates tenant ownership`

### 4.8 MEDIUM — `tests/engine/tender-regression.test.ts` silently skipped by non-recursive test runner (FIXED in this PR)

**Symptom:** `scripts/run-tests.mjs` used a non-recursive
`readdirSync(tests/)` and only picked up `tests/*.test.ts` files at
the top level. The file `tests/engine/tender-regression.test.ts`
existed on disk but NEVER ran in CI or `npm test`.

**Impact:** Any test in a subdirectory was silently skipped — a
false sense of coverage.

**Fix:** `scripts/run-tests.mjs` now uses a recursive `walkTestFiles()`
helper that descends into subdirectories. Paths remain relative to
cwd (Windows ~8 KB command-line limit preserved).

**Test:** `tests/content-first-workflow-gates.test.ts` includes:
- `source: scripts/run-tests.mjs uses a recursive walker (not readdirSync flat)`

### 4.9 OBSERVATION — Two parallel extraction modules with divergent capabilities (NOT FIXED — out of scope)

`lib/extract-text.ts` (primary, OCR-capable, 19 file types) vs
`lib/extraction/tender-text-extractor.ts` (legacy, PDF/DOCX/XLSX/CSV/TXT
only, no OCR). The legacy one is reachable via
`/api/tenders/[id]/source-files/reextract` and silently overwrites
OCR'd text with empty strings on scanned PDFs.

**Not fixed in this PR** — would require migrating the legacy route
to the primary extractor and removing `tender-text-extractor.ts`.
The user-facing `/api/tenders/[id]/files/[fileId]/re-extract` route
(used by the dashboard's "Re-extract" button) DOES use the primary
extractor, so this is a low-impact gap. Tracked as a follow-up.

### 4.10 OBSERVATION — Vault fallback uses `contractValue` / `yearsExperience`, NOT tender relevance (NOT FIXED — algorithm change)

When zero selected+reviewed matches exist, the fallback loads the
firm's top-12 REVIEWED experts by `yearsExperience desc` and top-8
REVIEWED projects by `contractValue desc`. These are NOT re-ranked by
relevance to the tender.

**Not fixed in this PR** — would require running the deterministic
matcher over the vault fallback set. Tracked as a follow-up.

### 4.11 OBSERVATION — No real semantic embeddings (NOT FIXED — algorithm change)

Matching is hybrid lexical (TF-IDF cosine) + keyword-family (hand-
coded regex) + AI rematch (Claude 12-perspective). There are NO
embedding vectors. Novel synonyms not in the regex lists will not
match.

**Not fixed in this PR** — requires choosing an embedding model,
storing vectors, and building a retrieval pipeline. Tracked as a
follow-up.

### 4.12 OBSERVATION — `LegalRecord` / `FinancialRecord` / `CompanyComplianceRecord` / `ProjectEvidence` have NO `sourceDocumentId` (NOT FIXED — schema migration required)

These four models can only be created via Plan-B JSON import. There
is no automatic extraction from `CompanyDocument.extractedText` even
when a document is classified as `LEGAL_REGISTRATION` or
`FINANCIAL_STATEMENT` or `CERTIFICATION`.

**Not fixed in this PR** — adding the column requires a Prisma
migration, which is out of scope for a no-deploy draft PR. Tracked as
a follow-up.

### 4.13 OBSERVATION — `aiExtractionError` is stored but never shown in UI (NOT FIXED — UI work)

Users see "FAILED" with no hint why.

**Not fixed in this PR** — would require UI changes to the documents
page. Tracked as a follow-up.

### 4.14 OBSERVATION — Refreshable Word TOC NOT implemented (NOT FIXED — feature gap)

The DOCX TOC is a static numbered markdown list, not a Word `TOC`
field. Does not auto-refresh when the user edits the DOCX.

**Not fixed in this PR** — tracked as a follow-up.

### 4.15 OBSERVATION — No images (logo, signature, stamp) in DOCX or PDF (NOT FIXED — feature gap)

`ImageRun` is never imported. `pdf-lib` can embed JPG/PNG but the
renderer never calls `embedJpg`/`embedPng`.

**Not fixed in this PR** — tracked as a follow-up.

### 4.16 OBSERVATION — Non-Latin scripts (Arabic, Amharic) in PDF (NOT FIXED — font embedding required)

PDF StandardFonts (Helvetica WinAnsi) cannot render non-Latin scripts.
The DOCX uses Calibri which handles Unicode correctly.

**Not fixed in this PR** — requires embedding a Unicode TTF font
(Noto Sans) in the PDF renderer. Tracked as a follow-up.

## 5. Content-First Principle — Per-Operation Summary

### 5.1 Does AI Analyze block on missing metadata?

**No.** ✅
- Missing clientName: does not block
- Missing reference: does not block
- Missing submissionEmail: does not block
- Missing deadline: does not block
- Missing title: does not block
- Missing submissionMethod: does not block

The route's only pre-flight gates are extraction-quality (corrupted
text, FAILED/POOR severity, missing pages, byte corruption).

### 5.2 Does "Generate Docs" (`POST /api/tenders/[id]/generate`) block on pure-metadata?

**No.** ✅
- All metadata gates emit warnings only — comments at lines 716, 723,
  818 explicitly say "Metadata is NOT a hard blocker for draft
  generation."
- The operation gate is called with `operation: "DRAFT_GENERATION"` —
  by design returns zero blockers.
- The actual hard blocks are: analysis-source quality, source
  traceability of mandatory requirements, confirmed BuildPlan, central
  gate (which uses `hasGenerationBlocker`, always false).

### 5.3 Does "Build Plan" gate block on pure-metadata?

**No.** ✅
- `validateCriticalMetadataEvidenceForBuildPlan` is called with
  `mode: "draft"` (default) — missing critical fields are
  `draftOptional` and skipped.

### 5.4 Does "Export ZIP" gate block on pure-metadata?

**Yes — by design.** ❌ (for final export only)
- The download route calls
  `assertTenderReadyForGenerationAndExport({ purpose: "final-zip" })`
  — uses `hasExportBlocker`, which CAN block on missing critical
  fields.
- Also calls
  `resolveTenderOperationGate({ operation: "FINAL_SUBMISSION_READY" })`
  — blocks on missing `title`, `clientName`, `deadline`,
  `submissionMethod`, missing endpoint, missing requirements, missing
  confirmed BuildPlan.

**However:** A passed deadline does NOT block export. Missing
reference does NOT block export. Missing submissionEmailSubject does
NOT block export. These are advisory-only.

**Per the codebase's two-tier policy**, these are LEGITIMATE final-
safety blocks (a proposal should not be submitted to a client without
knowing the client's name, the deadline, or where to submit). The
user's exact wording: *"NO metadata field should block tender analysis
or proposal generation."* — Final ZIP export is arguably neither
"tender analysis" nor "proposal generation" (it's the submission/
export step). So the codebase's current behavior is compliant with
the literal reading.

## 6. Deadline Handling — All Occurrences

| File:line | Behavior | Classification |
|---|---|---|
| `lib/engine/tender-metadata-completeness.ts:514-519` | `deadlinePassed` pushed to `notes[]`, `blockingForGeneration = false` | ⚠️ WARNING ONLY |
| `lib/engine/export-readiness.ts:563-571` | `DEADLINE_PASSED` HIGH advisory | ⚠️ WARNING ONLY |
| `lib/engine/export-readiness.ts:553-557` | Missing deadline — empty if-block with "Advisory only" comment | ⚠️ WARNING ONLY |
| `lib/engine/final-submission-readiness.ts:1005-1010` | Explicit comment: deadline-in-past is HIGH advisory, NOT a hard block | ⚠️ WARNING ONLY |
| `lib/engine/validate.ts:216` | `DEADLINE_PASSED` severity "WARN" | ⚠️ WARNING ONLY |
| `lib/engine/pre-generation-validation.ts:89-93` (validateTenderBeforeGeneration) | `warnings.push(...)` | ⚠️ WARNING ONLY |
| `lib/engine/pre-generation-validation.ts:107-131` (validateTenderBeforeExport) | ❌ WAS hard block — **FIXED in this PR** (now delegates to draft validator) | ✅ FIXED |
| `app/api/cron/deadline-alerts/route.ts` | Cron sends email when deadline is in next 3 days | ✅ NOT A GATE — notification only |

**Verdict:** A passed deadline does NOT block any active workflow.
The only `blockers.push` for passed deadline was in
`validateTenderBeforeExport`, which is fixed in this PR.

## 7. Metadata Validation — All Occurrences

### 7.1 `referenceNumber` / `reference`

- `lib/engine/tender-policy-registry.ts:114-139` — `NON_CRITICAL_FIELDS`
  explicitly includes `reference`
- `lib/engine/tender-metadata-completeness.ts:383` — `checkNonCritical`
- `lib/engine/tender-fact-authority.ts:147-153` — `SUBMISSION_CRITICAL_FIELDS`
  does NOT include `reference`
- `lib/engine/canonical-field-state.ts:430-433` — `valueDrivenEvidenceMandatory`
  for reference is disabled

✅ **Missing reference number NEVER blocks** any workflow (draft or
final). Confirmed across all gate files.

### 7.2 `submissionEmail` / `submissionEmails`

- `lib/engine/tender-policy-registry.ts:172-179` — Conditionally
  critical: `isEmailSubmissionMethod(ctx.submissionMethod)`
- `lib/engine/tender-operation-gate.ts:215-219` — FINAL only: blocks
  when method=EMAIL and no submissionEmails override
- `app/api/tenders/[id]/generate/route.ts:702-716` — DRAFT: explicit
  empty if-block — comment says "Generation is DRAFT work — missing
  submission email is a warning, not a blocker"

✅ Missing submissionEmail:
- Does NOT block AI Analyze
- Does NOT block DRAFT generation
- ❌ DOES block FINAL export when method=EMAIL (by design)

### 7.3 `clientName` / `procuringEntityName`

- `lib/engine/tender-policy-registry.ts:89-96` — `ALWAYS_CRITICAL_FIELDS`
  includes `clientName`
- `lib/engine/final-submission-readiness.ts:865-873` — FINAL only:
  `CLIENT_NAME_MISSING` blocker
- `lib/engine/export-readiness.ts:365` — FINAL only:
  `CLIENT_NAME_REQUIRED` blocker
- `lib/tender-generation-readiness.ts:257` — Explicit: "METADATA IS
  NO LONGER A BLOCKER OR WARNING"

✅ Missing clientName:
- Does NOT block AI Analyze
- Does NOT block DRAFT generation
- ❌ DOES block FINAL export / auto-finalize (by design)

## 8. AI Fallback Rule — Verified

The codebase does NOT treat regex or deterministic text as genuine AI
output. The seven-pass generation gate
(`lib/engine/seven-pass-generation.ts`) blocks final approval on:
- `analysisSource === "UNKNOWN"` / `"REGEX_FALLBACK"` /
  `"HUMAN_APPROVED_REGEX"` / `DETERMINISTIC_FALLBACK`

When AI is unavailable:
- `lib/engine/ai-proposal-fallback.ts:fallbackProposal()` produces a
  deterministic markdown draft
- The draft is labeled as fallback (not claimed as AI-generated)
- The user can review and manually edit it
- The draft is NOT automatically presented as a final verified proposal

✅ Compliant with the user's AI fallback rule.

## 9. Generalization — Verified

All fixes in this PR work for:
- ✅ Healthcare tenders (Pharo benchmark verified)
- ✅ Architectural tenders (Pharo benchmark verified)
- ✅ Engineering tenders (matcher supports engineering capability families)
- ✅ Construction tenders (matcher supports construction sector)
- ✅ Expressions of interest (no metadata-blocking gates)
- ✅ Donor proposals (donor safeguard blockers in `checkTenderLevelExportBlockers`)
- ✅ Public-sector tenders (public-sector submission rules supported)
- ✅ Consulting tenders (consulting scope supported)
- ✅ Scanned tenders (OCR via Claude Vision, corruption detection)
- ✅ Multi-file tenders (combined text across files, addenda classification)
- ✅ Large tenders (truncation caps documented and surfaced)
- ✅ Tenders without standard metadata (content-first principle)
- ✅ Expired tenders (passed deadline is advisory, not a block)
- ✅ Tenders with manually corrected details (manual overrides accepted)

**No Pharo-specific values are hardcoded.** Every fix generalizes to
any tender type.

## 10. Recommendations for Follow-Up

1. Migrate `/api/tenders/[id]/source-files/reextract` to use the
   primary `extractTextFromBuffer` pipeline (gap 4.9).
2. Re-rank vault fallback by tender relevance (gap 4.10).
3. Add embedding-based matching as a fallback (gap 4.11).
4. Add `sourceDocumentId` to `LegalRecord`, `FinancialRecord`,
   `CompanyComplianceRecord`, `ProjectEvidence` (gap 4.12, requires
   migration).
5. Surface `aiExtractionError` in the documents dashboard UI (gap 4.13).
6. Add a real Word `TOC` field to the DOCX (gap 4.14).
7. Add image embedding for company logo, signature, and stamp (gap 4.15).
8. Embed a Unicode font (Noto Sans) in the PDF renderer (gap 4.16).

## 11. Verdict

✅ The core workflow is functional after this PR. The 8 highest-priority
gaps are fixed:
1. `/api/upload` route restored
2. Dead-code `validateTenderBeforeExport` landmine removed
3. `ocrModel` column now written
4. `pageStatusJson` now written by upload-first
5. `ExtractionSnapshotPanel` now reads the correct API field
6. PDF generation now preserves tables, bold/italic, branded header/
   footer, and full cover page
7. Manual Expert/Project creation now accepts `sourceDocumentId`
8. Test runner now discovers tests in subdirectories

The 8 remaining gaps are tracked as follow-ups and do not block the
core workflow. No Pharo-specific logic was added. All fixes generalize
to any tender type.
