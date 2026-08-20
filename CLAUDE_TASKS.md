# Claude Agent — Persistent Task Tracker
<!-- This file is the source-of-truth for any Claude Code session on this repo.
     Read it at the start of every session. Update it at the end of every session.
     Never delete it. -->

## App identity
- **Repo**: hopeengineering83-code/hope-tender-path-b
- **Production URL**: https://hope-tender-path-b.vercel.app
- **Stack**: Next.js 15.5 / React 19 / TypeScript 6 / Prisma 6.19.3 / PostgreSQL
- **AI providers**: STRICT ZERO-PAID. Automatic chain is Gemini → Groq → Mistral → Z.ai → OpenRouter (verified `:free` model only) → deterministic draft. Cerebras, OpenAI, Together, DeepSeek and Anthropic require paid access and are never contacted. Canonical order and policy in `lib/ai-provider-catalog.cjs`.
- **Deployment**: Vercel (auto-deploy on merge to main)

## Development branch rule
Always develop on the branch specified in the session's system-reminder
(`claude/<name>` pattern). Never push directly to main.
After pushing, always open a draft PR targeting main.

---

## Permanent security constraints (NEVER violate)
1. Do NOT hard-code Pharo, pharmaceutical, healthcare, or any single tender type.
2. Do NOT remove already merged work from any merged PR.
3. Do NOT rebuild the app from scratch.
4. Do NOT fake official documents.
5. Do NOT invent company evidence, experts, projects, certificates, contracts, dates,
   contract values, or client references.
6. Do NOT mark unsafe documents READY_FOR_EXPORT.
7. Do NOT include official-original placeholders in the final ZIP.
8. Do NOT include control / planned / superseded / not-exportable rows in final ZIP.
9. Never expose raw stack traces to the client in production.
10. Rate-limit hierarchy must remain: AUTH (10/min) < AI (20/min) < MUTATION (30/min)
    < API (300/min).

---

## What has been merged to main (do not re-do)

### PR #469 — Base engine
- 7-pass AI pipeline, Knowledge Vault, universal tender taxonomy, DOCX generation

### PR #470 — Product gaps batch 1
- Bid outcome badge, notifications pagination, dashboard stats, vault search,
  documents DELETE endpoint

### PR #473 — Universal submission engine hardening
- `isFinalExportCandidateDocument` excludes REPLACE_WITH_ORIGINAL reviewStatus
- Rate limit on GET /api/tenders (API_RATE_LIMIT 300 req/min)
- Pre-ZIP content check (409 DOCUMENTS_MISSING_CONTENT)
- Company profile completeness bar (13-field, ≥80% green)
- ComplianceGapsPanel CRITICAL/HIGH/MEDIUM/LOW severity badges
- DuplicateButton on tender list

### PR #474 — Remaining gaps (merged d1b4fc2)
- Export Readiness Panel: Download Final ZIP button (enabled/disabled)
- Sector strategies: feasibility, government/public procurement, NGO/donor
- Submission plan envelope separation (SubmissionEnvelope type + envelope field)

### PR #475 — HIGH-priority gaps (merged d598a65)
- ZIP envelope breakdown headers (X-Envelope-Breakdown, X-Envelope-Note)
- Browser tab title badge (🚨 critical / count / clear on unmount)
- Auto-finalize remaining-count amber nudge banner

### PR #476 — MEDIUM-priority gaps (merged e25abb4)
- Feasibility Study + NGO/Donor-Funded in tender categories
- Donor safeguard blockers in `checkTenderLevelExportBlockers` (ESMP, logframe, M&E)
- Envelope badge column in submission plan table (blue/amber/slate)

### PR #477 — LOW-priority gaps (merged)
- Compliance-gaps panel pagination (≤20 → show-all toggle; >20 → Prev/Next paged)

### PR #482 — Canonical readiness score UI + placeholder stripping (merged)
- Canonical readiness score widget in UI
- Bid-Team placeholder stripping in proposal output

