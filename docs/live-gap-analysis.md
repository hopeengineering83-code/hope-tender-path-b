# Hope Tender Proposal Generator — Live Gap Analysis

## Current status

The application is now a working Next.js tender workspace with authentication, company knowledge vault, PDF/DOCX extraction paths, tender intake, analysis, matching, compliance, document generation, review board, and guarded export.

The most important live gap identified from production testing is not basic extraction alone. The app can extract text from some PDFs, but company knowledge import from real CV and project portfolio PDFs can still miss records or misclassify details. Because Hope’s source PDFs are high-value factual evidence, extraction cannot be treated as optional or approximate.

## Original prompt requirement mapping

### 1. Company documents are the factual source
Status: Partially met.

The app stores extracted document text and uses company knowledge records for matching and generation. However, if in-app PDF extraction/import misses details, the generated company knowledge becomes incomplete.

Fix applied in this PR: Plan B exact JSON import. This allows externally extracted, page-referenced raw CV/project text to be imported as the factual source without relying on the app PDF parser.

### 2. Tender documents define exactly what must be generated
Status: Improved but still evolving.

The tender analysis engine detects requirements, quantities, exact filenames, and order. More advanced template recognition may still be needed for complex authority-provided forms.

### 3. Generate exactly and only what the tender requires
Status: Improved.

Generation now refuses to proceed if no planned tender-required documents exist and respects branding/cover/signature restrictions.

### 4. Do not invent unsupported facts
Status: Improved.

Generation blocks unreviewed expert/project records and export validates final DOCX traces. Remaining risk is incomplete or inaccurate source extraction. Plan B exact JSON reduces this risk.

### 5. No AI traces in final output
Status: Improved.

Export validates generated DOCX contents and blocks AI/draft/internal traces.

### 6. Submission-ready documents
Status: Phase 1+.

DOCX generation and ZIP export exist. Final quality still depends on exact tender template/form requirements and complete source data.

### 7. Reusable company knowledge base
Status: Met structurally.

Company documents, experts, projects, assets, review board, and audit records exist. Plan B import adds a stronger route for reliable population.

### 8. Up to 10 matching cycles
Status: Implemented.

Matching now supports up to 10 stabilized matching cycles with reviewed-record prioritization.

### 9. Internal traceability without exposing traces in final files
Status: Improved.

Records keep source narratives and review metadata. Final export validation blocks internal trace leakage.

### 10. Review and approval workflow
Status: Improved.

Review Board exists and can approve draft records. Plan B import can also import externally verified records as REVIEWED only when raw source text is included.

## Remaining high-priority gaps

### Gap A — Exact source extraction is not guaranteed inside the app
Severity: Critical.

Real company PDFs can be long, table-heavy, and inconsistent. In-app extraction/import can miss CVs/projects or split them incorrectly.

Mitigation in this PR:
- Added `/api/company/plan-b-import`.
- Added `/dashboard/company/plan-b-import`.
- Import requires full raw text per expert/project by default.
- Raw text is preserved in each expert/project narrative.

### Gap B — Full external extraction file still must be produced and uploaded
Severity: Critical operational task.

The app can now receive the exact JSON, but the complete JSON for all CVs/projects must be prepared from the PDFs and uploaded through Plan B Import.

Rules:
- Every CV record must include complete raw CV text block.
- Every project record must include complete raw project record text.
- Structured fields are only indexes.
- Raw text is source of truth.

### Gap C — Template-specific tender forms are not fully reconstructed
Severity: High.

If a tender includes mandatory forms with exact formatting, the current Phase 1 generation may not recreate all official templates exactly.

Future fix:
- Add template capture and form-filling engine.
- Store tender-provided DOCX/PDF templates.
- Generate filled copies instead of generic recreated forms.

### Gap D — OCR for scanned PDFs remains external/architecture-ready, not fully hosted
Severity: High.

If a file has no text layer, extraction needs OCR. Vercel serverless OCR is expensive and brittle.

Recommended architecture:
- External OCR worker or document AI provider.
- Store OCR text back to CompanyDocument/TenderFile.
- Then run the same import pipeline.

### Gap E — Exact project/CV completeness must be audited after import
Severity: High.

Plan B import reports received/created/updated/skipped counts, but user should compare expected counts:
- Expert CVS.pdf expected: 25 CV ranges detected.
- Projects Reference.pdf expected: 114 project records.

Future fix:
- Add expected-count validation to Plan B Import UI.
- Block success state if actual imported records do not match expected counts.

## Current PR purpose

This PR does not claim to have extracted all source PDFs perfectly inside the app. It adds the missing infrastructure to safely transfer externally extracted exact CV/project JSON into the app as a reliable Plan B when the app parser fails.

## Acceptance criteria

- User can open Company > Plan B Exact Import.
- User can upload or paste exact JSON.
- API imports experts/projects with raw source text preserved.
- Records can be imported as REVIEWED only when rawText is included.
- Records without rawText are rejected by default.
- Import result reports created/updated/skipped counts and warnings.
- Audit log records the Plan B import.
