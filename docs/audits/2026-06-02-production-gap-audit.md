# Hope Tender Proposal Generator — Full Hard Audit after PR #564 / local #565

Audit date: 2026-06-02  
Repository workspace: `/workspace/hope-tender-path-b`  
Production app named by requester: `https://hope-tender-path-b.vercel.app`

## A. Executive Summary

This PR intentionally contains an audit report only. It does **not** change runtime gates, generation logic, export logic, auth, provider ordering, or database behavior.

The app is no longer merely a Pharo benchmark prototype: it already contains a broad tender workflow, multi-provider AI routing, company vault matching, submission-plan rows, lifecycle/readiness panels, source-grounding repair, metadata repair, official-original handling, and canonical final ZIP blocking. However, it is not yet at senior Claude/ChatGPT proposal-consultant quality for arbitrary Hope workstreams. The main remaining gap is not one missing button; it is an incomplete chain of **page-level extraction → source-grounded AI analysis → client/procuring metadata traceability → explicit/derived plan confirmation → controlled generation → evidence promotion → package export**.

Most important findings:

1. **Local code is ahead of the stated production baseline.** The workspace HEAD is `8e388b894a3fef96b0af4eba9a54d40ed4ca95a5`, one commit after the user-stated production commit `99d542a96529f044e17f6ab678dd3535127b0a6b` (#564). Local commit #565 is a Vercel/Prisma build-command fix.
2. **Live production and GitHub PR inventory could not be verified from this container.** `urllib`/CONNECT to the public Vercel URL returned `Tunnel connection failed: 403 Forbidden`, and the local git checkout has no configured `origin` remote. Treat production health, open PR count, and branch inventory as externally reported until verified from GitHub/Vercel.
3. **Provider chain policy is mostly correct in the generic fallback router.** `PROVIDER_CHAINS` matches the required ordering with Anthropic last. Some proposal/refinement code still uses hand-written chains and stale comments; ordering remains Anthropic-last, but PR 2/3 should normalize these paths to one shared provider-chain helper.
4. **Extraction quality is file-level, not page-level.** The database and UI store/show `totalPages`, `extractedPages`, `ocrPages`, `failedPages`, `extractionScore`, and method per file, but there is no persisted page-quality table/list with low-confidence pages, table/form capture quality, page snippets, per-page confidence, or important-page coverage.
5. **Client/procuring entity extraction is partial.** AI Analyze asks for a few extended fields and stores procuring entity, legal name, donor, implementing agency, client name source page/quote, and submission email page. It does not yet extract and trace all 20 requested client/contact/submission fields, nor does it store source quote/page per field.
6. **AI Analyze is structurally useful but not fully source-grounded.** The AI result type does not include source file/page/quote for each requirement, and the route creates `TenderRequirement` rows without filling `sourceTenderFileId`, `sourcePageNumber`, `sourceSectionHeading`, `sourceExactQuote`, or `sourceConfidence`. Generation later blocks untraced mandatory requirements or attempts repair, but analysis itself is not yet audit-grade.
7. **Build Plan exists and is gated, but derived-plan provenance and user confirmation are incomplete.** The plan endpoint can create `PLANNED` rows and the completeness resolver exposes plan states, but generated rows are still generic `GeneratedDocument` rows without a durable `planProvenance` / `DERIVED_DRAFT_UNCONFIRMED` / `NEEDS_CONFIRMATION` schema field.
8. **Generate Docs is safer than before but still not strict enough for arbitrary tenders.** It blocks missing requirements, empty plan in many cases, poor extraction below current threshold, missing metadata, contaminated metadata, regex fallback, and untraced mandatory requirements. It does not yet require confirmed client details/source traceability, verified important-page extraction, derived-plan user confirmation, outside-plan reconciliation before generation, or partial evidence coverage before generation in all cases.
9. **Recovery Command Center PR #558 appears locally fixed for the Link Vault Evidence 404.** The component now calls `/api/tenders/${tenderId}/link-vault-evidence` rather than `/dashboard/vault`, and a regression test checks this. Additional action-routing tests are still needed for every Execute action.
10. **Final ZIP safety remains the strongest part of the app.** Download uses canonical final readiness and rejects mixed ZIPs for strict two-envelope tenders. This must not be weakened.

Recommended next PRs should follow the requested sequence. PR 2 should focus narrowly on Recovery Command Center action parity and route tests. PR 3 should add page-level extraction quality data and UI/gate behavior. PR 4 should harden client/procuring metadata extraction with per-field source references.

## B. Current Production Health after PR #564

### B1. Local repository state

Observed by command:

```bash
git status --short --branch
git rev-parse HEAD
git log --oneline -5
```

Findings:

- Current local branch: `work`.
- Current local HEAD: `8e388b894a3fef96b0af4eba9a54d40ed4ca95a5`.
- Local history top commits:
  - `8e388b8 Fix production DB crash: add prisma db push to Vercel buildCommand (#565)`
  - `99d542a Block generation on untraced requirements, strengthen placeholder detection, add metadata completeness tests (#564)`
  - `fbd9ce9 Add Build Plan extraction gate, evidence coverage check, and extraction quality tests (#563)`
  - `c3dd641 Fix Codex review issues: use shared extraction gate threshold and include sectionReference in traceability check`
  - `0d5e1eb Add Build Plan extraction gate, evidence coverage check, and extraction quality regression tests`

Conclusion: the workspace is **not exactly main at #564**; it includes a local #565 commit. This audit treats #564 as the requested production baseline and notes #565 as present locally.

### B2. Production commit and health

Live verification attempted:

```bash
python - <<'PY'
import urllib.request
url='https://hope-tender-path-b.vercel.app/api/health'
try:
    r=urllib.request.urlopen(url, timeout=20)
    print(r.status)
    print(r.read(2000).decode('utf-8','replace'))
except Exception as e:
    print(type(e).__name__, str(e))
PY
```

Result: `URLError <urlopen error Tunnel connection failed: 403 Forbidden>`.

Therefore, from this container I could **not** independently confirm:

- Vercel production deployment state.
- `/api/health` response.
- `databaseReachable=true`.
- Whether production is serving `99d542a...`, `8e388b8...`, or another commit.
- Whether a stale preview is being mistaken for production.

The production status remains the user-provided baseline until verified from Vercel/GitHub outside this container.

### B3. Open PRs / branch risk

Observed locally:

- `git config --get remote.origin.url` returns no remote.
- `git show-ref --head` only lists `HEAD` and `refs/heads/work`.
- No `gh` executable is available in the container.

Conclusion: no open PR inventory can be confirmed from this checkout. Branch risk remains: any stale PR from before #558-#565 could reintroduce unsafe provider ordering, weak gates, or old UI routes unless manually reviewed in GitHub.

### B4. Latest merged PR order from #558 to #564

The requested order is plausible and is treated as accepted baseline:

1. #558 Fix Recovery Command Center Link Vault Evidence 404.
2. #559 Fix Build Plan and Approve All silent failures.
3. #560 Auto-build submission plan and classify outside-plan documents on load.
4. #561 Add CLAUDE.md with extraction quality and client-detail requirements.
5. #562 Fix extraction quality, client extraction, and generation gate gaps.
6. #563 Add Build Plan extraction gate, evidence coverage check, and extraction quality tests.
7. #564 Block generation on untraced requirements, strengthen placeholder detection, add metadata completeness tests.

Local history also shows #565 after #564.

## C. Current App Rating vs Claude AI / ChatGPT Level

### C1. Score

Current score: **6.4 / 10** against a senior AI proposal consultant manually using Claude/ChatGPT.  
Target score after PR 10: **8.5 / 10**.

### C2. Rubric scoring

| Capability | Score | Audit basis |
|---|---:|---|
| Tender understanding and extraction | 6.5 | AI Analyze has strong prompt coverage, but requirement rows lack durable per-requirement source coordinates from the AI result. |
| Page extraction and OCR reliability | 4.5 | File metrics exist; page-level quality and OCR details are not persisted/displayed as requested. |
| Client/procuring-entity detail extraction | 5.5 | Partial extended fields exist; 20-field per-source extraction is missing. |
| Requirement completeness | 6.5 | AI and fallback extract requirements; consolidation is useful, but source-grounded completeness is weak. |
| Metadata completeness | 7.0 | Completeness gate and placeholder detection exist; manual-confirmed/source-confirmed field states are missing. |
| Submission plan accuracy | 6.0 | Build Plan exists; derived/unconfirmed plan provenance is not durable enough. |
| Evidence matching from company vault | 6.5 | Reviewed-vault readiness and matching exist; promotion workflow needs stricter matrix-source proof. |
| Compliance matrix strength | 6.5 | Matrix exists, but support-level promotion needs explicit source traceability enforcement. |
| Source traceability | 5.0 | Requirement schema supports traceability, but AI Analyze does not populate it directly. |
| Technical proposal drafting quality | 7.0 | Strong prompts and sectioned generation exist, but content is still too benchmark-shaped in places. |
| Financial proposal/package handling | 6.0 | Pricing workbook and two-envelope export guard exist; financial evidence/package separation remains incomplete. |
| Official-original protection | 7.5 | Official-original/replacement-control logic exists; must be expanded to tender-issued forms. |
| Section-by-section generation reliability | 7.0 | Parallel sections and targeted regeneration exist; not fully tied to plan rows/requirements. |
| Multi-provider AI fallback resilience | 8.0 | Required generic chains exist with Anthropic last; hand-coded chains still need consolidation. |
| Readiness/export safety | 8.0 | Canonical readiness and final ZIP gate are strong. |
| Generalization across tender types | 6.0 | Category/package detectors exist but need fixture-backed regression. |
| User workflow clarity | 6.0 | Many panels exist; contradictory states and action parity need cleanup. |

### C3. Main gaps preventing Claude/ChatGPT-level quality

1. Missing page-level extraction inventory and confidence.
2. Missing per-field source citations for most client/procuring metadata.
3. AI Analyze output schema lacks per-requirement source file/page/quote.
4. Build Plan does not durably distinguish explicit tender plan vs derived draft vs user-confirmed plan.
5. Generate Docs can still proceed without some requested important-page and evidence-confirmation prerequisites.
6. Evidence coverage support levels can be represented, but promotion workflow is not yet strict enough.
7. Section generation still has fixed proposal assumptions and some Pharo/benchmark-shaped language.
8. Tests do not yet cover six generic tender families with realistic fixture assertions.

### C4. Already stronger than manual Claude/ChatGPT

- Canonical export blocking and direct ZIP route protection.
- Persistent document lifecycle/audit data.
- Reviewed-vault separation from draft evidence.
- Provider cooldown/health tracking and fallback routing.
- Two-envelope ZIP protection.
- Repeatable regression tests for safety gates.

### C5. Still weaker than manual Claude/ChatGPT

- Reading scanned/tabled tender pages page-by-page.
- Recognizing contaminated portal text and multiple organizations in all cases.
- Designing the exact package plan for donor/government formats when filenames are implicit.
- Asking the right manual confirmation questions before drafting.
- Writing tailored, non-template technical methodology for arbitrary sectors.
- Handling official tender forms/templates without generating fake originals.

### C6. Exact features required to close the gap

1. PageExtractionRecord model or JSON metadata containing page number, method, char count, density, confidence, categories, errors, and snippets.
2. ClientMetadataField model or structured JSON with field, value, source file/page/quote, status, contamination flag, and manual confirmation.
3. AIAnalysisVersion model storing prompt version, provider/chunk metadata, extracted requirements, client details, extraction status, and restore capability.
4. Requirement source extraction in AI result and direct persistence to `TenderRequirement` source fields.
5. SubmissionPlanRow model or GeneratedDocument extensions for explicit/derived/user-confirmed/official-original/control/outside-plan states.
6. Evidence promotion API enforcing compliance-matrix source references for FULL/SUBSTANTIAL.
7. Targeted generation by plan row and section, with no broad uncontrolled regeneration.
8. Regression fixtures for Pharo, building design, road/water, EOI/vendor registration, donor/bank, and two-envelope tenders.

## D. Architecture Map

### D1. App/dashboard routes

Public and auth pages:

- `/`, `/login`, `/forgot-password`, `/reset-password`, `/offline`.
- `/dashboard` and dashboard subpages: account, activity, admin AI readiness, analysis, analytics, assets, calendar, company, company documents, plan-b import, company readiness, review-board, compliance, documents, export, history, matching, search, settings, setup, system, tenders, new tender, tender detail, command center, users.

Key tender UI components:

- Tender detail: `app/dashboard/tenders/[id]/page.tsx`.
- Recovery Command Center: `components/tender-recovery-command-center.tsx`.
- Extraction Quality: `components/extraction-quality-panel.tsx`.
- Generation Readiness: `components/generation-readiness-panel.tsx`.
- Mandatory Requirement Coverage: `components/requirement-coverage-panel.tsx`.
- Tender Controls Ledger: `components/tender-controls-panel.tsx`.
- Submission Plan Completeness: `components/submission-plan-completeness-panel.tsx`.
- Submission Plan Reconciliation: `components/submission-plan-reconciliation-panel.tsx`.
- Generated Docs / review: `components/document-review-panel.tsx` plus generated-output helpers.
- Export Readiness / Final Submission: `components/export-readiness-panel.tsx`, `components/final-submission-control-center.tsx`, `components/canonical-readiness-score-widget.tsx`.
- AI/provider panels: `components/ai-health-panel.tsx`, `components/ai-health-test-button.tsx`.

### D2. API routes

Core system/admin:

- Health: `/api/health`.
- AI health/runtime: `/api/ai/health`, `/api/ai-runtime`, `/api/admin/ai-environment-readiness`, `/api/admin/ai-provider-health`, `/api/admin/ai-provider-health/test`.
- Admin diagnostics/repair/audit: `/api/admin/diagnostics`, `/api/admin/repair`, generated-proposal audit/reassess, stuck job release.

Company vault:

- Company profile and settings routes.
- Company documents/assets/legal/financial/compliance records.
- Experts/projects batch and individual routes.
- Company ingestion readiness, plan-b import, repair/reimport/cleanup.

Tender lifecycle routes:

- Tender CRUD/upload: `/api/tenders`, `/api/tenders/upload-first`, `/api/upload`, `/api/tenders/[id]`, file/doc subroutes.
- AI Analyze: `/api/tenders/[id]/ai-analyze`.
- Run Engine: `/api/tenders/[id]/engine`.
- Build Plan: `/api/tenders/[id]/submission-plan/build` and `/api/tenders/[id]/submission-plan`.
- Auto-classify plan docs: `/api/tenders/[id]/submission-plan/auto-classify`.
- Generate Docs: `/api/tenders/[id]/generate` and `/api/tenders/[id]/generate-missing-plan-files`.
- Targeted regeneration: `/api/tenders/[id]/regenerate-section`, `/api/tenders/[id]/regenerate-cvs`.
- Validate/review: `/api/tenders/[id]/validate`, `/api/tenders/[id]/documents/bulk-review`, document review routes.
- Evidence/coverage: `/api/tenders/[id]/requirement-coverage`, confirm/reject routes, `/api/tenders/[id]/link-vault-evidence`, `/api/tenders/[id]/proposal-evidence-readiness`, traceability.
- Metadata/source repair: repair metadata, re-extract metadata, repair source grounding.
- Export readiness/final package: `/api/tenders/[id]/export-readiness`, `/api/tenders/[id]/export`, `/api/tenders/[id]/download`, repair export gaps.
- Lifecycle/readiness/control: lifecycle, readiness, readiness-score, controls, analysis-quality, extraction-quality, matching-quality, score-breakdown.
- Pricing/two-envelope support: pricing workbook and lines.
- Proposal versions: `/api/tenders/[id]/proposal-versions` and version detail.

### D3. AI router/provider health

- Primary provider router: `lib/ai.ts`.
- Health/cooldown/env helpers: `lib/ai-provider-health.ts`, `lib/ai-provider-health-db.ts`, `lib/ai-runtime-capability.ts`, `lib/ai-environment-readiness.ts`.
- Generic `PROVIDER_CHAINS` has required default/extraction/proposal/validation/fast orders with Anthropic last.
- Admin test route pings providers without returning secrets.

### D4. Prisma schema and migrations

Main models:

- User/session/role.
- Company, company documents/assets, experts, projects, legal records, financial records, compliance records.
- Tender, TenderFile, TenderRequirement, ComplianceMatrix, ComplianceGap.
- GeneratedDocument, DocumentReview, DocumentComment, ExportPackage.
- AiJob/AiJobStep.
- SectionEvidenceMap and ProposalVersion.
- ProviderHealthSnapshot.
- PricingWorkbook/CostLine.

Recent migrations:

- `20260602000000_add_client_extraction_fields`
- `20260602000000_add_extraction_quality_fields`

Important limitation: schema has file-level extraction metrics on `TenderFile`, but no first-class page-level extraction model.

### D5. Neon/runtime assumptions

- Prisma datasource uses `DATABASE_URL`.
- `ProviderHealthSnapshot` persists cooldown state across Vercel cold starts.
- Several list endpoints intentionally avoid `fileContent` selection; however, some audit/repair/dedup routes select content for heavy operations.
- `/api/health` should remain slim and must not expose secrets, user counts, or schema/bootstrap internals.

### D6. Tests

The suite is broad and includes provider policy, extraction gates, metadata, source grounding, submission plan, export readiness, official originals, recovery action routing, security, db transfer query shape, multi-sector fixtures, tender classification, and final ZIP scope tests. The suite lacks full realistic fixture acceptance across the exact six requested tender categories with end-to-end extraction/analyze/plan/generate assertions.

## E. Recent PRs Already Accounted For

This audit assumes PRs #558-#565 are already in local code unless explicitly noted. I did not reapply those patches. The notable local results are:

- #558: Link Vault Evidence no longer routes to `/dashboard/vault`; component calls the API route and tests assert no vault navigation.
- #559/#560: Build Plan endpoint exists and creates planned rows; submission plan completeness endpoint is metadata-only and exposes plan states.
- #561: CLAUDE.md exists with extraction and client-detail requirements.
- #562/#563: Extraction-quality fields/gates and tests exist.
- #564: generation blocks untraced mandatory requirements and has stronger metadata placeholder tests.
- #565: local HEAD adds a Vercel build-command production DB crash fix.

## F. Current Open PRs / Branch Risk

Could not confirm open PRs due no remote/gh and blocked external CONNECT. Risks to check manually before merging future PRs:

1. Stale PRs that predate #558 may restore `/dashboard/vault` or other missing route navigation.
2. Stale PRs that predate Mistral/Together may restore a six-provider chain or put Anthropic before other providers.
3. Stale PRs that predate #563/#564 may weaken extraction, metadata, source traceability, or empty-plan gates.
4. A production deployment may be at #564 while local is at #565; confirm which commit Vercel serves.

## G. Critical Remaining Gaps

1. Page-level extraction records are missing.
2. AI Analyze does not write per-requirement source references.
3. Client/contact/submission metadata extraction is incomplete and not per-field sourced.
4. Build Plan lacks durable plan-row provenance and user-confirmation state.
5. Generate Docs does not fully require usable plan/evidence/outside-plan reconciliation before generation.
6. Recovery Command Center action parity still needs full per-action regression coverage.
7. Evidence support-level promotion needs stricter source-traced workflow.
8. Document lifecycle states are represented mostly as strings on GeneratedDocument; not all requested states are first-class or consistently enforced.
9. Performance risk remains for routes that intentionally load `fileContent` during audit/repair/dedup operations.
10. Generic tender workstream support needs fixture-backed classifier and planner acceptance tests.

## H. Page Extraction / OCR Gaps

Current implementation:

- `TenderFile` stores `totalPages`, `extractedPages`, `ocrPages`, `failedPages`, `extractionScore`, and `extractionMethod`.
- `assessExtractionQuality()` computes a heuristic severity from full extracted text.
- Extraction Quality UI shows file-level totals, OCR count, failed count, character count, severity, and recommendations.
- Extraction Quality API returns file-level reports.

Gaps versus requested requirements:

- No page-level confidence list.
- No persisted blank/weak page list.
- No per-page extraction error list.
- No table/form capture-quality flag per page.
- No page categories for submission instructions, evaluation criteria, required docs/forms, client/contact/submission details.
- No OCR model field.
- No exact “Perfectly extracted pages: Y” calculation.
- No extraction coverage `Y/X` based on page-level perfection.
- Important-page failure does not yet hard-block based on categories, only score/failed-page metrics.

Required PR 3 changes:

1. Add page-level extraction metadata storage, preferably JSON on TenderFile first for small PR safety, then optional normalized model.
2. Calculate “perfect page” only if text density, no error, not blank/noise, and table/form confidence pass.
3. Display total/perfect/OCR/weak/failed counts plus low-confidence and failed page lists.
4. Add recommended actions: re-extract, OCR, clearer scan, manually enter metadata, continue only if acceptable.
5. Gate AI Analyze/Build Plan/Generate/Export when important pages failed or total page count is unknown.

## I. Client Detail Extraction Gaps

Current implementation:

- AI Analyze prompt asks for procuring entity, legal name, donor, implementing agency, client source page/quote, and submission email page.
- `Tender` stores these partial fields plus contamination flag.
- Placeholder detection and contamination checks exist.

Gaps:

- The app does not yet extract/store all requested fields: project owner separately from implementing agency, procurement/reference number source, project location/city source, client address source, submission address source, contact person/title/email/phone source, website/portal link, submission email source quote, required email subject line source, pre-bid/contact channel source, authorized officer source.
- Source page/quote is only stored for client name and submission email page, not every field.
- Missing values are not represented with durable `MISSING_SOURCE` status per field.
- Manual confirmation status is not first-class.
- Multi-organization role separation is partial.
- Contamination detection is a boolean on tender, not per field.

Required PR 4 changes:

1. Add structured metadata field status/source JSON.
2. Extract all 20 fields with role classification.
3. Treat placeholders as missing.
4. Add UI table showing value, role, source file/page/quote, status, and manual confirmation action.
5. Block generation/export until critical fields are sourced or manually confirmed: procuring entity/client, submission method, endpoint/email/address, and deadline.

## J. AI Analyze Gaps

Current implementation:

- Uses extracted tender file text and keyword-aware truncation.
- Chunks large tenders.
- Creates `AiJob` and chunk step records.
- Restores/persists provider cooldown state.
- Uses AI fallback router with extraction use case.
- Stores AI/partial/fallback statuses and analysis source notes.
- Blocks AI Analyze on poor extraction unless forced.

Gaps:

- The AI result schema does not include source file/page/section/quote per requirement.
- Requirement rows are created without source coordinates; later repair tries to ground them.
- Partial AI and regex fallback statuses exist, but `analysisExtractionStatus` is persisted asynchronously after success, not transactionally with the analysis rows.
- Regex fallback can create requirements without complete plan/source metadata, then downstream gates must catch it.
- AI Analyze does not yet guarantee extraction of exact required forms/templates into official-original rows.
- The source text passed to AI is truncated/key-section sampled; if critical content is outside sampled windows, analysis can be incomplete.

Status mapping:

- Existing/compatible statuses: `AI_ANALYZED`, `AI_ANALYSIS_PARTIAL`, `ANALYSIS_REQUIRES_REVIEW`, `FALLBACK_DRAFT_CREATED`, `FULL_EXTRACTION_AI_ANALYZED`, `PARTIAL_EXTRACTION_AI_ANALYZED`, `OCR_REQUIRED`, `EXTRACTION_WEAK_REVIEW_REQUIRED`, `REGEX_FALLBACK_FROM_WEAK_EXTRACTION`.
- Safe mapping for old history:
  - status `AI_ANALYZED` + extraction status null → treat as `PARTIAL_EXTRACTION_AI_ANALYZED` until page metrics prove full extraction.
  - notes regex fallback + no approval → `ANALYSIS_REQUIRES_REVIEW`.
  - approved fallback note → `FALLBACK_DRAFT_CREATED` plus human-approved analysis source.
  - missing extraction metrics → `EXTRACTION_WEAK_REVIEW_REQUIRED` for final export, `PARTIAL_EXTRACTION_AI_ANALYZED` for display only.

## K. Build Plan Gaps

Current implementation:

- `/api/tenders/[id]/submission-plan/build` builds a plan from requirements/exact file naming/order and creates `GeneratedDocument` rows with `generationStatus: PLANNED`.
- It blocks when extraction is below the shared gate.
- It blocks if no requirements and no explicit files exist.
- Submission plan completeness endpoint reports rows, counts, plan state, and user confirmation requirement.

Gaps:

- The built rows do not store explicit vs derived provenance in a durable field.
- There is no first-class `DERIVED_DRAFT_UNCONFIRMED` status on plan rows.
- There is no dedicated user-confirm-derived-plan action that records reviewer/time/note.
- Official tender-issued forms/templates are not guaranteed to become `ORIGINAL_REQUIRED` / `REPLACE_WITH_ORIGINAL` rows at plan-build time.
- If planned file names are absent, derived rows may still look like normal generated-document stubs rather than unconfirmed draft-plan rows.
- The all-zero plan state has been improved, but needs end-to-end UI testing against requirements-with-no-plan.

Required PR 5 changes:

1. Persist plan provenance/status on rows.
2. Create derived draft plan rows from mandatory requirements, evaluation criteria, ToR/scope, submission rules, and envelope rules when exact filenames are absent.
3. Mark derived draft rows `NEEDS_CONFIRMATION` and block final export until confirmed.
4. Convert official forms/templates to original-required/replacement-control rows, never fake-generated final docs.
5. Add tests for requirements > 0 and plan rows = 0 hard blocker.

## L. Generate Docs Gate Gaps

Current implementation blocks:

- No company profile / incomplete reviewed vault readiness.
- Invalid/missing client name.
- Poor extraction below current threshold.
- No requirements.
- Requirements ≥ 5 with zero active generated/planned docs.
- Missing/placeholder critical metadata.
- Contaminated metadata.
- Unapproved regex fallback.
- Untraced mandatory requirements after source repair attempt.
- Critical compliance gaps.

Gaps:

- Extraction gate permits null metrics and only blocks scores below threshold; it does not block unknown total page count or failed important pages.
- Client details must be sourced or manually confirmed, but current gate mostly checks field presence/completeness.
- Submission plan is required only in the zero-doc/requirements≥5 case; generation can proceed with active docs that are outside plan unless later export blocks them.
- Outside-plan reconciliation is not always required before generation.
- Reviewed vault evidence linked at least partially is not a universal pre-generation requirement.
- Derived draft plan confirmation is not enforced because provenance is not durable.
- The main generator can still create/support-fill multiple rows and later warn about outside-plan extras rather than fully preventing them.

Required PR 6 changes:

1. Server-side generation-readiness helper with all ten requested prerequisites.
2. Block unknown/weak extraction and important-page failure.
3. Block unsourced/unconfirmed client critical details.
4. Block no/empty/unconfirmed submission plan when requirements exist.
5. Block unreconciled outside-plan active docs before full generation.
6. Require at least partial reviewed-vault evidence when relevant mandatory requirements exist.
7. Keep final ZIP/export gates unchanged or stricter.

## M. Recovery Command Center Gaps

Current implementation:

- `RETRY_AI_ANALYZE` / `RUN_AI_ANALYZE` call AI Analyze API.
- `BUILD_SUBMISSION_PLAN` calls the build API.
- `RUN_ENGINE` calls engine API.
- `APPROVE_FALLBACK_WITH_NOTE` calls approval API.
- `DOWNLOAD_FINAL_ZIP` hits download route.
- `LINK_VAULT_EVIDENCE` calls link-vault-evidence GET/POST and does not navigate to `/dashboard/vault`.
- `REPAIR_SOURCE_REFERENCES` calls repair-source-grounding API.
- Several actions scroll to existing panels.
- Unknown actions show an inline safe message.

Gaps:

- Tests check Link Vault Evidence and unknown fallback, but not every Execute action.
- Some user-requested action labels differ from internal action names, e.g. “Generate Missing Planned Docs” should call `/generate-missing-plan-files`, but current `GENERATE_REQUIRED_DOCUMENTS` scrolls to plan completeness rather than executing targeted missing generation.
- “Validate Docs,” “Export Readiness,” and “Re-check readiness” should have explicit API/scroll behavior tested.
- Scroll targets can silently do nothing if the panel id is missing.

Required PR 2 changes:

1. Export action mapping as a pure table/helper.
2. Add tests for all required actions.
3. Ensure every action calls an existing API, scrolls to a verified id, or opens an existing route.
4. Add inline message when a scroll target is absent.
5. Confirm production #558 fix after deployment.

## N. Evidence Coverage Gaps

Current implementation:

- Company ingestion readiness distinguishes reviewed experts/projects/documents.
- Compliance matrix has `supportLevel`, `evidenceType`, `evidenceSource`, and `evidenceReference`.
- Requirement coverage routes and tests exist.
- Link-vault evidence only fully readies a document when bytes exist and hygiene checks pass.

Gaps:

- Selected experts/projects still risk being interpreted by UI/users as strong coverage without explicit matrix-source promotion.
- Auto-linked evidence messages can say “ready” for document hygiene while requirement-level support remains partial.
- FULL/SUBSTANTIAL promotion must require compliance matrix row plus tender source page/quote and evidence source traceability.
- Financial/legal/submission-rule requirements need type-specific evidence enforcement.
- “Confirm all” must not promote weak evidence.

Required PR 7 changes:

1. Keep auto-linked evidence `PARTIAL` by default.
2. Promotion API validates requirement source traceability and evidence source category.
3. FULL/SUBSTANTIAL requires audit note and source references.
4. Not-applicable requires audit note.
5. Add tests for financial/legal/submission-rule evidence mismatch.

## O. Metadata Gaps

Current implementation:

- Tender has core metadata fields plus extended client fields.
- Metadata completeness gate checks critical fields and placeholders.
- Stored metadata sanitizer clears invalid fields before generation.
- Metadata contamination blocks generation.

Gaps:

- Critical fields are not all represented with source/manual-confirm status.
- Repair pulls from deterministic source text, but result status is not stored per field.
- Proposal validity, bid bond, page limit, site visit, evaluation weights, budget, copies required are not all hard blockers in every tender context.
- Placeholder rules need to apply to every client/contact/submission field, not only tender-level fields.
- Contamination should be per-field and should block only affected critical fields while making review clear.

Required PR 4/6 changes:

1. Per-field metadata provenance/status.
2. Manual confirmation action with audit log.
3. Context-aware criticality by tender category/package mode.
4. UI panel for missing/source-missing/manual-confirmed fields.

## P. Document Lifecycle / Export Gaps

Current implementation:

- `GeneratedDocument` has `generationStatus`, `validationStatus`, `reviewStatus`, exact filename/order, content, and review audit.
- Export helpers exclude superseded/internal/outside candidates and require readiness.
- Final ZIP calls canonical readiness before packaging.
- Strict two-envelope packaging blocks mixed ZIPs.

Gaps:

- Requested states are strings, not a formal enum/state machine.
- `CONTROL`, `SUBMISSION_RULES`, `ORIGINAL_REQUIRED`, `REPLACE_WITH_ORIGINAL`, `NOT_EXPORTABLE`, `OUTSIDE_PLAN`, `DUPLICATE`, `HISTORICAL`, `QUALITY_FAILED` are not all consistently modeled as first-class generation statuses.
- PLANNED is correctly not export-ready, but derived-plan confirmation is not stored.
- Official originals require stronger attachment tracking.
- Historical/superseded pruning/archive strategy is not designed.

Required PR 8 changes:

1. Normalize lifecycle states and row classification.
2. Ensure generated docs map to plan row or are control/not-exportable/outside/superseded.
3. Add targeted generate missing planned docs.
4. Avoid generating uncontrolled duplicates.
5. Add archive strategy design before deleting any audit history.

## Q. Security Gaps

Current strengths:

- Sensitive tender routes generally require session/role.
- Admin routes use admin role guards.
- Provider errors are sanitized in major routes.
- Provider health snapshots never store API keys.
- Download route requires auth and canonical readiness.
- Public health route appears intended to be slim.

Gaps / needs verification:

- Need route-by-route tests for all admin repair/bootstrap/schema routes.
- Need explicit tests that public routes do not leak raw DB errors, admin existence, user count, `DATABASE_URL`, `SESSION_SECRET`, provider keys, or file content.
- Need verify generated package download cannot be accessed by non-owner or unauthenticated user.
- Need ensure every storage/file preview endpoint checks user ownership and does not expose base64 by list endpoints.
- Need ensure provider test route never returns raw provider response bodies.

Required security PR:

- Expand route guard tests and error redaction tests before any public diagnostics are added.

## R. Performance / Neon Transfer Gaps

Current strengths:

- Submission plan endpoint explicitly avoids loading `GeneratedDocument.fileContent` by default.
- Several list routes use `select` instead of `include` for content.
- `/api/health` should stay slim.

Risks:

- Deduplicate, reimport, auto-finalize, audit, and download routes intentionally load file content; these must remain explicit and not be polled.
- Tender AI Analyze sends sampled extracted text but still can process up to 300k chars.
- Repeated generation can create many historical/superseded rows if not pruned/archived.
- Provider/test/panel polling frequency should be checked in production.

Required PR 8/performance changes:

1. Audit all `fileContent` selections and label intentional heavy routes.
2. Ensure list/dashboard/poll endpoints never select file content.
3. Add generated-doc archive/prune design that preserves audit history.
4. Reduce polling where panels can refresh on mutation completion.
5. Keep health slim.

## S. Generic Tender Engine Upgrade Strategy

### S1. Tender category detector

Current AI prompt supports category detection, including building design, road/infrastructure, water/irrigation, urban planning, geotechnical, supervision, feasibility, healthcare, industrial, donor, EOI, and vendor registration. It needs fixture-backed deterministic tests and UI surfacing.

### S2. Submission package mode detector

Current classification supports `SINGLE`, `TWO_ENVELOPE`, `EOI`, and `DONOR_FORMAT`. Export code protects strict two-envelope downloads. It needs stronger plan behavior for donor forms and official originals.

### S3. Required document planner

Build Plan should combine explicit files, requirements, evaluation criteria, submission instructions, scope/ToR, and envelope rules. Derived rows should be unconfirmed until reviewer approval.

### S4. Proposal section planner

Section planner should be tender-category-specific and requirement-driven, not benchmark-fixed. It should derive sections from ToR/scoring and mark any unsupported sections as bid-team actions.

### S5. Evidence confirmation workflow

Evidence should flow: selected vault candidates → partial coverage → compliance matrix promotion with source traceability → readiness gate.

### S6. Sectioned/resumable generation

Existing sectioned generation and proposal versions should be extended into resumable per-plan-row/per-section jobs with restore.

### S7. DOCX/PDF/ZIP assembly hardening

Keep strict signature checks, official-original attachment requirements, byte readiness, and two-envelope separation. Add plan-row-to-zip-entry traceability.

### S8. Analysis version history and restore

Add `AIAnalysisVersion` or reuse `ProposalVersion` pattern for analysis: source text hash, extraction status, provider/chunks, result JSON, createdBy, restoredAt.

### S9. Regression benchmark suite

Create fixtures for:

1. Pharo benchmark.
2. Building design RFP.
3. Road or water infrastructure tender.
4. EOI/supplier registration.
5. Donor/bank proposal.
6. Two-envelope technical/financial tender.

Each fixture should assert extraction metrics, client fields, mandatory requirements, plan rows, official originals, package mode, blocked/unblocked generation, evidence requirements, and ZIP readiness.

## T. Prioritized PR Plan

### PR 1 — Audit report only

- This document.
- No runtime gate changes.
- Confirm no secrets committed.
- Confirm Anthropic-last policy not changed.
- Confirm final ZIP/export safety not weakened.

### PR 2 — Recovery Command Center action parity

Root cause: action dispatcher is embedded in UI and only partially tested.  
Files likely changed: recovery component, action helper, tests.  
Tests: recovery action mapping, panel route parity.

### PR 3 — Page extraction dashboard and gates

Root cause: extraction quality is file-level heuristic rather than page-level proof.  
Files likely changed: extraction library, upload/extract routes, UI panel, extraction API, gates, tests.

### PR 4 — Client/procuring metadata traceability

Root cause: only partial client fields/source tracking exist.  
Files likely changed: AI prompt/result schema, Prisma migration or metadata JSON, tender UI, metadata gate, tests.

### PR 5 — Submission plan derived/confirmed behavior

Root cause: plan provenance/user confirmation is not durable.  
Files likely changed: submission-plan builder/completeness/build route/UI/tests.

### PR 6 — Generate Docs hard gate

Root cause: generation gate still accepts some ambiguous plan/extraction/evidence states.  
Files likely changed: generation readiness helper, generate route, action panel, tests.

### PR 7 — Evidence coverage workflow

Root cause: support-level promotion needs source-traced matrix enforcement.  
Files likely changed: requirement coverage routes/UI, evidence profile helper, tests.

### PR 8 — Outside-plan generation and targeted missing docs

Root cause: generation can produce/support-fill rows later classified outside-plan.  
Files likely changed: generate route, generate-missing-plan-files route, document state, tests.

### PR 9 — AI Analyze version history and restore

Root cause: analysis can be overwritten without full restore/audit.  
Files likely changed: Prisma schema/migration, AI Analyze route, versions API/UI/tests.

### PR 10 — Generic classifier and fixture suite

Root cause: general tender support is not yet proven against representative fixtures.  
Files likely changed: classification, planner, tests/fixtures.

## U. Test Plan

### U1. Required commands per PR

Run when feasible:

```bash
npm run typecheck
npm run build
npm test
npm run lint
```

If full tests are too heavy, run:

```bash
npm run typecheck
npm run build
npm test -- <targeted test files if runner supports it>
npm run lint
```

### U2. Targeted test additions by PR

- PR 2: `tests/recovery-command-center-actions.test.ts`, `tests/panel-route-parity.test.ts`, new action-map test.
- PR 3: extraction page metrics tests; important-page gate tests; UI summary tests where feasible.
- PR 4: client metadata extraction sanitizer/source tests; placeholder and contamination tests.
- PR 5: derived plan creation, explicit plan creation, zero-row blocker, official original plan-row tests.
- PR 6: generation-readiness hard blockers for extraction/client/requirements/plan/outside/evidence.
- PR 7: evidence promotion and financial/legal mismatch tests.
- PR 8: targeted generate missing planned docs and outside-plan dedup tests.
- PR 9: analysis version restore tests.
- PR 10: multi-sector fixture tests.

### U3. Manual verification after deploy

1. Confirm Vercel production READY and exact commit hash.
2. Confirm `/api/health` returns OK and `databaseReachable=true` without secrets.
3. Confirm no stale preview is used.
4. Confirm GitHub has no unsafe open PRs.
5. Upload one fixture from each tender family and verify: extraction panel, client detail panel, AI Analyze status, Build Plan rows, Generate gate, Evidence coverage, Export readiness, and ZIP blocking.

## V. AI Provider Audit Details

Required chains:

- Default: `openai, gemini, mistral, deepseek, groq, together, openrouter, anthropic`.
- Extraction/analyze: `gemini, openai, mistral, together, deepseek, groq, openrouter, anthropic`.
- Drafting/proposal: `openai, gemini, mistral, deepseek, together, groq, openrouter, anthropic`.
- Validation: `openai, gemini, mistral, deepseek, together, groq, openrouter, anthropic`.
- Fast/cheap: `groq, together, deepseek, mistral, gemini, openai, openrouter, anthropic`.

Local finding:

- The shared `PROVIDER_CHAINS` object matches all five required chains and keeps Anthropic last.
- `generateWithFallback()` skips unconfigured/cooled providers and throws only after all configured providers are exhausted.
- Provider health/environment surfaces include OpenAI, Gemini, Mistral, DeepSeek, Groq, Together, OpenRouter, and Anthropic.
- Admin provider testing must continue to return status/model/duration/safe errors only, never secrets.
- Some hand-coded proposal/refinement paths still duplicate provider ordering and stale comments; these should be centralized later even though Anthropic remains last.

## W. Safety Gate Confirmation

This audit PR makes no runtime changes. Therefore:

- Claude/Anthropic ordering is unchanged and remains last in the shared chains.
- Final ZIP/export safety is unchanged.
- Official-original safety is unchanged.
- Metadata/source/evidence/generation gates are unchanged.
- No secrets were added to this report.