### PR #484 — Seven-pass senior-quality generation gate (merged 50cdb5c)
- `lib/engine/seven-pass-generation.ts`: evaluateSevenPassGenerationGate()
- `lib/engine/document-quality-gate.ts`: assessGeneratedDocumentQuality()
- `lib/engine/analysis-source.ts`: detectAnalysisSource(), assertAnalysisReadyForFinalGeneration()
- `lib/engine/final-submission-readiness.ts`: canonical readiness summary
- `lib/engine/readiness-scoring.ts`: weighted readiness score with hard caps
- Analysis-source gate wired into generate/route.ts (blocks regex fallback)
- Bulk reassessment endpoint: POST /api/admin/generated-proposals/reassess
- AI provider health tracker: POST /api/admin/ai-provider-health
- Tests: seven-pass-generation, document-quality-gate, analysis-source-gate,
  final-submission-readiness, readiness-scoring-hard-caps, reassess-endpoint-contract,
  bid-team-placeholder-stripping, and more

### PR #485 — Wire seven-pass gate into finalization (merged ✅)
- `lib/engine/seven-pass-generation-wiring.ts` (NEW): adapter module
- `auto-finalize/route.ts`: seven-pass gate enforced
- `reassess/route.ts`: supplemental analysis-source check
- **1315 pass / 0 fail**

### PR #486 — Post-#485 gap fixes (open, CI green ✅)
Branch: `fix/seven-pass-wiring-self-review-and-donor-regex`
- selfReviewScore null sentinel (gate no longer blocks when score not provided)
- proposal-versions RBAC (DELETE+POST require ADMIN/PROPOSAL_MANAGER)
- export/page.tsx: allPassed accepts VALIDATED as well as PASSED
- export-readiness.ts: isDonorTender regex extended with ADB, JICA, bilateral donor
- **1315 pass / 0 fail**

### PR #489 — Wire real selfReviewScore into auto-finalize (merged ✅)
- `auto-finalize/route.ts`: calls `assessGeneratedDocumentQuality()` on cleaned text; passes `report.score` as `selfReviewScore` to `evaluateSevenPassForDocument()` so SELF_REVIEW_SCORING pass enforces ≥80 threshold instead of skipping with null
- **1339 pass / 0 fail**

### PR #492 — AI provider recovery and storage-backed document audit (merged ✅)
- `lib/ai.ts`: wire `recordProviderSuccess/Failure/isProviderCooledDown` into `generateWithFallback`; skip cooled-down providers
- `app/api/ai/health/route.ts`: add runtime health data + DeepSeek + cooldown warning
- `lib/engine/storage-backed-document-audit.ts` (NEW): read storagePath files, validate signatures, run quality gate, return flags only
- `app/api/admin/generated-proposals/audit/route.ts`: probe storagePath docs in bulk audit
- **1359 pass / 0 fail**

### PR #491 — Wire selfReviewScore + requirements into reassess; 4 new sectors (merged ✅)
- `reassess/route.ts`: batch-load requirements alongside notes; pass `requirements` to `assessGeneratedDocumentQuality()`; forward `report.score` as `selfReviewScore` to `buildSevenPassGateInput()` so SELF_REVIEW_SCORING threshold enforced in reassess path
- `seven-pass-generation-wiring.ts`: add EDUCATION, WATER_SANITATION, HEALTH_SERVICES, ENERGY sectors (4 new tests)
- **1350 pass / 0 fail**

### PR #490 — Industry-sector mismatch detection in tenderScopeOnly (merged ✅)
- `lib/engine/seven-pass-generation-wiring.ts`: `detectTenderScopeOnly()` extended with `detectIndustrySectorMismatch()` — 6 sector fingerprints (PHARMA, CONSTRUCTION, OIL_GAS, IT_SYSTEMS, AGRICULTURE); requires ≥2 hits in both tender notes and doc text before flagging; conservative by design
- 7 new tests in `seven-pass-generation-wiring.test.ts`
- **1346 pass / 0 fail**

