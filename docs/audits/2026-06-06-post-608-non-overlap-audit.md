# Post-#608 Non-Overlap Audit and Cleanup Plan

Date: 2026-06-06
Branch: `codex/post-608-non-overlap-audit-and-cleanup`
Production app: `https://hope-tender-path-b.vercel.app`
Production deployment reported by operator: `dpl_DVHLixoFMJfJfs4HARNU1XhH8MAZ` (`READY`, target `production`)

## Executive summary

This is a deliberately small, non-overlapping audit/prep PR. It does not change runtime gates, generation logic, export logic, provider chains, database schema, or production data. Its purpose is to preserve the current production status, isolate draft PR #608, and give the next reviewer a token-saving checklist for the full code-review phase after PR #608 is resolved.

## Current production status recorded for this audit

- Latest production deployment is reported as `READY`.
- Production runtime logs were reported clean for the checked 2-hour window: no error/fatal/warning logs found.
- PRs #597-#607 are reported merged.
- PR #608 is open, draft, not merged, and not mergeable.
- PR #608 is being repaired by another AI and must remain isolated from this work.

## PR #608 isolation rule

Do **not** touch PR #608. Specifically:

1. Do not checkout PR #608's branch.
2. Do not push to PR #608's branch.
3. Do not rebase PR #608.
4. Do not merge PR #608.
5. Do not close PR #608.
6. Do not edit PR #608's description.
7. Do not modify PR #608 files unless production is broken and no alternative exists.
8. If a needed fix overlaps PR #608, mark it `DEFER UNTIL PR #608 IS RESOLVED`.

## PR #608 changed-file avoidance list

The public PR #608 file tree showed the following changed paths. Treat these as blocked for this non-overlap PR:

- `app/api/tenders/[id]/ai-analyze/route.ts`
- `app/api/tenders/[id]/ai-proposal/route.ts`
- `app/api/tenders/[id]/analysis-quality/route.ts`
- `app/api/tenders/[id]/copilot/route.ts`
- `app/api/tenders/[id]/export/route.ts`
- `app/api/tenders/[id]/generate/route.ts`
- `app/api/tenders/[id]/pipeline-diagnostic/route.ts`
- `app/api/tenders/[id]/re-extract-metadata/route.ts`
- `app/api/tenders/[id]/regenerate-section/route.ts`
- `app/api/tenders/[id]/repair-metadata/route.ts`
- `app/api/tenders/[id]/submission-plan/build/route.ts`
- `app/dashboard/page.tsx`
- `app/dashboard/tenders/[id]/page.tsx`
- `app/dashboard/tenders/[id]/report/page.tsx`
- `app/dashboard/tenders/[id]/tender-detail.tsx`
- `app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx`
- `app/dashboard/tenders/page.tsx`
- `app/share/[token]/page.tsx`
- `components/ai-copilot-suggestions-panel.tsx`
- `components/analysis-quality-panel.tsx`
- `components/corrupted-metadata-banner.tsx`
- `components/next-action-panel.tsx`
- `components/tender-health-score-panel.tsx`
- `components/tender-recovery-command-center.tsx`
- `lib/ai.ts`
- `lib/analysis-quality.ts`
- `lib/engine/export-readiness.ts`
- `lib/engine/final-submission-readiness.ts`
- `lib/engine/generate.ts`
- `lib/engine/proposal-intelligence.ts`
- `lib/engine/tender-ai-copilot.ts`
- `lib/engine/tender-field-extractors.ts`
- `lib/engine/tender-lifecycle-orchestrator.ts`
- `lib/engine/tender-metadata-completeness.ts`
- `lib/recovery-command-actions.ts`
- `lib/tender-generation-readiness.ts`
- `tests/analysis-quality-multifactor.test.ts`
- `tests/recovery-command-center-actions.test.ts`
- `tests/tender-field-extractors.test.ts`
- `tests/tender-metadata-completeness.test.ts`

## Neon-saving rules for follow-up work

