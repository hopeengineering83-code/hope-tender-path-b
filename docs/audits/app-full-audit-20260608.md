# Hope Tender Proposal Generator — Full App Audit

Date: 2026-06-08
Branch: `chatgpt/full-audit-20260608`
Base: `main`

## Audit scope

Audited the production-critical tender workflow and the recent problem reports from the app UI:

- AI Analyze and partial/resume behavior
- Tender metadata and client/submission detail extraction
- Submission-plan building
- Generate Missing Planned Docs and Generate Docs behavior
- Document Validator and placeholder/no-content checks
- Recovery Command Center lifecycle counts and action routing
- Evidence Coverage / section evidence mapping
- Export readiness and Final ZIP gates
- Build/deploy scripts

## Findings fixed in this PR

### F1 — PLANNED documents with no content were not counted as missing

Screenshot symptom:

- Document Validator showed planned documents as blocked with `No content`.
- Recovery Command Center showed `0 required submission document(s) are planned but not generated`.

Root cause:

- `resolveSubmissionPlanCompleteness()` treated `PLANNED` rows as a separate status but did not include them in `totalMissing`.

Fix:

- `PLANNED` rows now count as missing until they have real content/storage or are converted into generated draft/control records.
- Recovery Command Center will now show the real missing count instead of `0`.

### F2 — Generate Missing Planned Docs ignored existing PLANNED rows

Root cause:

- `/api/tenders/[id]/generate-missing-plan-files` returned early when `findMissingGeneratedDocuments()` returned zero, even if existing `GeneratedDocument` rows were still `PLANNED` with no content.

Fix:

- The route now checks both missing plan files and existing `PLANNED` rows.
- It converts existing planned rows instead of incorrectly returning `No missing planned files remain.`

### F3 — Narrative technical/methodology planned rows received only control placeholders

Root cause:

- Missing planned files were converted to generic control records, even for technical/methodology documents that need draft narrative content.

Fix:

- Technical/methodology/strategic narrative rows now get a generated DOCX working draft.
- The draft is not export-ready by default: it is marked `NEEDS_REVALIDATION` and `NEEDS_REVIEW`.
- This removes the `No content` blocker without weakening final export gates.

### F4 — Official evidence must not be fabricated

Risk:

- Legal registration, audited financial statements, tax/TIN/VAT certificates, bid forms, and official templates must be uploaded/replaced from real source documents, not generated.

Fix:

- Those rows remain replacement-control records requiring the actual official original.
- The PR does not auto-approve or fabricate official evidence.

## Findings still requiring separate merge or follow-up

The audit also found issues already addressed in separate open PRs or still requiring a controlled follow-up:

1. Evidence mapping false `Uncovered` states — addressed in PR #636.
2. Client/submission detail manual resolution — addressed in PR #635.
3. Build-time AI Analyze patch script still exists in `package.json`; this should be removed only after the resumable AI Analyze logic is permanently moved into source. Do not remove the script without confirming source parity.

## Safety checks

- No secrets exposed.
- No provider order changed.
- Claude/Anthropic remains last.
- Generate Docs and Final ZIP gates were not weakened.
- Official original evidence is still blocked until replaced with real documents.
- Generated narrative drafts require validation and reviewer approval before export.

## Vercel test plan

1. Open the tender where Document Validator shows PLANNED documents with no content.
2. Refresh Recovery Command Center.
3. Confirm the missing planned document count is no longer `0` when PLANNED rows exist.
4. Click `Generate Missing Planned Docs → Execute`.
5. Confirm planned rows become `GENERATED` with DOCX content or replacement-control records.
6. Click `Validate`.
7. Confirm `No content` blockers are removed for generated narrative drafts.
8. Confirm Final ZIP remains blocked until validation, review, evidence, and official-original gates pass.
