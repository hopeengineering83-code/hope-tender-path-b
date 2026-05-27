# Claude Agent — Persistent Task Tracker
<!-- This file is the source-of-truth for any Claude Code session on this repo.
     Read it at the start of every session. Update it at the end of every session.
     Never delete it. -->

## App identity
- **Repo**: hopeengineering83-code/hope-tender-path-b
- **Production URL**: https://hope-tender-path-b.vercel.app
- **Stack**: Next.js 15.5 / React 19 / TypeScript 6 / Prisma 6.19.3 / PostgreSQL
- **AI providers**: Claude (primary) → Gemini → OpenAI → DeepSeek → deterministic fallback
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

### PR #473 — Universal submission engine hardening (merged 2026-05-27)
**REPLACE_WITH_ORIGINAL exclusion**
- `lib/engine/document-output-state.ts`: `isFinalExportCandidateDocument` now
  explicitly excludes `REPLACE_WITH_ORIGINAL` reviewStatus
- Tests: `tests/pricing-hygiene-extended.test.ts` — 2 regression assertions added

**Rate limit on GET /api/tenders**
- `app/api/tenders/route.ts`: `API_RATE_LIMIT` (300 req/min) applied per userId
  after session check; returns `429` with `Retry-After` header

**Pre-ZIP content check**
- `app/api/tenders/[id]/download/route.ts`: pre-loop check — documents with
  neither `fileContent` nor `storagePath` return `409 DOCUMENTS_MISSING_CONTENT`

**Company profile completeness bar**
- `app/dashboard/company/page.tsx`: 13-field completeness bar
  (≥80% green, ≥50% amber, <50% red)

**ComplianceGapsPanel**
- `app/dashboard/tenders/[id]/tender-detail.tsx`: CRITICAL/HIGH/MEDIUM/LOW
  severity badges, Resolve/Reopen toggle, visible error handling with dismiss
  banner, show-all toggle when gaps > 5

**DuplicateButton on tender list**
- `app/dashboard/tenders/page.tsx`: DuplicateButton in Action column

**New test files (all pass)**
- `tests/export-safety.test.ts` — 24 assertions
- `tests/auto-finalize-safety.test.ts` — 30 assertions
- `tests/rate-limit-safety.test.ts` — 10 assertions

---

### PR #474 — Remaining gaps (MERGED 2026-05-27)
Branch: `claude/relaxed-mendel-YHnOx` → merged to main as `d1b4fc2`

- Export Readiness Panel: Download Final ZIP button (enabled/disabled)
- Sector strategies: feasibility, government/public procurement, NGO/donor
- Submission plan envelope separation (`SubmissionEnvelope` type + `envelope` field)
- Test count after merge: **1161 pass / 0 fail**

---

### PR #475 — HIGH-priority gaps (open, Vercel building)
Branch: `claude/high-priority-gaps-post-474`

**ZIP envelope breakdown headers**
- `lib/engine/submission-plan.ts`: `inferEnvelope` exported (was private)
- `app/api/tenders/[id]/download/route.ts`: after ZIP assembly, compute
  envelope breakdown (TECHNICAL/FINANCIAL/ADMIN counts per doc type)
  - `X-Envelope-Breakdown: TECHNICAL=5,FINANCIAL=1,ADMIN=2` on every ZIP response
  - `X-Envelope-Note: ...` advisory header when FINANCIAL docs are present
  - Breakdown included in audit log description

**Browser tab title badge**
- `app/dashboard/tenders/[id]/tender-detail.tsx`:
  `useEffect` updates `document.title` in real-time as gaps are resolved:
  - `🚨 N critical — <title>` when CRITICAL gaps exist
  - `(N) <title>` when non-critical unresolved gaps exist
  - `<title>` when all gaps resolved
  - Restores `"Tenders"` on unmount

**Auto-finalize remaining-count nudge**
- `components/export-readiness-panel.tsx`:
  - `autoFinalizeRemaining` state tracks docs still needing finalization
  - Amber "N documents still need finalization — click Auto-finalize again"
    banner persists after each run until count reaches 0 or gate passes
  - Banner has a dismiss (✕) button; also auto-cleared when re-check shows
    no remaining document blockers