### PR #487 — Blocked-readiness recovery and document classification (merged ✅)
Branch: `claude/relaxed-mendel-YHnOx`
- `lib/engine/document-type-normalizer.ts` (NEW)
- `lib/engine/document-quality-gate.ts`: document-type-aware gating
- `app/api/tenders/[id]/reclassify-documents/route.ts` (NEW)
- `app/api/tenders/[id]/deduplicate-documents/route.ts` (NEW)
- `components/export-readiness-panel.tsx`: retry AI analysis, approve fallback, source grounding, reclassify, dedup, historical row count
- `lib/engine/final-submission-readiness.ts`: ungeneratedPlannedRequired + missingCriticalMetadataFields
- `components/canonical-readiness-score-widget.tsx`: shows planned-doc gap
- **1330 pass / 0 fail** (15 new tests)

---

## Next actions queue (prioritised)

### IMMEDIATE
- (none)

### REMAINING KNOWN GAPS
- (none — all known gaps resolved)

---

## Key files reference (quick lookup)
| File | Purpose |
|---|---|
| `lib/engine/document-output-state.ts` | `isFinalExportCandidateDocument`, `filterFinalExportCandidateDocuments` |
| `lib/engine/pricing-hygiene.ts` | `containsPricingLeakage`, `isSensitiveFinancialOrLegalDoc` |
| `lib/engine/submission-plan.ts` | `buildSubmissionPlan`, `SubmissionPlanFile`, `SubmissionEnvelope` |
| `lib/engine/seven-pass-generation.ts` | `evaluateSevenPassGenerationGate`, `sevenPassBlocksFinalApproval` |
| `lib/engine/seven-pass-generation-wiring.ts` | Adapter: `buildSevenPassGateInput`, `evaluateSevenPassForDocument` |
| `lib/engine/document-quality-gate.ts` | `assessGeneratedDocumentQuality` |
| `lib/engine/analysis-source.ts` | `detectAnalysisSource`, `assertAnalysisReadyForFinalGeneration` |
| `lib/engine/final-submission-readiness.ts` | Canonical readiness summary |
| `lib/engine/export-readiness.ts` | `checkFullExportReadiness`, `documentHygieneIssues` |
| `lib/rate-limit.ts` | `rateLimit`, `API_RATE_LIMIT`, `MUTATION_RATE_LIMIT`, `AI_RATE_LIMIT`, `AUTH_RATE_LIMIT` |
| `components/export-readiness-panel.tsx` | Export gate UI, Download ZIP button |
| `app/api/tenders/[id]/download/route.ts` | ZIP assembly, envelope headers |
| `app/api/tenders/[id]/auto-finalize/route.ts` | Auto-finalize + seven-pass gate |
| `app/api/tenders/[id]/generate/route.ts` | Generation route + analysis-source gate |
| `app/api/admin/generated-proposals/reassess/route.ts` | Bulk reassessment + seven-pass |

## Test count baseline
- After PR #473 merge: **1148 pass**
- After PR #474 merge: **1161 pass**
- After PR #484 merge: **~1290 pass** (many new test files added)
- After PR #485 merge: **1315 pass / 0 fail**
- After PR #486 (pending): **1315 pass / 0 fail**
- After PR #487 (merged): **1330 pass / 0 fail** (+15 new tests)
- After PR #489 (merged): **1339 pass / 0 fail**
- After PR #490 (merged): **1346 pass / 0 fail**
- After PR #491 (merged): **1350 pass / 0 fail**
- Never regress below the baseline at merge time

---

## How to resume in a new session
1. `Read CLAUDE_TASKS.md` — this file
2. `git fetch origin && git checkout main && git pull origin main`
3. `git log --oneline -10` to see recent commits
4. Check open PRs: look for any `claude/*` or `chatgpt/*` draft PRs not yet merged
5. Work the "IMMEDIATE" queue first
6. Update this file at the end of every session

_Last updated: 2026-05-28 by Claude after PR #492 merge — all known gaps resolved; test baseline 1359 pass / 0 fail_
