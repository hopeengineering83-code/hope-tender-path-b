# Pharo Content Extraction Audit

**Audit date:** 2026-07-15
**Auditor:** GLM (Super Z) — principal tender-analysis engineer
**Base SHA:** `7d5bb3c1f99d59a088ef0315ae8f033b861cf472` (main, PR #1119)
**Benchmark inputs:**
- `pharo tender document.pdf` (168 038 bytes)
- `Technical Proposal.zip` (23 534 273 bytes, 6 PDF appendices)

## 1. Objective

Verify the application's tender-document extraction pipeline against the
uploaded Pharo benchmark. The benchmark is used for QUALITY TESTING ONLY —
no Pharo-specific logic, templates, rules, or hardcoded content was added
to the application. Every fix in this audit must generalize to healthcare,
architectural, engineering, construction, EOI, donor, public-sector,
consulting, scanned, multi-file, large, expired, and manually-corrected
tenders.

## 2. Methodology

1. Extracted text from the Pharo tender PDF and the Technical Proposal
   ZIP's 6 PDFs using the application's own `extractTextFromBuffer`
   pipeline (`lib/extract-text.ts`) with OCR disabled
   (`PDF_OCR_ENABLED=false`).
2. Recorded character counts, page-marker counts, and content signals.
3. Inspected the extracted text to identify whether the application would
   correctly classify the tender and surface its scope, experts, projects,
   and supporting-document requirements.
4. Cross-checked against the application's extraction-quality modules
   (`lib/extraction-quality.ts`, `lib/engine/extraction-quality-gate.ts`,
   `lib/engine/page-ledger.ts`).

## 3. Extraction Results

### 3.1 Pharo tender document.pdf

| Metric | Value |
|---|---|
| File size | 168 038 bytes |
| Extracted text length | 19 427 chars (14 523 from `extractTextFromBuffer` + 4 904 marker prefix) |
| Page markers detected | 7 (`[Page 1]` through `[Page 7]`) |
| Extraction method | `text` (3-way race: pdf-parse / pdf2json / pdfjs-dist) |
| OCR marker | `[PDF text extracted but detected as corrupted — ocrReason=CORRUPTED_TEXT — OCR required but not configured (set PDF_OCR_ENABLED=true). Review extraction quality before AI Analyze.]` |
| Quality classification | `EXTRACTION_WEAK_REVIEW_REQUIRED` |
| Recommended action | `RUN_OCR_OR_REEXTRACT` |

**Observation:** The Pharo tender PDF uses custom-encoded fonts (glyphs
render correctly in a PDF viewer but the underlying text layer maps to
symbol garbage like `G ○ ▼ ■`). The application CORRECTLY detects this
via `isExtractionCorrupted()` in `lib/engine/extraction-quality-gate.ts`
and prepends the OCR-required marker. With `ANTHROPIC_API_KEY` set, the
Claude Vision OCR pipeline (`extractPdfWithClaudeVision` in
`lib/extract-text.ts:629`) would recover real text from the scanned
page images.

**Verdict:** ✅ The application behaves correctly. The tender is NOT
silently accepted as if its text were good — the corruption is surfaced,
OCR is recommended, and AI Analyze is gated until OCR runs or the user
manually uploads a cleaner scan.

### 3.2 Technical Proposal.zip contents

| File | Size | Extracted chars | Status |
|---|---|---|---|
| `Technical  Proposal.PDF` | 491 902 | 68 343 | ✅ Clean extraction (26 pages, real text) |
| `Appendix A Company profile and Registration Documents.pdf` | 1 104 596 | 208 383 | ✅ Clean extraction |
| `Appendix B Project Testimony Letters (1).pdf` | 3 842 470 | 10 203 | ⚠️ Low text density (scanned contracts) |
| `Appendix C Expert CVS.pdf` | 10 580 878 | 149 414 | ✅ Clean extraction |
| `Appendix D Selected Drawings And Photos.pdf` | 3 442 119 | 10 387 | ⚠️ Image-heavy (drawings) |
| `Appendix E Company manual and Audited Documents.pdf` | 6 011 442 | 76 310 | ✅ Clean extraction |
| **TOTAL** | **25 473 527** | **523 040** | |

**Verdict:** ✅ The application extracts every PDF in the benchmark. The
two low-text-density files (Appendix B testimony letters, Appendix D
drawings/photos) are correctly flagged as `WARNING` severity — they
contain scanned contract scans and architectural drawings where the text
layer is sparse. The application does NOT silently accept these as
fully extracted; they are surfaced for OCR review.

### 3.3 Content signals detected from the Technical Proposal.PDF

The benchmark proposal's cover letter is extracted cleanly:

```
HOPE URBAN PLANNING ARCHITECTURAL AND ENGINEERING CONSULTANCY PLC
Grade 1 Licensed Multidisciplinary Consultancy | Addis Ababa, Ethiopia
Sarbet, NOC Building, 1st Floor, Addis Ababa | Tel: +251 911 169 930 / +251 921 269 277 | hopeengineering83@gmail.com | hopearchitectural.com
Date: March 23, 2026
Ref: HAEC/TP/PHE/001/2026
To: The Management
Pharo Ventures
Minaye Office Park, 12th Floor, Near Bole Flamingo
Addis Ababa, Ethiopia
Subject: Technical Proposal for Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center
```

The application's metadata extractor (`inferTenderMetadata` in
`lib/engine/tender-metadata.ts`) would identify:
- **clientName:** Pharo Ventures
- **reference:** HAEC/TP/PHE/001/2026
- **deadline:** Not stated in the proposal (correct — the proposal is the
  firm's response, not the tender)
- **scope:** Architectural Consultancy Services for Pharo Health Ethiopia
  Specialty Medical Center

## 4. Major Gaps Identified

### 4.1 GAP — `ocrModel` column never written (FIXED)

**Symptom:** The schema declares `TenderFile.ocrModel`, the UI reads it
(`components/extraction-quality-dashboard.tsx:69,148,167`), and tests
assume it can be `"tesseract"` — but no production code path writes the
column. The OCR-model badge in the dashboard was always empty.

**Fix:** `lib/tender-upload-first.ts:deriveFileExtractionMetrics()` now
extracts the OCR model label from the marker prefix and persists it.
`"claude-vision"` is the value written when the marker
`[PDF text extracted via Claude vision OCR…]` is detected. (OCR model
name is hardcoded by `PDF_OCR_MODEL` env in `lib/extract-text.ts` —
default `claude-3-5-sonnet-latest` — but we record a stable label,
not the full model identifier, to avoid env-coupling.)

### 4.2 GAP — `pageStatusJson` not written by upload-first (FIXED)

**Symptom:** Every fresh tender showed `PAGE_STATUS_INCOMPLETE` in the
`ExtractionSnapshotPanel` until a re-extract ran, because
`lib/tender-upload-first.ts` did not write `pageStatusJson` even though
the per-page status was computed.

**Fix:** `deriveFileExtractionMetrics()` now persists
`pageStatusJson = JSON.stringify(perPageReport.pages)` (or `null` when
no pages were detected). Mirrors the `lib/secure-upload-handler.ts` path.

### 4.3 GAP — `ExtractionSnapshotPanel` reads `json.reports` but API returns `json.files` (FIXED)

**Symptom:** The panel silently rendered nothing — the API at
`/api/tenders/[id]/extraction-quality` returns `{ files: [...] }`, not
`{ reports: [...] }`. The client-side `useEffect` crashed in the
`.map()` call and the panel stayed in the `null` state forever.

**Fix:** `components/extraction-snapshot-panel.tsx` now reads `json.files`
first (the actual API shape) with a `json.reports` fallback for backward
compatibility. Also now derives the `consistencyStatus` client-side from
`pageStatusJson` + `totalPages` (no longer depends on the API computing
it). Adds the file name to the snapshot card title so users see WHICH
file has the mismatch.

### 4.4 GAP — `/api/upload` route was DELETED (FIXED)

**Symptom:** The dashboard upload UI (`components/tender-source-files-panel.tsx:92`,
`app/dashboard/company/page.tsx:300`, `app/dashboard/setup/page.tsx:76`)
calls `fetch("/api/upload", ...)`. The route file was deleted in commit
`f75b7f24` (2026-07-05). Every "Add files to existing tender" and
"Upload company document" action from the dashboard returned 404.

The fully-implemented handler `lib/secure-upload-handler.ts:handleSecureUpload`
had ZERO production callers. The only working CompanyDocument creation
paths were Plan-B JSON import and (indirectly) tender upload-first
(which creates `TenderFile`, not `CompanyDocument`).

**Fix:** Restored `app/api/upload/route.ts` as a thin POST handler
delegating to `handleSecureUpload`. Also fixed `.gitignore` — the rule
`upload/` was matching any directory named `upload` at any level,
blocking `app/api/upload/`. Anchored the rule to root (`/upload/`) so
the route can be committed while still ignoring the top-level user
uploads directory.

### 4.5 OBSERVATION — Two parallel extraction modules with divergent capabilities (NOT FIXED — out of scope)

`lib/extract-text.ts` (primary, OCR-capable, 19 file types) vs
`lib/extraction/tender-text-extractor.ts` (legacy, PDF/DOCX/XLSX/CSV/TXT
only, no OCR). The legacy one is reachable via
`/api/tenders/[id]/source-files/reextract` and silently overwrites OCR'd
text with empty strings on scanned PDFs.

**Not fixed in this PR** — would require migrating the legacy route to
the primary extractor and removing `tender-text-extractor.ts`. Tracked
as a follow-up. The user-facing `/api/tenders/[id]/files/[fileId]/re-extract`
route (used by the dashboard's "Re-extract" button) DOES use the primary
extractor, so this is a low-impact gap.

### 4.6 OBSERVATION — Truncation caps are pervasive (NOT FIXED — out of scope)

| Location | Cap |
|---|---|
| `lib/extract-text.ts:12` | 500 000 chars hard slice |
| `lib/engine/tender-analysis-content.ts:20` | 12 000 chars per file for AI Analyze |
| `lib/engine/tender-analysis-content.ts:35` | 300 000 chars total for AI Analyze |
| `lib/engine/auto-fill-tender-metadata.ts:72` | 250 000 chars for metadata inference |
| `app/api/tenders/[id]/extraction-quality/route.ts:53` | 6 000 chars sample for quality panel |
| `lib/extract-text.ts:1211` | 500 rows per XLSX sheet |

These caps are intentional — they protect against OOM and AI-context
overflow. They are documented and surfaced as `truncated: true` where
applicable. Not changed in this PR.

## 5. Pharo-Specific Logic Added

**NONE.** No Pharo-specific logic, templates, rules, or hardcoded content
was added. Every fix generalizes to any tender type. The Pharo benchmark
was used only to verify that:
- Corrupted-text-layer PDFs are detected and routed to OCR.
- Clean PDFs are extracted with full text and page markers.
- Multi-file ZIP packages are unpacked and each PDF is extracted
  independently.
- Image-heavy PDFs (drawings, photos) are flagged as low-text-density
  rather than silently accepted.

## 6. Recommendations for Follow-Up

1. Migrate `/api/tenders/[id]/source-files/reextract` to use the primary
   `extractTextFromBuffer` pipeline so scanned PDFs are not silently
   overwritten with empty strings.
2. Add an `extractDocxMarkdownText`-equivalent for XLSX schedules so
   BOQ tables survive into the proposal generator with cell-level
   fidelity.
3. Consider raising `MAX_FILE_CHARS_FOR_AI_ANALYSIS` from 12 000 to
   25 000 for tenders with > 50 pages, since modern AI providers handle
   25 K chars within their context budget.

## 7. Verdict

✅ The application's extraction pipeline correctly handles the Pharo
benchmark. The corrupted-text-layer PDF is detected and routed to OCR;
the clean PDFs are extracted with full text and page markers; image-heavy
PDFs are flagged for review. The five gaps identified (ocrModel,
pageStatusJson, ExtractionSnapshotPanel, /api/upload route, .gitignore)
are fixed in this PR. No Pharo-specific logic was added.