**Test count**: 1161 pass / 0 fail, typecheck clean

---

## Next actions queue (prioritised)

### IMMEDIATE
- [x] ~~Monitor PR #474 CI~~ — green, merged
- [x] ~~Merge PR #474~~ — merged as d1b4fc2
- [ ] Monitor PR #475 CI (Vercel build) — open

### HIGH — DONE in PR #475 (merged d598a65)
- [x] ZIP envelope breakdown headers + audit log
- [x] Browser tab title badge (🚨 / count / clear)
- [x] Auto-finalize remaining-count amber nudge banner

### MEDIUM — in progress (PR #476, branch claude/medium-priority-gaps-post-475)
- [x] Feasibility Study + NGO/Donor-Funded added to tender categories
- [x] Donor safeguard checklist in export readiness (ESMP, logframe, M&E)
- [x] Envelope badge (TECHNICAL/FINANCIAL/ADMIN) on submission plan table

### MEDIUM — DONE in PR #476
- [x] Feasibility Study + NGO/Donor-Funded in categories (`new/page.tsx`)
- [x] Donor safeguard blockers in `checkTenderLevelExportBlockers`
      (ESMP, logframe, M&E plan — MEDIUM severity, keyword-detected)
- [x] Envelope badge column in `submission-plan-reconciliation-panel.tsx`
      (blue=TECHNICAL, amber=FINANCIAL, slate=ADMIN)

### LOW / NICE-TO-HAVE (next)
- [ ] Add `AUTH_RATE_LIMIT` (10/min) export from `lib/rate-limit.ts` to the
  login route if not already applied
- [ ] Confirm `isInternalDraftDocument` is called before any document enters
  the compliance-gaps or export-readiness check (prevent internal drafts from
  surfacing as blockers)
- [ ] Add pagination to the compliance-gaps panel when a tender has > 20 gaps

---

## Key files reference (quick lookup)
| File | Purpose |
|---|---|
| `lib/engine/document-output-state.ts` | `isFinalExportCandidateDocument`, `filterFinalExportCandidateDocuments`, `isInternalDraftDocument` |
| `lib/engine/pricing-hygiene.ts` | `containsPricingLeakage`, `isSensitiveFinancialOrLegalDoc`, `isMixedTechnicalFinancialSentence` |
| `lib/engine/submission-plan.ts` | `buildSubmissionPlan`, `SubmissionPlanFile`, `SubmissionEnvelope` |
| `lib/engine/proposal-sections.ts` | AI system prompts for each proposal section |
| `lib/engine/universal-tender-taxonomy.ts` | Tender type classification (FEASIBILITY_STUDY, etc.) |
| `lib/rate-limit.ts` | `rateLimit`, `API_RATE_LIMIT`, `MUTATION_RATE_LIMIT`, `AI_RATE_LIMIT`, `AUTH_RATE_LIMIT` |
| `components/export-readiness-panel.tsx` | Export gate UI, Download ZIP button, action buttons |
| `app/api/tenders/[id]/download/route.ts` | ZIP assembly, pre-content-check |
| `app/api/tenders/[id]/auto-finalize/route.ts` | Auto-finalize: batch=3, skips sensitive docs |
| `app/api/tenders/[id]/export-readiness/route.ts` | Export gate checker |
| `app/dashboard/tenders/[id]/tender-detail.tsx` | ComplianceGapsPanel |
| `app/dashboard/company/page.tsx` | Company profile completeness bar |

## Test count baseline
- After PR #473 merge: **1148 pass**
- After PR #474 (current): **1161 pass**
- Never regress below the baseline at merge time

---

## How to resume in a new session
1. `Read CLAUDE_TASKS.md` — this file
2. `git log --oneline -10` to see recent commits
3. Check open PRs: look for any `claude/*` draft PRs not yet merged
4. Work the "IMMEDIATE" queue first, then HIGH, then MEDIUM
5. Update this file at the end of every session

_Last updated: 2026-05-27 by Claude after PR #476 push_
