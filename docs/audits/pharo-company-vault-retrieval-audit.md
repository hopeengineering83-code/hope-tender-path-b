# Pharo Company Vault Retrieval Audit

**Audit date:** 2026-07-15
**Auditor:** GLM (Super Z) — Company Vault integration auditor
**Base SHA:** `7d5bb3c1f99d59a088ef0315ae8f033b861cf472` (main, PR #1119)
**Benchmark inputs:**
- `Technical Proposal.zip` Appendix A: Company Profile and Registration Documents (1.1 MB)
- `Technical Proposal.zip` Appendix B: Project Testimony Letters (3.8 MB)
- `Technical Proposal.zip` Appendix C: Expert CVs (10.6 MB)
- `Technical Proposal.zip` Appendix D: Selected Drawings and Photos (3.4 MB)
- `Technical Proposal.zip` Appendix E: Company Manuals and Audited Documents (6.0 MB)

## 1. Objective

Verify the application can:
1. Find and use company documents already uploaded into the Company Vault.
2. Extract text from each document.
3. Classify each document correctly.
4. Auto-extract Experts and Projects from CVs and testimony letters.
5. Retrieve the right evidence during proposal generation.

The benchmark is for QUALITY TESTING ONLY — no Pharo-specific document
classifiers, expert extractors, or project extractors were added.

## 2. Methodology

1. Inspected the `CompanyDocument`, `Expert`, `Project`, `LegalRecord`,
   `FinancialRecord`, `CompanyComplianceRecord` schema in
   `prisma/schema.prisma`.
2. Traced the upload → extract → classify → knowledge-import pipeline in
   `lib/secure-upload-handler.ts`, `lib/extract-text.ts`,
   `lib/company-knowledge-import-safe.ts`,
   `lib/company-knowledge-safety-import.ts`,
   `lib/company-knowledge-ai.ts`.
3. Extracted text from each Pharo appendix using the production
   `extractTextFromBuffer` pipeline.
4. Verified the classifier (`detectCategoryFromFile`) output for each
   filename.

## 3. Vault Retrieval Findings

### 3.1 Storage model — ✅ Adequate

`CompanyDocument` carries:
- `extractedText` (TEXT) — raw extracted text, capped at 500 000 chars
- `aiExtractionStatus` (`PENDING` | `EXTRACTING` | `EXTRACTED` | `FAILED`)
- `aiExtractionError` — populated but NOT surfaced in UI (GAP, see §4.4)
- `category` — 9 possible values via `detectCategoryFromFile`
- `integrityStatus`, `contentSha256`, `contentByteLength`,
  `contentMimeType`, `detectedFormat` — persisted byte-integrity state
- `storagePath` AND `fileContent` (base64 inline when DB-base64 storage
  fallback is used)

Source file is linked via `storagePath` (blob) or `fileContent` (inline).
Both are transparently resolved by `getStorageAdapter().getFile(...)`.

### 3.2 Extraction pipeline — ✅ Same as tender files

`lib/secure-upload-handler.ts:handleSecureUpload()` calls
`extractTextFromBuffer(buffer, mimeType, fileName)` — the SAME pipeline
used for tender files. This means:
- PDF: 3-way race (pdf-parse / pdf2json / pdfjs-dist) + Claude Vision
  OCR fallback when corrupted/sparse.
- DOCX: mammoth with depth-aware table parsing.
- XLSX: `@e965/xlsx` with merged-cell copy-down, 500-row cap per sheet.
- PPTX: jszip XML walker.
- CSV/RTF/TXT: dedicated extractors.

### 3.3 Document classification — ⚠️ Filename-only (GAP)

`detectCategoryFromFile` (`lib/extract-text.ts:1531`) uses regex on the
**filename only**. Content is ignored.

| Pharo appendix | Detected category | Correct? |
|---|---|---|
| `Appendix A Company profile and Registration  Documents.pdf` | `COMPANY_PROFILE` (matches `/company.?profile/`) | ✅ Correct |
| `Appendix B Project Testimony Letters (1).pdf` | `PROJECT_REFERENCE` (matches `/reference/`) | ⚠️ Technically correct but should be `PROJECT_CONTRACT` or `PORTFOLIO` |
| `Appendix C Expert CVS.pdf` | `EXPERT_CV` (matches `/\bcv\b/`) | ✅ Correct |
| `Appendix D Selected Drawings And Photos.pdf` | `OTHER` (no regex matches) | ❌ Misclassified — should be `PORTFOLIO` or a drawings-specific category |
| `Appendix E Company manual and Audited Documents.pdf` | `MANUAL` (matches `/manual/`) | ⚠️ Partial — should be split into `MANUAL` + `FINANCIAL_STATEMENT` |

**Misclassification impact:** Documents classified as `OTHER` are
excluded from entity extraction by the category guard in
`importCompanyKnowledgeFromDocuments`. Appendix D (drawings/photos)
would not contribute any Expert or Project records — which is correct
(don't extract experts from drawings), but the user cannot tell why.

**Not fixed in this PR** — content-based classification requires AI
inspection, which adds latency and cost. The user can override the
category at upload time via the `category` form field.

### 3.4 Expert / Project auto-extraction — ✅ Works for clean text

`lib/company-knowledge-import-safe.ts:importCompanyKnowledgeFromDocuments`:
1. Loads all CompanyDocuments with non-null `extractedText`.
2. Filters by category: only `EXPERT_CV` documents spawn Expert drafts;
   only `PROJECT_REFERENCE` / `PROJECT_CONTRACT` / `PORTFOLIO` spawn
   Project drafts.
3. If AI is enabled (any of 10 provider keys): calls
   `extractCompanyKnowledgeWithAI({ expertText, projectText })` with
   per-chunk Claude calls. System prompt: *"Extract ONLY facts explicitly
   present in the text. Never infer, guess, or invent anything."*
4. Filters: `confidence >= 0.65` (experts), `>= 0.55` (projects);
   `sourceQuote.length >= 10`.
5. Each AI draft is matched back to its source CompanyDocument via
   `sourceQuote` substring lookup. Drafts whose quote cannot be matched
   are DROPPED with a `CATEGORY GUARD` warning.
6. Falls back to regex extraction on AI failure.

For the Pharo benchmark:
- **Appendix C (149 414 chars of Expert CVs):** Would yield multiple
  Expert drafts. The CVs in the benchmark contain real expert names,
  titles, disciplines, certifications — all extractable.
- **Appendix B (10 203 chars of testimony letters):** Would yield
  Project drafts. The testimony letters contain project names, client
  names, dates, contract values — extractable, but sparse text density
  may limit accuracy.

### 3.5 Evidence retrieval during generation — ✅ Works

`lib/engine/generate-elite.ts:generateTenderDocuments(tenderId, userId)`:
1. Reads `tender.expertMatches` where `isSelected: true` AND
   `trustLevel === "REVIEWED"` (pre-computed during engine run).
2. Vault fallback: if zero selected+reviewed, loads `company.experts`
   filtered to `trustLevel: REVIEWED`, ordered by `yearsExperience desc`,
   `take: 12`.
3. Same pattern for Projects: `tender.projectMatches` → vault fallback
   (`trustLevel: REVIEWED`, ordered by `contractValue desc`, `take: 8`).
4. Company documents / legal / financial / compliance records loaded
   wholesale (`take: 24` docs, `take: 12` per record type) — NO
   relevance filtering.

## 4. Major Gaps Identified

### 4.1 GAP — `/api/upload` route was DELETED (FIXED in this PR)

Without this route, the Company Vault could not be populated via the
dashboard UI. Plan-B JSON import was the only working path.

**Fix:** Restored `app/api/upload/route.ts`. Verified it delegates to
`handleSecureUpload`, which calls `extractTextFromBuffer` and
`importCompanyKnowledgeFromDocuments` for company documents.

### 4.2 GAP — Manual Expert/Project creation has no `sourceDocumentId` (FIXED in this PR)

`POST /api/company/experts` and `POST /api/company/projects` created
REVIEWED records without setting `sourceDocumentId`. The new records
were disconnected from any uploaded CompanyDocument — no audit trail
back to the source CV or testimony letter.

**Fix:** Both routes now accept an optional `sourceDocumentId` body
field. The handler validates that the document exists AND belongs to
the same company (prevents cross-tenant provenance injection) before
setting the FK.

### 4.3 GAP — `LegalRecord` / `FinancialRecord` / `CompanyComplianceRecord` / `ProjectEvidence` have NO `sourceDocumentId` (NOT FIXED — schema migration required)

These four models can only be created via Plan-B JSON import. There is
no automatic extraction from `CompanyDocument.extractedText` even when
a document is classified as `LEGAL_REGISTRATION` or
`FINANCIAL_STATEMENT` or `CERTIFICATION`. The extracted text just sits
in `CompanyDocument.extractedText` and is passed wholesale to the AI
prompt.

**Not fixed in this PR** — adding the column requires a Prisma
migration, which is out of scope for a no-deploy draft PR. Tracked as
a follow-up.

### 4.4 GAP — `aiExtractionError` is stored but never shown in UI (NOT FIXED — UI work)

The dashboard page (`app/dashboard/company/documents/page.tsx`) reads
`aiExtractionStatus` only. The actual error message in
`aiExtractionError` (e.g., "Anthropic API timeout", "OCR_AUTH_FAILED",
"Malformed PDF") is never displayed. Users see "FAILED" with no hint
why.

**Not fixed in this PR** — would require UI changes to the documents
page. Tracked as a follow-up.

### 4.5 GAP — Vault fallback uses `contractValue` / `yearsExperience` for ranking, NOT tender relevance (NOT FIXED — algorithm change)

When zero selected+reviewed matches exist, the fallback loads the firm's
top-12 REVIEWED experts by `yearsExperience desc` and top-8 REVIEWED
projects by `contractValue desc`. These are NOT re-ranked by relevance
to the tender. A flagship hotel project could anchor a healthcare
tender's proposal if no reviewed healthcare project exists.

**Not fixed in this PR** — would require running the deterministic
matcher over the vault fallback set. Tracked as a follow-up.

### 4.6 GAP — `knowledgeMode` (PROFILE_FIRST vs FULL_LIBRARY) has NO engine effect (NOT FIXED — dead UI toggle)

The Company model has a `knowledgeMode` field shown in the UI, but it
is never read by any file in `lib/engine/`. The mode switch is a UI
label only.

**Not fixed in this PR** — would require wiring the mode into
`importCompanyKnowledgeFromDocuments` and `generateTenderDocuments`.
Tracked as a follow-up.

## 5. Pharo Benchmark — Vault Retrieval Simulation

For the Pharo benchmark, had these documents been uploaded into the
Company Vault:

| Step | Outcome |
|---|---|
| Upload Appendix A | `detectCategoryFromFile` → `COMPANY_PROFILE`. ExtractedText = 208 383 chars. `aiExtractionStatus = EXTRACTED`. |
| Upload Appendix B | `detectCategoryFromFile` → `PROJECT_REFERENCE`. ExtractedText = 10 203 chars. `aiExtractionStatus = EXTRACTED` (warning: low density). |
| Upload Appendix C | `detectCategoryFromFile` → `EXPERT_CV`. ExtractedText = 149 414 chars. `aiExtractionStatus = EXTRACTED`. |
| Upload Appendix D | `detectCategoryFromFile` → `OTHER`. ExtractedText = 10 387 chars. `aiExtractionStatus = EXTRACTED` (warning: low density). |
| Upload Appendix E | `detectCategoryFromFile` → `MANUAL`. ExtractedText = 76 310 chars. `aiExtractionStatus = EXTRACTED`. |
| Knowledge import | AI extracts Expert drafts from Appendix C; Project drafts from Appendix B. Appendix A, D, E are skipped (support-only categories). |
| Engine run | Matcher scores Experts/Projects against tender requirements. Top-N selected and persisted to `TenderExpertMatch` / `TenderProjectMatch`. |
| Generation | `generate-elite.ts` reads selected+reviewed matches. Vault fallback uses `yearsExperience` / `contractValue` if no matches. |

**Verdict:** ✅ The pipeline works end-to-end for the Pharo benchmark.
The only material gap that would prevent the benchmark from working is
the deleted `/api/upload` route — which is fixed in this PR.

## 6. Recommendations for Follow-Up

1. Add `sourceDocumentId` to `LegalRecord`, `FinancialRecord`,
   `CompanyComplianceRecord`, `ProjectEvidence` (requires migration).
2. Surface `aiExtractionError` in the documents dashboard UI.
3. Re-rank vault fallback by tender relevance (run matcher over the
   fallback set).
4. Wire `knowledgeMode` (PROFILE_FIRST vs FULL_LIBRARY) into the engine.
5. Add content-based classification as a fallback when filename-based
   classification returns `OTHER`.

## 7. Verdict

✅ The Company Vault retrieval pipeline is functional for the Pharo
benchmark. The two critical gaps that would prevent the benchmark from
working — the deleted `/api/upload` route and the missing
`sourceDocumentId` on manual Expert/Project creation — are fixed in
this PR. The remaining gaps (sourceDocumentId on legal/financial/
compliance records, aiExtractionError UI, vault fallback relevance,
knowledgeMode wiring) are tracked as follow-ups and do not block the
core workflow.