- Do not run production AI Analyze, Run Engine, Generate Docs, ZIP export, or repeated refresh loops during audits.
- Do not select `fileContent` in dashboard/list/panel queries.
- Avoid full `extractedText` in dashboard/list/status paths; use metadata, counts, or bounded samples.
- Load large content only for upload/extraction, analysis, preview, download, export, or targeted repair operations.
- Do not delete, truncate, migrate, or repair production data in audit-only PRs.
- Do not print `DATABASE_URL`, provider keys, SMTP secrets, session secrets, or token fragments.

## Hard product rules to preserve

- Tender documents define exact scope.
- Company vault defines factual evidence only.
- Generate only what the tender requires.
- Do not invent client data, deadlines, source pages, source quotes, experts, projects, legal records, financials, signatures, stamps, or evidence.
- Do not fake official tender forms.
- Do not weaken AI Analyze, Build Plan, Generate Docs, validation, evidence, manifest, or Final ZIP/export gates.
- Generate Docs must create zero `GeneratedDocument` rows before all generation gates pass.
- Final ZIP must exactly match the Final Package Manifest.
- Chat/workbench output must never enter Final ZIP automatically.
- Provider fallback order must remain: Gemini -> OpenAI -> Mistral -> Together -> DeepSeek -> Groq -> OpenRouter -> Anthropic.

## Token-saving full code-review checklist after PR #608 is resolved

Use this checklist only after PR #608 is merged or closed and `main` is synced.

### Runtime stability

- `/api/tenders/[id]` returns dashboard-safe payloads without raw DB errors.
- `GenerationReadinessPanel` catches route failures and never crashes tender detail SSR.
- `upload-first` handles malformed/unsupported files without leaking stack traces in production.
- `ai-jobs/run-next` handles stuck jobs and provider failure without duplicate generation.
- `pipeline-diagnostic` is auth-scoped, metadata-only, and safe for large tenders.

### Gate integrity

- Extraction gate runs before AI Analyze, Run Engine, Build Plan, Generate Docs, and Export.
- AI Analyze cannot silently pass regex fallback or corrupted extraction as confident.
- Metadata confirmation blocks generation/export when critical fields are missing or placeholders.
- Mandatory requirements require source traceability before final package readiness.
- Evidence coverage only promotes to `FULL`/`SUBSTANTIAL` through compliance matrix/source-traced confirmation.
- Build Plan must exist, be visible, and be confirmed when derived before final export.
- Generate Docs must create zero `GeneratedDocument` rows until all server gates pass.
- Final ZIP must equal Final Package Manifest and exclude control, draft, superseded, outside-plan, and official-original placeholder rows.

### Neon/storage/performance

- Dashboard/list/status routes do not select `fileContent`.
- Dashboard/list/status routes do not select full `extractedText` unless the route is explicitly an extraction/analysis workflow.
- `GeneratedDocument`, `AiJob`, `AiJobStep`, and `TenderCopilotMessage` retention is documented and bounded.
- Polling intervals are conservative and do not create repeated large reads.
- Storage-backed documents are read only for preview/download/export/validation, not list views.

### Code cleanup

- Identify dead components, unused routes, unused helpers, obsolete tests, stale comments, and duplicate gate logic.
- Review direct raw SQL for parameterization and bounded result shape.
- Replace unsafe `JSON.parse` on DB text fields with safe parsing helpers.
- Review duplicate export/manifest/readiness logic for canonical helper usage.
- Confirm provider order drift is covered by tests.
- Review auth/ownership on all tender, share, admin, cron, and download routes.
- Confirm chat history is never auto-exported.

## Deferred until PR #608 is resolved

- Generate gate content-page logic.
- Recovery Command Center scroll targets and action registry changes.
- `clientName` / `procuringEntityName` extractor fallback changes.
- Export mandatory evidence blocker changes.
- AI copilot gate warnings and tender chat context changes.
- Any direct edits to the PR #608 changed-file avoidance list above.

## Exact next action after PR #608 resolves

1. Sync latest `main`.
2. Re-run the PR #608 changed-file list against `main` to identify merged vs abandoned changes.
3. Run targeted searches for `fileContent: true`, `extractedText: true`, unsafe `JSON.parse`, duplicate readiness/generation/export gates, and provider-order drift.
4. Produce a severity-ranked code-review report.
5. Implement the first non-overlapping high-confidence fix in a small PR.
