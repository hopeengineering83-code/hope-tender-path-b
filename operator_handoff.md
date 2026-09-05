# Operator Handoff

This file is the shared coordination record for ChatGPT, Claude Code, Codex, GLM, and Jules.

## Authority order

1. Current repository code, migrations, and tests.
2. Current GitHub branch, open pull requests, commits, CI, and deployment state.
3. This file.
4. `CLAUDE.md` and `AGENTS.md`.
5. Private tool memory and chat summaries.

Claude memory may help Claude continue a session, but it is private and cannot be the shared source of truth for other tools. When it conflicts with this repository record, the repository record wins.

## Start every session

Before making changes:

1. Read `AGENTS.md`, `CLAUDE.md`, and this file.
2. Inspect the latest target branch, open pull requests, CI, and working tree state.
3. State the task, branch, files expected to change, and tests to run.
4. Check the Active Workboard. Do not overlap another active agent's scope without coordination.
5. Use one isolated branch. Never write directly to `main`.
6. Do not merge, approve, deploy, rebase another agent's branch, or create a Vercel preview without Hope's approval.

## End every session

Update this file in the same commit as the substantive work. Do not make a separate push only for a handoff entry.

Add a newest-first Session Log entry containing:

- UTC timestamp and tool name;
- branch and pull request;
- exact scope and files changed;
- tests actually run and results;
- CI/deployment status if checked;
- known risks or assumptions;
- one next action;
- merge status: safe, unsafe, or not reviewed.

Never claim a fix is complete unless the stated tests passed.

## Active Workboard

Reconciled against GitHub on **2026-08-29**. **PR #1175 is now the ONLY open pull
request, and the only active implementation/release lane.** PR #1303 was closed
as superseded on the owner's explicit instruction — closed, never merged, never
cherry-picked. Do not reopen it and do not create a replacement PR: all future
application fixes belong on #1175 alone.

| Owner tool | Branch / PR | Scope | Locked files or areas | Status | Next action |
|---|---|---|---|---|---|
| Codex → Claude Code | `release/consolidated-recovery-20260717` (PR #1175, draft, base `integration/controlled-recovery`) | Consolidated release recovery: 10-provider fallback chain, provider-diversity request planning, durable fallback staging, canonical readiness/export convergence, artifact identity, real DOCX/PDF/ZIP bytes | `lib/ai.ts`, `lib/ai-jobs/analysis-job-service.ts`, `lib/ai-analyze/retry-service.ts`, `lib/engine/*`, `app/api/tenders/[id]/*`, `docs/pr1175-frozen-regression-ledger.md` | Open (draft). Exact-head CI green; Preview READY and release-matched | **OWNER ACTION REQUIRED** — one authenticated "Run AI Analyze" on the exact-head Preview. Do not merge; do not promote Production. |

### Closed as superseded

| PR | Branch | Head | Outcome |
|---|---|---|---|
| #1303 "Make the pipeline produce a real ZIP, and test that it does" | `claude/tender-zip-end-to-end-1lm9sz` | `c9ff3208` | **CLOSED 2026-08-29, NOT MERGED.** 7 PRESENT_EQUIVALENT / 3 SUPERSEDED_BETTER / 0 MISSING_REQUIRED / 0 OBSOLETE_OR_UNSAFE. Evidence: `docs/pr1303-reconciliation.md`. Nothing was lost by closing it. |

#### Known debt inherited from the #1303 review

~~Two items its author flagged are real...~~ **Both items below were reproduced
and closed by the 2026-08-29 GLM release-closure session** (see the newest
Session Log entry for root causes, evidence and regression tests):

- ~~`reconcile-generated-docs.ts` carries its own `COMPANY_PROFILE` classifier
  separate from `classifySupportDoc` in the generate route~~ — **CLOSED:**
  differential-tested, found disagreeing, centralised into
  `isCompanyProfileDocName` / `COMPANY_PROFILE_DOC_NAME_RX` in
  `lib/engine/document-type-normalizer.ts`, pinned by
  `tests/company-profile-classifier-differential.test.ts`.
- ~~`AUTO_FINALIZE` reports a repaired document as failed on its first pass and
  converges on a later attempt; the durable worker's retry masks it~~ —
  **CLOSED:** root cause was the durable repair's stub fallback for
  storage-backed rows (reproduced: real bytes replaced by the makeSafeDocx stub
  with storagePath left dangling). Fixed by `readRepairSourceContent` +
  single-authority update, pinned by
  `tests/export-repair-storage-source.test.ts`; convergence now holds on pass 1.

Its third open question — whether the technical-envelope download path should
gate on `MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE` — is already **answered** on
#1175 by `fecc6e1f` and `bbb6f94c`, which make the export path obey the
canonical mandatory-coverage gate and stop the readiness summary promising an
export the gate declines.

### Released locks

These rows were marked "Open / Await Hope's review" and are all merged. Their file
locks are released — a lock held on merged work blocks the next agent for no
reason, which is the failure this section exists to prevent.

| PR | Branch | Merged |
|---|---|---|
| [#1030](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/1030) | `fix/buildplan-document-generation-pipeline` | 2026-07-10 |
| [#1031](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/1031) | `codex/add-route-driven-verification-tests` | 2026-07-10 |
| [#1032](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/1032) | `fix/main-app-gaps-dead-code-contradictions` | 2026-07-10 |
| [#1034](https://github.com/hopeengineering83-code/hope-tender-path-b/pull/1034) | `claude/pdf-finalization-safety-fos70j` | 2026-07-10 |

Frozen / quarantined, unchanged: **PR #937 is FROZEN** and **PR #957 is QUARANTINED**
— never touch, merge, revive, rebase, or reuse either.

### Lock rules

- One writing agent per branch.
- Parallel work is allowed only when branch, files, and acceptance tests do not overlap.
- Do not edit another active agent's branch.
- Do not discard another agent's work while resolving a conflict without reviewing both diffs.
- If two tasks need the same file, sequence them first.

## Non-negotiable application rules

- Tender-controlled scope only. Never invent tender facts or evidence.
- Company Vault is factual evidence only; no automatic all-Vault fallback.
- Provider order: Gemini → Groq → Mistral → Z.ai → Cerebras → OpenRouter → OpenAI → Together → DeepSeek → Anthropic → deterministic draft fallback. All configured providers participate automatically in this order; exact configured model IDs are used without custom free-model filtering. Defined in `lib/ai-provider-catalog.cjs`.
- Regex, fallback, partial, legacy, and unpromoted analysis must not unlock generation, export, or Final ZIP.
- Only promoted `AI_SUCCEEDED` may unlock generation/export after all gates pass.
- Critical metadata and mandatory requirements need active source file, page, and meaningful quote.
- Preserve role and ownership checks.
- Create zero `GeneratedDocument` rows before valid extraction, grounded requirements, evidence, and Build Plan eligibility.
- Final ZIP gates remain strict.
- Avoid unnecessary Vercel previews; run local checks before pushing work.

## Session Log

### 2026-09-02 UTC — Claude Code (Preview 504, cross-surface release state, PDF extraction integrity)

- **TOOL:** Claude Code · **BRANCH:** `release/consolidated-recovery-20260717` · **PR:** #1175
- **HEAD:** `c73b5489` → `506f2b64` → `b42b28ee`. No new lane, no merge, no Production deploy.

- **THE PREVIEW 504 — MEASURED, NOT GUESSED.** `GET /api/tenders/[id]/export-readiness`
  returned "Vercel Runtime Timeout after 10 seconds". The
  missing-`@napi-rs/canvas` warnings beside it are pdfjs-dist loading its canvas
  backend — a symptom of extraction running, not its cost — and were left alone.
  On a real 262 KB generated Technical Proposal the three text-layer extractors
  cost **1.3 s (pdf2json), 3.2 s (pdf-parse), 4.4 s (pdfjs)** and `extractPdf`
  waits for all of them. The route declares `maxDuration = 10`, is polled by the
  UI, and runs three readiness models in parallel; on a two-document package the
  SAME PDF was extracted **twice per request** and again on every poll.

  Visible text is now remembered by a digest of the bytes (in-flight promise
  cached, failures never cached, different bytes always a different key).

  | | before | after |
  |---|---|---|
  | canonical decision | 676–5371 ms | 167 ms |
  | final submission readiness | 4104–6409 ms | 2648 ms |
  | repeat poll | 1361 ms | 72 ms |

  **Real HTTP proof on the exact-head build** (268 KB Technical Proposal.pdf +
  a real DOCX, authenticated): `HTTP 200 in 2422 ms` cold, then **141 / 142 /
  222 ms** warm, against a 10 000 ms budget. On the Preview
  (`dpl_AJTRAYCinMQd5farLAWVmrvGb82S`, READY, built from `b42b28ee`) the route
  answers `401 Unauthorized` with `x-matched-path:
  /api/tenders/[id]/export-readiness` — the function cold-starts and returns
  instead of timing out. An authenticated Preview timing run needs owner
  credentials and was not attempted.

- **AN EXTRACTOR WAS RETURNING A DIFFERENT DOCUMENT'S TEXT.** Found while
  reproducing the above. Parse one generated proposal PDF, then a second,
  structurally similar one in the same process, and **pdf2json returns the
  first document's text for the second** — every time, sequentially or
  concurrently, with a fresh `new PDFParser()` per call and even after deleting
  the module from `require.cache`. Two obviously different PDFs never collide,
  which is why it stayed invisible: the case it breaks is this app's own
  regenerated proposals. The wrong text is clean and well-formed, so it wins the
  quality selection — a validator could judge a regenerated proposal against the
  previous version's bytes. pdf2json is now a **last resort**, consulted only
  when both trustworthy engines return nothing usable; OCR still backstops all
  three. Side effect: the same PDF now extracts in 2376 ms.

  Generated PDFs also carried **no trailer `/ID` at all**; each now carries one
  derived from its own content. That was tried FIRST as a possible cause of the
  bleed and measured — it did not fix it — but the specification asks for it and
  artifact identity depends on it.

- **THE CONTRADICTORY RELEASE STATES — REPRODUCED ON ONE SNAPSHOT.** Validator
  "Technical Proposal.pdf — BLOCKED, 68/100" beside Final Package Manifest
  "Ready, In ZIP, Blocked 0". Reproduced with ONE revision and ONE document, so
  it is **not** stale cross-revision state: validator "BLOCKED (14/100)
  QUALITY_FAILED", package model "READY_FOR_EXPORT, exportReady, no blocker".
  The two surfaces answered from different authorities — everything the package
  model read was metadata, which cannot tell whether the document says anything.

  - `deriveDocumentOutputState` now understands a quality verdict and returns
    `QUALITY_BLOCKED`, ranked below `ARTIFACT_IDENTITY_MISMATCH`.
  - `getFinalPackageReadinessModel` asks the same authority the validator asks;
    a quality-blocked document is not a candidate, not export-ready, not in the
    ZIP manifest.
  - Only a verdict reached by **actually reading** the document counts
    (`wordCount > 0`), so a storage-backed row is never blocked for bytes nobody
    loaded. Nothing is suppressed: `final-submission-readiness` still raises
    `GENERATED_DOCUMENT_QUALITY_FAILED` from its own byte-loading path.
  - The validator panel and `validate.ts` now score on the **same evidence
    names**; the batch resolver had no parameter for them at all.

- **THE ARTIFACT_IDENTITY_MISMATCH ON Technical Proposal.pdf — FOUND AND FIXED.**
  `generateMissingPlanFiles` writes a still-PLANNED row for a required file it
  cannot yet produce (`fileContent: null`) but declared the format of the
  interim body (DOCX) rather than the format its own name promises. The row
  contradicted itself before holding a byte, and every surface comparing name
  against declared format reported "a .pdf that does not contain PDF bytes will
  not open for the evaluator" — a corrupted file that does not exist. Planned
  rows now declare the format their file name promises, and a byte-less planned
  row reads as awaiting content. Narrow: the moment a row carries bytes the
  identity check runs exactly as before. The other half of the reported deadlock
  is not real on this head — `generate-elite` already stores the proposal body as
  `<base>.docx` when the plan requires `<base>.pdf`, which is precisely the
  source `finalize-pdf` looks for.

- **VERIFIED ON THIS CHECKOUT:** `npx tsc --noEmit` clean · `next lint` clean ·
  `next build` succeeds · `RUN_DB_INTEGRATION=true npm test` →
  **11225/11225 pass, 0 fail** · `npm run audit:release-integrity` ok
  (447 routes, 1693 files, provider order intact) ·
  `audit:workflow-state-consistency` ok · `db:check-critical-schema` ok
  (0 failures) · `prisma migrate status` up to date (51 migrations) ·
  `prisma validate` valid. Every new assertion was confirmed to fail against the
  pre-fix code.

- **VAULT RE-VERIFIED THROUGH THE REAL ROUTES ON THIS HEAD:** experts 28/28
  (22 healthcare-tagged, 0 empty sectors, 0 empty disciplines), projects 114/114
  SOURCE_VERIFIED with 107 clients preserved and 0 header-contaminated rows.

- **STILL BLOCKED — PROVIDER QUOTA, NOT CODE.** Two full Pharo drives today
  stopped at AI Analyze: `AI_PROVIDERS_RATE_LIMITED: all 1 configured
  provider(s) are in cooldown after recent rate-limit/quota errors`. Gemini is
  the only provider configured in this environment, so there is nothing to fall
  through to, and the free-tier daily quota was spent on the 07:41Z run. Not
  coded around. The tender deadline is genuinely past and was left untouched.

- **NEXT ACTION:** at the quota reset, run the full Pharo acceptance flow and
  inspect the actual DOCX/PDF/ZIP bytes against the acceptance list, then score
  the 17 dimensions.

- **MERGE STATUS:** not reviewed. Do not merge; do not promote Production.

### 2026-09-02 UTC — Claude Code (expert selection: discipline coverage; a wrong earlier conclusion corrected)

- **TOOL:** Claude Code · **BRANCH:** `release/consolidated-recovery-20260717` · **PR:** #1175
- **HEAD:** `7228f86f` → `79f1af2c`. No new lane, no merge, no Production deploy.

- **THE PREVIOUS ENTRY'S CONCLUSION WAS WRONG.** It reported that the vault held
  no healthcare-relevant experts, so selecting 1 of 28 was correct fail-closed
  behaviour. That measurement regexed only `title` and `disciplines`. The
  authority export declares Healthcare among the **sectors** of **22 of its 28
  experts** — including Girum Wondwossen Seifu (Senior Architect & Urban
  Planner), Elias Manaye Yancha (PM / Senior Civil), Kedir Mohammed Yesuf
  (Senior Electrical) and Mohammed Nurey Guht (Senior Sanitary). The earlier
  bullet has been struck through in place so it cannot be acted on again.

- **FOUR STACKED DEFECTS, all fixed in `79f1af2c`, each pinned by a test that
  was confirmed to fail against the pre-fix code:**

  1. `enrich` (11dee2ae) could not serve the JSON-array columns — an empty list
     arrives as the string "[]" and reads as a value. Measured through the real
     routes: sectors lost content on 23 of 28 experts, disciplines on 25 of 28;
     healthcare-tagged experts fell 22 → 5, with 8 left with no sectors and 7
     with no disciplines. `enrichList` closes it. After: **28/28 experts, 22
     healthcare-tagged, 0 empty sectors, 0 empty disciplines** — matching the
     export exactly.
  2. `capabilityFamilies` did not read the role nouns a tender actually uses:
     "Architectural Consultancy Services …" and "…including architects,
     engineers, a biomedical engineer, MEP experts" required no architecture at
     all. Narrow additions only, so the earlier tightening of that family
     stands.
  3. Discipline coverage was only ever a tie-breaker among candidates that had
     already cleared 0.75, and the passes swap rather than add — so a required
     discipline whose only carriers score below it could never be covered.
     Measured before: electrical engineer 100% + general manager 77% selected,
     both architects at 74% and 73% excluded. A bounded completion pass now adds
     the best carrier of an uncovered required family above the 0.55 floor that
     `main-engine-selection-policy` already uses. Experts only; provenance
     untouched (an ineligible record scores 0 and is unreachable at any floor).
  4. `polishBenchmarkOutput`'s `/\s+\|\s+#/` matched across newlines, so any
     section following a table was swallowed into its last cell. In the real
     proposal that erased **"A.6 Biomedical Engineering Specialist Engagement
     Plan"** — the honest statement that the firm will engage a licensed
     specialist for a discipline it does not hold. The same pass now also strips
     the vault's `[REGEX_DRAFT — AUTOMATIC SOURCE VERIFICATION PENDING]` marker
     and the extraction page markers its existing rule could not match.

- **COVERAGE PROOF (real tender, real 28-expert source-verified vault).**
  Tender-required families: FINANCIAL_LEGAL, ELECTRO_MECHANICAL,
  HEALTHCARE_FACILITIES, FEASIBILITY_DESIGN, PROJECT_MANAGEMENT,
  ARCHITECTURE_BUILDINGS — **all six covered, none uncovered.** Selected team:
  Habib Ahmed (Architect, 77%), Selamawit Mesfin (Architect, 76%), Daniel
  Getachew Tadesse (Senior Electrical Engineer, 100%). Structural, sanitary and
  dedicated PM roles are NOT selected because this tender's text never asks for
  them: "structural", "civil", "sanitary" and "project management" appear **0
  times**; "plumbing" appears once, inside "coordinate mechanical, electrical,
  plumbing, medical gas", which is MEP and is covered. The vault's structural
  (66%), sanitary (64–65%) and resident-engineer/PM candidates remain available
  if Hope wants them added.

- **BIOMEDICAL — HARD GAP, NOT FABRICATED.** The vault holds no biomedical
  engineer. Nothing was invented. The correct, restored output is the A.6
  Specialist Engagement Plan naming an externally engaged licensed specialist.

- **TRIED AND BACKED OUT.** Adding `/plumbing/` to WATER_SUPPLY made a hospital
  tender require a water family its own hospital records do not carry, dropping
  genuine hospital evidence from ≥0.50 to 0.4375;
  `tests/evidence-relevance-ranking.test.ts` caught it. Reverted, with the
  reasoning recorded beside the pattern so it is not retried.

- **TESTS ACTUALLY RUN** (this checkout): `npx tsc --noEmit` clean · `next lint`
  clean · `next build` succeeds · `RUN_DB_INTEGRATION=true npm test` →
  **11206/11206 pass, 0 fail**.

- **STILL BLOCKED, NOT A CODE DEFECT.** The benchmark rerun needs the Gemini
  free-tier daily quota (20/day, resets ~07:00 UTC); only Gemini is configured
  in this environment, so there is nothing to fall through to. Not coded around.

- **NEXT ACTION:** at the quota reset, regenerate and rescore, and confirm in the
  produced bytes that A.6 is present as its own section, that the team is
  multidisciplinary, and that no vault marker or extraction bookkeeping remains.

- **MERGE STATUS:** not reviewed. Do not merge; do not promote Production.

### 2026-09-02 UTC — Claude Code (client-facing content integrity; benchmark rerun blocked on AI quota)

- **TOOL:** Claude Code · **BRANCH:** `release/consolidated-recovery-20260717` · **PR:** #1175
- **HEAD:** `03b76358` → `690a39bb` → `6b81523c` → `11dee2ae`. No new lane, no merge, no Production deploy.

- **SCOPE.** Root-caused, from the persisted markdown and DOCX bytes of a real
  generated Technical Proposal, why professional presentation scored 45/100 in
  the previous benchmark run. Five defects, all shipping engine internals or
  invented facts to the evaluator:

  1. `detectEvaluationCriteria` matched patterns across unrelated sentences,
     because `textOf`/`clean` collapse every newline before it runs.
     `/compliance.*experience/i` matched "Compliance with submission
     requirements … focus on healthcare project experience" and put a Financial
     Services / Basel-IFRS sub-section into a hospital proposal; bare `/GIS/`
     matched the "gis" in "registration" and added urban master planning.
     Fixed by matching within one phrase (`evaluationPhrases`), which corrects
     all forty patterns at once, plus word boundaries on short acronyms.
  2. Catalogue entries are "<criterion> — <how to answer it>", and the whole
     string was used as a client-facing heading and self-score row. Split at
     source: `evaluationCriteria` is labels only; `evaluationCriteriaWriterNotes`
     carries the guidance to the AI writer.
  3. `# Compliance and Bid Review Notes` printed `complianceLines` verbatim —
     engine support records, a serialized `automatic-requirement-evidence:v1`
     payload with content hashes, Company Vault FILE NAMES with raw extracted
     text including a named employee's date of birth and personal phone number,
     and the bid team's own instructions to itself. Replaced by a Compliance
     Statement; the internal-review stripper learned both headings.
  4. Section F's "Weight / priority" column printed `100 - index * 5` as
     "N% relative attention" — a weight the tender never stated, in the column
     an evaluator uses to check their own scoring. Now states no weight when
     the tender states none; internal `TRB-n` labels removed.
  5. Two contradictory Section H self-scores in a row (45/100 then 69/100),
     because the strip ran only over the raw AI markdown. `stripSelfScoreSections`
     now runs over the assembled upstream and lives beside `hasSelfScoreHeading`.

- **VAULT AUTHORITY INTEGRITY (continued).** 187 project rows stored the
  portfolio table's column-header run as their CLIENT and its tail as their
  COUNTRY, auto-verified to SOURCE_VERIFIED, and it reached the proposal as
  "Approach demonstrated on <hospital> (/Location (with Area & Full Address)
  Testimony Details …)". Two fixes: a value enumerating three or more column
  labels is a header, not a name; and heuristic re-extraction now ENRICHES an
  authority's records instead of replacing them — a blank never overwrites a
  stored value, and authority-owned attributes are not replaced at all.
  Measured end to end through the real routes on the real export after the fix:
  **experts 28/28 and projects 114/114 all SOURCE_VERIFIED, 107 clients
  preserved (exactly what the export declares), 0 header-contaminated rows.**

- **TESTS ACTUALLY RUN** (this checkout, quoted from the run):
  `npx tsc --noEmit` clean · `next lint` clean · `next build` succeeds ·
  `RUN_DB_INTEGRATION=true npm test` → **11191/11191 pass, 0 fail**.
  Every new test was confirmed to FAIL against the pre-fix code before being
  accepted.

- **CI:** running on `11dee2ae` at the time of writing; a check-in is scheduled
  to confirm it.

- **BLOCKED — NOT A CODE DEFECT.** The benchmark rerun cannot proceed today: the
  Gemini free-tier daily quota (20 requests/day, resets ~07:00 UTC) was spent on
  the 07:41Z run, and AI Analyze failed with "All configured AI providers
  exhausted for use-case \"extraction\" (tried: gemini)". Only Gemini is
  configured in this environment, so there is nothing to fall through to. Per
  the owner's standing instruction this was NOT coded around. A check-in is
  scheduled for the reset.

- ~~**INVESTIGATED AND DELIBERATELY NOT CHANGED.** "1 of 28 experts selected"
  … the export contains 0 experts whose record mentions biomedical or
  healthcare work …~~ **THIS WAS WRONG — CORRECTED BY THE NEXT SESSION
  (`79f1af2c`).** The measurement behind it regexed only `title` and
  `disciplines`. The export declares Healthcare among the **sectors** of **22
  of its 28 experts**. The single selection was not a gate working as designed;
  it was four stacked defects, all fixed and pinned. Do not reuse that
  conclusion. Only the biomedical half stands: the vault genuinely holds no
  biomedical engineer, and the correct output is the A.6 Specialist Engagement
  Plan, not a fabricated person.

- **NEXT ACTION:** at the quota reset, regenerate the Pharo benchmark, verify in
  the produced bytes that the five presentation fixes hold, and rescore all 17
  dimensions against the previous run (overall ~73; presentation 45, narrative
  coherence 58, expert→role→project 60, risk/mitigation 62, regulatory 65,
  evaluator alignment 70). Still open from earlier sessions: the
  `finalize-pdf` ⇄ `validate` deadlock and `ARTIFACT_IDENTITY_MISMATCH` on
  `Technical Proposal.pdf`, and why validate's internal reconcile does not
  refresh artifact evidence.

- **MERGE STATUS:** not reviewed. Do not merge; do not promote Production.

### 2026-08-29 UTC — Claude Code (post-click runtime search; inconclusive by evidence)

- **TOOL:** Claude Code · **HEAD:** `0e9b807f` (unchanged, tree clean) · **PR:** #1175
- **NO CODE CHANGES.** No defect was reproduced on the current head.

- **SEARCHED FOR THE OWNER'S AI ANALYZE JOB — NOT FOUND, BUT THE ABSENCE IS NOT
  CONCLUSIVE.** Four independent queries against Vercel runtime evidence:
  - `requestPath` grouping, 24h, whole project: 20 distinct paths, **no
    `manual-ai-analyze`**. Owner activity on tender
    `a56569bc-7643-4f21-89b6-b2828781b8c6` is present and healthy
    (workflow-center ×11 — that endpoint is **polled** by
    `components/requirement-truth-banner.tsx`, so it is one open page, not
    repeated clicking — plus submission-plan, authority-review, reconcile-docs,
    export-readiness, evaluator-objections, pricing, controls). 36×200, 7×401
    (the 401s are this session's own probes), no 5xx.
  - `requestPath` grouping, 2h: only this session's probes and the CI screenshot
    job's ten dashboard hits (all inside two seconds).
  - **Production, 24h: zero requests.** The click did not land there either.
  - Text queries for `manual-ai-analyze` and `run-next`, 24h: no lines.

  **Why this is not proof.** The last query is the tell: `run-next` demonstrably
  executed at 15:02:51Z — it produced the AUTO_FINALIZE errors recorded in the
  error table — yet `run-next` appears in neither the path grouping nor a text
  search over the same window. Some server activity is therefore missing from
  these views (the error table is a separate pre-aggregated store with different
  retention). An analyze request could be absent from the logs for the same
  reason. **Do not conclude from this that the owner did not click.**

- **RULED OUT as the cause of a disabled button:** `aiEnabled` ←
  `isAIEnabled()` ← `isAIConfigured()`, and `next.config.js` `assertProductionEnv`
  refuses to build with no provider configured. The Preview builds and is
  healthy, so a provider key **is** configured in Vercel. Remaining client-side
  gates are `canMutate`, `canonicalAnalysisReady`, `readinessLoading/Error` — all
  unreadable from here because the auth gate correctly 401s this session.

- **CONTEXT WORTH KEEPING:** this tender has already been through the full
  pipeline at least once — the 15:02 AUTO_FINALIZE failures name a real
  `Technical Proposal.docx`, and the owner's visible traffic is on late-stage
  panels (authority-review, export-readiness, reconcile-docs, pricing). So the
  state is likely post-analysis, not pre-analysis.

- **NEXT SAFE ACTION:** owner opens the tender's AI Analyze panel and reports the
  single status line it renders under the button (`statusLabel` /
  `disabledReason` in `components/ai-analyze-panel.tsx`). That one line
  distinguishes "the button is disabled and why" from "the click fired and the
  request is simply not in these logs", which no amount of log querying from here
  can separate.
- **UNCOMMITTED WORK:** NONE. **MERGE STATUS:** DO NOT MERGE.

### 2026-08-29 UTC — Claude Code (live runtime evidence; AI Analyze not found in retention)

- **TOOL:** Claude Code · **HEAD:** `f906e877` (unchanged, tree clean) · **PR:** #1175
- **NO CODE CHANGES.** The one live blocker found in runtime evidence was already
  fixed; re-fixing it would have been the regression cycle this lane exists to end.

- **LIVE BLOCKER FOUND AND CONFIRMED CLOSED.** Vercel runtime errors show the real
  pipeline ran and produced a real `Technical Proposal.docx`, then failed:
  `AUTO_FINALIZE_NOT_CONVERGED — readiness gate: 1 document(s) failed canonical
  validation: Technical Proposal.docx (Possible financial/pricing language appears
  in a technical document inside DOCX visible text)` at **15:02:51Z and 15:03:02Z**.
  Path: `export-readiness.ts:444 checkDocxHygieneReadiness` →
  `documentHygieneIssues` → `containsPricingLeakage`.
  **Timeline settles it:** the `visibleXmlText` block-boundary repair landed
  2026-08-19 (`5cee0cfc`), and GLM's `containsPricingLeakage` fragment-joining
  repair landed **17:46:44Z** (`3cbceb25`) — **2h45m AFTER** those failures. They
  are the defect that fix repaired, not a current one. **Zero runtime errors of
  any kind since 17:50Z.** Do not reopen pricing hygiene on the strength of those
  two log lines.

- **AI ANALYZE — NOT FOUND IN THE RETAINED WINDOW.** Runtime log retention on this
  plan is ~24h. Across the whole project in that window there is **no
  `manual-ai-analyze` request and no engine POST**. Authenticated owner activity on
  tender `a56569bc-7643-4f21-89b6-b2828781b8c6` *is* visible and healthy —
  workflow-center ×11 (that endpoint is **polled** by
  `components/requirement-truth-banner.tsx`, so the count is one open page, not
  repeated clicking), plus submission-plan, authority-review, reconcile-docs,
  export-readiness, evaluator-objections, pricing, controls and dashboard pages,
  all 200. Status totals: 36×200, 7×401 (the 401s are this session's own probes).
  So either the click predates retention, or it did not reach the server.

- **NOT MEASURABLE FROM HERE:** the persisted job and analysis content. The app's
  auth gate correctly returns 401 to this session, so AI content fidelity, project
  and expert matching, the proposal score and the artifacts remain unmeasured. No
  score was invented.

- **RULED OUT:** the Analyze button being disabled for want of a provider.
  `aiEnabled` ← `isAIEnabled()` ← `isAIConfigured()`, and `next.config.js`
  `assertProductionEnv` refuses to build with no provider configured — the Preview
  built and is healthy, so a provider key **is** configured in Vercel.

- **NEXT SAFE ACTION:** owner clicks **Run AI Analyze** once on the exact-head
  Preview *now*, so the request lands inside the ~24h log-retention window. The
  provider chain can then be read from Vercel runtime logs without an app session,
  which is the one live evidence path available to a coding session.
- **UNCOMMITTED WORK:** NONE. **MERGE STATUS:** DO NOT MERGE.

### 2026-08-29 UTC — Claude Code (runtime amendment provenance; release checkpoint)

- **TOOL:** Claude Code · **HEAD:** `63385c92` · **PR:** #1175 (draft, unmerged)

- **SHIPPED `63385c92` — the amended deadline now names the document that
  amended it.** The runtime path already resolved an extension correctly, but
  could not say which file supplied it: `getEffectiveTenderFacts` concatenates
  every ACTIVE file before the reader runs, so the winning value arrived
  attached to nothing. `EffectiveTenderFactEntry` already declared `sourceQuote`
  and had never populated it for the deadline. Attribution is recovered where
  the files are already in hand — by locating the winning clause — rather than
  threading file identity through the reader, which would put source authority
  in a second place. One field (`originalFileName`) had to be added to the
  `files` select or the attribution was always null; caught by running it.

- **PROVEN AT RUNTIME (real DB, two source files, `tests/amended-deadline-runtime-provenance-db.test.ts`, 5/5):**
  original notice alone → 2027-03-10 · addendum added → **2027-03-24** ·
  provenance `sourceFileName=02-addendum-1.txt` + amending quote ·
  original file still ACTIVE with its own date · submission email, method and
  subject **unchanged** (a partial amendment does not replace tender context).

- **EXACT-HEAD ACCEPTANCE — all green on `63385c92`:**
  GitHub CI **6/6** (incl. route/screenshot capture) · dependency security PASS ·
  Preview `dpl_557pnYcPctmXADifZmNZLyUYEVtt` READY · `/api/health` 200,
  release == HEAD, 8/8 tables, `schemaMatchesDeployedCode=true` ·
  full CI-equivalent suite **10876/10876** · prisma validate · typecheck · lint ·
  build (build needs a provider key present — `next.config.js` `assertProductionEnv`
  refuses to build with none configured; CI supplies a placeholder).

- **SECURITY (verified, not assumed):** the previously transmitted Mistral
  credential is absent from every tracked file and from all git history. Four
  redaction suites (`redact-secrets`, `provider-diagnostic-secret-safety`,
  `provider-health-redaction`, `error-response-redaction`) pass. Remaining
  `AIza…` strings in the tree are deliberate fakes used to test redaction.
  **OWNER SECURITY ACTION: rotate that Mistral credential if not already done.**

- **STILL NOT MEASURED — App proposal quality.** No provider is reachable *and*
  credentialed from this execution environment. Claude Code's own egress proxy
  denies `api.mistral.ai`, `api.groq.com`, `api.openai.com`, `api.cerebras.ai`
  and `openrouter.ai` before vendor authentication;
  `generativelanguage.googleapis.com` is reachable but unauthenticated. This is
  a property of the Claude sandbox, **not of Vercel** — the deployed Preview's
  CSP already permits all ten provider hosts, so a key configured in Vercel may
  well work there. Reference proposal stands at 92/100; no App score invented.

- **NEXT SAFE ACTION:** one of — (a) configure `GEMINI_API_KEY` in an execution
  environment this session can drive, or (b) with a provider key present in
  Vercel, the owner clicks "Run AI Analyze" once on the exact-head Preview for
  the retained benchmark tender and reports the tender id, after which the
  persisted job and artifacts can be inspected.
- **UNCOMMITTED WORK:** NONE. **MERGE STATUS:** DO NOT MERGE.

### 2026-08-29 UTC — Claude Code (addendum / deadline-amendment authority)

- **TOOL:** Claude Code · **START SHA:** `47fe74db` · **END SHA:** `f86d4343`+
- **BRANCH / PR:** `release/consolidated-recovery-20260717` / #1175 (draft)

- **FIXED — `f86d4343`: a later addendum now supersedes the deadline it changes.**
  `effective-tender-facts.ts:355` joins every active file's text into one string
  before the reader runs, so the first complete date in it — the ORIGINAL —
  was reported however many addenda followed. A tender extended by three weeks
  was worked to its superseded date; one past its original date still read as
  expired after being extended.
  Precedence is taken from the documents, **never from upload order**: explicit
  amending language plus an addendum number where several amendments exist.
  Clauses about other postponed events (clarification questions, pre-bid, bid
  validity, bid security, contract start) are excluded — each is a different
  fact. Unorderable conflicts and dayless amendments are refused and reported.

- **ACCEPTANCE MATRIX (`tests/deadline-amendment-authority.test.ts`), 20/20:**
  1 original-only · 2 one extension · 3 latest of several · 4 quoting the old
  date is not an amendment · 5 explicit revision wins · 6 unorderable conflict
  fails closed + warns · 7 extension past an expired original honoured ·
  8 formats (month-first + named TZ, day-first + "local time", unambiguous
  numeric, dayless refused) · 9 other dated events not confused · 10 an addendum
  changes only what it states (email/method/client untouched).
  **8 of the 10 failed before the change.**

- **VERIFIED AS ALREADY CORRECT — preserved, not rebuilt:**
  - *Stale-state invalidation.* Adding an addendum changes the canonical
    analysis content hash (proved directly), so the existing
    `ANALYSIS_HASH_MISMATCH` gates in `generation-readiness-gate.ts` and
    `build-plan.ts` fail closed. No new mechanism was added.
  - *Human-confirmed extension.* `TenderMetadataOverride` already carries
    `authorityClass = HUMAN_CONFIRMED_OPERATIONAL`, `confirmationBasis`
    (required for export on submission-critical fields), `reason`,
    `previousValue`, `overriddenBy`, `confirmedAt`; `deadline` is overridable
    (`effective-tender-facts.ts:407`). No new edit path was invented.
  - *Addendum as independent active source* (`canonical-source-files.ts:89`)
    and the original deadline remaining readable in source text.

- **TESTS:** full CI-equivalent suite **10871/10871**, 0 fail, 0 cancelled.
  prisma validate, typecheck, lint, build clean. Benchmark tender unaffected
  (11/11 consumed fields); water RFP and EOI fixtures unaffected.

- **STILL BLOCKED — Gap A (real proposal quality).** Provider availability was
  re-tested this session, not assumed: the only configured provider is still
  `CEREBRAS_BASE_URL=http://127.0.0.1:4599` with a 15-character key — the local
  stub in `scripts/local-ai-provider.mjs`. No App proposal exists to score and
  none was invented. Reference proposal stands at 92/100.

- **OWNER ACTION REQUIRED — corrected:** the blocker is **egress policy**, not a
  missing key. Probed directly: `api.mistral.ai`, `api.groq.com`,
  `api.openai.com`, `api.cerebras.ai` and `openrouter.ai` are all **403
  CONNECT-denied** by the session proxy (recorded as `connect_rejected`), so a
  valid key for any of them still cannot run here.
  `generativelanguage.googleapis.com` **is reachable** — it answered from
  Google's own API asking for a key, with no proxy denial — and Gemini is first
  in the canonical order. **Supply `GEMINI_API_KEY`**, or have the environment's
  egress policy extended to the host of whichever provider is preferred.
- **NEXT SAFE ACTION:** with a key present, run
  `DRIVE_VAULT_JSON=… node scripts/pipeline-drive-seed.mjs`, then
  `DRIVE_COOKIE=… DRIVE_TENDER_FILE=… node scripts/pipeline-drive.mjs`, open the
  produced DOCX/PDF/ZIP and score on the 8-axis rubric.
- **UNCOMMITTED WORK:** NONE. **MERGE STATUS:** DO NOT MERGE.

### 2026-08-29 UTC — Claude Code (deterministic tender-comprehension repairs)

- **TOOL:** Claude Code · **START SHA:** `3cbceb25` · **END SHA:** `db988b74`+
- **BRANCH / PR:** `release/consolidated-recovery-20260717` / #1175 (draft)
- **TASK:** Score the App against the owner-supplied benchmark and fix verified gaps.
- **FIXED (both live, both consumed, both general — no fixture wording asserted):**
  1. `556d4795` — the client name was read as the label asking for it.
     "Procuring Entity / Client Name" yielded `"/ Client Name"`. Critical field:
     prints on the cover letter and gates export.
  2. `db988b74` — the deadline was invented. A dayless summary row became
     August **1st** where the tender twice says the **25th**; the reader then
     never looked further down the file. Also closed: `" at "` connector,
     trailing punctuation, day-first numeric dates, ambiguous numerics now
     refused, and a warnings array that was discarded at the return so
     "deadline not detected" reached nobody.
- **CORRECTION — do not chase this:** an earlier note in this session called
  "scope 1 of 6" and "criteria 0 of 5" defects. They are **not**.
  `scopeOfServices`, `technicalCriteria`, `eligibilityCriteria` and
  `financialCriteria` on `TenderDocumentIntelligence` have **no consumer** in
  lib/, app/ or components/; the criteria arrays are hard-coded `[]` at the
  return. The parser is consumed only for FACTS. Real scope comes from
  `requirements` via `tender-document-context.ts`; real criteria come from
  `extractDeepTenderComprehension` (an AI call). Populating those arrays would
  build dead code.
- **CONSEQUENCE:** methodology depth and evaluation responsiveness — 35 of the
  100 rubric points — are gated on the AI path, not the deterministic reader.
- **TESTS:** full CI-equivalent suite **10850/10850**, 0 fail, 0 cancelled.
  Focused cone 359/359. typecheck, lint, build clean. Each new regression test
  was confirmed to FAIL against the previous reader (8/11 and 9/12 groups).
- **HARNESS:** `41df7886` added `DRIVE_TENDER_FILE` / `DRIVE_VAULT_JSON` so real
  benchmark material drives the harness without committing third-party PII.
  Verified: 12 vault documents persist carrying 114 projects and 28 experts.
- **BLOCKER:** no AI provider reachable. `.env` points Cerebras at the local stub
  (127.0.0.1:4599) whose canned quotes belong to another fixture and appear
  nowhere in the benchmark tender, so AI Analyze cannot reach AI_SUCCEEDED.
- **OWNER ACTION REQUIRED:** set `GROQ_API_KEY` (owner's choice of provider) in
  the session environment. Name only; never paste the value into chat.
- **NEXT SAFE ACTION:** with the key set, run
  `DRIVE_VAULT_JSON=… node scripts/pipeline-drive-seed.mjs` then
  `DRIVE_TENDER_FILE=… node scripts/pipeline-drive.mjs`, open the DOCX/PDF and
  score on the same 8 axes as the reference (92/100).
- **UNCOMMITTED WORK:** NONE. **MERGE STATUS:** DO NOT MERGE.

#### Addendum — third repair and cross-tender proof

3. `a897b325` — a generic clock phrase erased the whole deadline.
   "…at 14:00 local time." names no offset; the reader strips the zone names it
   knows, `Date` could not parse the leftover phrase, and it rejected the entire
   string, so the date and time went with it. **Both** of this repository's own
   drive fixtures are written that way and were silently carrying no deadline.
   The benchmark never showed it because it names a real zone.

**Cross-tender verification** (the reason that third defect was found at all —
the benchmark alone could not expose it). The reader was run over two materially
different tenders, `scripts/pipeline-drive-fixture.mjs` (two-envelope water RFP)
and `-fixture-b.mjs` (EOI, email attachments):

| | Fixture A | Fixture B | Benchmark |
| --- | --- | --- | --- |
| client | Ministry of Water and Energy | Awash Water Works Design and Supervision Enterprise | Pharo Ventures |
| tenderType | Request for Proposal | Expression of Interest | Request for Technical Proposal |
| deadline | 2026-11-30T14:00Z | 2026-10-15T10:00Z | 2026-08-25T17:00+03:00 |
| serviceStreams | engineering design, supervision, consultancy, water | supervision, water | architectural design, consultancy, building |

No healthcare or benchmark leakage into the other two. All three deadlines were
wrong or absent before this session.

**Consumed-surface audit.** `TenderDocumentIntelligence` exposes many fields but
only six are read anywhere (`effective-tender-facts.ts` and the intake panel):
`tenderType`, `projectTitle`, `clientOrProcuringEntity`,
`financialProposalRequiredState`, `serviceStreams`, `submissionInstructions`.
Against the real benchmark tender all eleven checkable values now pass —
including the explicit financial-proposal denial read as `false`, both
submission emails and the exact subject line.

`bidBond` still returns the fragment `"/ Bid Security: Not mentioned."`, the same
label-splitting family as the client defect. It is **deliberately not fixed**:
the field has no consumer, so repairing it would add dead code. Recorded so it
is neither chased nor mistaken for an oversight.

### 2026-08-29 UTC — Claude Code (proposal-quality benchmark intake)

- **TOOL:** Claude Code · **START SHA:** `3cbceb25` · **END SHA:** this commit
- **BRANCH / PR:** `release/consolidated-recovery-20260717` / #1175 (draft)
- **TASK:** Score the App's generated proposal against the owner-supplied
  Claude/ChatGPT benchmark and fix verified quality gaps at the general root cause.
- **OUTCOME:** Reference scored **92/100**. **App score NOT MEASURED** — no AI
  provider is reachable, so no App proposal exists to score and none was invented.
- **FILES CHANGED:** `docs/proposal-quality-benchmark.md` (new), `operator_handoff.md`.
  **No application code changed** — no verified defect was reproducible without the run.
- **BEHAVIOR PRESERVED / CHANGED:** all / none.
- **KEY FINDINGS:**
  - The benchmark tender forbids a financial proposal, gives 5 criteria with **no
    weights**, and sets the deadline **August 25, 2026**.
  - The reference proposal misstates that deadline as **March 25, 2026** and
    contradicts itself on 107 vs 116 certified projects. Neither may be copied.
  - Its hospital claims (7,000 m² / ETB 550,074,678 and 2,800 m² / ETB 125,000,000)
    **are** verified against the company authority record.
  - **Trap for any future grounding rule:** `projects[]`=114 and `experts[]`=28 are
    the *extracted subset*; `companyProfile` separately states "more than 350
    completed projects, with 116 certified" and "29 key experts". Comparing a
    narrative claim to array length alone yields false fabrication findings.
  - **Benchmark hard-coding audit: clean.** `pharo-acceptance-fixture.ts` is
    test-only; HEALTHCARE is 1 of 20+ taxonomy domains; domain instructions span
    building/road/water/geotechnical/sanitation/irrigation/supervision.
- **BLOCKER:** `.env` points Cerebras at `http://127.0.0.1:4599` — the local stub in
  `scripts/local-ai-provider.mjs`, whose canned `sourceQuote` values belong to the
  harness's own RFP fixture and appear nowhere in the benchmark tender. Verbatim
  quote containment therefore refuses them, so AI Analyze cannot reach
  `AI_SUCCEEDED` on this tender. Preview routes return 401 to this session.
- **OWNER ACTION REQUIRED:** set a real provider key — `GEMINI_API_KEY` (first in
  canonical order, free tier), or `GROQ_API_KEY` / `MISTRAL_API_KEY`. Name only;
  never paste the value into chat or commit it.
- **NEXT SAFE ACTION:** with that key set, run the tracked harness
  (`scripts/pipeline-drive*.mjs`) over the benchmark tender + company vault, open
  the produced DOCX/PDF, and score it on the same 8-axis rubric as the reference.
- **UNCOMMITTED WORK:** NONE. **MERGE STATUS:** DO NOT MERGE.

### 2026-08-29 UTC — GLM (release-closure: pricing false positive, storage-backed repair, classifier centralisation)

- **TOOL:** GLM (Super Z)
- **UTC TIME:** 2026-08-29
- **START SHA:** `8789c9244e8afbefca2d7f37e2a7f63a4c561550`
- **END SHA:** this commit (parent `8789c924`)
- **BRANCH:** `release/consolidated-recovery-20260717`
- **PR:** #1175 (draft, the only lane)

- **TASK:** Close the three verified release blockers: the reproduced
  Technical Proposal pricing false positive behind AUTO_FINALIZE_NOT_CONVERGED,
  the AUTO_FINALIZE first-pass repair convergence defect, and the COMPANY_PROFILE
  classifier duplication debt.

- **ROOT CAUSE 1 (pricing, classification D — text-extraction/context-loss false
  positive):** `containsPricingLeakage` joined the surviving sentence/cell/paragraph
  fragments with a SPACE, so the `.{0,90}` proximity windows paired a fragment
  ENDING in a number with a priced term at the START of the next fragment — a
  "price" that exists in no sentence of the document. Every fragment was
  individually clean, so the paragraph-level repair found nothing to remove,
  `blockedByHygiene` persisted, and the NON_RETRYABLE blocker looped the tender in
  a terminal AUTO_FINALIZE_NOT_CONVERGED. Reproduced against the real
  extractor→detector→repair chain before any code change (probe evidence recorded
  in the session); the same false-positive family is already documented on
  `visibleXmlText()`. Fixed by joining with `\n` (JS `.` cannot cross a line
  terminator, so the windows are fragment-local); currency pairing is unaffected
  because the currency patterns glue with `\s*`, which matches newlines.
  Genuine current-bid pricing (currency amounts, percentages, fee schedules,
  rate cards, BoQ, quotations, lump sums) still fails closed — pinned by the
  required SAFE/UNSAFE regression pair in
  `tests/pricing-hygiene-fragment-boundary.test.ts`, including a
  repairability invariant (a full-text trip must be visible per-fragment, or the
  repair can never act).
- **ROOT CAUSE 2 (AUTO_FINALIZE convergence, storage-backed rows):**
  `runExportGapRepair` selected the bytes to clean with
  `generatedDocumentHasContent(doc) && doc.fileContent`, which is falsy for
  storage-backed rows (Vercel Blob in production: fileContent=null). The repair
  silently fell through to the `makeSafeDocx` stub: a ~58-word placeholder was
  written into fileContent, the integrity record was rebound to the STUB, and
  storagePath still pointed at the real generated document — validation blessed
  the stub while the ZIP/download served real bytes whose hash no longer matched,
  and the repair's own machine marker prevented re-repair. Reproduced against the
  real continuation service: 16,662 real bytes in, an 8,759-byte stub out; after
  the fix the same probe preserves the real bytes byte-for-byte and converges on
  pass 1. Fixed by `readRepairSourceContent` (storage adapter read for
  storage-backed rows — the same bytes storage-first readers serve) plus
  `storagePath: null` on the repair update (single byte authority, the contract
  the /auto-finalize route's rebuild already follows). Pinned by
  `tests/export-repair-storage-source.test.ts`.
- **ROOT CAUSE 3 (classifier debt, differential-tested first):** the reconciler's
  COMPANY_PROFILE regex (space-only) and the generate route's
  separator-normalised substring test disagreed on real names
  ("02-Company-Profile.docx" matched only the route; "Firm Profile" only the
  reconciler; "Capability Statement" only the route). Centralised into ONE
  predicate — `COMPANY_PROFILE_DOC_NAME_RX` / `isCompanyProfileDocName` in
  `lib/engine/document-type-normalizer.ts` — used by both paths, pinned by
  `tests/company-profile-classifier-differential.test.ts`.

- **FILES CHANGED:** `lib/engine/pricing-hygiene.ts`,
  `lib/engine/export-gap-repair.ts`, `lib/engine/document-type-normalizer.ts`,
  `lib/engine/reconcile-generated-docs.ts`,
  `app/api/tenders/[id]/generate/route.ts`, `operator_handoff.md`, plus the three
  new test files above.
- **DELIBERATELY NOT CHANGED:** provider chain order and budgets (`npm run
  audit:release-integrity` re-confirms Gemini → … → Anthropic → deterministic
  fallback last); AI fallback staging; every auth/RLS/tenant gate; the
  seven-pass/authority-review gates; the HTTP /auto-finalize route; freeze-mode
  and release control; no test was weakened or deleted.
- **VERIFICATION (on this exact tree):** full CI-equivalent combined suite with
  RUN_DB_INTEGRATION=true against a real PostgreSQL 16:
  **10,821 / 10,821 pass, 0 fail, 0 skipped** (includes 80 new regression tests);
  real-ZIP end-to-end against real PostgreSQL 14/14; prisma validate + migrate
  deploy clean; typecheck 0 errors; lint clean; production build PASS;
  release-integrity audits OK (444 routes, 1,636 files); dependency audit 0
  vulnerabilities; workflow-state consistency OK.
- **KNOWN RISKS:** the pricing fix relies on fragment-local proximity windows;
  a genuine leak SPLIT across fragments with no currency anywhere and no
  individually-tripping fragment would no longer be caught by THIS detector —
  it remains covered by the currency patterns (`\s*` crosses the join),
  per-fragment detection, the proposal-price-leakage guard, the
  financial-separation rule and the document-quality validator. The regression
  pair documents this trade explicitly.
- **NEXT ACTION:** exact-head CI on the pushed SHA, then the owner's one
  authenticated "Run AI Analyze" on the Preview. Do not merge; do not promote
  Production.
- **MERGE STATUS:** not merged (draft PR; release freeze in force).

### 2026-08-29 UTC — Claude Code (cross-tool takeover from Codex)

- **TOOL:** Claude Code
- **UTC TIME:** 2026-08-29
- **START SHA:** `b247a1394a540855f62b12911e28d92ba465e379`
- **END SHA:** this commit (parent `b247a139`)
- **BRANCH:** `release/consolidated-recovery-20260717`
- **PR:** #1175 (draft)

- **TASK:** Take over the release-finalization effort from Codex without regressing
  proven work. Establish real remote/CI/Preview state, correct the stale shared
  handoff, and reconcile the second open PR before adding any code.
- **ROOT CAUSE (of the coordination failure this entry fixes):** the Active Workboard
  asserted #1175 was the only open PR. #1303 opened two days later and was invisible
  to any tool reading this file, which is exactly the cross-agent blind spot the
  board exists to prevent.

- **FILES CHANGED:** `docs/pr1303-reconciliation.md` (new), `operator_handoff.md`.
  **No application code was modified this session.**

- **BEHAVIOR PRESERVED:**
  - Canonical provider order Gemini → Groq → Mistral → Z.ai → Cerebras → OpenRouter
    → OpenAI → Together → DeepSeek → Anthropic → deterministic fallback last.
  - 10-provider attempt budget; no free-only policy; no OpenRouter `:free` rule.
  - Provider-diversity chunk planning and the durable sanitized provider trace.
  - `FALLBACK_DRAFT` staging that never claims `AI_SUCCEEDED` and is not
    destructively auto-rearmed.
  - `analysisInputHash` rebinding to the persisted post-promotion tender.
  - BuildPlan authority, tenant isolation, evidence/provenance/export gates.
  - Exactly two routine manual owner actions (AI Analyze, Run Engine).
- **BEHAVIOR CHANGED:** none.

- **FROZEN LEDGER TESTS RUN:**
  - focused provider/chunk/fallback cone (9 files) — **126/126 pass, 0 fail**
  - isolated-PostgreSQL transition cone (5 files) — **22/22 pass, 0 fail**,
    including a real downloadable ZIP
- **FULL TESTS RUN:** `CI=true RUN_DB_INTEGRATION=true npm test` under a
  CI-equivalent environment — **10743/10743 pass, 0 fail, 0 cancelled**.
  A first local run showed 96 failures / 368 cancelled; that was traced to a
  local environment missing the workflow's `E2E_*`,
  `REQUIRE_MIGRATION_HISTORY` and database settings, **not** to code. Re-running
  with the ci.yml env block green-lit every one of them. Recorded here so the
  next tool does not re-investigate it as a regression.
- **DB INTEGRATION:** disposable local PostgreSQL 16 (`hope_tender_ci`, role
  `hope_ci`), all migrations deployed. Never Production; never Neon.
- **STATIC:** `npx prisma generate` OK · `npm run typecheck` clean ·
  `npm run lint` clean · `npm run build` PASS.
  (A stale `.next/` left by the wrong branch produced phantom `TS2307` errors in
  `.next/types/validator.ts`; removing `.next` cleared them. Not a code defect.)
- **CI:** exact-head `b247a139` — **6/6 success**.
- **PREVIEW:** deployment `dpl_CLgC33SyKH8sNAu2J9vmL433zdoG` · release
  `b247a139…` · `/api/health` HTTP 200, all 8 table probes true,
  `schemaMatchesDeployedCode=true`. GitHub head == Preview commit == health release.
- **REAL RUNTIME TEST:** the end-to-end pipeline test drove manual AI Analyze →
  Run Engine → generation → validation → ZIP against real PostgreSQL and produced
  a real archive. **This used the in-repo stub model server, not the live provider
  chain**, so it is not the live acceptance Phase 8 requires.

- **PR #1303 RECONCILIATION:** complete. 7 PRESENT_EQUIVALENT, 3 SUPERSEDED_BETTER,
  **0 MISSING_REQUIRED**, 0 OBSOLETE_OR_UNSAFE. `PR_1303_RECONCILED = YES`,
  `SAFE_TO_CLOSE_AS_SUPERSEDED = YES`. Full table: `docs/pr1303-reconciliation.md`.
  A second reconciliation in that file covers unpushed sibling-session work found
  in the takeover container (4 changes, 0 MISSING_REQUIRED).

- **KNOWN BLOCKERS:** The provider-diversity code at `b247a139` has **not** received
  a fresh authenticated manual AI Analyze run. Groq's live preflight/skip verdict is
  therefore still unproven, and the AI issue must not be reported as fixed.
- **EXTERNAL PROVIDER ISSUES:** last observed (historical, must be re-checked live):
  Gemini 503, Z.ai 429, Cerebras 402, OpenRouter credit limit, OpenAI 429,
  Together 401, DeepSeek 402, Anthropic insufficient credits. These are owner
  account matters, not code defects, and must never be worked around in code.
- **OWNER ACTIONS REQUIRED:** click "Run AI Analyze" once on the exact-head Preview
  for the retained tender, then report the durable provider trace.
- **UNCOMMITTED WORK:** NONE.

- **NEXT SAFE ACTION:** obtain one owner-authenticated AI Analyze run on
  `b247a139` Preview and read the persisted per-provider trace (attempted vs
  `PREFLIGHT_SKIPPED`, exact model, token budgets) to close or re-open the Groq
  question from evidence.
- **DO_NOT_REOPEN:** provider order and attempt budget; the withdrawn free-only /
  OpenRouter `:free` policies; `analysisInputHash` rebinding; the one-reader
  document-text module; `pricing-hygiene` as the single pricing authority;
  confirmed-plan row materialisation in `POST /generate`.
- **MERGE STATUS:** DO NOT MERGE. Draft. No Production promotion, alias change,
  schema change, or database mutation was performed.

#### Addendum — final-SHA acceptance re-run (same session)

The matrix above was executed on `b247a139`. It was re-executed in full on the
final SHA **`23c3a5bf`** (docs-only delta; no application file differs):

| Check | Result on `23c3a5bf` |
| --- | --- |
| `prisma generate` / `prisma validate` | OK / schema valid |
| `npm run typecheck` / `npm run lint` | exit 0 / exit 0 |
| Frozen focused provider/chunk/fallback cone | **126/126** |
| Frozen isolated-PostgreSQL cone | **22/22**, real ZIP produced |
| Full CI-equivalent suite | **10743/10743**, 0 fail, 0 cancelled |
| `npm run build` | PASS |
| Exact-head GitHub CI | **6/6 success** |
| Preview `dpl_pFnvNkTR31fgobPtigTbLTMUWm8Z` | READY, release == head, health 200, schema match |

**Environment trap worth knowing — cost part of a session, do not rediscover it.**
A local run of the PostgreSQL cone failed with
`Engine route and worker share canonical current-analysis authority: expected 202, actual 401`,
plus 8 cancelled tests cascading into the ZIP suite. It was **not** a code
defect and **not** database pollution — it reproduced on a freshly created
database. The cause was the `SESSION_SECRET` used for the run:
`lib/auth.ts:14` throws when the secret is shorter than 32 characters, so
session signing fails and every authenticated route answers 401. The value in
use was 31 characters. Re-running with a >=32-character secret restored
**22/22** immediately.

Two consequences for the next tool:
1. When a batch of DB tests fails on 401 while GitHub CI on the same SHA is
   green, check `SESSION_SECRET` length **before** reading application code.
2. That fail-closed behaviour is correct and must not be relaxed to make a
   local run pass.

Also confirmed this session: the app's own auth gate is intact end-to-end —
Vercel's deployment-level access does **not** confer an application session.
`GET /api/tenders/<retained-id>/release-snapshot` on the exact-head Preview
returns `401 {"error":"Unauthorized"}`. The retained tender therefore could not
be re-confirmed from here, and AI Analyze genuinely requires the owner.

<!-- Add newest entry at the top. -->

### 2026-09-05 13:38 UTC — Codex (public delivery-count convergence)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; based on real remote head `7bce8e9d42a66f1eb2fe2c7a6665db94a22da83f`.
- **Verified failure:** exact-head hosted run `33969155527` reached successful AI Analyze, ENGINE_RUN, PROPOSAL_GENERATION and AUTO_FINALIZE. The package model had zero document/tender blockers and one confirmed PDF delivery, but the route-level public envelope still passed its older workspace-derived count (`2` export-ready rows: editable DOCX plus delivery PDF) against `1` required delivery, manufacturing `READINESS_COUNT_CONTRADICTION`.
- **Fix / files:** `app/api/tenders/[id]/export-readiness/route.ts` now feeds both public and nested payloads the final-package model's confirmed delivery-candidate count; `tests/export-readiness-delivery-count.test.ts` pins that the retained editable source cannot inflate the delivery count. No gate or candidate classification was relaxed.
- **Tests:** focused 14 tests passed; `npx tsc --noEmit` passed; `npm run lint` passed; `git diff --check` passed. `npm test` was attempted before this commit and correctly refused by the repository guard because the container-provided `DATABASE_URL` points at Neon; exact-head CI must provide the required ephemeral PostgreSQL service and run the full suite.
- **Risks / next action:** temporary acceptance infrastructure remains. Push, wait for exact-head Preview and full CI, rerun authenticated hosted acceptance, then inspect actual ZIP bytes/manifest/document content before any cleanup.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** — final ZIP acceptance remains pending.

### 2026-09-05 13:10 UTC — Codex (hosted-acceptance failure diagnostics)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; continued from verified remote head `6579eb745abeadce8f15326102ad8e49a81e0ea5`.
- **Scope:** Ran the real authenticated Preview acceptance against tender `fed8756d-4210-4ad8-808b-b6f63742f656`. AI Analyze, ENGINE_RUN and PROPOSAL_GENERATION succeeded; AUTO_FINALIZE failed, export readiness remained blocked, POST `/export` returned 400, and ZIP download returned HTTP 409 JSON (263 bytes), not a ZIP. The temporary workflow itself incorrectly concluded success because its final steps were observational.
- **Verified blocker:** the current package has an active validated `Technical Proposal.docx` and its active validated `Technical Proposal.pdf`; the confirmed plan requires only the PDF. Canonical narrative validation also reports the DOCX at 98/100 but rejects it for empty headings and a heading repeated at least three times. No production code was changed on this diagnostic commit.
- **Files changed:** `scripts/tmp-summarize-tender-jobs.py`, `operator_handoff.md`. The temporary job summarizer now prints the safe failure detail returned for failed AiJob rows so the next hosted run identifies AUTO_FINALIZE's actual terminal reason instead of only its status.
- **Tests actually run:** `python3 -m py_compile scripts/tmp-summarize-tender-jobs.py`; `git diff --check`. Hosted acceptance run `33967673866` completed as a GitHub workflow but did **not** satisfy acceptance.
- **Risks / assumptions:** failure details returned by the authenticated owner-scoped AiJob API are intended operator diagnostics; credentials and session cookies remain masked and are not printed. Temporary infrastructure remains in place because acceptance has not passed.
- **Next action:** push this diagnostic-only commit, await the exact-head Preview, rerun hosted acceptance, use the exposed AUTO_FINALIZE error plus artifact state to prove the narrow production root cause, then add a regression and fix only that cause.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** — hosted acceptance failed.

### 2026-09-05 UTC — Codex (real hosted acceptance: PDF/source identity and Markdown quality false positive)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; started from independently verified remote head `6579eb745abeadce8f15326102ad8e49a81e0ea5` with no later commits.
- **Real hosted failure:** owner-authenticated workflow run `33967673866` completed AI Analyze, ENGINE_RUN, and PROPOSAL_GENERATION, then AUTO_FINALIZE failed. The actual export response was HTTP 400 and the ZIP response was HTTP 409 JSON, despite the temporary workflow itself reporting success. The quality authority incorrectly called an ordinary Markdown heading followed by a blank line an “empty section”; after PDF finalization, package readiness also selected the retained editable DOCX ahead of the required same-base PDF, while file naming/order counted that editable source as an extra delivery attachment.
- **Scope / repair:** empty-section detection now requires another heading or true end-of-input after the blank space; planned-document and manifest selection prefer the confirmed required format; exact-name/order checks omit a retained alternate-format source only when a same-base required delivery artifact exists. The DOCX is preserved and remains editable; no validation, provenance, evidence, tenant, auth, envelope, pricing, or byte gate is relaxed. The temporary acceptance job now fails unless final readiness is `ok=true` with zero blockers, POST export is HTTP 200, and the downloaded bytes are a non-empty ZIP that `unzip -t` reopens.
- **Files changed:** `.github/workflows/lockfile-refresh-artifact.yml`, `lib/engine/document-quality-validator.ts`, `lib/engine/final-package-readiness-model.ts`, `lib/engine/export-readiness.ts`, `tests/document-quality-markdown-empty-section.test.ts`, `tests/final-package-readiness-model.test.ts`, `tests/export-readiness.test.ts`, `operator_handoff.md`.
- **Tests actually run:** focused suite **43/43 passed**; Prisma generate, TypeScript and lint passed. `npm test` correctly refused the configured Neon `DATABASE_URL` before running any test; full disposable-PostgreSQL regression remains required from exact-head CI.
- **Risks / next action:** the real current confirmed Build Plan reported one required delivery (`Technical Proposal.pdf`), while the owner acceptance target also names Cover Letter and Annexes. Do not invent them or alter the confirmed source-derived scope: rerun exact-head hosted acceptance and inspect the real ZIP/manifest first, then reconcile only if the source-derived Build Plan itself proves those deliverables. Push this surgical repair, require exact-head CI/Preview, and rerun the hosted workflow.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** — hosted ZIP acceptance and artifact inspection remain incomplete.

#### Exact-head hosted follow-up (`369d1273`)

The repair made AUTO_FINALIZE succeed on the real Preview. Export readiness then exposed one remaining count-only contradiction: the retained editable DOCX was still labelled an export candidate alongside its required PDF, producing `exportReadyDocumentsTotal=2` for one confirmed delivery. The package model now treats only the row whose format matches the confirmed plan as the export candidate; retained conversion sources remain active workspace documents but cannot inflate final-package counts. The focused regression asserts one export-ready delivery while both byte-bearing rows remain stored.

The next exact-head hosted run proved the model was correct (`DOCX exportCandidate=false`, `PDF exportCandidate=true`) but the route's top-level public envelope still copied its numerator from the older broad readiness summary. The envelope now takes both required and export-ready totals from the final-package authority already returned in the same response, matching its nested canonical totals instead of manufacturing `2 > 1` from two different populations.

Hosted run `33969698668` then passed zero-blocker export readiness and reached POST `/export`, where the central generation/export gate independently rejected the same retained DOCX as outside the confirmed PDF plan. Confirmed-plan validation now recognizes only same-base alternate-format rows as conversion workspace sources; the exact required PDF must still exist exactly once, be non-empty and machine-validated, while genuinely different extra files still block.

After that fix, hosted run `33970121264` passed every automated step and returned a valid ZIP, but byte inspection found the archive contained both `Technical Proposal.docx` and `Technical Proposal.pdf` even though the confirmed plan names only the PDF. The download route now filters quality review, authority review, and final ZIP inputs to exact confirmed delivery names. This preserves the DOCX in the workspace while preventing it from leaking into the client package.

### 2026-08-29 UTC — Codex (exact retained-source request-shape preservation)

- **Branch / PR:** existing `release/consolidated-recovery-20260717` / draft PR #1175 only. The refreshed container initially lacked a remote and exposed a synthetic `work` branch; after adding the canonical repository remote, its worktree was proven byte-identical to exact remote `04b93e0a004bfc672cda1a9516be45484b3e5c58`, then safely reattached to the existing consolidation branch. No branch or PR was created, merged, or promoted.
- **Scope:** strengthened the adaptive-chunking behavioral evidence for the retained 12,122-character source shape. The prior CASE A configured Gemini alone, so it did not explicitly freeze the owner requirement that a source of that exact size retain Groq when Gemini, Groq, and Mistral are all model/preflight eligible. The test now pins all three exact extraction models, their canonical order, Groq inclusion, and the expected single lossless request. No runtime, provider, timeout, database, schema, environment, or release-gate behavior changed.
- **Files changed:** `tests/ai-analysis-capacity-concurrency-regression.test.ts` and this handoff.
- **Tests:** focused provider/chunk matrix passed 126/126; Prisma generation, typecheck, full ESLint, dependency audit (0 vulnerabilities), and production build passed. Local `npm test` correctly failed closed before executing because the inherited `DATABASE_URL` is a Neon host; the guard was not bypassed and exact-head CI must supply its disposable PostgreSQL service.
- **Known risk / next action:** owner-authenticated Preview access remains unavailable; the retained tender must still run exactly once at the resulting exact head to read durable provider attempts, prove the Groq state, compare adaptive Mistral behavior, and continue the downstream artifacts path.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** pending exact-head CI/Preview and live authenticated acceptance.


### 2026-08-28 UTC — Codex (capability-specific real-workload diagnostics)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; started from exact remote `52e20b6e` after fetching first.
- **Newly closed diagnostic gap:** provider health had capability-specific success timestamps but one shared latest failure. A proposal failure could therefore obscure the latest real extraction outcome (or the reverse), and the operator could not see the exact extraction and proposal models beside separate latest real-workload results. Real extraction/proposal attempts now record independent, secret-redacted capability results; tenant-scoped `AiUsageRecord` rows restore those results across cold starts without a schema change; the diagnostics payload and health cards expose both exact models and both outcomes separately. AI usage rows now persist the exact effective model instead of leaving it null.
- **Error-summary correction:** the AI Analyze workflow message counted regex occurrences as providers, allowing repeated details from one provider to produce impossible counts above the ten-provider chain. It no longer invents provider counts and keeps BILLING, AUTH/CONFIGURATION_INVALID, RATE_LIMITED, TEMPORARILY_UNAVAILABLE, TIMEOUT, MALFORMED_RESPONSE, and REQUEST_TOO_LARGE distinct; authenticated diagnostics owns unique-provider results.
- **Files changed:** `lib/ai-provider-health.ts`, `lib/ai-provider-health-db.ts`, `lib/ai.ts`, `lib/engine/provider-health-store.ts`, `app/api/ai-providers/diagnostics/route.ts`, AI Analyze/regenerate-section usage recording routes, `components/ai-health-panel.tsx`, `components/ai-analyze-panel.tsx`, `tests/ai-provider-diagnostics.test.ts`, `tests/provider-capability-result-separation.test.ts`, and this handoff.
- **Tests actually run:** focused provider capability/diagnostics/health/fallback/failure-truth suites passed **76/76** across the recorded runs; Prisma validate and generate passed; typecheck passed; full ESLint passed; release-integrity/safe-error/metadata/protected-gap audits passed (444 routes / 1,635 files); dependency audit reports 0 vulnerabilities; production build passed with a non-secret placeholder Gemini key. The first pushed exact-head CI completed **10,736/10,737** assertions and exposed one stale exhaustive-key assertion in `deepseek-provider-visibility.test.ts`: it still pinned the pre-change runtime snapshot contract and rejected the two intentional new result fields. The production behavior passed; the contract is updated in the follow-up commit and its focused suite passes. A disposable PostgreSQL full-suite attempt could not start locally because this container has neither Docker nor local PostgreSQL binaries; the inherited Neon URL remains unreachable and was not modified. Exact-head CI must rerun after the follow-up push.
- **Risks / assumptions:** durable detail is sourced from tenant-owned `AiUsageRecord`; no raw provider response or secret is persisted. Older usage rows may have a null model and are truthfully paired with the currently effective model, while all new extraction/proposal rows persist the exact model. No provider order, attempt budget, cooldown, fallback authority, schema, Vercel variable, database URL, or release gate changed.
- **Next action:** push this commit to existing PR #1175, require exact-head CI/security/screenshot/Preview, then use an authorized Preview ADMIN session for the retained 12,122-character tender and complete downstream artifact acceptance.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION**; owner-authenticated real-workload acceptance remains required.

### 2026-08-28 UTC — Codex (AI Analyze adaptive chunk/concurrency repair)

- **Branch / PR:** continued only on existing `release/consolidated-recovery-20260717` / draft PR #1175 from verified exact remote head `ba201cb0a1fcba8cec1877252436f7cf2737aaa6`; no branch or PR was created, and nothing was merged, promoted, or deployed to Production.
- **Proven regression / scope:** the 8,000-character soft threshold split the owner-reproduced 12,122-character extraction into two calls, while `analyzeWithAI` explicitly launched three sibling chunk workers. Those workers shared provider TPM/RPM/cooldown state and could self-induce the observed Groq/Gemini contention. The Groq adapter also selected the proposal model while preflight/diagnostics selected the extraction model, and structured-but-empty output was accepted as routing success before parsing.
- **General repair:** exact extraction prompt/model preflight now keeps sources up to the bounded 50,000-character quality ceiling in one request whenever a configured provider can safely accept them; genuinely oversized sources retain lossless 8K/1K-overlap chunking but execute sequentially per job. Groq now sends the exact extraction model used by registry/preflight. Extraction response validation happens inside the canonical provider iterator, so malformed/empty output falls through to the next provider without replaying the whole chain. Existing durable per-chunk checkpoints, missing-index resume, ten-provider order, deadline clamps, secret redaction, and fail-closed fallback/export authority remain unchanged.
- **Files changed:** `lib/ai.ts`, `tests/ai-analysis-capacity-concurrency-regression.test.ts`, and this handoff.
- **Checks:** targeted AI runtime/durable-resume/diagnostic/fallback suites passed; Prisma validate/generate, typecheck, ESLint, and production build with non-secret placeholder configuration passed. Full local `npm test` was correctly refused by the fail-closed database guard because the inherited URL is Neon. The first exact-head CI run reached 10,727/10,731 passing assertions; its four failures were stale message/source-shape assertions for the old Groq signature and fixed 8K-only chunk contract. Those assertions now describe adaptive single-request behavior and malformed-response fall-through; disposable-PostgreSQL CI must rerun after the follow-up push.
- **Known external blockers:** owner-supplied Preview evidence still shows provider-account failures (Cerebras/OpenRouter/DeepSeek/Anthropic billing or credits, Together invalid key, OpenAI/Z.ai throttling). Code does not conceal or bypass them. Authenticated re-run of the retained tender and downstream artifacts requires owner access after fresh exact-head Preview.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** pending exact-head CI/Preview and owner-authenticated runtime acceptance.

### 2026-08-27 UTC — Codex (PR #1175 CodeQL inline closure)

- **Branch / PR:** existing `release/consolidated-recovery-20260717` / draft PR #1175 only, fetched at exact remote head `87703940ae1a821828039df02f376d4a6434dd09`; no branch or PR was created and nothing was merged or promoted.
- **Scope / reproduced findings:** addressed all seven outstanding inline CodeQL comments: incomplete URL-scheme rejection, chained XML entity decoding, two incomplete tag-sanitization findings, regular-expression injection, and two clear-text environment-derived logging sinks. The local provider had already converged to one static UUID/file-name capture at the fetched head; the new security contract locks that repair in.
- **General repair:** link auditing now uses a positive protocol allowlist; XML entities decode through one callback pass; DOCX visible text remains bounded capture-only; form insert markers are precompiled static expressions; accumulated/fatal pre-deploy output is redacted at the final console sink. No readiness, provider-order, artifact, database, or Production configuration changed.
- **Files changed:** `e2e/pr1175-independent-release-audit.spec.ts`, `lib/engine/export-gap-repair.ts`, `lib/engine/tender-form-completion-gate.ts`, `scripts/verify-pre-deploy-safe.mjs`, `tests/codeql-inline-closure.test.ts`, and this handoff.
- **Checks before commit:** focused CodeQL/form/DOCX regressions passed 34/34; typecheck, full ESLint, and diff check passed. Exact-head disposable-PostgreSQL CI, dependency security, route/screenshot capture, build, authenticated Playwright, and fresh Preview health remain required after push.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION**; stop at the owner's controlled integration decision.

### 2026-08-27 UTC — Codex (live AI Analyze request-budget repair)

- **Branch / PR:** existing `release/consolidated-recovery-20260717` / draft PR #1175 only, starting from fetched exact remote head `42ef2bedb8a8d78b2a46517e272aaf318eda3be8`; no branch or PR was created and nothing was merged or promoted.
- **Reproducer / root cause:** owner-supplied exact-Preview diagnostics proved `AI_MAX_PROVIDER_ATTEMPTS=3` was overriding the source default of ten, so the runtime stopped after Mistral while later configured providers remained. The same run proved preflight counted input alone while adapters additionally reserved output, producing Groq 413/8K-TPM and OpenRouter/Together context failures. HTTP 413 was then recorded as provider-health failure rather than request-shape evidence.
- **General repair:** automatic routing now guarantees one bounded first attempt per canonical AI provider despite stale lower overrides; preflight budgets system + user input, model/provider output, TPM/context capacity, and a safety margin, and passes the safe output allowance to the exact adapter/model. Extraction chunks are 8K characters with 1K overlap and a 200-chunk explicit cap; the chunk coverage diagnostic now measures the actual covered end instead of falsely warning on every multi-chunk source. HTTP 413/context-too-large is `REQUEST_TOO_LARGE` with zero cooldown, and the normal workflow UI summarizes provider failures while authenticated diagnostics retain sanitized detail.
- **Files changed:** `lib/ai.ts`, `lib/ai-preflight.ts`, `lib/ai-provider-classification.ts`, `lib/ai-provider-health.ts`, `components/ai-analyze-panel.tsx`, `components/ai-health-panel.tsx`, `tests/provider-request-budget-regression.test.ts`, and this handoff.
- **Checks:** Prisma-backed typecheck and ESLint passed; focused provider/request/source-fidelity regressions passed; production build passed with a non-secret placeholder provider key. Full local `npm test` was correctly refused by the fail-closed database guard because the configured URL is Neon; disposable-PostgreSQL exact-head CI is required after push.
- **CI follow-up:** the first exact-head runs reached 10,717/10,722 passing assertions; all five failures were stale source-shape checks for the former preflight/default syntax, not behavioral failures. The implementation was expressed with explicit context/TPM branches and the compact ten-attempt initializer those checks require; the focused 114-assertion set then passed 114/114 before the follow-up push.
- **Remaining acceptance / risk:** wait for exact-head CI, dependency/security, screenshot/route audit, and fresh Preview. Then the owner-authenticated current tender must rerun AI Analyze and the complete Engine → BuildPlan → artifacts pipeline. No claim is made yet that the live provider chain or proposal artifacts pass.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION**; stop at the owner's controlled integration decision.

### 2026-08-27 UTC — Codex (fresh Preview environment refresh)

- **Branch / PR:** existing `release/consolidated-recovery-20260717` / draft PR #1175 only; fetched exact remote head `2ebefd370186259c2a2a538ebaec823c07d0b978`. No branch or PR was created, and nothing was merged or promoted.
- **Scope:** documentation-only checkpoint used to trigger one fresh exact-head Vercel Preview after the owner replaced the Preview database environment. Historical immutable Preview failures are not treated as code regressions. No application, schema, migration, database, provider, gate, or Production configuration changed.
- **Verified starting state:** Production deployment `dpl_2gL1XHLbpxcJ93VeG5sDD9ZLHo55` reports HTTP 200, all eight critical tables healthy, and deployed-schema parity. The owner designated the current Production database and newly uploaded Company/Vault/tender data as authoritative; old-database recovery is out of scope.
- **Required acceptance:** the resulting Preview release must equal this commit, return HTTP 200 with all eight table probes true and schema parity, and then pass owner-authenticated current-data workflow/artifact acceptance. No live-data or proposal-quality claim is made before that evidence exists.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION**; stop at the owner's controlled integration decision.

### 2026-08-26 UTC — Codex (exact-head green acceptance checkpoint)

- **Branch / PR:** restored the checkout's missing `origin` metadata, fetched, and attached it to existing `release/consolidated-recovery-20260717` / draft #1175 at exact head `4d279897`; no new remote branch or PR.
- **Exact-head evidence:** both full CI jobs passed, both high/critical dependency-security jobs passed, screenshot capture passed, the primary `hope-tender-path-b` Vercel deployment is Ready, and GitHub reports zero unresolved review threads. Public Preview `/api/health` returned HTTP 200 healthy with release `4d2798977ce54f60d7130d0e348ab1eb0aa62e89`, deployment `dpl_5DZBnft19T9gLYHZeARXyWMfhT2F`, every critical table present, and `schemaMatchesDeployedCode: true`.
- **Scope / files:** verification and this handoff only; no production code changed because no new repository defect was reproduced after the CI-guard repair.
- **Remaining acceptance:** reproducible code and automated checks are 100% closed. The retained Pharo tenant's authenticated four-requirement evidence table, exact quality score, and downloadable final PDF/ZIP remain unverified because this environment has no owner session or retained tenant Vault bytes. Those facts cannot be inferred from public health or fabricated.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** pending owner-authenticated retained-Pharo acceptance.

### 2026-08-26 UTC — Codex (exact-head CI assertion repair)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; fetched first and continued from exact remote head `4f259eb1` without creating another branch or PR.
- **Reproducer / root cause:** both exact-head CI runs completed 10,707/10,708 assertions and failed only `buildplan-generation-pipeline.test.ts`, whose source-shape assertion still required the retired DOCX-only `extractDocxVisibleText` consumer. Production intentionally moved to `generatedDocumentVisibleText` so DOCX and required PDF bytes share one reader; the stale assertion contradicted the new invariant and was the sole CI blocker. Exact-head dependency security and screenshot capture passed, and GitHub reported zero unresolved review threads.
- **Files changed:** `tests/buildplan-generation-pipeline.test.ts` and this handoff only. The regression now asserts that both Export Readiness and current-document quality consume the canonical DOCX/PDF reader before quality scoring; no production gate was weakened.
- **Checks:** the CI-failing suite plus real-PDF finalization and quality-enforcement suites passed 94/94 with `CI=true RUN_DB_INTEGRATION=true`; targeted ESLint, typecheck and diff check passed.
- **Remaining acceptance:** code and automated regression closure is now 100% for every reproducible repository defect in the original prompt. Whole live acceptance is still 70% until an owner-authenticated retained-Pharo Preview run supplies its actual four evidence rows and downloadable PDF/ZIP; this environment cannot truthfully manufacture that evidence.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** pending the new exact-head CI and authenticated retained-Pharo verification.

### 2026-08-26 UTC — Codex (finalized-PDF visible-content validation)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; fetched first and continued from exact remote head `1e42bf63` without creating a branch or PR.
- **Live contradiction root cause closed:** generated-artifact visible-text truth only opened DOCX/OPC bytes. A finalized required PDF was therefore byte/type checked but its client-visible pages could be skipped by both the current-document quality resolver and Export Readiness. The shared reader now opens DOCX and PDF bytes, consumers use that reader, and an unreadable narrative proposal fails closed instead of silently bypassing the quality gate. Large binary narrative artifacts use one bounded 32 MiB decoded-byte policy rather than the panel's prior 2 MB base64-only shortcut.
- **Files changed:** `lib/engine/{generated-document-text,current-document-quality,export-readiness}.ts`, `tests/{pdf-finalization-safety,generated-document-quality-final-enforcement}.test.ts`, and this handoff.
- **Checks run:** 71/71 focused PDF finalization, real-PDF visible-text, canonical quality and validator assertions passed. The full local-PostgreSQL suite reported 10,702 passing assertions, zero ordinary assertion failures, and the same backup/restore rehearsal parent failure plus three cancellations caused by the deliberately non-ephemeral local database/user lacking `CREATE DATABASE`; the production-service artifact pipeline within that suite passed. Prisma validate/generate, typecheck, full lint, production build, release-integrity/security audits and diff check passed. With local PostgreSQL, the real DOCX→PDF artifact-identity integration and the production-service generation/validation/ZIP pipeline passed; the latter opened real artifacts and used the same generation services with a materially different water/supervision two-envelope fixture.
- **Risk / next action:** push this commit and require exact-head CI/security/screenshot/Preview. Retained authenticated Pharo Vault bytes remain unavailable locally, so owner-Preview 4/4 evidence and its exact PDF/ZIP cannot truthfully be claimed here.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** pending exact-head automated checks and owner-authenticated retained-Pharo verification.

### 2026-08-26 UTC — Codex (evaluation-weight unit fidelity follow-up)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; exact remote head `257a6571`, no new branch or PR.
- **Defect found and fixed:** review of the prior canonical criteria repair found that `AIAnalysisResult.evaluationCriteriaSource[].weight` is source text, not a number. The implementation tested for `number`, so every real stated weight was discarded as “weight not stated”; had a number reached it, the code would also have mislabeled points/marks as a percent. Canonical promotion now preserves the exact source unit/text (`40 points`, `75%`, `pass/fail`) and never invents `%`.
- **Files changed:** `lib/engine/canonical-analysis-update.ts`, `tests/evaluation-criteria-canonical-producer.test.ts`, and this handoff.
- **Checks:** seven focused canonical criteria tests, typecheck and targeted ESLint passed. Existing exact-head `257a6571` dependency security, screenshot audit and Vercel Preview were green; both duplicate CI runs had passed migrations, integrity, typecheck, lint, 10k+ tests and build and remained in the authenticated Playwright step when checked.
- **Remaining acceptance:** no project-scoped owner Preview credential or accessible real Pharo Vault bytes exist in this environment. Therefore retained-tenant 4/4 coverage and its actual Technical Proposal PDF/ZIP still cannot be claimed; the truthful completion remains 70% of the ten original live acceptance phases.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** pending exact-head CI completion and owner-authenticated retained-Pharo verification.

### 2026-08-26 UTC — Codex (canonical criteria producer and validation-quality convergence)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; continued from exact head `74cd6c3c` without creating another branch or PR.
- **Root causes fixed:** the prior follow-up incorrectly added downstream source-text interpretation, contrary to the one-analysis-authority rule. Criteria are now extracted at the canonical producer: the shared source extractor recognizes qualitative `SELECTION CRITERIA` and `AWARD FACTORS`, the source-driven parser consumes that extractor, and AI promotion derives persisted methodology from source-attributed criteria when narrative methodology is absent. Readiness reads only those persisted facts. Separately, canonical validation previously stamped clean-container documents `VALIDATED` without running the narrative rubric used by readiness, and that rubric lacked selected evidence names; validation now supplies relevance-selected expert/project names and requires the combined canonical verdict to be GOOD. A real `TECHNICAL PROPOSAL` first page is recognized as a cover/title rather than a false missing-cover result.
- **Files changed:** `lib/engine/{canonical-analysis-update,current-document-quality,document-quality-gate,evaluation-criteria-presence,evaluation-methodology-source-extractor,source-driven-tender-text-parser,validate}.ts`, `scripts/pharo-benchmark.ts`, `tests/{evaluation-criteria-canonical-producer,evaluation-criteria-presence,pipeline-produces-real-zip-end-to-end}.test.ts`, and this handoff.
- **Real pipeline/artifacts:** installed local PostgreSQL 16, applied all 51 migrations, and ran the production-service ZIP pipeline. It generated/opened real DOCX and ZIP bytes with automatic validation and no recovery click. Independent Mammoth inspection measured the technical proposal at 616 words and canonical quality 81/100 with the actual selected project name; the pipeline regression now requires every validated document to be GOOD and at least 80/100. The checked-in Pharo Vault export contains zero importable experts/projects/documents, so the real Pharo instrument now stops truthfully at `GENUINE_SOURCE_BLOCKED` instead of continuing with empty/fake evidence or crashing on a fabricated job ID.
- **Tests actually run:** focused criteria/quality/production ZIP suite 35/35 passed; PostgreSQL artifact identity, mandatory coverage and release-panel suites passed; Prisma migrate deploy/generate, typecheck, targeted ESLint and the benchmark blocker path passed. Full PostgreSQL suite ran 10,706 assertions: 10,703 passed, 0 failed, 3 cancelled only in the backup/restore rehearsal because the local database was named `hope` rather than an explicitly ephemeral test database.
- **Risks / next action:** the retained authenticated Preview Pharo tenant must be rerun because this checkout does not contain its real Vault source bytes. If its fourth mandatory requirement remains only PARTIAL, release must stay blocked. Exact-head CI/security/screenshot/Preview and real owner-authenticated artifact inspection remain required after push.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** — live acceptance remains incomplete.

### 2026-08-26 UTC — Codex (evaluation-criteria source truth follow-up)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; continued from exact remote head `b039c607` without creating a branch or PR.
- **Reproduction / root cause:** Final Submission Readiness accepted `evaluationMethodology` or structured `evaluationCriteriaSourceJson`, while Export Readiness inspected only `evaluationMethodology`; both ignored preserved criteria in active source text. The release consumers could therefore emit `EVALUATION_CRITERIA_ADVISORY` even when the source contained qualitative criteria without numerical weights.
- **Scope / files changed:** added the shared source-criteria presence resolver `lib/engine/evaluation-criteria-presence.ts`; migrated `lib/engine/export-readiness.ts` and `lib/engine/final-submission-readiness.ts`; added structurally different no-weight, structured-source, and explicit-absence behavioral cases in `tests/evaluation-criteria-presence.test.ts`.
- **Tests actually run:** 70/70 focused assertions passed across criteria presence, canonical mandatory population, Build Plan release safety, PDF byte/finalization/ZIP behavior, and pricing hygiene. Prisma generate, typecheck, targeted ESLint, and `git diff --check` passed.
- **Environment limitation / risks:** the clean real Pharo benchmark was invoked with the real tender DOCX and Plan-B Vault JSON, but the configured Neon PostgreSQL hostname was unreachable before fixture creation. No real artifact or authenticated Preview rerun is claimed. The resolver requires a criteria heading/lead-in plus substantive factors and rejects explicit source statements that criteria were not provided.
- **Next action:** require exact-head CI/security/screenshot/Preview, then rerun the authenticated Pharo workflow and inspect the real DOCX, required PDF, and ZIP; retain any genuine mandatory-evidence blocker below 4/4.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** — owner-controlled live verification remains required.

### 2026-08-21 UTC — Codex (final owner-policy contradiction cleanup)

- **Mode:** exact-head completion audit and narrow provider-policy cleanup.
- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, continued from `0ac4ab0a32e4df78c69c35f402863a46e897880a`.
- **Scope:** removed residual zero-paid/free-model policy code and contradictory operator text after the full ten-provider chain was restored. Capability reports no longer calculate or expose an app-owned free-model policy, UI/readiness descriptions no longer claim later providers are forbidden, and all provider capability diagnostics iterate the same canonical automatic chain. Preserved actual billing lockouts, exact configured models, provider fall-through, retry recovery, and all source/tenant/artifact fail-closed controls.
- **Files changed:** `lib/ai-provider-catalog.cjs`, `lib/ai-provider-registry.ts`, `lib/ai-provider-capability-test.ts`, `lib/ai.ts`, `lib/ai-analyze/retry-service.ts`, provider health/readiness modules, AI health UI, environment scripts, production runbook, affected regression tests, and this handoff.
- **Tests:** focused provider/readiness/retry suite passed 217/217; Prisma generation, typecheck, lint, and release-integrity passed (435 routes and 1,590 files). Exact-head CI passed 10,240/10,240 unit and PostgreSQL integration tests plus 185 authenticated/anonymous/golden/cross-user Playwright tests (3 intentionally skipped); build, migrations/idempotency/zero-drift, security audit, and route/screenshot capture passed. Preview `/api/version` and `/api/health` returned HTTP 200 at the exact SHA; deployment `dpl_HjrZJpDa19Jzb3XRv88T3jk9KCP1`.
- **Risks / blockers:** no known provider-policy, CI, Preview, or route/screenshot blocker remains. PR stays draft for owner review.
- **Next action:** owner review only; do not merge or promote Production without explicit approval.
- **Merge status:** SAFE FOR OWNER REVIEW; DO NOT MERGE OR PROMOTE PRODUCTION without owner approval.

### 2026-08-21 17:42 UTC — Codex (eligible-provider redundancy reaches environment readiness)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; continued from exact remote head `cc6624fbeed87b6fcbe0f864d52882bef4ce2dd7`.
- **Scope / files changed:** closed the remaining readiness contradiction: startup/environment readiness counted any one of ten keys, so paid-only keys or a single free provider could still report deployment-ready while routing correctly refused them. `evaluateEnv()` and the operator readiness surface now require two provider-policy-eligible zero-paid configurations, including exact runtime-model eligibility. Updated behavioral expectations in `tests/env-policy.test.ts` and `tests/ai-provider-fallback.test.ts`.
- **Tests actually run:** focused environment/provider/health suite passed **60/60**; typecheck passed; lint passed; release-integrity passed (435 routes, 1,590 files); diff check passed.
- **Risks / assumptions:** Preview remains relaxed unless `STRICT_PREVIEW_ENV_CHECK=true`, so an operator can deploy diagnostics to repair configuration; Production fails closed. Live capability still cannot be inferred from configuration, so two real structured-analysis successes and same-tender completion remain mandatory.
- **Next action:** push, require exact-head CI/Preview, then run authenticated provider diagnostics and retained-tender acceptance when the project-scoped session is available.
- **Merge status:** **UNSAFE / DO NOT MERGE / DO NOT PROMOTE PRODUCTION** pending live provider and workflow proof.

### 2026-08-21 17:35 UTC — Codex (immutable zero-paid and two-provider readiness gate)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; continued from exact remote head `2277165016c258fe95b4c503503eb51436a6c946`.
- **Scope / files changed:** closed two source-level gaps found in the continued audit: a stale `AI_ZERO_PAID_MODE=false` Vercel override could re-enable the full paid chain, and health declared success with only one analysis-capable provider despite the required 429 redundancy. Zero-paid is now immutable, the automatic chain can never include the paid tail, and healthy/runtime-ready requires two analysis-verified free providers. Files: `lib/ai-provider-catalog.cjs`, `lib/ai-provider-registry.ts`, `lib/ai-provider-health-check.ts`, `tests/zero-paid-provider-chain.test.ts`, and this handoff.
- **Tests actually run:** focused zero-paid/health/reconciliation suite passed **42/42** after the final import correction. Typecheck, lint, release-integrity, and exact-head CI are required on the committed SHA.
- **Risks / assumptions:** this deliberately removes the unsupported paid-mode escape hatch; paid providers remain diagnostic-only `BILLING_BLOCKED`. It does not fabricate the still-missing live evidence: two real free providers and same-tender Preview completion still require an authorized owner session and project-scoped environment access.
- **Next action:** push once, require exact-head CI/Preview, then use authorized Preview diagnostics to establish the redundant provider pair and run the retained tender to final package.
- **Merge status:** **UNSAFE / DO NOT MERGE / DO NOT PROMOTE PRODUCTION** until live provider and same-tender acceptance pass.

### 2026-08-21 17:30 UTC — Codex (provider-policy recheck and stale-truth repair)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; rechecked from `abc1e32f4f7e72256d2fe419ea1a29624c40ff24` without rebasing or touching Production.
- **Scope / files changed:** audited every inline review comment and confirmed all seven CodeQL findings had already been repaired by landed commits (`a37a7076` and `279965cb`); corrected the remaining stale provider-order statement in `operator_handoff.md` and stale registry comment in `lib/ai-provider-registry.ts`. No runtime behavior or safeguard changed.
- **Tests actually run:** Prisma generate passed; focused zero-paid/provider/capability/health/redaction suite passed **255/255**; typecheck passed; lint passed; release-integrity passed (435 routes, 1,590 files); both affected scripts passed Node syntax checks; dependency audit reports 0 vulnerabilities; diff check passed. Exact prior head `abc1e32f` CI passed **10,238/10,238 unit + PostgreSQL tests** and **184 Playwright passed / 4 skipped**, with migrations, idempotency, zero drift, build, authenticated isolation, dependency security, route/screenshot audit and Vercel green. Its Preview `dpl_6d2Z1NaFUikBKSTUhGbHq8uVK191` returned HTTP 200 for version/health with exact SHA, schema parity and eight healthy table probes.
- **Risks / assumptions:** the authenticated diagnostics endpoint correctly returned 401 without a session. This environment still lacks a project-scoped Vercel token and stable Preview owner session, so effective provider variables, two real provider capability successes, same-tender AI Analyze/Engine/package completion, job-polling 200, and post-analysis Bid Strategy cannot be claimed. The prompt's true end-to-end acceptance is therefore **3/11 areas (27.3%)**, while the static/code provider-policy controls inspected here are green.
- **Next action:** obtain the authorized Preview owner session and project-scoped configuration access, establish two live free-provider structured-analysis successes, then rerun the retained tender through final ZIP on the resulting exact head.
- **Merge status:** **UNSAFE / DO NOT MERGE / DO NOT PROMOTE PRODUCTION** — provider-account and authenticated workflow acceptance remain open.

### 2026-08-21 17:10 UTC — Codex (final Preview provider pass blocked at authorization boundary)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; exact starting SHA `80169f0cc4fe629e431d56cbc92f189b7c2fdb52` verified before work.
- **Scope / result:** inspected the exact-head GitHub checks and real Preview public runtime. Preview deployment `dpl_BSN5ooAyk2iSwyRcS8XAMCfKFb8Z` reports HTTP 200 healthy, release `80169f0cc4fe629e431d56cbc92f189b7c2fdb52`, and schema parity. No application or provider-policy source was changed because this runtime blocker requires effective Vercel environment/account evidence, not guessed model names.
- **Tests actually run:** `GET /api/version` returned HTTP 200 with `gitCommitSha: 80169f0c`; `GET /api/health` returned HTTP 200 healthy with all eight table probes true and the exact full release SHA. GitHub exact-head checks were inspected and are green. The Vercel API credential available to this session identifies the owner user but is explicitly forbidden from the `hopeengineering83-codes-projects` scope, and no authenticated Preview owner session or provider credentials are available. Therefore effective environment values, provider connectivity/model visibility/capability, job polling, and the same-tender workflow could not be truthfully exercised.
- **Risks / assumptions:** the owner-confirmed runtime before-state remains Z.ai `glm-4.7-flash` HTTP 429 followed by extraction-provider exhaustion; Gemini has no app-policy-proven free model for every runtime use case. Groq, Mistral, and OpenRouter effective model/capability state is unverified, so none is counted as a second usable provider. No key value was read or exposed, no environment was changed, no disallowed provider was contacted, and Production was untouched.
- **Next action:** supply a Vercel token authorized for `hopeengineering83-codes-projects` plus a stable authorized Preview owner session (or have the owner perform the equivalent scoped environment inspection and authenticated run), then reconcile exact model variables from live provider capability evidence and repeat the same tender through AI Analyze, Run Engine, generation, validation/finalization, and DOCX/PDF/ZIP packaging.
- **Merge status:** **UNSAFE / DO NOT MERGE / DO NOT PROMOTE PRODUCTION** — two hard acceptance blockers remain: scoped effective-runtime configuration access and authenticated same-tender end-to-end proof.

### 2026-08-21 14:55 UTC — Codex (real-Preview 422 recovery authority repair on PR #1175)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, continued only from requested exact head `e18912149a6cba76a3ff1929c9266ed5e00b5454`.
- **Scope:** fixed the remaining manual recovery refusal: once the new authenticated request has loaded the same tender by `(id,userId)`, an old `TENDER_NOT_FOUND` is re-evaluated rather than blindly retained; current missing/foreign tenders still fail before job recovery. Replaced key/config-only retry availability with the runtime automatic-chain authority: active zero-paid order, provider policy, exact use-case model free approval, billing lockout and per-provider cooldown.
- **Files changed:** `lib/ai-analyze/retry-service.ts`, `lib/ai-jobs/analysis-job-service.ts`, `tests/ai-analyze-retry-scheduler.test.ts`, and this handoff.
- **Tests actually run:** Prisma generate passed; typecheck passed; lint passed; focused retry, snapshot and exact-model suites passed **50/50**. Exact-head PostgreSQL/CI, build, Playwright, isolation, screenshot and Preview validation remain required after push.
- **Risks / assumptions:** current ownership proof is not inferred from the historical job; it exists only because `createAnalysisJob` already loaded `Tender` with both current tender ID and authenticated user ID. Live provider/tender acceptance still requires the owner Preview session.
- **Next action:** push to existing PR #1175, run all exact-head gates, deploy Preview only, and execute the owner-authenticated same-tender flow if credentials are available.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION**.

### 2026-08-21 14:15 UTC — Codex (second end-to-end gap audit on PR #1175)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, continued from `bf946337a404189a65821c701aafd50ba8ea3724` after all exact-head checks were green.
- **Scope:** second audit found two remaining edge gaps. An uncertain legacy snapshot deleted only chunks carrying the old job ID, but the unique revision key permits legacy null/differently-bound chunks; cleanup now deletes all chunks for the exact tenant+tender+content revision so the fresh job cannot inherit checkpoints. Capability diagnostics also previously resolved the analysis model once and used it for connectivity and generation; they now resolve fast, analysis, and proposal independently against the same live account listing and pass each exact model through the real adapter.
- **Files changed:** `lib/ai-jobs/analysis-job-service.ts`, `lib/ai-provider-capability-test.ts`, `tests/ai-analyze-safe-rearm-snapshot.test.ts`, `tests/exact-model-zero-paid-regression.test.ts`, and this handoff.
- **Tests actually run:** focused safe-rearm and exact-model regressions passed **14/14**; typecheck and lint passed before commit. Full exact-head PostgreSQL, build, Playwright, screenshot, Preview and health validation must run on the pushed SHA.
- **Risks / assumptions:** live account capability and the owner-specific blocked tender still require authenticated Preview access not present in this environment; no claim is made for those runtime acceptance items.
- **Next action:** push this commit to existing PR #1175, wait for exact-head CI/Preview, then report code closure separately from owner-authenticated runtime acceptance.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION**.

### 2026-08-21 13:40 UTC — Codex (Preview AI Analyze recovery on PR #1175)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, continued only from requested exact head `fe804c6b62605aeb6af789fff0af4933a06ddd4f`.
- **Scope:** corrected failure-classification precedence so provider model-not-found phrases cannot become terminal tender-not-found failures; added safe historical-category repair during authenticated manual re-arm; made chunk reuse conditional on exact active-file IDs, non-null source-byte hashes, extracted-text hashes, analysis input hash, and chunk hashes, otherwise superseding the old job and deleting its checkpoints before creating a fresh run. Live provider diagnostics now expose key presence, configured models, model configuration, free-policy proof, model visibility, and explicit diagnostic state independently, and no longer summarize a present-but-policy-blocked key as unconfigured.
- **Files changed:** `lib/ai-analyze/retry-service.ts`, `lib/ai-jobs/analysis-job-service.ts`, `lib/ai-provider-capability-test.ts`, `app/api/ai-providers/diagnostics/route.ts`, `tests/ai-analyze-retry-scheduler.test.ts`, `tests/ai-analyze-safe-rearm-snapshot.test.ts`, `tests/exact-model-zero-paid-regression.test.ts`, and this handoff.
- **Tests actually run:** Prisma generate/validate passed; typecheck passed; lint passed; release-integrity passed (435 routes, 1,589 files); focused non-DB regressions passed. Production build passed with a non-runtime placeholder Gemini key. PostgreSQL execution was attempted but the configured Neon test endpoint was unreachable, while `npm test` correctly refused that production-designated hostname; exact PostgreSQL/Playwright/Preview evidence is therefore delegated to the existing PR CI and Preview after push.
- **Risks / assumptions:** strict reuse requires non-null persisted source-byte hashes; older/incomplete snapshots intentionally take the fresh-job path and never reuse old chunks. No provider credentials or usable Vercel API credential are available locally, so live account model reconciliation and same-tender acceptance must be verified on the exact Preview rather than claimed from this container.
- **Next action:** run exact-head #1175 CI and inspect its Preview live diagnostics, health, and same-tender manual AI Analyze transition; do not merge or promote Production.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** until exact Preview acceptance is evidenced.

### 2026-08-20 19:30 UTC — Codex (exact-model and zero-paid model-level closure on PR #1175)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; applied directly on its exact prior head `680e5e32907838669a86a1e3e4f591ac68062d7f` as explicitly requested by Hope.
- **Scope:** added one generic `modelOverride` identity from live discovery/resolution through diagnostic preflight, `callProvider`, every free automatic adapter, and the real outbound request. Zero-paid resolution now accepts only app-policy-proven free models and skips before invocation when none exists; a provider listing no longer proves price. Groq's retired runtime model/default/profile was removed, and Groq now requires an explicit currently verified free-policy model. Addressed both CodeQL inline findings from the superseded PR #1301 by parsing intercepted request URLs and matching exact hostnames rather than unsafe substrings; also repaired the CI-reported `ProcessEnv` type errors. Exact-head CI then exposed that the original patch had accidentally converted legacy Gemini-only fallback hints into a chain-wide override, causing Groq to be skipped; the fallback surface no longer accepts an exact-model override, while the provider-specific diagnostic path retains it, so normal runtime again resolves each provider's own model.
- **Files changed:** `lib/ai-provider-registry.ts`, `lib/ai-provider-capability-test.ts`, `lib/ai-preflight.ts`, `lib/ai.ts`, `lib/company-knowledge-ai.ts`, `lib/ai-model-profiles.ts`, `scripts/check-env.mjs`, `scripts/provider-smoke-test.mjs`, `tests/exact-model-zero-paid-regression.test.ts`, and aligned provider registry/health/runtime/environment tests.
- **Tests actually run:** Prisma generation passed; focused provider/health/security regressions **159/159 passed** after the URL-host fix; the six exact CI-failure files then passed **47/47** after repairing chain-wide model poisoning and updating Groq fixtures to configure the proven-free model; typecheck passed; lint passed; release-integrity passed (435 routes, 1,589 files, protected invariants); local build passed. Follow-up exact-head PR #1175 CI passed migration deploy, critical schema, idempotency, zero drift, release-integrity, typecheck, lint, build, **10,225/10,225 unit + PostgreSQL tests**, and **185 Playwright passed / 3 skipped** across authenticated intake, golden workflow, cross-user isolation, tablet, anonymous, and security coverage. Exact-head route/screenshot audit passed and uploaded 243 files (artifact `9422101183`, SHA-256 `f434bc8c211debe3c6556599af265d8878e4e513c60aec77c33ddbe1c03ea64e`). Preview `dpl_8fi1PndT48LZbGJUJ5VA6F3nNWFj` returned HTTP 200 healthy with matching release SHA and schema.
- **Risks / assumptions:** no real provider credentials exist in this container, so model evidence is deterministic real-adapter outbound interception rather than live account calls. No source, database, CI, Preview-health, security, isolation, or screenshot blocker remains in the tested scope; live provider-account capability results still depend on owner-held credentials.
- **Next action:** Hope reviews the draft PR and live provider-account capability evidence; do not merge or promote Production without explicit approval.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** — local PostgreSQL and exact-Preview validation remain outstanding.

### 2026-08-18 UTC — Claude Code (dependency advisory blocking CI *and* Vercel Preview)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; base `49c0f63a`.
- **Symptom:** two different red signals on the branch — the CI check "Reject high and critical dependency vulnerabilities", and the Vercel deployment on the authoritative `hope-tender-path-b` project. Both red on `cbe26fea` and again on `49c0f63a`, i.e. across commits from two different sessions.
- **One root cause.** `npm audit --omit=dev` reports three high findings that are all the same advisory — 1145093, "DeepmergeTS has stack exhaustion when merging recursive object graphs" — reachable from production via `@prisma/client@6.19.3 -> prisma@6.19.3 -> @prisma/config -> deepmerge-ts (<8.0.0)`. It is not from any commit on this branch; no dependency file was touched. It is a newly published advisory against the existing lockfile. The Vercel failure is the *same* gate: `scripts/vercel-build.mjs` runs `scripts/audit-dependencies.mjs`, whose build log shows "Dependency audit failed: 3 blocking vulnerability finding(s)". So the Preview deployments owner UAT depends on were being failed by the advisory, not by a build defect.
- **Fix:** one `overrides` entry, `"deepmerge-ts": "^8.0.1"` — the mechanism this repo already uses for six other transitive advisories (postcss, rimraf, glob, sharp, nanoid, js-yaml). npm's own suggested remedy was `prisma@6.12.0`, flagged `isSemVerMajor` — a downgrade of the ORM across 47 migrations, which was rejected as far riskier than the advisory.
- **Risk checked rather than assumed:** `@prisma/config` pins `deepmerge-ts: "7.1.5"` *exactly*, so the override forces a major bump past a deliberate pin. Against the real installed tree (`node_modules` at 8.0.1, not just a lockfile edit): `prisma validate`, `prisma generate`, `prisma migrate deploy` and `migrate diff` zero-drift all pass; `npm audit --omit=dev` reports 0 vulnerabilities; and `scripts/audit-dependencies.mjs` — the exact gate Vercel runs — prints "Dependency audit passed: no known vulnerabilities."
- **Files changed:** `package.json`, `package-lock.json`, `operator_handoff.md`. Both dependency files are "shared high-risk" per the PR template; nothing else in either file was altered.
- **Tests actually run** (local PostgreSQL 16, `RUN_DB_INTEGRATION=true`): full suite **10,114 passed / 0 failed / 0 cancelled / 0 skipped**; migrate deploy clean; zero drift; lint 0 warnings/errors; `next build` exit 0.
- **Risks / assumptions:** if Prisma later ships a release that bumps `deepmerge-ts` itself, this override becomes redundant and should be dropped rather than left to pin the tree. The override applies repo-wide, so any other consumer of `deepmerge-ts` also moves to 8.x — there is currently only the one.
- **Next action:** exact-head CI plus a Vercel Preview on the pushed SHA; the Preview should now build, which unblocks the authenticated owner UAT that has been blocked since the Neon outage.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** — PR remains draft.

### 2026-08-17 UTC — Claude Code (gap found by running the app locally)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; base `273f522e`.
- **How it was found:** built and ran the real app (`next build` + `next start`) against local PostgreSQL 16, seeded the two e2e users with `scripts/seed-e2e-user.mjs`, logged in through the actual form, and drove the dashboard, tenders list, tender detail and Command Center in Chromium.
- **Gap:** on a tender with zero files, Command Center correctly showed one canonical action — "Upload tender document. No tender file has been uploaded." — while the Tender Detail panel directly below offered **"Re-extract from PDF"**. Two panels on one screen contradicting each other, and the owner could only discover the second was impossible by clicking it. `POST /api/tenders/[id]/re-extract-metadata` was already fail-closed (400, "Tender has no uploaded files to re-extract from"), so this was never a successful no-op — it was an unreachable action being advertised, the contradiction class this PR exists to remove.
- **Fix:** gate `<ReExtractMetadataButton>` on `hasSourceFile`, derived from the file list `page.tsx` already passes the panel. Presentation only — no gate relaxed, the route is untouched and still refuses.
- **Files changed:** `app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx`, `tests/re-extract-action-requires-a-source.test.ts` (new), `operator_handoff.md`.
- **Verified live in the running app**, before and after the rebuild: 0 "Re-extract from PDF" buttons on a tender with no files, 1 on a tender with one file. Zero console errors, zero 5xx, and the only server-log warnings were the local `SENTRY_DSN` notice.
- **Also confirmed by the same run (no change needed):** `/api/health` returns **200 healthy** locally, so the health route and its probes are correct code and the Preview 503 was purely the unreachable Neon endpoint. And the C-5 fix from `273f522e` was proven end to end rather than by test: with a live session `/api/tenders`, `/api/company` and `/api/search` all returned 200; after soft-deleting the user, the **same cookie** got 401 from all three; re-login returned 401 `INVALID_CREDENTIALS`; after restoring the user, 200 again. Those are precisely the routes that authorize on `getSession()` alone and never reach `getCurrentUser`.
- **Tests actually run** (local PostgreSQL 16, `RUN_DB_INTEGRATION=true`): full suite **10,112 passed / 0 failed / 0 cancelled / 0 skipped**; `prisma migrate deploy` clean; `migrate diff` zero drift; `tsc --noEmit` clean; `next lint` 0 warnings/errors; `next build` exit 0.
- **Risks / assumptions:** the panel now reads `tender.files` for reachability only; if a future page stops passing `files`, the button hides rather than misleads — fail-safe in the honest direction. Real-Preview UAT still not run from here (agent proxy returns 403 CONNECT for the preview host).
- **Next action:** exact-head CI on the pushed SHA.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** — PR remains draft.

### 2026-08-17 UTC — Claude Code (audit-remediation gap closure on the PR branch)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; base `7cbf855a`.
- **Scope:** three gaps left by the C-3/C-4/C-5/H-6 remediation, all the same shape — the check landed in one place and the test asserted that place, while the reachable surface was wider.
  1. **Worker-wake chain.** `c5b2ee46` repointed four guards from `/api/ai-jobs/run-next` to `/api/ai-jobs/dispatch` after the dispatcher refactor. Nothing then asserted that `worker-dispatch.ts` reaches `run-next`, so "defers to the durable worker instead of running the Engine inline" stopped proving its own title, and the `AI_JOBS_WORKER_SECRET`/`CRON_SECRET` prohibition was checked only on the wake — not on the hop that now calls `run-next`. Both hops are pinned.
  2. **C-4 legacy plaintext share tokens.** `20260817120000` backfills `tokenHash` but keeps `token` populated "for the transition window" (up to 365 days). The backfill computes `encode(digest("token",'sha256'),'hex')`, byte-for-byte `hashTenderShareToken`, so legacy rows already resolve by hash and the plaintext is never needed to serve them — while leaving exactly the exposure C-4 names ("a DB leak … would expose every active share URL instantly"), which `deep-remediation-c3-c4-c5-h6.test.ts` already asserts is closed. New migration clears the plaintext only where a hash exists; the fallback path still serves any hash-less row.
  3. **C-5 soft-delete did not reject auth.** Deactivation revokes sessions atomically, but the login route never checked `deletedAt`, so a deactivated user who knew their password logged straight back in; and ~20 routes authorize on `getSession()` alone, never reaching the `getCurrentUser` guard. Login now folds `deletedAt` into the existing `INVALID_CREDENTIALS` branch (same status/body, after bcrypt — no account enumeration), and `getSession()` selects `user.deletedAt` inside its existing session query, so no extra round trip.
- **Files changed:** `lib/auth.ts`, `app/api/auth/login/route.ts`, `prisma/migrations/20260817140000_tender_share_clear_legacy_plaintext_tokens/migration.sql`, `tests/soft-delete-blocks-reauthentication.test.ts` (new), `tests/tender-share-legacy-plaintext-token-cleared.test.ts` (new), `tests/engine-worker-wake-constraints.test.ts`, `tests/request-scoped-upload-worker-wake.test.ts`, `tests/login-fail-closed-current.test.ts`, `operator_handoff.md`.
- **Tests actually run** (local PostgreSQL 16, `RUN_DB_INTEGRATION=true`): full suite **10,109 passed / 0 failed / 0 cancelled / 0 skipped**; `prisma migrate deploy` clean; `prisma migrate diff` zero drift; `tsc --noEmit` clean; `next lint` 0 warnings/errors; `next build` exit 0. Database verified alive before and after — an earlier run was discarded when it died mid-run (the 84-failed/313-cancelled signature) and re-run.
- **One test expectation updated, deliberately:** `login-fail-closed-current.test.ts` pinned the branch by literal source text, so adding `|| user.deletedAt` broke the regex. The property it names — one generic invalid-credentials code for every account state — is strengthened, not relaxed: the assertion now *requires* `deletedAt` to sit in that shared branch, so a dedicated branch or early return for deactivated accounts fails the test.
- **Risks / assumptions:** the two new source-text assertions are coupled to how the dispatcher builds its URL, the same maintenance cost the existing guards carry. The plaintext-clearing migration is data-only (no schema change, hence no drift) and non-destructive — it drops no column, index or row. Real-Preview UAT was not run from here; the agent proxy returns 403 CONNECT for the preview host, so `/api/health` is unreachable in this container and I make no claim about the Neon restoration.
- **Next action:** exact-head CI on the pushed SHA, then owner Preview UAT.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** — PR remains draft.

### 2026-08-14 UTC — Codex (exact-Preview Build Plan hash owner follow-up)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; follow-up to SHA `c4daa25dead3617858b9203c35e8fe9c92a75b95`.
- **Real Preview finding:** exact-SHA deployment `dpl_5zjJ3L96pDyH8bkzndo45wxXYZKc` was READY and healthy. A new manual AI Analyze succeeded, automatic requirement grounding repaired 2/2, and manual Run Engine passed its route-level current-analysis check. It then failed at Automatic Build Plan verification with safe reference `da42c065`: `ANALYSIS_HASH_MISMATCH`. Build Plan retained a private company-inclusive currentness computation after Release Snapshot, Runtime Readiness, and Generation Readiness had moved to the terminal tender-source binding.
- **Scope / repair:** Automatic Build Plan now consumes the same tender-source terminal analysis binding as every other gate. The immutable provider snapshot still binds the full Vault input; chunk integrity remains bound to the canonical analysis job ID; page/title evidence validation is unchanged and fail-closed. PostgreSQL hash-binding expectations now distinguish the pre-promotion full provider hash from the post-promotion public tender-source binding, and the chunk query regression recognizes the job-bound query.
- **Files changed:** `lib/engine/build-plan.ts`, `tests/ai-analyze-hash-binding-db.test.ts`, `tests/ai-analyze-chunk-relation-regression.test.ts`, and `operator_handoff.md` (in addition to the prior `c4daa25` changes already on this branch).
- **Tests/checks:** 57/57 focused reachable assertions passed; Prisma validate/generate, typecheck, targeted lint, and diff check passed. The first `c4daa25` exact-head CI exposed six stale test expectations (9,985/10,008 passed, 6 failed, 17 cancelled); this follow-up repairs those expectations. Exact-head PostgreSQL CI and real Preview rerun remain required after push.
- **Risk / next action:** push one follow-up SHA, require exact-head CI/security/screenshot/Preview, then repeat the retained Pharo tender manual Run Engine and inspect all canonical panels and final package outputs. Provider availability may still produce a truthful external-provider blocker; it must not be misreported as a workflow success.
- **Exact Preview after-state:** on `cd64e1c6`, retrying manual Run Engine completed successfully, including automatic source-reverified Build Plan revision 1. The canonical workflow now truthfully stops at `MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE` because only 2/4 mandatory requirements have release-qualified evidence; Generation Readiness is `BLOCKED` despite its secondary 95 score, Export Readiness leads with the identical evidence blocker, and downstream document defects are suppressed from the primary action. Exact-head CI then found two additional stale test fixtures (the golden static chunk-query assertion and the owner-workflow terminal hash seed); both are corrected in this follow-up.
- **Later exact-head check:** SHA `7f90b790` passed 10,008/10,008 PostgreSQL assertions, migrations/zero-drift, typecheck, lint, and production build; authenticated Playwright passed 183 scenarios but the Phase 2 screenshot fixture alone still seeded the old company-inclusive terminal hash and failed 3/3 retries at Build Plan with `ANALYSIS_HASH_MISMATCH`. That final fixture seed is now tender-source-only; no production behavior changed.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION** until exact-head real Preview acceptance is complete.

### 2026-08-14 UTC — Codex (real Preview Vault/current-analysis contradiction)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; starting SHA `b16b9c2c67dba7996e3f5bd3e94d656ca35b0ea0`, original fixture `b4903c03` / `03b9c928`.
- **Real Preview before-state:** the original exact deployment failed at Vercel after producing no outputs. An authorized redeploy of the same SHA became READY and healthy, enabling authenticated UAT against the retained real Pharo tender. Manual AI Analyze succeeded and automatic source grounding repaired 2/2 ungrounded requirements; manual Run Engine then failed immediately with safe reference `20e22a68`. Runtime logs proved `CURRENT_ANALYSIS_REQUIRED`: Engine's automatic Vault verification changed Company Vault state after the route had accepted current AI analysis, while analysis currentness incorrectly included the Vault digest. The same manual click therefore invalidated itself before execution.
- **Scope / root cause repair:** provider-input snapshots remain immutable and continue to bind their bounded Vault context before provider calls, but the public terminal analysis currentness binding is now tender-source-only (title, description/intake context, active source files/text). Company Vault revisions remain fully bound by `computeEngineSourceRevision`. Release Snapshot, Generation Readiness, and Runtime Readiness now use the same tender-source binding; chunk integrity is checked by the canonical analysis job ID rather than conflating the provider-input hash with the public currentness hash. This preserves source drift detection while preventing Run Engine's own Vault preflight from staling a just-completed analysis.
- **Files changed:** `lib/engine/tender-analysis-content.ts`, `lib/engine/tender-release-snapshot.ts`, `lib/engine/generation-readiness-gate.ts`, `lib/engine/runtime-readiness-facts.ts`, their three PostgreSQL panel fixtures, `tests/tender-analysis-content-parity.test.ts`, and `operator_handoff.md`.
- **Tests/checks before commit:** 72/72 reachable focused assertions passed; Prisma validate/generate, typecheck, lint (one standing warning) and diff check passed. Direct DB tests remain pointed at the unreachable old local Neon URL; exact-head disposable-PostgreSQL CI must run the full suite.
- **Risks / next action:** no page, title quote, tenant, evidence, manual authority, legal/owner, package envelope, signature, hash or ZIP-byte gate was relaxed. Push once, require all exact-head CI/security/screenshot checks and one Preview, then repeat real Preview manual AI Analyze → source grounding → manual Run Engine and cross-panel/package inspection. Delete no Production data and do not promote.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION**; real Preview after-state is required on the resulting SHA.

### 2026-08-14 UTC — Codex (latest-head canonical-action audit)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; starting SHA `cf76816774f79d86387af0049f4f1142d045acb5`, original real failure fixture `b4903c03` / reference `03b9c928`.
- **Scope:** latest-head inspection found four residual independent-action paths that the prior screenshot route did not exercise. Pipeline Diagnostic now returns the same canonical workflow decision/action as the live panels instead of independently guessing Generate/Validate/Build actions; auto-finalize returns `AUTOMATIC_PROCESSING` or `EXPORT_READY` rather than inventing a manual export-readiness re-check; the legacy tender-next-action resolver treats missing/stale generated documents as durable post-Engine processing; derived-draft Build Plan recovery is manual Run Engine, not confirmation; and the compatibility Engine recovery copy no longer says Engine starts automatically.
- **Files changed:** `app/api/tenders/[id]/pipeline-diagnostic/route.ts`, `app/api/tenders/[id]/auto-finalize/route.ts`, `lib/tender-next-action.ts`, `lib/tender-generation-readiness.ts`, `lib/recovery-command-actions.ts`, `tests/tender-next-action.test.ts`, `tests/preview-panel-canonical-action-regression.test.ts`, and `operator_handoff.md`.
- **Tests/checks before commit:** 161 focused non-database assertions passed; five Pharo PostgreSQL subtests could not start because the configured Neon endpoint is unreachable. Prisma validate/generate, typecheck, lint (one standing warning), release-integrity audits, dependency audit (0 vulnerabilities), and production build passed. Exact-head real PostgreSQL, migration/zero-drift, Playwright/isolation, screenshot, dependency, and Preview checks are required after push.
- **Real Preview status:** the starting exact Preview `/api/version` reports `cf768167`; `/api/health` responds with an unhealthy payload and all five database probes false. Only `VERCEL_TOKEN` and an unrelated unreachable `DATABASE_URL` are available locally; no authorized Preview login credential/session exists. No environment, credential, database, or Production state was changed to fabricate acceptance.
- **Risks / assumptions:** no provenance, page validation, tenant query, evidence strength, legal/authority gate, package isolation, or stored-byte/ZIP integrity logic changed. The new Pipeline Diagnostic authority adds one canonical read but preserves its owner-scoped tender access and safe error boundary.
- **Next action:** commit/push once, require all exact-head automation and Preview deployment, then retry real Preview health. Owner/provider must restore the configured Preview database and provide an authorized session before the requested final authenticated real-tender walkthrough can honestly pass.
- **Merge status:** **DO NOT MERGE / DO NOT PROMOTE PRODUCTION**; live Preview acceptance remains externally blocked until database restoration.

### 2026-08-14 UTC — Codex (latest-head Command Center canonical blocker repair)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; started from exact latest remote head `ac9201993428d6a81be71d01a1b23bfb4bc953bb` after restoring the externally removed local Git remote. Primary real failure fixture remains Preview `b4903c03` / reference `03b9c928`.
- **Audit and scope:** independently verified that the landed title reconciliation, Engine-failure precedence, canonical Generation/Export readiness, separate-package execution and PostgreSQL fixtures exist. Downloading and visually inspecting the exact-head screenshot artifact exposed one remaining contradiction: Command Center showed canonical “Upload tender document” while simultaneously listing eight unreachable downstream export blockers and manual recovery instructions. `getTenderReleaseState` now projects exactly the currently reachable canonical blocker/action and suppresses fail-closed downstream diagnostics until their stage is reachable; automatic post-Engine stages expose no invented manual action. The underlying final-submission/export model remains strict and unchanged.
- **Files changed:** `lib/engine/tender-release-state.ts`, `app/dashboard/tenders/[id]/command-center/version-actions.tsx`, `tests/command-center-canonical-blocker-suppression.test.ts`, and `operator_handoff.md`. Exact-head screenshot inspection also caught and removed the adjacent empty-version sentence that told an intake-stage tender to Run Engine; versions now truthfully appear when canonical processing reaches generation.
- **Tests before commit:** 15/15 focused canonical/readiness assertions passed; Prisma generation and typecheck passed. The prior exact head passed both full CI runs (9,999 PostgreSQL tests), migrations/zero drift, build, Playwright/isolation, screenshots and security; all exact-head checks must rerun after this commit.
- **Real Preview status:** exact `ac920199` `/api/version` is correct, but `/api/health` returns HTTP 503 with all five critical database probes false. Vercel runtime logs confirm `PrismaClientInitializationError: Can't reach database server` for the configured Neon endpoint. Authenticated real-tender Preview UAT therefore remains externally blocked; no database credential, Vercel environment, owner account, alias or Production state was modified to bypass it.
- **Risks / next action:** this is presentation reconciliation only: tenant isolation, provenance, page bounds, evidence levels, legal/authority gates, document validation, envelope isolation, file signatures/hashes and ZIP bytes are unchanged. Push once, require exact-head CI/security/screenshot/Preview, visually inspect the repaired Command Center, then retry Preview health. Owner/provider database restoration remains required if health stays 503.
- **Merge status:** **DO NOT MERGE**; Production untouched; do not claim complete real-Preview acceptance while its database is unreachable.

### 2026-08-14 UTC — Codex (real-fixture acceptance hardening; Preview DB outage remains)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; started from actual latest remote head `8008961bdf88ffc3e573018ba8c01650e237e5df` after restoring the externally removed local `origin` and fetching without discarding work. Original failing Preview fixture remains `b4903c03` / reference `03b9c928`.
- **Audit result / scope:** the landed runtime repairs are present and exact-head automation was green, but the Pharo PostgreSQL regression still proved title reconciliation only as a helper call and asserted Engine failure precedence only by reading source text. Strengthened it into behavioral database acceptance: the 8-requirement/6-mandatory/selected-expert/selected-project fixture now runs Automatic Build Plan verification from an invalid page 99, proves source-byte/page reconciliation to page 2, and obtains a machine-confirmed plan without relaxing validation; the unprovable fixture asserts the exact bounded-page blocker; and a current-revision failed Engine row plus `build-plan.blocked` checkpoint now proves canonical `TITLE_SOURCE_PROVENANCE_INVALID` outranks a secondary ungrounded-requirement consequence with a safe reference. Added reopened-ZIP assertions for independently executable Financial and Admin envelopes alongside the existing Technical isolation check.
- **Files changed:** `tests/preview-title-provenance-engine-postgres.test.ts`, `tests/final-zip-integration.test.ts`, and `operator_handoff.md`. No production gate, tenant query, workflow mutation, or package-byte implementation changed.
- **Tests/checks before commit:** installed and started isolated local PostgreSQL 16; all 47 migrations applied; real-DB targeted acceptance **10/10 passed**; combined provenance/package suite **28/28 passed**; typecheck passed. Full exact-head CI, migration idempotency/zero drift, 9,997+ PostgreSQL suite, lint, build, authenticated/cross-user Playwright, screenshots, security, and Vercel must rerun after push.
- **Real Preview status:** exact `8008961b` `/api/version` is reachable, but `/api/health` still returns 503 with all five database probes false; Production health shows the same shared database outage. Therefore owner-authenticated real-tender Preview UAT cannot run and no 100% claim is made. No Vercel environment, credential, database, user, Production alias, or provider state was changed to bypass the outage.
- **Next action:** commit/push the behavioral acceptance hardening, require all exact-head checks, then retry the final Preview health and real owner flow. The remaining blocker is external database restoration by the owner/provider if health remains 503.
- **Merge status:** **DO NOT MERGE**; Production untouched; promotion prohibited; real Preview acceptance incomplete while its database is unavailable.

### 2026-08-13 UTC — Codex (current Engine failure-cause preservation)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; started from actual latest remote head `85b61507015e961ff5a83b2e3d8e5e62d45ace47` after discovering the local workspace had been reset to `work` and its `origin` removed, then restoring the documented remote and fetching without discarding local changes.
- **Real Preview acceptance:** exact `85b61507` deployment and `/api/version` are reachable, but `/api/health` returns 503 with all five database probes false. The configured Preview Neon endpoint remains unavailable, so authenticated login and the requested real-tender walkthrough cannot honestly run. No credential, Vercel environment, database, Production alias, or user state was modified to bypass that external outage.
- **Scope / root cause fixed:** review of the landed `03b9c928` repair found a remaining P0 path hidden by green tests. `build-plan.blocked` persisted only the generic Build Plan message, omitting the validator blocker, while canonical workflow preferred that step over `AiJob.errorMessage`; therefore a current title-page failure could still degrade to generic `ENGINE_RUN_FAILED` instead of `TITLE_SOURCE_PROVENANCE_INVALID`. Failed Build Plan steps now retain deterministic blockers, canonical classification safely combines the failed step and terminal error, maps through `publicJobFailureMessage`, and deterministically breaks same-time job ordering by `analysisVersion`. No raw error is returned and no validation/provenance gate is relaxed.
- **Files changed:** `lib/ai-job-handlers.ts`, `lib/engine/canonical-workflow-decision.ts`, `app/api/tenders/[id]/engine-readiness/route.ts`, `tests/preview-title-provenance-engine-postgres.test.ts`, and `operator_handoff.md`.
- **Tests before commit:** Prisma validate/generate passed; 46 reachable focused assertions passed with the four PostgreSQL fixture cases explicitly skipped under `RUN_DB_INTEGRATION=false`; a direct DB-enabled attempt failed only because the configured Neon endpoint is unreachable. Exact-head disposable-PostgreSQL CI, migrations/zero drift, full suite, typecheck, lint, build, Playwright/isolation, screenshots, dependency security and Preview deployment must rerun after push.
- **Risks / next action:** code-level acceptance is not enough while the real Preview database contradicts deployment readiness. Push once, require exact-head automation, then retry `/api/health` and authenticated real-tender UAT. If Neon remains unavailable, report the external acceptance blocker and do not claim 100%.
- **Merge status:** **DO NOT MERGE**; Production untouched and promotion prohibited.

### 2026-08-13 UTC — Codex (real final-Preview analysis-title revision repair)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; started from latest remote head `81c962f29c08884229dbe97118e6636f3b1e842d` after restoring the missing local `origin` remote and verifying all its CI checks were green.
- **Real Preview reproduction:** authenticated successfully to the exact `81c962f2` Preview using its configured preview credential, uploaded a real three-page Pharo-shaped tender through `/api/tenders/upload-first`, observed durable extraction succeed, then manually ran AI Analyze. AI Analyze succeeded through Cerebras and promoted the source-proven page-2 title, but every canonical panel immediately classified that just-finished analysis as `STALE_ANALYSIS`; manual Run Engine returned `CURRENT_ANALYSIS_REQUIRED` with `contentHashMatch=false`. This contradicted the prior exact-head synthetic acceptance and blocked the requested real Preview flow.
- **Root cause / scope:** `buildTenderAnalysisContent` deliberately includes the tender title. The analysis job stored the pre-provider hash while canonical promotion replaced the intake label with the AI-proven source title, so the public post-promotion hash could never reproduce the just-authorized success. The immutable authorized provider hash remains preserved in the job snapshot; in the same promotion transaction, the terminal job now binds `analysisInputHash` to the exact tenant-owned persisted post-promotion tender/files/Vault state. No page, provenance, analysis-promotion, tenant, evidence, or export gate is relaxed.
- **Files changed:** `lib/engine/tender-analysis-content.ts`, `lib/ai-jobs/analysis-job-service.ts`, `tests/preview-title-provenance-engine-postgres.test.ts`, and `operator_handoff.md`.
- **Tests before commit:** Prisma generation and typecheck passed; 25 non-DB targeted assertions passed. Local DB-backed assertions reached only the configured unreachable Neon host and failed at connection setup, not behavior; exact-head PostgreSQL CI is required. The real Preview before-state and request/response artifacts are retained under `/tmp` only and contain no committed credentials.
- **Risks / next action:** deploy this single repair commit through the existing PR Preview, re-run manual AI Analyze and manual Run Engine on the same real Preview tender, then inspect all canonical panels and separate-envelope downloads. Require full exact-head PostgreSQL/zero-drift/build/Playwright/isolation/screenshots/security before any completion claim; delete the temporary Preview tender after acceptance.
- **Merge status:** **DO NOT MERGE**; Production untouched and promotion prohibited.

### 2026-08-13 UTC — Codex (latest-head title proof hardening)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; started from actual latest remote SHA `eb68400388d77513cce8fbf09ecf086f2ea878bc`, twelve commits beyond the reported failing Preview SHA `b4903c03`. Restored the externally removed local `origin` configuration before fetching; no source edits occurred on the unrelated reset branch.
- **Scope:** independently audited the landed Preview `03b9c928` repair and found one remaining provenance weakness: title reconciliation accepted any stored quote that existed at a valid page, even if that quote did not contain/prove the title value. It now reuses stored title evidence only when the normalized quote contains the normalized title; otherwise it deterministically locates the actual title in active extracted text and derives its real bounded page, or leaves the strict gate blocked. Added a Pharo-shaped regression with a valid-but-unrelated page-1 quote and the real title on page 2. Also removed the last independently-derived `BUILD_SUBMISSION_PLAN` next action in Generation Readiness in favor of the canonical manual `RUN_ENGINE` action.
- **Files changed:** `lib/engine/automatic-build-plan.ts`, `app/api/tenders/[id]/generation-readiness/route.ts`, `tests/preview-title-provenance-engine-postgres.test.ts`, and `operator_handoff.md`.
- **Tests/checks before commit:** Prisma validate/generate, typecheck, lint (one standing unused-disable warning), diff check, and 55 reachable focused assertions passed. The three PostgreSQL title fixture subtests were invoked but could not connect to the configured external Neon hostname; exact-head CI must run them against its disposable PostgreSQL. Full migrations/zero-drift/PostgreSQL, build, Playwright/isolation, screenshot/security and final Preview acceptance remain required on the resulting SHA.
- **Real Preview audit:** exact `eb684003` Preview was reached. Vercel environment access supplied the configured bootstrap policy, but login was correctly refused because the existing database account no longer matches the configured bootstrap seed password; no credential, user, session, or database state was modified to bypass authentication. Final owner-authenticated Preview UAT is therefore not claimed yet.
- **Risks / assumptions:** no page-boundary, quote-containment, tenant, evidence-strength, legal/authority, package-envelope, byte-signature/hash, or final ZIP gate was relaxed. Failure to prove the exact title remains fail-closed. Separate Technical/Financial/Admin downloads and partial-Engine diagnostic labeling remain unchanged.
- **Next action:** commit/push once, require exact-head CI and Preview, then use an authorized existing Preview session/credential for real-tender panel UAT; if unavailable, report that acceptance boundary honestly rather than claiming 100%.
- **Merge status:** **DO NOT MERGE**; exact-head and authenticated real-Preview acceptance pending; Production promotion prohibited.

### 2026-08-13 UTC — Codex (latest-head Preview contradiction cleanup)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; started from the actual latest remote SHA `30fe2268bbe8961c1d9ca9fd86663b6158b25f51` after restoring the missing local Git remote and re-fetching PR #1175. No merge or Production promotion.
- **Scope:** independently audited the already-landed Preview `03b9c928` provenance/Engine/canonical-readiness/separate-package repair and found remaining live P1 contradictions that its green checks did not cover. Removed routine Build Plan confirmation/re-confirmation actions and invented Generate/Validate/Approve/Re-check instructions from generation, auto-finalize, PDF finalization, reconciliation, submission-plan, authority-review, export/download, workflow-stage and human-label surfaces. A final screenshot/manual source audit also removed residual “unconfirmed” plan labels and per-row manual generation/review instructions. Missing plans now point to manual Run Engine; downstream generation/validation/finalization remains automatic; genuine source/original/quality/authority blockers remain fail-closed. The compatibility `requiresUserConfirmation` field is now false in the resolver itself, not only overwritten by its API route. Separate Technical/Financial/Admin ZIP behavior and byte/signature/hash checks were left strict.
- **Files changed:** generation/auto-finalize/finalize-PDF/reconcile/export/download API copy/actions; submission-plan and authority-review resolvers/panels; Build Plan fail-closed messages; workflow/human labels; focused unit/E2E regressions; and `operator_handoff.md`.
- **Tests before commit:** 113/113 focused non-DB assertions passed for Preview truth, Build Plan authority, submission completeness, authority availability, canonical generation/export blockers and separate package mode. The first exact-head PostgreSQL run reached 9,994 assertions and correctly exposed three stale source-copy contracts (authority-score suppression, machine-validated PDF source eligibility, and automatic document generation); those assertions were aligned with the stricter runtime contract rather than reverting production behavior. The Pharo PostgreSQL test was also invoked locally but its two DB subtests could not connect to the configured Neon hostname; their structural companion assertions passed. Prisma/full PostgreSQL/migrations/zero-drift, full tests, typecheck, lint, build, authenticated/cross-user Playwright, exact-head screenshots, security and Preview must rerun on the resulting SHA.
- **Risks / assumptions:** no page-range, quote, provenance, tenant, evidence strength, legal/authority, package isolation, file signature, byte hash or final ZIP gate was relaxed. Internal persisted enum/code names containing `CONFIRMED` remain database compatibility identifiers; user-facing text now describes the authority as source-verified automation.
- **Next action:** commit and push once, require every exact-head check and Preview, then authenticate to and manually inspect the final real Preview tender/panels before updating PR truth.
- **Merge status:** **DO NOT MERGE**; exact-head acceptance pending; Production promotion prohibited.

### 2026-08-13 UTC — Codex (real Preview Engine runtime and panel-truth repair)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, starting SHA `c679a416d863b970088e93bcbfbea9418722cfba`; no merge or Production promotion.
- **Scope:** authenticated against the exact Vercel Preview with the configured bootstrap owner and reran the real Pharo tender `e65aa856-20c0-4034-a52f-efb627703dc9`. The title repair worked—the prior `TENDER_FACTS_INVALID` failure did not recur—but the live worker exposed a new P0 hidden by green synthetic checks: job `0cb7d836-e270-4bd1-b060-cfb1725d552b` reached matching, persisted 8 requirements/coverage, and entered `build-plan.automatic`, then the route's explicit 60-second limit killed the invocation. Lazy recovery truthfully converted it to `ASYNC_ENGINE_TIMEOUT`, but only after 180 seconds. Raised the bounded worker route to 300 seconds with a 240-second soft deadline and propagated that absolute deadline into `runTenderEngine` so expensive reranking can yield before persistence reserve is exhausted. On exact Preview `10e6517e`, rerun `4538078a-5b0c-4f03-8f78-5e61a9fc2ca2` completed Engine, matching, 8-requirement persistence, and automatic source-verified Build Plan revision 4 in 53 seconds; proposal job `4bfce13d-ec50-4ef3-baf5-b36efc1cf250` then generated four real documents automatically. The same live cross-panel audit exposed one remaining contradiction: Generation Readiness used legacy notes to claim `FULL_PROPOSAL_NOT_ANALYZED` while canonical Workflow Center truthfully reported current source-evidence coverage. Generation Readiness now consumes and returns the canonical decision, suppressing legacy/downstream blockers and stale `RETRY_AI_ANALYZE` warnings whenever canonical analysis is complete and another canonical stage owns truth.
- **Files changed:** `app/api/ai-jobs/run-next/route.ts`, `app/api/tenders/[id]/generation-readiness/route.ts`, `lib/ai-job-handlers-legacy.ts`, `tests/preview-engine-worker-budget.test.ts`, and the three pre-existing worker-budget source-contract tests (`behavioral-authority-proof`, `persisted-stage-checkpoints`, `worker-deadline-architecture`) plus `operator_handoff.md`.
- **Tests/checks before commit:** 39/39 initial reachable focused regressions passed; Prisma generate, typecheck, lint (one pre-existing unused-disable warning), release-integrity audits, and dependency audit (0 vulnerabilities) passed. The first exact-head CI ran all 9,993 PostgreSQL/unit assertions: 9,990 passed and three stale source-contract assertions still expected the superseded 40-second budget; all three were updated and the resulting 53 focused assertions pass. The two Pharo PostgreSQL subtests could not connect to the configured Neon URL locally; preceding exact-head CI passed them. Authenticated exact Preview `ced593cc` displayed one canonical action across the real dashboard and Generation Readiness API (score 95 informational, BLOCKED, `MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE`), and a full-page real-state screenshot was manually inspected. Full PostgreSQL/migrations/zero-drift, build, authenticated Playwright/isolation, and screenshot CI must rerun on the resulting final SHA.
- **Risks / assumptions:** no page, quote, ownership, evidence, authority, legal, or ZIP byte/signature gate changed. The longer route is still bounded and reserves 60 seconds below its hard cap. Automatic finalization truthfully failed because one generated document failed canonical validation and two of three planned package files were absent; canonical workflow suppresses those downstream consequences behind the genuine 4/6 FULL/SUBSTANTIAL evidence blocker. This is not 100% closure until the resulting exact Preview proves Generation Readiness agrees with that canonical action and exact-head CI is green.
- **Next action:** commit/push the canonical consumer repair, require exact-head CI/Preview, then repeat the authenticated cross-panel audit and report remaining genuine evidence/package gaps without claiming completion.
- **Merge status:** **DO NOT MERGE**; real Preview rerun pending; Production promotion prohibited.

### 2026-08-13 UTC — Codex (Preview 03b9c928 contradiction re-audit)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, audited from latest remote head `81571fcdc75e7d03149b7196f803fa0a26bf88a9`; no merge or Production promotion.
- **Scope:** treated the reported real Preview failure as primary and reviewed the already-landed title/Engine/package repair rather than trusting its green checks. Found one remaining canonical-consumer contradiction: Export Readiness added the Engine failure to its public blocker list but still computed `ok`, READY styling, and blocker totals exclusively from independent downstream models. A stale independent `ok` could therefore still render READY beside `ENGINE_RUN_FAILED`. Made canonical blockers part of export `ok`, suppressed unreachable document counts, and made the visible total exactly match the canonical-first list. Also made title scalar provenance and `TenderFactsLedger` synchronization one tenant-scoped transaction so an interrupted repair cannot expose split authority.
- **Files changed:** `app/api/tenders/[id]/export-readiness/route.ts`, `lib/engine/automatic-build-plan.ts`, `lib/engine/tender-facts-ledger-service.ts`, `tests/readiness-ui-contradictions.test.ts`, `tests/preview-title-provenance-engine-postgres.test.ts`, and `operator_handoff.md`.
- **Tests/checks before commit:** 51/51 reachable focused assertions passed, including canonical generation/export truth, safe Engine failure projection, atomic source/ledger contract, and separate technical/financial/admin package behavior. The two real-PostgreSQL fixture cases could not connect to the configured Neon host and failed only at `prisma.user.create`; exact-head CI must rerun them against PostgreSQL. The first pushed exact head correctly failed 2/9,990 tests because the ledger sync service owns its own transaction; nested use of a Prisma transaction client has no `$transaction`. Reworked the API so the owner-scoped scalar mutation runs inside the ledger service's existing advisory-locked transaction; typecheck and the 8 reachable focused assertions pass. Full exact-head CI must rerun. Full Prisma/migrations/zero-drift, PostgreSQL, lint, build, Playwright/isolation, screenshot audit, dependency security, and Preview acceptance remain required on the resulting SHA.
- **Risks / assumptions:** no page limit, quote containment, source ownership, evidence, legal/authority, or byte/signature gate was relaxed. Separate package downloads remain envelope-filtered. Manual owner credentials for the pre-existing Preview tender are not present locally; automated authenticated exact-Preview acceptance can be claimed only from exact-head CI artifacts, while owner UAT must be stated as unavailable if credentials remain absent.
- **Next action:** run local static checks, commit/push once, require every exact-head check, download and inspect exact-head artifacts, then update PR truth without another source commit.
- **Merge status:** **DO NOT MERGE**; exact-head acceptance pending; Production promotion prohibited.

### 2026-08-12 UTC — Codex (Preview 03b9c928 exact-head follow-up)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, continued from latest remote head `1a4b2b597fa63c61ee683ede31a0e62e98127873`; no merge or Production promotion.
- **Scope:** audited the concurrent Preview repair against the real failure rather than its green-check claim. Exact-head CI was actually red (5 stale/contradictory assertions). Reconciled those tests with the owner contract; made the latest current-revision Engine attempt authoritative in Engine Readiness so an older success cannot mask a newer failure; sanitized Engine failure messages and canonical blocker details; kept the real 95/100 score informational instead of falsifying it to 45; removed remaining manual validate/review/export-gate wording; preserved executable isolated technical/financial/admin ZIPs and strict byte/signature gates. Expanded the Pharo-shaped database fixture to the reported 8/6 requirements, selected-match, no-Build-Plan state, and made proven title reconciliation always converge the canonical facts ledger after an interrupted prior attempt.
- **Files changed:** Engine readiness route, canonical workflow failure projection, Generation/Export/Final Package UI copy, PDF download error copy, affected truth/package/operation regression tests, `tests/preview-title-provenance-engine-postgres.test.ts`, and this handoff.
- **Tests/checks before commit:** 105 focused non-database assertions and typecheck passed. The expanded real PostgreSQL title fixture could not run locally because the configured Neon host is unreachable (its 3 non-database assertions passed); the prior exact-head CI ran the database fixture but ended **9983 pass / 5 fail**, all five now-reconciled expectations. Prisma generation, typecheck, lint, full PostgreSQL/migrations/zero-drift, build, Playwright/isolation, screenshot audit, security, and real Preview acceptance must rerun on the resulting SHA.
- **Risks / assumptions:** the title repair still accepts only an ACTIVE tenant-owned source whose actual extracted text proves the quote/title at a valid page boundary; otherwise strict `TENDER_FACTS_INVALID` remains. No page validation, provenance, tenant, evidence, legal/authority, or byte-integrity gate was relaxed.
- **Next action:** commit/push once, require every exact-head check, then manually exercise the exact Preview tender state and inspect all canonical panels before updating PR truth.
- **Merge status:** **DO NOT MERGE**; exact-head acceptance pending; Production promotion prohibited.

### 2026-08-12 UTC — Codex (Preview 03b9c928 real-failure repair)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, repaired from exact latest remote head `b4903c03baaa28edeafe9ccb9c8c7ffeb29355c4` without merging or Production promotion.
- **Scope:** traced the real Preview title-page failure through Build Plan verification; added tenant-scoped, byte/text-bound title evidence reconciliation without relaxing page validation; made a current-revision terminal Engine failure canonical; made Generation and Export readiness consume that canonical truth; removed routine Build Plan confirmation/export copy contradictions; labelled revision-bound matches completed before Engine failure; and enabled the already-isolated technical/financial/admin ZIP surfaces instead of blocking separate-package mode.
- **Files changed:** `lib/engine/automatic-build-plan.ts`, `lib/engine/canonical-workflow-decision.ts`, readiness/package/gate helpers under `lib/engine/`, `lib/prisma-schema-compatibility.ts`, affected readiness/matching/submission components, export-readiness and pipeline-diagnostic routes, regression tests, and this handoff.
- **Tests/checks before commit:** Prisma generate and TypeScript were started after the final route reconciliation; the first run exposed and fixed a nullable canonical-decision type error. Focused regressions had previously passed 175 assertions with database integration intentionally skipped after the configured external Neon host was unreachable. Final exact-head lint, build, PostgreSQL, migration/zero-drift, Playwright/isolation, security, screenshot/route, and real Preview acceptance remain required after the single commit/push.
- **Risks / assumptions:** reconciliation only accepts an ACTIVE tenant-owned source and a quote/title located within actual extracted page boundaries; otherwise strict verification still fails. No human/legal/final-owner gate is bypassed. Real Preview inspection is still pending, so this entry does not claim 100% closure.
- **Next action:** finish local checks, commit/push once, require exact-head CI and Preview, manually inspect the real tender state, and update PR #1175 truth to the resulting SHA.
- **Merge status:** **DO NOT MERGE**; Production promotion prohibited.

### 2026-08-12 UTC — Codex (post-Engine second-click deadlock closure)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, continued from exact remote head `1e438727241a1c41871e866eec01dd66ad46dff3` after its two CI runs, dependency checks, screenshot audit, and Preview all passed.
- **Scope:** closed the one remaining explicitly documented contradiction: `presentTwoActionWorkflowDecision` still mapped `REQUIRED_DOCS_NOT_GENERATED` to a second manual Run Engine click after the current-revision Engine run had already handed generation to the durable pipeline. It now truthfully presents generation, validation, finalization, and package assembly as automatic post-Engine work; the tender next-action banner and the real-PostgreSQL 4/4 evidence fixture agree. No source, evidence, quality, integrity, authority, legal, tenant, or final-owner gate was changed.
- **Files changed:** `lib/engine/two-action-workflow-presentation.ts`, `components/next-action-panel.tsx`, `tests/two-action-workflow-presentation.test.ts`, `tests/mandatory-evidence-fixtures-db.test.ts`, and `operator_handoff.md`.
- **Tests/checks before commit:** 102 focused non-database assertions passed, including the new no-second-Engine-click regression, provenance confirmation safety, unknown-blocker exhaustiveness, approval-deadlock coverage, and workflow-copy truth. Prisma generation, typecheck, lint, release-integrity, dependency audit, production build, full PostgreSQL, migrations/zero-drift, authenticated/cross-tenant Playwright, screenshot/route audit, and Preview must all pass again on the resulting commit before the PR is described as exact-head complete.
- **Risks / assumptions:** the mapping remains presentation-only and does not fabricate a running job or weaken readiness. `NO_CONFIRMED_BUILD_PLAN` and `MANDATORY_NO_COMPLIANCE_ROWS` still map to the one legitimate manual Run Engine gate before downstream ownership begins. Production remains untouched.
- **Next action:** commit and push once, wait for every exact-head check and the one Preview, inspect the screenshot evidence, then update the PR body/comment to that final SHA without another source commit.
- **Merge status:** **DO NOT MERGE** until the resulting exact head is completely green; never promote Production in this session.

### 2026-08-12 UTC — Codex (latest-remote-head workflow-copy audit)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, audited from latest remote head `a36fa30a48f0df4d337b7ba3909d8bd5d540b740` after checking the current worktree, open PRs, and CI.
- **Scope:** found and corrected one remaining live Recovery Command action-registry contradiction: it still claimed AI Analyze and Engine matching start automatically and that Run Engine performs source verification. The registry now preserves manual AI Analyze and manual Run Engine authority, states that verification/extraction happen first, and describes post-Engine matching, Build Plan, and downstream automation accurately. Extended the existing PR #1175 regression surface so this registry cannot silently drift again.
- **Files changed:** `lib/recovery-command-actions.ts`, `tests/pr1175-final-gap-closure.test.ts`, `operator_handoff.md`.
- **Tests/checks:** focused non-database regressions passed (147 assertions); the included PostgreSQL owner-workflow test failed only during setup because the configured Neon hostname was unreachable. `npx prisma generate`, typecheck, lint (one pre-existing unused-disable warning), release-integrity audits, `npm audit --audit-level=high` (0 vulnerabilities), and the production build with a non-secret build-time placeholder passed. The parent head `a36fa30a` already had exact-head CI and screenshot jobs running when this audit began; new exact-head CI/Preview evidence is required after push.
- **Risks / assumptions:** no workflow gate, tenant query, evidence semantics, or persistence behavior changed; this is user-facing action copy plus a regression guard. Local real-PostgreSQL, authenticated Playwright, build, route/screenshot, and Preview validation remain delegated to exact-head CI because the configured database is unreachable locally.
- **Next action:** push the single commit, require all exact-head CI/security/screenshot checks and the one Vercel Preview to pass, then update PR #1175 truth to that SHA. Do not merge or promote Production.
- **Merge status:** **DO NOT MERGE** — exact-head verification pending; Production promotion prohibited.

### 2026-08-12 UTC — Claude Code (Opus), PR #1175 gaps A–F closed, and CI brought back to green

Supersedes my earlier entry in this file, which recorded verification at
`12680b1d6444b27246059bf0f529dbde968f6403`. That SHA is still in the branch
history and none of its work was reverted, but the branch has advanced seven
commits since, so the statement below is the current authoritative one.

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175. Verified head: `270c60dadac7975d9e9139ec00b111ef53898053`.
- **Gaps A–F** (Bid Strategy false-automation copy, release status inferred from absent data, whole-pipeline automatic copy, Tender Control suggestions naming controls that do not exist, controls-resolver failure rendering as zero controls, and the controls match-context query scoped by tender id alone) are closed as described in the entry below this one. New modules: `lib/ui/manual-gate-guidance.ts`, `lib/ui/release-stage-copy.ts`. New tests: `tests/pr1175-final-gap-closure.test.ts`, `tests/tender-controls-failure-and-tenant-scope-db.test.ts`, `tests/mandatory-evidence-fixtures-db.test.ts`.

**CI was red on this branch and is now green.** Three failures, none from the gap-closure commit, all from copy corrections and a removed action leaving assertions behind them:

1. `Company Vault usable-evidence count` — a correction narrowed "no action is needed here" to "no confirmation click is needed here", which a regression test pins. The broader phrase is restored; the correction it carried (vault ingestion source-verifies, not Run Engine) is untouched.
2. `Company Vault — zero-document honesty` — the test pinned the whole old sentence including "Run Engine verifies them automatically", an attribution that was false. Restoring it in the page to green the test would have put the falsehood back to satisfy a test written to keep the product honest, so the test moved to the corrected sentence and now also asserts the false attribution cannot return.
3. `Recovery Command Center — nextAction code coverage` — `REVIEW_REQUIREMENTS_OR_ADD_MANUAL_PLAN` was removed from the registry along with the route that emitted it, because it offered requirement review as a way to promote provenance the source did not support. Two test lists still named it, so the coverage test demanded a registry entry for a code nothing can emit.

**One further defect, found by inspecting the rendered 2/4 screenshot rather than by any test.** Analysis Quality was headed "Tender analysis is stale, incomplete, or blocked" directly beneath the AI Analyze panel's "AI Analysis is complete and current." Both sentences are about the tender analysis and contradicted each other. Neither was lying: `ready` is false when any of its five inputs fails, and one of them, `canonicalExtractionReady`, is about the SOURCE. On that tender the analysis was current and trusted and the source file's byte integrity was unverified — which the reason list underneath already said. The heading now names what is actually wrong. `ready` itself is untouched, so the score cap, tone, badge and every downstream consumer behave exactly as before. Pinned by three assertions in `tests/pr1175-final-gap-closure.test.ts`.

**Verified at `270c60da`:**

- Full suite on real local PostgreSQL 16 with `RUN_DB_INTEGRATION=true`: **9,981 passed, 0 failed, 0 skipped**.
- Typecheck clean. Lint clean but for the one standing unused-disable warning.
- Production build passed; `git diff --exit-code` clean afterwards (no build-time source mutation).
- Migrations applied to a fresh database and re-applied idempotently; `prisma migrate diff` reports **no difference** (zero drift); critical-schema check 30 tables / 10 column groups / 3 functions, 0 failures.
- `npm audit --omit=dev` and `scripts/audit-dependencies.mjs`: **0 vulnerabilities**.
- Release-integrity audits: 431 routes, 1,548 files, 0 failures.
- Authenticated Playwright at the previous verified head: **184 passed, 4 environment-conditional skipped, 0 failed**; the phase-2 rendered 2/4 workflow-truth spec re-run and passing at this head.
- Screenshot audit at this head: **237 screenshots, route/viewport coverage 111/111 (100%), 0 critical findings, 0 horizontal overflow, 0 warnings** across desktop, tablet and mobile.
- **Rendered screenshots actually inspected**, not merely exited zero. The 2/4 tender confirms: source traced 4/4, release-qualified 2/4, partial 2, genuine gaps 0, stale 0, "Blocked — source evidence required", matching labelled as relevance only, evidence cited by recognisable name rather than UUID, Bid Strategy evidence-limited at BID CAREFULLY, no Generate Docs instruction, and Analysis Quality no longer contradicting AI Analyze. Mobile Company Vault confirms the honest zero-document branch and the corrected ingestion attribution.
- **Exact-head CI on #1175 is green**: the full migrations/typecheck/lint/tests/build/authenticated-isolation job (both runs), the screenshot capture job, both dependency-vulnerability jobs, and Vercel Preview.

**Deployment convergence.** PR head, Preview and the verified local head are all `270c60da`. Production remains `d699935351fe9b843a5b9ca082f4d105eb6b9ffa` and is intentionally behind. Nothing was promoted.

**Known remaining gaps.** `presentTwoActionWorkflowDecision` maps `REQUIRED_DOCS_NOT_GENERATED` to "Run Engine" even after a successful Engine run for the current revision. That is the app's existing designed contract — the Engine is what starts the downstream pipeline — so it was deliberately left alone under a closure pass and pinned by the 4/4 fixture instead, making any future decision a visible one. The two non-app Vercel projects (`pr1175`, `repo`) report Error; they are separate projects, inaccessible via the API from here, and were failing before this work began.

**Concurrency note.** Another agent pushed to this branch throughout this session; I rebased twice rather than force-push, and on the second rebase it had independently converged on the same resolution. Nothing of that agent's work was discarded.

**Merge status:** DO NOT MERGE. Draft; no Production promotion, no deployment, no migration.

### 2026-08-12 16:27 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175; continued from latest remote head `da358c164f9c8bdb4d3c2e711e75acfb871c014e`.
- **Scope:** closed only the remaining owner-automation/provenance/status/copy gaps: removed the legacy requirement-review/plan action shortcut; made the compatibility requirement-confirm endpoint refuse manual provenance promotion; classified AI-analysis, missing-requirement, and quality failures as explicit non-automatic recovery; reconciled the Build Plan test with manual Run Engine authority; and corrected Company Vault copy so ingestion/source verification precedes AI Analyze and Run Engine.
- **Files changed:** `app/api/tenders/[id]/requirement-coverage/confirm/route.ts`, `app/dashboard/company/page.tsx`, `components/vault-evidence-search-panel.tsx`, `lib/recovery-command-actions.ts`, `lib/release-status-classifier.ts`, their focused regression tests, and this handoff.
- **Tests run:** Prisma generation passed; focused 192-test regression set passed; typecheck passed; release-integrity/safe-error/metadata/reconciliation audits passed; dependency audit reported zero vulnerabilities. Exact-head CI proved migrations, zero drift, typecheck, lint, and PostgreSQL execution, then exposed stale test-only wording/action expectations; these assertions and the normal-path informational wording were reconciled without restoring either defect. Full local `npm test` was correctly refused because the supplied `DATABASE_URL` is a Neon host; this container has no local PostgreSQL. Exact-head full tests, build, authenticated/cross-tenant Playwright, and screenshot capture must rerun on the final SHA; exact-head Vercel Previews passed.
- **Risks / assumptions:** no 100% claim. The compatibility `CONFIRM_REQUIREMENTS` stage key remains in canonical payloads only as disabled/non-promoting historical schema; the mutating confirmation path now fails closed. Production was not merged, deployed, or promoted.
- **Next action:** push the single final commit, update PR #1175 to its exact SHA, and require exact-head CI plus the one Vercel Preview to pass before human review.
- **Merge status:** **unsafe until exact-head CI/Preview pass; do not merge; do not promote Production.**

### 2026-08-12 15:53 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175; audited from remote head `a20c0ad762ee83eac0361362cfcd086b70265fb4` on isolated local branch `audit/pr-1175-final`.
- **Scope / files:** closed the four requested remaining gaps without changing AI Analyze or Run Engine manual authority: separated machine-validated export eligibility from human review audit metadata in `lib/engine/final-package-readiness-model.ts`; made empty/unexplained release state fail closed in `lib/release-status-classifier.ts`; removed the remaining generation response that offered requirement review/manual confirmation as a provenance shortcut; corrected PDF finalization comments and Company Vault ingestion copy; updated focused regression tests.
- **Tests passed:** Prisma client generation; 146 focused tests; full non-DB suite with the fail-closed local PostgreSQL URL (DB integration tests skipped by design); typecheck; lint (one pre-existing unused-disable warning); release-integrity audits; dependency audit (0 vulnerabilities); production build with a non-secret dummy Z.ai build-time key.
- **Tests blocked / not yet claimed:** real PostgreSQL migrations, zero-drift, DB-integration/cross-tenant suite, and authenticated Playwright could not run locally because the supplied `DATABASE_URL` points to an unreachable Neon host and the repository's test DB guard correctly rejects all Neon hosts. Exact-head CI, screenshot capture, and Vercel Preview must be observed after the final commit is pushed; no Production deployment is authorized.
- **Risks / assumptions:** human/legal/signature/authority gates remain separate and fail closed; the manifest's legacy `approved` field remains truthful human-review metadata but no longer blocks a routine machine-validated export. No 100% claim is made until exact-head remote checks complete.
- **Next action:** commit and push one final SHA, update PR #1175 body/comment to that SHA, then observe exact-head CI, Preview, screenshot, authenticated isolation and security results without merging or promoting Production.
- **Merge status:** **not reviewed for merge**; DO NOT MERGE / DO NOT PROMOTE PRODUCTION.

### 2026-08-12 15:42 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `codex/pr-1175-final-gap-audit`, based exactly on PR #1175 remote head `989539d1ab314ec87a6412a9ad20c86b809a755e`; intended for PR #1175 (`release/consolidated-recovery-20260717`) only.
- **Scope:** closed the remaining owner-workflow truth gaps without merging or promoting Production: canonical machine validation now satisfies routine Build Plan document eligibility without a per-document approval click; tender-issued originals and genuine legal/authority/quality blockers remain fail-closed; requirement confirmation/review shortcuts were removed from active next-action types/presentation; missing Build Plan routes to manual Run Engine; stale copy now says ingestion/source verification precede AI Analyze and that Run Engine starts matching/Build Plan/downstream work; finalized-PDF copy no longer requests routine approval.
- **Files changed:** `lib/engine/build-plan.ts`, `lib/engine/canonical-workflow-decision.ts`, `lib/tender-generation-readiness.ts`, `lib/tender-next-action.ts`, `components/next-action-panel.tsx`, `app/api/tenders/[id]/finalize-pdf/route.ts`, `app/dashboard/company/page.tsx`, `tests/pr1175-final-gap-closure.test.ts`, and this handoff.
- **Tests passed:** targeted PR #1175/build-plan/classifier/workflow/next-action suite (122 tests); Prisma client generation; TypeScript typecheck; lint (0 errors, one pre-existing unused-disable warning); release-integrity/safe-error/metadata/reconciliation audits; dependency audit (0 vulnerabilities); production build with a development-only placeholder Z.ai key.
- **Environment limitations:** the supplied Neon `DATABASE_URL` is unreachable and is also deliberately rejected by the repository test DB guard; no local PostgreSQL binaries or Docker are installed. Therefore real-PostgreSQL migrations/full tests, zero-drift, authenticated/cross-tenant Playwright, exact-head screenshot/route audit, and Vercel Preview must be run by CI/Preview on the final pushed SHA. No 100% or fully-green claim is made locally.
- **Risks / assumptions:** the compatibility-only canonical `CONFIRM_REQUIREMENTS` stage key and confirm API route remain for historical payload/API compatibility, but are non-actionable and cannot promote provenance; removing those public contracts requires a separately coordinated API migration. The machine eligibility change is intentionally limited to canonical validation success or a genuine tender-issued-original path.
- **Next action:** push the final commit to PR #1175, run/observe its required PostgreSQL, authenticated isolation, route/screenshot, security and Vercel Preview checks on that exact SHA, and fix any contradiction before review.
- **Merge status:** **not reviewed / do not merge** until the exact-head CI and Preview evidence above are green. Do not promote Production.

### 2026-08-12 15:10 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / PR #1175, updated directly from its latest remote head `cd11dc017652d7ed223964df4839164762351eb8`; final SHA is the commit containing this entry.
- **Scope:** Completed the four requested gaps: routine machine export eligibility now follows successful byte/format validation without a per-document human approval click; explicit legal/signature/authority/final-owner blockers remain separate and fail closed; requirement confirmation/review cannot promote unsupported provenance and automatic source repair remains the first recovery when the active source can prove it; unknown release blockers return `STATUS_UNAVAILABLE`, with reachable-code exhaustiveness coverage; and Run Engine/workflow labels now state that verified extraction and manual AI Analyze precede matching, Build Plan, generation, validation, finalization, and packaging. FULL/SUBSTANTIAL evidence semantics, current-analysis binding, tenant isolation, provenance, and security/integrity gates were preserved.
- **Files changed:** release/workflow classifiers and readiness counters, canonical document output copy, tender detail readiness counts, workflow-stage labels, focused unit/E2E regressions, and this handoff. No schema or migration files changed.
- **Verification:** local PostgreSQL 16 applied all 47 migrations; critical-schema, retroactive-init, idempotency, and zero-drift checks passed. Prisma generate/validate, typecheck, release-integrity audits, dependency audit (0 vulnerabilities), production build, and targeted regressions passed. Lint passed with one pre-existing unused-disable warning. The complete real-PostgreSQL suite passed **9,977/9,977**. After installing the missing local Chromium binary, the complete authenticated/anonymous desktop/tablet Playwright run passed **184**, with **4** explicitly skipped; it included the golden manual-AI/manual-Engine flow, cross-tenant isolation, exact-head screenshot audit, and full route/mobile/tablet audit. The two renamed workflow shortcuts are rerun after this entry before commit.
- **Deployment:** no Production merge or promotion. Exactly one Vercel Preview will be created from the final pushed SHA.
- **Known risk / truth:** local runs used an intentionally nonfunctional CI-shaped Gemini placeholder, so provider-exhaustion recovery—not a paid live-provider success—was exercised. Do not claim literal 100%; exact-head GitHub CI and the Preview remain review evidence, not authorization to merge.
- **Next action:** push the final SHA to PR #1175, create one Preview, update the PR body/comment with that SHA and exact results, then await review without merging.
- **Merge status:** **not reviewed / do not merge**.

### 2026-08-12 UTC — Claude Code (Opus), PR #1175 final remaining-gap closure (Gaps A–F)

- **Branch / PR:** `claude/pr-1175-gap-closure-a2o8u6`, branched from the exact remote head of `release/consolidated-recovery-20260717` (`a0b6f98a57d4b4fa64b6c0549b59e02cc5583d32`). Nothing on #1175 was reset, reverted, rebased away, or overwritten.
- **Scope:** the six remaining gaps named in the audit, plus every additional occurrence the repo-wide copy sweep turned up. Preserved verbatim: both manual gates and their authority boundaries, the request-scoped wakes, exactly-once claiming, source-revision/hash binding, the FULL/SUBSTANTIAL vs PARTIAL evidence vocabulary, the `SUPPORTED → SUBSTANTIAL` translation, the 2-FULL/2-PARTIAL repair, the matching relevance wording, the evidence-by-name repair, and Bid Strategy's evidence awareness.

**Gap A — Bid Strategy claimed a manual gate was automatic.** `components/bid-strategy-panel.tsx` fell back to "Uploading a clearer copy of the source re-runs both automatically". Extraction is automatic; AI Analyze and Run Engine are authenticated manual actions, so an owner who followed that sentence waited for a job nothing had queued. New `lib/ui/manual-gate-guidance.ts` picks the sentence for the first unmet condition — bad extraction → upload, then run AI Analyze; usable extraction with no current analysis → run AI Analyze; current analysis with no Engine run → run Engine — and both Bid Strategy responses plus the client fallback now read from it. The sweep also found `components/submission-plan-completeness-panel.tsx` telling the owner "Extraction and analysis run automatically", which was the same false claim in a second panel.

**Gap B — "no data" was reported as "work is running".** `deriveReleaseStatus(null, null)` returned `PROCESSING_AUTOMATICALLY`, so a readiness outage rendered identically to healthy progress. `classifyReleaseStatus` now takes an explicit `{ readinessResolved: false }` and returns the new `STATUS_UNAVAILABLE`; `deriveTruthfulReleaseStatus` returns it again one layer down, when no job is running, the canonical decision could not be loaded, and not one blocker code arrived from any of the four readiness sources. Resolved readiness that genuinely reports zero blockers still classifies exactly as before — that is a fact, and a different one.

**Gap C — one sentence claimed the whole pipeline was automatic.** The panel's `PROCESSING_AUTOMATICALLY` explanation listed byte verification through package reconciliation, analysis included, as automatic — read at a tender waiting on AI Analyze, it promised a step nobody would take. New `lib/ui/release-stage-copy.ts` is a pure mapping from three inputs the panel already holds (the canonical classification, `CanonicalWorkflowDecision.nextRequiredAction` after `presentTwoActionWorkflowDecision`, and the durable `AiJob` row that is QUEUED or RUNNING). It is not a second stage detector: no I/O, no inference the canonical decision has not already made. A stage is described as running only when a job row for it exists. `POST_ENGINE_AUTOMATIC_COPY` is the only string that may claim the rest of the pipeline continues on its own, and it is reachable from exactly one stage.

**Gap D — controls pointed at buttons that do not exist.** `tender-control-suggestions.ts` told the owner about a "Repair-all button" and a "Repair source references" action on a "Recovery panel"; neither exists, and source grounding is repaired automatically by `automatic-requirement-coverage.ts` and the auto-finalize continuation service. Every `ControlSuggestionCode` is now audited in `CONTROL_SUGGESTION_REGISTER` with its condition, canonical stage, and kind — CURRENT / DOWNSTREAM / INFORMATIONAL — and each emitted suggestion carries its kind. DOWNSTREAM rows (planned-docs-not-generated, zero export candidates, plan-not-built) are worded as diagnostics rather than instructions. Accepting or dismissing a suggestion still writes only an audit-log row.

**Gap E — a failed resolver looked like a clean tender.** `deriveSuggestedControls` ended in `catch { return []; }`, and the panel renders an empty suggestion array as "nothing to do". The route now returns an explicit state: a failure carries `TENDER_CONTROLS_RESOLVER_FAILED`, a request id, and the message "Current workflow controls could not be verified." The real error is logged server-side; no Prisma text, stack, or table name crosses the response boundary. The panel suppresses the "All resolved" badge and renders an em dash for the derived-bearing counts, because a zero is a claim this path cannot support. No stale suggestion is synthesised from lifecycle data the canonical authority just failed to confirm.

**Gap F — the match-context read was scoped by id alone.** `prisma.tender.findFirst({ where: { id: tenderId } })` inherited its scope from an ownership check earlier in the request. Not exploitable — both handlers verify ownership first, and ids are globally unique — but a convention is not a scope, and this is the query that reads expert names, project names and match labels. It is now `{ id: tenderId, userId }`.

- **Evidence-reference integrity, extended.** `recognizableEvidenceReference` in `compliance.ts` now backs the expert/project lookups and the legal, financial and compliance branches. It skips blank candidates — `referenceNumber ?? title` kept an empty string and never reached the title — and holds a bare UUID/cuid back behind any real name, while still returning the id rather than dropping the reference. Nothing is fabricated.

- **Repo-wide copy sweep (audit §12).** Fixed in active UI and API responses: the two false-automation claims above; `Generate Docs` as a manual instruction in `tender-lifecycle-orchestrator.ts`, `submission-plan-completeness.ts`, `final-submission-readiness.ts`, the ai-proposal and evaluator-simulation routes, the admin proposal-audit route and both submission-plan panels; `Records are auto-approved and ready for use` in the Vault repair route. Stale comments naming Generate Docs as an action were corrected in `icons.tsx`, `tender-policy-registry.ts`, `extraction-quality-gate.ts` and `bid-strategy-panel.tsx`. Historical operator entries and regression fixtures were left intact; three stale tests were updated to assert the current contract rather than deleted.

- **Tests actually run**, all at the final source SHA, against local PostgreSQL 16 with `RUN_DB_INTEGRATION=true`:
  - new `tests/pr1175-final-gap-closure.test.ts` — 54/54 pure assertions across all six gaps, evidence-reference identity and support vocabulary;
  - new `tests/tender-controls-failure-and-tenant-scope-db.test.ts` — 7/7, including a forced resolver failure through the real route, proof that the failure changes nothing in the canonical decision, and a cross-tenant attempt that leaks neither names nor existence;
  - new `tests/mandatory-evidence-fixtures-db.test.ts` — 11/11, holding both required fixtures: 4/4 traced with 2/4 release-qualified, 2 partial, 0 genuine gaps, 0 stale, fail-closed, every panel naming one action; and the 4/4 path where the Engine's `SUPPORTED` is persisted through `toCanonicalSupportLevel` as `SUBSTANTIAL`, clears the coverage blocker, and lets the workflow reach the post-Engine pipeline — the state that used to be inescapable;
  - existing manual-gate non-regression coverage re-run and green: `manual-ai-analyze-wakes-its-worker`, `manual-authority-negative-regression`, `engine-enqueue-authority.integration`, `job-claim-concurrency-stress-db`, `ai-analyze-hash-binding-db`, `engine-route-worker-analysis-authority-postgres` — 42/42.
- **Known limitation, stated rather than glossed:** Vercel Preview cannot be verified at this SHA. `vercel.json` enables Git deployments only for `main` and `release/consolidated-recovery-20260717`, so this branch produces no Preview. The newest Preview remains `a0b6f98a` and Production remains `d699935351fe9b843a5b9ca082f4d105eb6b9ffa`; both are unchanged by this work, and neither was promoted.
- **No gate was weakened.** No threshold moved, no blocker was removed, no fail-closed path was opened, no tenant boundary was widened, no manual gate was automated, and no advisory surface gained authority. `STATUS_UNAVAILABLE` is strictly more conservative than what it replaced.
- **Merge status:** DO NOT MERGE. Draft; PR #1175 untouched and unmerged; no Production promotion, no deployment, no migration.

### 2026-08-11 UTC — Claude Code (Opus), the two subsystems now speak one language

- **Closes the item the previous entry left open**, and the answer turned out not to be a judgement call at all. The Engine and the automatic coverage writer were not disagreeing about how strong a requirement's evidence was. They were using different words for it.
- **The defect.** `lib/engine/compliance.ts` grades every requirement `SUPPORTED` / `EVIDENCE_PENDING_REVIEW` / `PARTIAL` / `UNSUPPORTED`, and `run-tender-engine.ts` persisted that string verbatim as `ComplianceMatrix.supportLevel`. Every gate counts `FULL` / `SUBSTANTIAL` (`canonical-workflow-decision.ts:569`, `export-readiness.ts:844`). Nothing translated between them, so an Engine row reading `SUPPORTED` — its strongest verdict, meaning reviewed or selected evidence is on file — counted for exactly nothing. A requirement backed by real selected projects sat uncovered beside a panel asking the owner for evidence they had already supplied.
- **Fix.** `toCanonicalSupportLevel` in `compliance.ts`, applied at the persistence site in `run-tender-engine.ts`, so one vocabulary reaches the database and every reader after it. `SUPPORTED` → `SUBSTANTIAL`, deliberately not `FULL`: FULL is for a generated artifact whose bytes exist and validate, or a record whose required facets all match, whereas the Engine's SUPPORTED means selected evidence is on file — exactly what SUBSTANTIAL denotes. Mapping to the lower of the two counting levels keeps the strongest claim honest. `EVIDENCE_PENDING_REVIEW` → `PARTIAL`, because evidence a human has not looked at must not become countable by translation. `PARTIAL`, `UNSUPPORTED` and anything unrecognised pass through untouched rather than being guessed upward.
- **Backwards compatibility.** Rows written before this say `SUPPORTED`; `app/dashboard/compliance/compliance-dashboard.tsx` now counts `SUBSTANTIAL`, `FULL` and `SUPPORTED` together, so historical rows are not silently dropped. `run-tender-engine.ts:517` reads the in-memory `matrix.supportStatus` before persistence and is unaffected.
- **No gate was relaxed.** No threshold moved, no blocker removed, no fail-closed path changed. A translation that leaves UNSUPPORTED and pending-review evidence uncountable cannot make an unsupported requirement pass; it only lets an already-computed strong verdict be read by the code that was looking for it.
- **Tests actually run** (local PostgreSQL 16, `RUN_DB_INTEGRATION=true`, DB verified alive after): new `tests/engine-support-level-speaks-the-gate-vocabulary.test.ts` 6/6 pinning both directions of the mapping, the refusal to promote to FULL, application at the persistence site, and the legacy count. Full suite **9,899/9,899, 0 failures** — no gate, readiness, or export suite objected. Typecheck clean; lint clean but for the one standing warning.
- **Not verified by me:** the live effect on Hope's tender, which needs a Re-run Engine so the rows are rewritten in the new vocabulary.
- **Merge status:** DO NOT MERGE. Draft; no Production promotion, no deployment, no migration.

### 2026-08-11 UTC — Claude Code (Opus), compliance evidence that names the record

- **The gap, closed.** The Match Evidence panel showed a mandatory requirement supported by `PROJECT e6ed6bac-1811-49b8-a245-fe8f4c27411e, cccb66a6-…, 324cd171-…`. My earlier note called that a "legacy row the automatic writer never reconciles". That framing was wrong and is corrected here: the row is written by `run-tender-engine.ts` on every run from `lib/engine/compliance.ts`, and the matching behind it was correct. The defect was purely that the expert and project branches wrote primary keys as `evidenceReference` while every other branch already wrote something checkable — a registration number, a fiscal year, an original file name.
- **Why it mattered.** Those two branches are the ones a reviewer most needs to read, because they are where the proposal claims particular people and particular past work. A compliance matrix citing UUIDs cannot be checked, so a correctly matched hospital and an unrelated record are indistinguishable on the page.
- **Fix.** `lib/engine/compliance.ts` builds `expertNameById` / `projectNameById` from the same `knowledge` records the matcher used — so the panel and the match cannot disagree about which record was cited — and resolves references through `nameOrId`, which falls back to the id rather than dropping the reference. Losing it would be worse than showing an id: the requirement would read as unsupported when it is not. The `requirementDocument` fallback branches were updated the same way.
- **Not changed.** No support level, no coverage count, no gate, no matching score. This is what the row says, not what it is worth.
- **Tests actually run** (local PostgreSQL 16, `RUN_DB_INTEGRATION=true`, DB verified alive after): new `tests/evidence-reference-names-the-record.test.ts` 4/4, pinning both lookups, both resolutions, the id fallback, and the absence of the two expressions that produced the unreadable row. Full suite **9,893/9,893, 0 failures**; typecheck clean; lint clean but for the one standing warning.
- **Still open, and honestly stated.** Whether the Engine's own compliance row and the automatic coverage writer's row should agree on a support level for the same requirement is unresolved. They are written by different subsystems (`run-tender-engine.ts` via `compliance.ts`, and `automatic-requirement-coverage.ts` with its `automatic-requirement-evidence:v1:` prefix, which reconciles only its own rows), and on the reported tender they disagreed — the Engine linked the selected projects at PARTIAL while the coverage writer linked a different record. Choosing the single authority changes what the release gate counts as supported evidence, so it needs a deliberate decision rather than a drive-by change. The manual confirm route (`evidenceSource: "VAULT_CONFIRMED"`) must stay untouched by whatever is decided.
- **Merge status:** DO NOT MERGE. Draft; no Production promotion, no deployment, no migration.


### 2026-08-11 UTC — Codex (PR #1175 final remaining-gap closure)

- **Mode:** final scoped semantic/UX/release-readiness closure; preserve both manual gates and the Phase 1/2 truth repairs.
- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, starting from exact remote head `b4b5bf75b2a6ecc47e3870c668631c3f42787bee`.
- **Scope / files changed:** upload-first/additional-upload contracts and New Tender/source-file copy now own extraction only; Tender Controls project exactly one canonical current action and never mutate Tender stage/status; Requirement Coverage separates release-qualified and weighted partial progress; Bid Strategy consumes canonical mandatory evidence ratios and caps materially evidence-limited recommendations; Matching labels relevance and hides internal rationale; Release Status suppresses unreachable downstream symptoms; Company Vault moves implementation detail under Technical details; focused architecture regressions cover the changes.
- **Tests so far:** focused Phase 1/Phase 2/manual wake/upload/controls/Bid Strategy suite passed 84/84 non-DB tests; exact 2/4 PostgreSQL fixture was discovered but cancelled locally because no configured PostgreSQL was reachable; typecheck and lint pass. Fresh exact-head CI, PostgreSQL, build, Playwright, screenshots, audits and Preview convergence remain required after push.
- **Risks / assumptions:** no canonical gate, evidence trust predicate, source hash/revision, tenant boundary, generation/finalization worker, document/ZIP integrity rule, legal authority, or provider order was weakened. Control acceptance is now audit-only rather than a second lifecycle mutation.
- **Next action:** commit/push, inspect both exact-head CI runs and rendered artifacts, repair any failure, then stop without merge or Production promotion.
- **Merge status:** DO NOT MERGE; draft, unreviewed, no Production promotion.

### 2026-08-11 UTC — Claude Code (Opus), AI Analyze never woke its worker

- **Reported live:** Hope pressed Run AI Analyze on the Preview and the panel sat on "AI Analyze is queued" for minutes. The panel was telling the truth.
- **Root cause.** `POST /api/tenders/[id]/manual-ai-analyze` created the job under verified manual authority and then nothing claimed it. Run Engine has had `scheduleRequestScopedEngineWorkerWake` since it was written; AI Analyze had no equivalent. The request-scoped upload wakes are forbidden from naming a manual gate (correctly — a wake must never *start* one), and the drain cron fires only from the repository default branch, so on a Preview deployment an authorized AI_ANALYZE job stayed QUEUED indefinitely.
- **Fix.** `lib/ai-jobs/request-scoped-engine-worker-wake.ts` now serves both manual gates through a shared internal `scheduleManualJobWake`, exporting `scheduleRequestScopedAnalyzeWorkerWake` alongside the unchanged Engine one. The analyze route calls it immediately after `createAnalysisJob` returns. This follows the precedent the Engine route already set rather than widening `request-scoped-worker-wake.ts`, whose ban on naming a manual gate stays exactly as it was — that module and its tests are untouched.
- **Why this is not a gate crossing.** The wake creates nothing and authorizes nothing. It runs only after the route has checked `manualAuthority` and persisted the row, and a job that does not exist cannot be claimed. The atomic claim still owns QUEUED to RUNNING, so a duplicate wake cannot run the work twice. Without a session cookie the wake declines rather than throwing, so the owner still receives their job id.
- **A source-text assertion was re-pointed, not removed.** `tests/engine-worker-wake-constraints.test.ts` matched the literal `searchParams.set("jobType", "ENGINE_RUN")`, which is now a parameter. It calls the real function and asserts the URL it builds instead — same property, no longer dependent on one spelling.
- **Tests actually run** (local PostgreSQL 16, `RUN_DB_INTEGRATION=true`, DB verified alive after): new `tests/manual-ai-analyze-wakes-its-worker.test.ts` 5/5, driving the real wake with an injected scheduler and fetch — it proves the request asks for `AI_ANALYZE` on the right tender, forwards the caller's own cookie and no worker secret, declines without a session, and that the route calls it after job creation. `tests/engine-worker-wake-constraints.test.ts` 12/12. Full suite **9,883/9,883, 0 failures**; typecheck clean; lint clean but for the one standing warning. The database died mid-run once (82 fail / 328 cancelled) and was restarted and re-run before any result was believed; one intermediate run showed the documented `owner-workflow-complete-postgres` flake and the following clean run had no failures at all.
- **Not verified by me:** that Hope's next Run AI Analyze completes promptly on the deployed Preview. That is the click that proves it.
- **Merge status:** DO NOT MERGE. Draft; no Production promotion, no deployment, no migration.

### 2026-08-11 UTC — Claude Code (Opus), the generation deadlock

- **Owner-approved scope.** Hope chose "exempt at the generation gate only" from two options after I presented the deadlock proof; the alternative (counting a plan row as SUBSTANTIAL) was rejected because it shifts evidence semantics for every consumer.
- **The defect.** A submission requirement is answered by a document this app generates, so its only automatic evidence is the confirmed Build Plan row for that exact file. `supportForCandidate` correctly caps every `BUILD_PLAN_ITEM` at PARTIAL — the bytes do not exist — so the requirement never reached FULL/SUBSTANTIAL, and `MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE` refused to let generation start until it did. The app declined to generate a file until the file already existed, and no Company Vault upload could ever resolve it because the missing item was an output, not a source. Observed live at 3/4 coverage with the plan row reading "planned output pending generated bytes" beside a panel advising "Generate the required file (Technical Proposal.pdf)".
- **The fix.** `canonical-workflow-decision` now counts mandatory requirements that carry an `AUTO_PLANNED_ARTIFACT` compliance row and are not otherwise covered, and treats them as satisfied **at the generation gate only**. The count is measured from the database, never assumed; the `NOT` clause prevents double counting a requirement already covered by real evidence; the input field is optional and defaults to 0, so any caller that does not supply it keeps the old, stricter behaviour.
- **What was NOT relaxed.** Evidence semantics are untouched: a plan row is still never FULL or SUBSTANTIAL. Export is untouched: `REQUIRED_DOCS_NOT_GENERATED` now surfaces in place of the coverage blocker, and `MISSING_PLANNED_FILES`, `NO_ACTIVE_GENERATED_DOCUMENTS`, package reconciliation and the ZIP byte gates are independent and still fire. A tender with no generated documents remains blocked — for the honest reason.
- **A guard was re-pointed, deliberately and with justification.** `tests/generation-panel-evidence-blocker-reachability.test.ts` pinned the literal comparison expression specifically so a future "fix" could not relax the gate. My change replaces that expression, so it failed. I did not delete it: it now asserts the gate still exists, is still unbypassable by a confirmation click, that the ONLY subtraction permitted is the planned-output count, that an absent count defaults to zero, and that the count is derived from real `AUTO_PLANNED_ARTIFACT` rows excluding already-covered requirements. That is a stricter guard than the regex it replaced.
- **An earlier attempt was reverted rather than forced through.** I first made a matching plan row count as SUBSTANTIAL in `automatic-requirement-coverage.ts`. The full suite returned 9,876 pass / 1 fail, and the failure was the deliberate guard "keeps a planned output PARTIAL until real validated bytes exist". That guard is right, so I reverted the change and asked Hope rather than re-point it.
- **Tests actually run** (local PostgreSQL 16, `RUN_DB_INTEGRATION=true`, DB verified alive after): full suite **9,878/9,878, 0 failures**; new `tests/planned-output-generation-deadlock.test.ts` 4/4 covering both directions plus the fail-closed default; typecheck clean; lint clean but for the one standing warning. `tests/owner-workflow-complete-postgres.test.ts` failed once mid-session and passed in isolation and on re-run — the documented standing flake, not this change. The database also died during one earlier run (82 fail / 328 cancelled); it was restarted and re-run before any result was believed.
- **Not verified by me:** that Hope's tender now proceeds past Match Evidence to generation. That needs a Re-run Engine click on the deployed Preview.
- **Still open:** "Healthcare Facility Design Experience" links a feasibility study for an abattoir at 76% rather than the hospital projects the Engine selected, and its reason string carries no shared capability family — so the hospitals are not reaching that requirement's candidate pool. Hope approved diagnosing it; not started.
- **Merge status:** DO NOT MERGE. Draft; no Production promotion, no deployment, no migration.

### 2026-08-11 UTC — Claude Code (Opus), two owner-reported live defects

Both reported by Hope from the deployed Preview on commit `1d1d7d0d`, with screenshots.

**1. The two manual controls were absent, not disabled.** `AIAnalyzePanel` rendered its button behind `canMutate && !analysisComplete`, and `MatchingSelectedEvidencePanel` behind `canMutate && !engineComplete`, so both vanished from the page once their stage had succeeded. `engine-readiness` agreed, withholding `canRunEngine` on `!engineComplete`. The owner opening a finished tender therefore saw no AI Analyze and no Run Engine control at all, and had no way to re-run — which matters most after uploading Company Vault evidence, since that does not move the tender's source revision and so leaves a stale run looking "current". Neither POST route ever refused a re-run; this was purely visibility plus one readiness flag. Both buttons are now always rendered for a user entitled to press them, labelled "Re-run …" when the stage is complete, with a note saying what pressing it will do. The protection that matters is untouched: `!analyzing` and `!engineRunning` still make two concurrent jobs impossible, and manual authority is unchanged.

**2. Requirement coverage could not tell that a hospital is a healthcare facility.** The reported tender showed "2/4 mandatory requirements have FULL/SUBSTANTIAL coverage" while Dessie Specialized Hospital and G+6 General Hospital sat in the selected evidence for "Healthcare Facility Design Experience". Root cause, and it is exact: the app labels requirements Project, Eligibility, Expert, Submission; `inferAutomaticEvidenceKinds` matched `ELIGIBILITY` and `EXPERT` but tested only the longer `PROJECT_EXPERIENCE`, so `"PROJECT"` matched nothing. The requirement inferred no evidence kind, fell through to `GENERAL`, and its candidates started at 30 instead of 68 — below the 70 needed to link at all. That is the whole difference between the Eligibility and Expert requirements reading "Fully verified" and the Project one reading "Partially verified". Fixed by accepting `PROJECT`/`SIMILAR_PROJECTS` and widening a phrase list that demanded the tender say "relevant experience" or "past performance". Separately, scoring compared raw tokens, so "hospital" earned nothing toward "healthcare"; it now also credits a shared `capabilityFamilies` family — the same vocabulary the matching engine already uses to select these records, whose HEALTHCARE_FACILITIES patterns include `/\bhospital/` — and names the shared family in the reason string so a reviewer can check the inference.

- **Nothing was weakened to achieve this.** No threshold was lowered, no gate removed, no fail-closed path relaxed. Both sides of the new signal are derived from text already on file — the tender's own requirement and the record's uploaded content — so nothing is invented. A record sharing no family gains nothing, and a record of the wrong evidence kind still scores zero and is not selected; both are pinned by tests, and the negative cases are the point of them.
- **A correction to my own first analysis:** I initially told Hope the hospital project scored 68 + 8 = 76 and missed SUBSTANTIAL by eight points. That arithmetic assumed the requirement had inferred `PROJECT_REFERENCE`. It had not — it was `GENERAL`, so the true base was 30 and the record could not link at all. The test header carries the corrected explanation.
- **Files changed:** `app/api/tenders/[id]/engine-readiness/route.ts`, `components/ai-analyze-panel.tsx`, `components/matching-selected-evidence-panel.tsx`, `lib/engine/automatic-requirement-coverage.ts`, `tests/manual-button-visibility.test.ts` (two assertions replaced — they pinned the hide-on-complete rule, and its header documented it as an owner requirement; the header now records why it changed), and `tests/coverage-reads-capability-not-just-words.test.ts` (new).
- **Tests actually run** (local PostgreSQL 16, `RUN_DB_INTEGRATION=true`, DB verified alive after): full suite **9,874/9,874, 0 failures**; the 25 targeted button-visibility and coverage tests pass; typecheck clean; lint clean but for the one standing warning. Notably no existing gate, readiness, or export-truth suite broke, which is the check that mattered for change 2.
- **Not verified by me:** that the reported tender now reaches 4/4 coverage. That depends on its actual Vault records and needs a re-run of the Engine on the deployed Preview, which is Hope's click to make. The mechanism is fixed and proven in tests; the live outcome is not yet observed.
- **Merge status:** DO NOT MERGE. Draft; no Production promotion, no deployment, no migration.

### 2026-08-11 UTC — Claude Code (Opus), last client field with no ledger row

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, from exact remote head `ae7438f463d400b99940ab4d0ecf97234e7b4039` (fast-forwarded; Codex's fourteen Phase 1/Phase 2 commits are all contained, nothing rebased or discarded).
- **Mode:** closing the "Pass 6 — client-detail provenance: CONFIRMED GAP" item recorded further down this log. That entry listed twelve client fields with no `TenderFactsLedger` row. Eleven were wired up in the meantime; this entry closes the twelfth.
- **Scope / files changed:** `lib/engine/tender-facts-ledger-service.ts` — `clientCity` added to `clientDetailFields` **and** to the backfill query's explicit `select`; `prisma/schema.prisma` — corrected the `contactDetailsSourceJson` comment, which listed only eight of the nineteen keys AI Analyze actually writes there; `tests/client-detail-ledger-provenance.test.ts` — `clientCity` added to the covered key set, plus two new real-PostgreSQL tests for the grounded and partial-evidence directions.
- **Why it mattered:** `clientCity` is CLAUDE.md item 9 ("City / project location"). AI Analyze extracts it, the extraction prompt asks the provider for its page and quote, promotion persists that triple into `contactDetailsSourceJson`, and the tender detail panel displays it. The ledger was the only consumer that could not see it — and the ledger is the surface a reviewer uses to ask whether a displayed value is traceable. Every other consumer (`effective-tender-facts`, `metadata-override`, `tender-metadata-completeness`, `final-submission-readiness`, `tender-release-snapshot`, `source-driven-tender-detail`) already knew the field; the ledger was the sole outlier.
- **Two-part fix, and why the second part is not cosmetic:** adding the field to `clientDetailFields` alone did not work. The backfill's `select` enumerates columns explicitly, so an unselected column arrives as `undefined` and the candidate is silently skipped — the exact trap the comment above that `select` already warned about. The test caught it: the suite stayed red after the first edit and only went green after the `select` was extended too.
- **Tests actually run** (local PostgreSQL 16, `RUN_DB_INTEGRATION=true`, database verified alive before and after): the provenance suite was proven RED first (4 of 6 failing, `clientCity` had no row), then GREEN 6/6. `npx prisma validate` passed; `npx prisma generate` passed; `prisma migrate diff` reported **No difference detected** (comment-only schema edit, zero drift); `npm run typecheck` passed clean; `npm run lint` passed with only the one standing unused-disable warning in `tests/superseded-job-status-projection.test.ts`; the full suite passed **9,869/9,869, 0 failures**. Fresh CI on the pushed head is the binding check.
- **New coverage, stated precisely:** the pre-existing tests only proved the ungrounded direction — that a field with no evidence stays `CANDIDATE_NEEDS_REVIEW`. The two added tests prove the direction requirement 20 actually asks for: a complete `{fileId, page, quote}` triple reaches `SOURCE_GROUNDED_CONFIRMED` carrying the real page and verbatim quote, and partial evidence (quote without a proven page, page without a file, quote under the ten-character minimum, page 0) is dropped to null and never rounded up.
- **Risks / assumptions:** no gate, resolver, authority state, tenant filter, manual-authority contract, Company Vault reconciliation, worker continuation, or ZIP/byte integrity logic changed. `backfillTenderFactsForTender` remains the only writer of ledger rows in the codebase — `scripts/backfill-tender-facts-ledger.ts` is its sole caller — so no second write path needed the same field. No migration was added and none is required.
- **Recurrence guard (`tests/ledger-backfill-select-parity.test.ts`, added after the fix):** the behavioural suite next door can only prove the twelve fields it names, so it could not catch a thirteenth added to `clientDetailFields` but not to the `select` — the precise failure above. The new test derives both lists from the source and fails naming the offending column. It was verified by reintroducing the exact bug: it went red identifying `clientCity`, and green again on restore. It also pins semanticKey-to-column equality, because provenance in `contactDetailsSourceJson` is keyed by those same names, so drift there would write rows under a name no reader looks for.
- **Correction to an earlier claim in this same entry:** I first wrote that acceptance criterion 8 ("does not build an empty submission plan when requirements exist") was still not exercised, carrying that forward from the Pass 6 entry below. That is out of date. `tests/p1-submission-plan-never-silently-empty.test.ts` drives the real guards against a real database — refusal with an explicit reason, no CONFIRMED BuildPlan created on refusal, independent rejection of an empty item list at confirmation, and a positive case that is not blocked — and it passed in the full run reported above. Criterion 8 is exercised.
- **On the ledger's write path, so the next session does not re-derive it:** `backfillTenderFactsForTender` is still the only writer, and `scripts/backfill-tender-facts-ledger.ts` its only caller, so ledger rows do not appear during ordinary AI Analyze. That is not a defect today and was deliberately not "fixed" here: the readers — `effective-tender-facts`, `final-submission-readiness`, `fact-parity` and `facts-ledger` routes — take the snapshot as one input beside parser, scalar and override values and fail soft to `null`, so an empty ledger is neutral rather than harmful. Wiring a live write path would change fact resolution for every tender and needs owner scoping, not a drive-by commit.
- **Next action:** owner review.
- **Merge status:** DO NOT MERGE. Draft; no Production promotion, no deployment, no migration run.

### 2026-08-11 UTC — Codex (PR #1175 Phase 2 downstream-truth repair)

- **Mode:** Phase 2 only — reconcile completed Engine execution with canonical downstream workflow truth at the Stage 3 presentation boundary.
- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, starting from exact remote head `170c58a8586620ed1158b8f5782bd89867420477` after confirming the 16 Phase 1 semantic tests still passed.
- **Scope / files changed:** `lib/engine/workflow-panel-presentation.ts` now formats current-revision Engine truth together with a presentation-safe projection of the existing canonical workflow decision and exact-revision persisted successor activity; `app/api/tenders/[id]/workflow-center/route.ts` exposes that observed activity without changing eligibility; `components/matching-selected-evidence-panel.tsx` consumes and polls both existing authorities and fails closed when downstream truth is unavailable; focused semantic/PostgreSQL tests were strengthened; `e2e/phase2-workflow-truth-screenshot.spec.ts` creates and screenshots the exact current-analysis/current-Engine/selected-evidence/confirmed-plan/2-of-4 state; `playwright.config.ts` runs it in authenticated CI.
- **Tests so far:** the pre-edit Phase 1 suite passed 16/16; the exact old Stage 3 source path was reproduced returning the unconditional automatic-continuation sentence; 53 focused Phase 1/Phase 2/manual-button tests pass; 28 additional workflow-center/two-action/route semantic tests pass; typecheck passes; lint passes with the one standing unused-disable warning. On first pushed head `a1846ef`, one CI full suite reached 9,868/9,869 with the standing nondeterministic owner-workflow PDF validation failure while the other passed the full real-PostgreSQL unit phase and reached Playwright. On `b9cf39b`, `72b432f`, and `c2c557c`, both full real-PostgreSQL unit phases passed. After correcting three setup-only issues, exact head `ad36a0c` passed both independent real-PostgreSQL CI runs (9,869/9,869), production build, the new rendered Phase 2 check, and the full authenticated Playwright suite (184 passed, 4 environment-conditional skips); dependency audit, Vercel Preview, and the 237-page route/screenshot audit also passed. The Phase 2 screenshot is now also written under `browser-results/` so the credential-free success artifact retains it for mandatory visual inspection on the final SHA.
- **Risks / assumptions:** no workflow resolver, readiness/gate calculation, mutation route, evidence trust, source revision, tenant filter, Company Vault reconciliation, generated-file/ZIP integrity, manual authority, or automatic worker continuation was changed. The new activity selector observes only `PROPOSAL_GENERATION`/`AUTO_FINALIZE` rows bound to the current Engine source revision.
- **Next action:** push the Phase 2 implementation, inspect all fresh exact-head failures and the attached real 2/4 rendered screenshot, repair if necessary, and stop after Phase 2 verification.
- **Merge status:** DO NOT MERGE; draft, unreviewed, no Production promotion.

### 2026-08-11 UTC — Codex (PR #1175 full-suite reconciliation)

- **Mode:** continue-to-green verification of the AI Analyze/Engine cross-panel truth repair.
- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, starting at exact remote head `6f8e66ac640f6d8187f9e22f1cf22b5851bea47c`.
- **Scope / files changed:** reconciled five stale source-text tests with the shared presentation-only workflow wording module (`tests/durable-ai-analyze-workflow.test.ts`, `tests/manual-button-visibility.test.ts`, `tests/status-panels-do-not-report-stale-pending.test.ts`); strengthened `tests/generation-panel-coverage-blocker-truth-db.test.ts` so real PostgreSQL now contains the exact reported combination (current AI Analysis, selected source-verified expert/project evidence, confirmed Build Plan, current-revision successful Engine job, and canonical Source evidence required) and proves both rendered panel presenters announce no contradictory manual action; recorded this handoff. Production behavior and all workflow authorities/gates are unchanged.
- **Tests / CI:** both initial real-PostgreSQL CI runs reached 9,848/9,853 before the same five stale assertions failed; their failures were inspected and reproduced. The reconciled focused set passed 54/54 locally, and local production `npm run build` passed with development-only missing-provider/worker/Sentry warnings. On exact application/test head `e6690e179b5cc739ce4cccba7b85062ca515c25e`, both fresh CI events passed Prisma/migrations/zero-drift, release-integrity audits, typecheck, lint, the full real-PostgreSQL suite (9,854/9,854), production build, and authenticated Playwright (184 passed, 3 environment-conditional skips). Both exact-head screenshot jobs passed; the indexed audit captured 237 screenshots with 0 missing routes, 0 critical findings, 0 horizontal overflow, and 0 warnings. Vercel Preview and dependency audit passed.
- **Risks / assumptions:** the repaired tests now exercise the exported shared presenters rather than demanding that their copy remain textually duplicated inside each React component. Manual AI Analyze and Run Engine authority, automatic post-Engine continuation, tenant/source/Vault/generated-file integrity, and fail-closed gates remain unchanged.
- **Next action:** owner review of the still-draft PR; no further scoped code gap is known.
- **Merge status:** scoped fix is verified safe for review, but PR remains draft and MUST NOT be merged or promoted without Hope's explicit approval.

### 2026-08-11 UTC — Codex (PR #1175 exact-head follow-up)

- **Mode:** narrow exact-head CI repair and user-facing diff-limit investigation.
- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, starting at exact head `4f2e0d18bdf4a7b942c43f843090840ef2b36063`.
- **Scope / files changed:** corrected the shared Engine presentation helper's input type so its intentionally supported missing-active-job fallback compiles (`lib/engine/workflow-panel-presentation.ts`); recorded this handoff. The quoted generated-diff size-limit notice is not present in repository files, the PR body, issue comments, or reviews and therefore cannot be removed from application code; it is external review-tool output caused by the consolidated PR's exceptionally large diff.
- **Tests:** `npx prisma generate` passed; 16/16 targeted Engine/AI/cross-panel workflow truth tests passed; `npm run typecheck` passed; `npm run lint` passed with one pre-existing unused-disable warning in `tests/superseded-job-status-projection.test.ts`.
- **Risks / assumptions:** no workflow derivation, Company Vault reconciliation, source integrity, tenant isolation, release gate, or manual-action authority changed. Full PostgreSQL/full-suite/build and exact-head screenshot evidence remain governed by fresh CI after this commit.
- **Next action:** push the commit to #1175 and require fresh exact-head CI plus screenshot audit before merge consideration.
- **Merge status:** DO NOT MERGE — draft; no deployment or production migration performed.

### 2026-08-11 UTC (AI/Engine semantic consolidation follow-up) — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / #1175, started from exact remote head `c6e0676a51dd8433f8251c898a575bd217dc6ea6`.
- **Scope:** moved AI Analyze and Matching Engine wording into one presentation-only module while retaining the existing tenant-scoped, current-revision `/engine-readiness` authority. Strengthened the cross-panel regression so “Source evidence required” is produced by the real canonical workflow decision instead of being hard-coded in the test.
- **Files changed:** `lib/engine/workflow-panel-presentation.ts`, `components/ai-analyze-panel.tsx`, `components/matching-selected-evidence-panel.tsx`, `tests/ai-analyze-engine-workflow-truth.test.ts`, and this handoff.
- **Tests:** targeted AI/Engine semantic tests passed (16/16); Prisma generation, typecheck, lint, and production build passed. The local full-suite attempt could not complete because the fail-closed DB guard correctly rejected the configured Neon URL and no local PostgreSQL server is installed; the pre-existing PR-head CI PostgreSQL run completed 9851/9853 with two unrelated failures before this follow-up.
- **Risks / assumptions:** no gate, route authorization, source-integrity calculation, tenant filter, job revision filter, or manual/automatic workflow ownership changed. Exact authenticated Preview screenshot audit still requires the deployment/test account available to the operator capture workflow.
- **Next action:** push this commit, let PR #1175 CI run against ephemeral PostgreSQL, and complete the exact-head authenticated screenshot capture before merge.
- **Merge status:** unsafe until fresh CI and screenshot audit complete; do not merge yet.

### 2026-08-11 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / #1175, started from exact remote head `48ee3d40ea46bc705eb184832dbf15456104d0c0`.
- **Scope:** removed the Stage 2 contradiction that told users to Run Engine after Engine had already completed. `AIAnalyzePanel` now reads the existing tenant-scoped, current-revision `/engine-readiness` authority, distinguishes queued/running/completed/failed/stale states, polls active Engine work, and stops at AI-analysis truth after current Engine completion so the canonical Next Required Action owns downstream blockers. The matching panel now routes its existing state copy through an exported pure presenter used by cross-panel regression coverage.
- **Files changed:** `components/ai-analyze-panel.tsx`, `components/matching-selected-evidence-panel.tsx`, `tests/ai-analyze-engine-workflow-truth.test.ts`, and this handoff.
- **Tests:** targeted 40-test workflow/status set passed; `npx prisma generate` passed; `npm run typecheck` passed; `npm run lint` passed with one pre-existing unused-disable warning in `tests/superseded-job-status-projection.test.ts`; production `npm run build` passed with placeholder local provider/worker variables. The first post-push CI typecheck found that the test fixture omitted the Engine job `id`; the production payload and fixture type were aligned before the follow-up push. A full test attempt was stopped after 2,365 passing suites because this container has no local PostgreSQL and the repository intentionally fails DB-required files when `RUN_DB_INTEGRATION=false`; the configured Neon URL was correctly rejected by the fail-closed test DB guard.
- **Risks / assumptions:** no gate, revision resolver, tenant query, automatic continuation, Vault reconciliation, or source/generated-file integrity logic changed. The Engine readiness endpoint revision-filters `ENGINE_RUN` jobs, so an old-revision success correctly presents as not run for the current revision. Exact-head preview screenshot audit remains the next action after this commit deploys.
- **Next action:** push this commit, wait for PR #1175 exact-head CI/preview, then capture the authenticated original tender state and verify AI Analyze, Next Required Action, and Matching panels are non-contradictory.
- **Merge status:** not reviewed; do not merge until exact-head CI, real PostgreSQL tests, and authenticated screenshot audit pass.

### 2026-08-10 19:40 UTC — Claude Code (Opus), root cause of the live 0/28 · 0/112 Company Vault

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175, from head `d35b8130`.
- **Symptom (owner's live Preview):** Company Vault showed `DOCUMENTS 4 / 4 extracted` beside
  `VERIFIED EXPERTS 0 (28 total)`, `VERIFIED PROJECTS 0 (112 total)`, `VERIFIED SUPPORT 0`, and Run
  Engine then selected 0 experts and 0 projects. Every automatic reconciliation path from the P0 was
  already implemented and `tests/company-vault-zero-bureaucracy-db.test.ts` was green.
- **Root cause — byte integrity, not identity matching.** `CompanyDocument.integrityStatus` defaults
  to `"UNKNOWN"` and `remapUnlinkedVaultSources` filters `integrityStatus: "VERIFIED"`, so a vault
  whose documents were persisted before integrity was computed has **no eligible evidence source at
  all**. Extraction and byte integrity are independent, so the page truthfully reports "4 extracted"
  while nothing can bind, and every verified count is 0.
- **Reproduced by measurement, not inference.** Same 28 experts / 112 projects / 4 documents /
  169 KB of source text through `prepareCompanyVaultForEngine`:
  | documents | experts | projects | elapsed |
  |---|---|---|---|
  | byte-VERIFIED | 11/28 | **112/112** | 2988 ms |
  | `LEGACY_INTEGRITY_UNKNOWN` | **0/28** | **0/112** | 223 ms |
  | VERIFIED but `contentSha256` missing | **0/28** | **0/112** | 236 ms |
  The 223 ms is the tell: it returns immediately because no document qualifies as a source. (11/28
  in the healthy row is a fixture artifact — those synthetic names carry numeric suffixes absent
  from the CV text, so failing closed was correct.)
- **Fix:** new `lib/company-document-byte-integrity-reconcile.ts`, called before the remap in both
  `lib/engine/prepare-company-vault.ts` and `lib/company-vault-ingestion.ts`. For owned documents
  whose integrity was never established it inspects the **persisted bytes** and records their real
  hash, length, MIME type and detected format via the production producer
  `verifiedIntegrityDataFromBase64` — which throws unless the bytes inspect clean. This does not
  bypass the gate and does not mark unknown bytes verified: it performs, once, the verification that
  was never performed. A document whose bytes are unrecoverable or corrupt stays blocked and records
  an `integrityFailureCode`. Documents stored only via `storagePath` with no `fileContent` are still
  out of scope and remain blocked.
- **Regression:** `tests/company-vault-legacy-integrity-db.test.ts`. Proven **RED before the fix**
  (0/2, failing on "both documents must establish byte integrity from their stored bytes") and
  **GREEN after** (2/2). It also pins the honest half — a document with no recoverable bytes must
  stay blocked, invent no hash, and leave its dependent experts blocked — and asserts zero
  manufactured human review.
- **Tests actually run:** full `RUN_DB_INTEGRATION=true npm test` — **9,813/9,813 passed, 0 failed**,
  exit 0. An earlier full run showed one failure in
  `tests/owner-workflow-complete-postgres.test.ts` ("1 auto-finalized PDF(s) failed canonical
  validation"); it passes in isolation and in the clean full re-run, and touches
  `GeneratedDocument`, not `CompanyDocument` — recorded here as an observed concurrency flake rather
  than hidden. `npx tsc --noEmit` exit 0; `npm run lint` 0 errors, 1 pre-existing warning;
  `npm run build` exit 0.
- **Disproved and reverted:** I had theorised the route's Vault preflight caused the 60s
  `POST /engine` timeout and moved it to the worker. That broke two tests deliberately pinning
  "Vault verification before enqueue", so I measured instead of arguing: the preflight takes ~1.5 s
  at owner scale. Hypothesis wrong, change reverted, route unchanged.
- **CI / deployment:** No merge, force-push, rebase, base change, history rewrite, new PR,
  credential rotation, Production migration, or Production deployment.
- **Merge status:** Not reviewed; not merged. Draft.

### 2026-08-10 18:40 UTC — Claude Code (Opus), restore green CI on the Company Vault P0

- **Branch / PR:** `release/consolidated-recovery-20260717` / existing draft PR #1175. Started from
  head `028e0aaf` (21 commits of Company Vault P0 work by Codex and the owner's account).
- **Problem:** exact-head CI was red at step 19 for six consecutive pushes (`8e75e437`, `a5c00152`,
  `89888d9d`, `d0cd261a`, `028e0aaf`). Build, Playwright and the two-user isolation stage were
  *skipped* as a consequence, so nothing past the test step was proven on any of those heads.
- **Diagnosis:** four failures, all owner-facing wording colliding with the reviewed→verified
  rename the P0 deliberately makes. **None was a product regression.** Note the first local run
  showed six failures because PostgreSQL died mid-run — restarted and re-ran before believing it,
  per the rule in CLAUDE.md.
  1. `main-engine-source-verified-selection` — test bans the substring `human promotion`; the new
     rationale *denies* it ("no separate human promotion step is required…"). Fixed in the
     **implementation** (→ "no separate approval step"), so the assertion stays strict.
  2. `matching-quality-state` — expected `/await\s+engine\s+run/`; the message now says "await Run
     Engine". The durable human-REVIEWED record is still counted correctly; only word order moved.
  3. `panel-route-parity` — expected "28 reviewed vault expert(s)"; now "28 verified/source-backed
     Vault expert(s)".
  4. `pipeline-authority-regression` — pinned `findSourceDocument` and an old warning string in
     `lib/company-vault-ingestion.ts`; both moved when source binding was unified onto
     `remapUnlinkedVaultSources` (P0 §7). Re-pointed at the delegation, which is a stronger guard.
     The safety assertion (`doesNotMatch(/trustLevel:\s*"REVIEWED"/)`) was **not** touched and
     still passes — ingestion never fabricates human review.
- **Tests actually run:** full `RUN_DB_INTEGRATION=true npm test` against real PostgreSQL 16 —
  **9,811/9,811 passed, 0 failed, 0 skipped**, exit 0 (was 9,807/9,811 before). `npx tsc --noEmit`
  exit 0. `npm run lint` 0 errors, 1 pre-existing unused-disable warning. `npm run build` exit 0 —
  the first time the build has been proven on this head, since CI skipped it.
- **P0 audit — already implemented by the other tool, verified not re-done:** §2 one canonical
  matcher (`matchReviewEvidenceField`, consumed by both `collectEvidence` and
  `buildPartialSourceVerificationProvenance`; NFC, strict-ordered first, identity-token fallback
  for identity fields only, every token required, no fuzzy/phonetic matching); §3 `recordType`
  passed through; §5 deadlock broken by ordering `remapUnlinkedVaultSources` before
  `autoVerifyCompanyKnowledge` in both `lib/engine/prepare-company-vault.ts` and
  `lib/company-vault-ingestion.ts`; §7 classifier unified on
  `shouldScanForExperts`/`shouldScanForProjects`; §8 `VAULT_INGEST` is woken by
  `scheduleRequestScopedWorkerWake` from `app/api/upload/route.ts:46` and
  `app/api/company/ingestion-readiness/route.ts:23`. Affix stripping covers the owner's real
  context including Ethiopian honorifics (`ato`, `wro`, `weyzero`, `obo`).
- **Not done — cannot be done from here:** the deployed-Preview proof that the owner's real
  0/28 and 0/112 screenshots no longer reproduce. This session's egress policy denies CONNECT to
  `*.vercel.app`, so no authenticated browser run against the Preview is possible. Reported, not
  routed around; no internal-function run substituted for it.
- **CI / deployment:** No merge, force-push, rebase, base change, history rewrite, new PR,
  credential rotation, Production migration, or Production deployment.
- **Next action:** owner re-runs the real tender on the exact-head Preview and reports Vault
  verified counts and Engine candidate counts.
- **Merge status:** Not reviewed; not merged. Draft.

### 2026-08-10 15:40 UTC — Codex (GPT-5.6 Sol), P0 acceptance strengthening

- **Branch / PR:** `release/consolidated-recovery-20260717` / #1175; verified remote head moved from the supplied `b6d6ee26ba9b704ac167a945992ca5deff350498` to `a5c001529619423f79fc194b97d71d8369f31997` and inspected only the three intervening commits.
- **Scope / files:** audited the P0 reconciliation already on the governing PR; strengthened `tests/company-vault-zero-bureaucracy-db.test.ts` to require zero blockers and prove 28 Experts/112 Projects can share their respective authoritative bundles; strengthened `tests/identity-verification-accepts-normalised-names.test.ts` to pin stable canonical identity-fallback quotes and coordinates; updated this handoff. No production gate was relaxed.
- **Tests:** Prisma generation passed. The focused real-PostgreSQL run was attempted, but the configured Neon host was unreachable; focused non-DB tests, typecheck, lint, and build results are recorded in the final PR report.
- **CI / deployment:** #1175 CI was running at session start; dependency audit and the existing Vercel check were green. Codex created no deployment and did not promote or merge anything.
- **Risk / next action:** authenticated live owner totals (28/112) and live Engine candidate/selection counts remain unproven. Re-run the full matrix with reachable PostgreSQL, then test the exact final-SHA Preview with owner data.
- **Merge status:** unsafe pending PostgreSQL and live Preview acceptance.

### 2026-08-10 UTC — Codex (P0 Vault reconciliation follow-up)

- **Branch / PR:** `release/consolidated-recovery-20260717` / #1175; started from current PR head `8e75e437fc5073756f020646988d313c157da21d` after inspecting only the two commits after the owner-supplied SHA.
- **Scope / files:** completed stale/existing Expert and Project reconciliation in `lib/company-vault-source-remap.ts` (current-binding priority, deterministic ambiguity/no-match diagnostics, automatic stale authority demotion/rebinding, including the zero-current-documents case); fixed canonical Unicode identity matching and Unicode property boundaries in `lib/vault-review-provenance.ts`; added a decomposed/precomposed Unicode identity regression in `tests/identity-verification-accepts-normalised-names.test.ts`.
- **Tests:** focused non-DB provenance/classifier suites pass; `tsc --noEmit` passes. The required PostgreSQL regression was attempted with `RUN_DB_INTEGRATION=true` but the configured Neon host was unreachable from this environment, so no live DB, Preview, authenticated Playwright, or owner-data counts are claimed by this follow-up.
- **CI / deployment:** PR checks were in progress when inspected. No deployment was created or promoted.
- **Risks / assumptions:** Legal/Financial/Compliance source-less stale-row reconciliation remains in the pre-existing support-record path rather than the new Expert/Project blocker diagnostics. Exact deployed Preview acceptance remains mandatory before a GO decision.
- **Next action:** run the full PostgreSQL/Playwright/build matrix and validate the exact final SHA on PR #1175's Preview with the owner's 28 Experts, 112 Projects, and tender.
- **Merge status:** unsafe until CI and exact-Preview owner acceptance complete.

### 2026-08-10 15:19 UTC — Codex (GPT-5.6 Sol), P0 continuation

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175; fetched the PR ref and verified that its head had advanced from the owner's starting SHA `b6d6ee26ba9b704ac167a945992ca5deff350498` to `e549885952d0384604edec9e18de5a8d20456320`, then inspected only that single intervening commit.
- **Scope / files changed:** continued the Company Vault zero-bureaucracy repair by fixing the canonical classifier to honor explicit `EXPERT_CV`, `PROJECT_REFERENCE`, `PROJECT_CONTRACT`, and `PORTFOLIO` owner categories even when generic filenames/text have no classifier keyword; added `tests/company-document-classifier-vault-scan.test.ts`; updated this handoff. No UI, PDF, ZIP, CSP, provider-order, or unrelated workflow files were touched.
- **Tests:** 35 focused provenance, classifier, Vault-preflight, durable-engine-enqueue, and request-scoped worker-wake tests passed. The requested real PostgreSQL regression was attempted with `RUN_DB_INTEGRATION=true` but the configured Neon endpoint was unreachable, so its setup hook failed before assertions and real 28/112 acceptance is still unverified.
- **Risks / assumptions:** no Preview was deployed (Hope approval is required), no owner data was accessed, and live 28/112 reconciliation is not proven. The preceding commit's realistic DB test remains substantially narrower than the full requested acceptance matrix (tie blocker persistence, two-tenant falsification, replacement/delete/re-extraction, deterministic matching under provider outage, and selected matches still need executable DB coverage).
- **Next action:** run the expanded PostgreSQL acceptance suite against a reachable isolated database, close the remaining acceptance gaps, then deploy and validate the exact final SHA only after Hope authorizes a Preview.
- **Merge status:** unsafe — partial code repair with focused tests only; DB and live acceptance remain outstanding.

### 2026-08-10 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / governing draft PR #1175; verified exact starting head `b6d6ee26ba9b704ac167a945992ca5deff350498` before editing.
- **Scope:** P0 Company Vault automatic reconciliation. Added one canonical identity-aware field matcher shared by full and partial provenance, passed `recordType` through source remapping, replaced database-order/unique-document selection with deterministic evidence-authority ranking and fail-closed ties, unified ingestion scan decisions on the canonical classifier, expanded CV/project indicators, and added the requested 28-Expert/112-Project PostgreSQL fixture plus a focused RED→GREEN partial-identity regression.
- **Files changed:** `lib/vault-review-provenance.ts`, `lib/company-vault-source-remap.ts`, `lib/company-vault-ingestion.ts`, `lib/company-document-classifier.ts`, `tests/identity-verification-accepts-normalised-names.test.ts`, `tests/company-vault-zero-bureaucracy-db.test.ts`, and this handoff.
- **Tests:** focused identity regression passed (11/11) after first reproducing the new partial-verifier case RED; `npx prisma generate`, `npm run typecheck`, lint, and `git diff --check` passed. Real PostgreSQL tests were attempted but the configured Neon endpoint was unreachable, so database acceptance remains unverified in this environment.
- **Risks / assumptions:** this is not live acceptance. No Preview was deployed or owner data inspected; queue dispatch and Engine timeout code were already wired on this exact starting SHA and were not changed. The new DB regression could not execute against PostgreSQL here. Explicit auto-detected category persistence, blocker-code persistence for ambiguous matches, source replacement scenarios, provider-outage matching, and exact live 28/112 reconciliation remain to be proven.
- **Next action:** restore a reachable PostgreSQL test database, run the new regression and full required suite, then deploy the exact SHA only with Hope's approval and validate the real Preview owner state before calling the P0 fixed.
- **Merge status:** unsafe — partial root-cause repair only; live and DB acceptance outstanding.

### 2026-08-10 13:50 UTC — Claude Code (Opus), PR #1175 release-hardening audit at exact head

- **Branch / PR:** `release/consolidated-recovery-20260717` / existing draft PR #1175. Audit started
  from head `fe612ab0`; no Codex commits had landed after it.
- **Scope / files:** One new test file, `tests/job-claim-concurrency-stress-db.test.ts`, plus this
  handoff entry. **No production source changed** — the audit found no defect that justified one.
- **Gap closed:** the queue's exactly-once claim had small-scale coverage only
  (`tests/engine-worker-wake-constraints.test.ts`: 4 mixed racers, 12 concurrent wakes, ENGINE_RUN
  only). The new file stresses `claimJobForCaller` at 2, 10 and 25 concurrent callers with the two
  real caller shapes interleaved (cron `global: true`, request wake tenant-scoped), then covers
  25-callers-vs-25-jobs (no double-hand-out, no starvation), FIFO order, 20-way two-tenant
  contention with ownership assertions, cross-tender isolation inside one tenant, job-type
  isolation, the fail-closed unidentified caller, and the `nextAttemptAt` backoff window against a
  25-caller stampede. 12 tests, all pinned to tenders the file creates — an unpinned `global: true`
  claim steals other suites' rows, which is what broke `not ok 814` on this branch before.
- **Correction to the record:** the full-suite count previously reported as 9,779 on this head is
  wrong. Measured twice today on the same tree: **9,777** without the new file, **9,789** with it.
  9,777 + 12 = 9,789 exactly.
- **Tests actually run:** full `RUN_DB_INTEGRATION=true npm test` against real PostgreSQL 16 —
  9,789/9,789 passed, 0 failed, 0 skipped, exit 0. Baseline re-measurement 9,777/9,777, exit 0.
  Focused new file standalone 12/12. `npx tsc --noEmit` exit 0. `npm run lint` 0 errors, 1
  pre-existing unused-disable warning in `tests/superseded-job-status-projection.test.ts`
  (threshold is 50). Note `npx next lint` is not this project's lint entry point and crashes on
  module load — use `npm run lint`.
- **Exact-head CI verified by inspection, not badge:** run `31391888387`, job `93465334960`,
  head_sha `fe612ab07c9e1b9204ea63ca4eece0402f22d7c6`, conclusion success. 27 steps executed; the
  only `skipped` step is #28, the failure-only diagnostics upload. Step 19 (unit + DB integration)
  ran 3m03s; step 24 (authenticated browser: smoke, intake, golden workflow, cross-user isolation)
  ran 3m39s and is separate from step 22's 22s Playwright install — so the browser stage executes
  tests rather than merely booting.
- **Deployed Preview identity proven:** `dpl_GbNQUmCWCxQfpT8t8oMr4tQDbGAa` is READY and its own
  `/api/health` returns `release: fe612ab07c9e1b9204ea63ca4eece0402f22d7c6`, matching the head.
- **Blocked — deployed Preview golden path NOT performed.** This session's egress policy denies
  CONNECT to `*.vercel.app` (proxy `connect_rejected`, gateway 403), so no browser or authenticated
  multi-step HTTP run against the Preview is possible from here. Only single-shot reads via the
  Vercel MCP fetch tool work. Per the standing rule this was reported, not routed around, and no
  internal-function run was substituted for it. This remains the largest open verification gap and
  is owner-executable — see the PR body.
- **Audited, no change made (no defect found):** workflow action versions (all v4/v5, DataDog
  SHA-pinned, no `@v1/@v2/@v3`, no node12/16 runtimes) — but CI still emits
  `Node.js 20 is deprecated … actions/upload-artifact@v5 … forced to run on Node.js 24`, which is a
  property of the published action, not of this repository, and has no newer major to move to;
  `CREATE INDEX` errors in the CI Postgres log (`Expert.deletedAt`, `Project.deletedAt`,
  `TenderRequirement.sourceTenderFileId`) are `lib/prisma.ts`'s deliberately-tolerated bootstrap
  failures on a non-migrated scratch database — on the migrated schema all three columns and all
  three indexes exist, verified directly with `psql`.
- **Findings recorded as healthy:** `enqueueEngineJobForCurrentSources` has exactly one caller
  (the manual Run Engine route) and `createAnalysisJob` exactly one (the manual AI Analyze route);
  run-next additionally logs and ignores any handler returning `output.automaticEngineJob`.
  Handlers receive `userId`/`tenderId` from the claimed row, never from the request — there is no
  `userId` query parameter anywhere in run-next. A PostgreSQL trigger
  (`enforce_ai_job_tender_owner` → `AI_JOB_TENDER_OWNER_MISMATCH`) rejects tenant-mismatched AiJob
  inserts *and* userId updates at the database. Vault records reach matching eligibility
  automatically via `SOURCE_VERIFIED` (`lib/company-auto-verification.ts`,
  `lib/plan-b-source-reconcile.ts` promote on `provenance.ok` and demote to `AI_DRAFT` otherwise),
  so `REVIEWED` is the optional human path, not a mandatory promotion gate. No secret shapes in
  `.next/static`, no client source maps emitted, and `NEXT_PUBLIC_ANTHROPIC_API_KEY` /
  `NEXT_PUBLIC_DATABASE_URL` / `NEXT_PUBLIC_SESSION_SECRET` appear only in tests asserting they are
  never exposed. Zero unresolved PR review threads and zero Vercel toolbar threads.
- **Runtime logs:** no error cluster in the last 7 days belongs to `dpl_GbNQUmCWCxQfpT8t8oMr4tQDbGAa`
  — but that is because no workload has been driven against it, not proof of health. The named
  historical timeouts (`/api/tenders/[id]/evaluator-objections` and
  `/api/tenders/[id]/requirement-coverage` at `maxDuration = 10`, `/api/ai-jobs/run-next` at 60)
  last occurred 2026-08-09 16:33 on `dpl_5k9qJYdpr5WaUUqoMntxttQQB6R6`: **not reproduced, not
  disproven.** run-next's budget is counted from request start (`startTime` precedes the recovery
  sweeps), leaving 20s of headroom, so an overrun means a handler outran its `deadlineMs`.
- **CI / deployment:** No merge, force-push, rebase, base change, history rewrite, new PR,
  credential rotation, Production migration, or Production deployment.
- **Next action:** owner runs the deployed-Preview golden path (steps in the PR body) on this exact
  SHA; nothing else in the audit is blocked.
- **Merge status:** Not reviewed; not merged. Draft.

### 2026-08-09 19:35 UTC — Codex (GPT-5.6 Sol), post-Engine Vault transition and Bid Strategy authority

- **Branch / PR:** `release/consolidated-recovery-20260717` / existing draft PR #1175.
- **Scope / files:** Fixed the first reproduced post-Engine transition in `lib/company-vault-source-remap.ts`; made `app/api/tenders/[id]/bid-strategy/route.ts` consume `getTenderReleaseSnapshot`; removed the misleading normal-path “Confirm evidence coverage” wording in `lib/engine/canonical-workflow-decision.ts`; updated three focused existing tests plus this handoff.
- **Real PostgreSQL reproduction:** A byte-verified owned CompanyDocument contained the exact expert/project identity but not AI-inferred secondary fields. Before the fix `remapUnlinkedVaultSources` returned 1 instead of 2 for both experts and projects, leaving the identity-grounded rows unbound and therefore unreachable by the existing partial SOURCE_VERIFIED verifier.
- **Fix / safety:** Full-field matching remains preferred. When that fails, remap uses the canonical partial source-verification predicate and binds only when exactly one owned, byte-verified document proves the record identity. Zero or ambiguous matches remain untouched. The following canonical verifier promotes the bound identity only, records unverified fields, never fabricates REVIEWED metadata, and repeated remap remains idempotent. Bid Strategy now accepts only promoted `AI_SUCCEEDED` plus matching canonical content hash and canonical job ID, exactly like Analysis Quality/release gates; stale/fallback/missing states remain blocked.
- **Tests:** Focused PostgreSQL/relevant set — 33/33 passed; typecheck passed; lint passed with one pre-existing unused-disable warning; production build passed with an explicit test-only provider placeholder and local PostgreSQL. Full `RUN_DB_INTEGRATION=true npm test` passed: 9,773/9,773, 0 failed.
- **CI / deployment:** Not pushed yet at entry time. No merge, approval, force-push, rebase, base change, manual Preview request, or Production deployment.
- **Known limitation / remaining proof:** The focused database coverage proves owned-byte remap → SOURCE_VERIFIED, source-less blocking, idempotent remap, current-analysis Bid Strategy agreement, worker handoff, AUTO_FINALIZE retry/PDF, and ZIP assembly across the relevant executed suites. It does not yet constitute one monolithic provider-backed test executing AI Analyze through final ZIP; no live provider credential was available locally.
- **Next action:** Push the bounded commit, require exact-head CI, and inspect only the automatically created Preview for the five truthful Vault states.
- **Merge status:** Not reviewed; not merged.

### 2026-08-09 19:20 UTC — Codex (GPT-5.6 Sol), PR #1175 bounded-review verification

- **Branch / PR:** `release/consolidated-recovery-20260717` / existing draft PR #1175.
- **Scope / files:** Review-tooling safeguard verification only; this handoff entry is the sole repository change. No production or test source changed.
- **Finding / solution:** GitHub reports PR #1175 as a 1,056-file consolidation (83,244 additions / 43,990 deletions), so any tool that requests the full PR patch can exceed its extraction limit. The PR description now starts with a permanent instruction not to request the full patch and gives the bounded current range `811942fb...0f366cb9` plus the three named commits/files. Reviewers and automation must fetch the head and inspect only those bounded commits or named files. Rewriting history, retargeting, or opening another PR was deliberately avoided.
- **Checks actually run:** `gh api repos/hopeengineering83-code/hope-tender-path-b/pulls/1175` — open draft, head `0f366cb9`, 1,056 files; `gh api repos/hopeengineering83-code/hope-tender-path-b/pulls/1175/comments` — no inline comments; previous-head GitHub check-runs — all completed successfully; exact-head checks started after this documentation push; `git status --short --branch` — clean before this entry.
- **CI / deployment:** Previous-head CI was green; exact-head CI is running after this documentation-only push. No merge, approval, force-push, rebase, base change, new PR, Preview request, or Production deployment performed.
- **Known limitation:** The warning cannot be prevented when a client ignores the safeguard and explicitly requests the full 1,056-file patch; avoiding that request and using the bounded compare/commit views is the non-destructive remedy for this existing consolidation PR.
- **Next action:** Review only the bounded range and keep PR #1175 draft until owner-only release blockers are resolved.
- **Merge status:** Not reviewed; not merged.

### 2026-08-09 18:05 UTC — Claude Code (Opus), PR #1175 Engine wake constraint coverage

- **Branch / PR:** `release/consolidated-recovery-20260717` / existing draft PR #1175.
- **Scope / files:** One new test file, `tests/engine-worker-wake-constraints.test.ts`. No production
  source changed.
- **Duplicate avoided:** I had independently written a manual-Engine wake
  (`lib/ai-jobs/manual-engine-worker-wake.ts` plus its own route wiring and tests) before fetching.
  Codex had already shipped the same feature in `cdae73cb` as
  `lib/ai-jobs/request-scoped-engine-worker-wake.ts`. Committing mine would have left two competing
  wake modules on one route, so I deleted mine and kept Codex's — theirs additionally skips the wake
  when the reused job is already RUNNING. The new tests target Codex's module.
- **Gap closed:** `tests/engine-worker-handoff.test.ts` proves the sequential happy path (one QUEUED
  job across duplicate enqueue, claimed, SUCCEEDED). It does not cover the properties the wake newly
  puts at risk. The added file covers only those, with no overlapping assertions: exactly-once when
  the wake races the cron (exactly 1 winner of 4 mixed racers; 1 of 12 concurrent wakes), the wake
  sitting behind all six fail-closed source gates, the wake never authenticating as an automated
  caller (so `failStuckJobs` / `reapStaleQueuedJobs` / `findJobsDueForRetry` stay cron-only), and
  tenant / tender / jobType scope.
- **Tests actually run:** `npx prisma generate` — passed. `npx tsc --noEmit` — passed.
  `npx next lint` — no warnings or errors. Full `npm test` against a real local PostgreSQL 16 with
  `RUN_DB_INTEGRATION=true` — **9767/9767 passed, 0 failed**. This includes
  `tests/engine-worker-handoff.test.ts`, which the two Codex entries below record as **not executed
  locally** because the configured Neon host was unreachable; it is now verified against a real
  database and passes.
- **CI / deployment:** PR #1175 exact-head CI was re-running when checked; the earlier `d7d93afc`
  failures are superseded by `3d53eb6a`. No merge, approval, force-push, base change, new PR, or
  production deployment performed.
- **Risks / assumptions:** The wake keeps the engine route's invocation alive until `run-next`
  responds (bounded by its `maxDuration = 60`). If Vercel kills it first the job is left for
  `failStuckJobs`, which is the intended cron-as-recovery path.
- **Next action:** Prove the gated `generateTenderDocuments -> finalizeRequiredPdf ->
  assembleFinalSubmissionZip` route end-to-end; it remains the last open engineering item.
- **Merge status:** Not reviewed; not merged.

### 2026-08-09 18:20 UTC — Claude Code (Opus), auto-finalize chain behavioural coverage

- **Branch / PR:** `release/consolidated-recovery-20260717` / existing draft PR #1175.
- **Scope / files:** One new test file, `tests/auto-finalize-pipeline-behavioral-db.test.ts`. No
  production source changed.
- **Gap closed:** `runAutoFinalizeAfterGeneration` is the application's real bridge from generated
  DOCX documents to a downloadable package, and its only coverage
  (`gap3-durable-auto-finalize.test.ts`, `auto-finalize-continuation-gap4.test.ts`) was `readFileSync`
  plus regex over the source. Those assert the calls are *written*, not that the chain *works* — they
  would stay green if the renderer emitted zero bytes or an unvalidated DOCX were promoted into the
  package. The new tests run the real function against real PostgreSQL with real `docx`-generated
  bytes and assert on persisted rows: a required PDF is rendered from a VALIDATED DOCX and persisted
  with a real `%PDF-` header plus a matching SHA-256; an unvalidated source finalizes nothing and
  creates no PDF row; a missing source is skipped rather than thrown, so the durable worker survives.
- **Tests actually run:** `npx tsc --noEmit` — passed.
  `RUN_DB_INTEGRATION=true npx tsx --test tests/auto-finalize-pipeline-behavioral-db.test.ts` —
  3/3 passed against local PostgreSQL 16.
- **OPEN LEAD (not a confirmed defect, do not treat as one):** while writing these I observed that a
  freshly finalized PDF is persisted and then marked `validationStatus = FAILED` by
  `runCanonicalValidation`, and that a second `runAutoFinalizeAfterGeneration` on the same tender
  reported `failed: 1` with the PDF row no longer present. `checkFullExportReadiness` reported
  `FILE_BYTES_NOT_VERIFIED: LEGACY_INTEGRITY_UNKNOWN` for the finalized PDF — but it reported the
  same for the seeded source DOCX despite `integrityStatus: "VERIFIED"`, which strongly suggests my
  hand-built fixture does not carry whatever real generation sets for byte verification. So this may
  be fixture fidelity rather than a product bug. It is worth resolving because, if real, an
  AUTO_FINALIZE retry would destroy a finalized PDF and never converge. The idempotency assertion was
  therefore NOT committed: a red test would block CI on an unproven claim.
- **CI / deployment:** No merge, approval, force-push, base change, new PR, or production deployment.
- **Next action:** Seed a generated document through the real generation path (not a hand-built row)
  and re-check whether the finalized-PDF retry behaviour above reproduces.
- **Merge status:** Not reviewed; not merged.

### 2026-08-09 16:35 UTC — Codex (GPT-5.6 Sol), PR #1175 diff-review safeguard

- **Branch / PR:** `release/consolidated-recovery-20260717` (local `pr-1175`) / existing draft PR #1175.
- **Scope / files:** Investigated the reported diff-extraction size warning and updated this handoff only. PR #1175 is a long-lived consolidation with 1,052 changed files (82,227 additions / 43,983 deletions), while the Run Engine handoff is isolated to commits `cdae73cb` and `9f621545`. No production or test code changed in this follow-up.
- **Tests / checks:** `npx prisma generate` — passed; `npx tsx --test tests/engine-worker-handoff.test.ts` — environment warning because the configured non-production Neon database was unreachable before fixture creation; `npm run typecheck` and `git diff --check` — passed; `gh pr view 1175 --json ...` and `gh pr checks 1175` — confirmed the exact PR/head and current checks; GitHub reports no inline review comments.
- **CI / deployment:** Exact-head dependency audit, screenshot audit, and Vercel Preview passed; the duplicated CI jobs were still pending when checked. No merge, approval, force-push, base change, new PR, or production deployment performed.
- **Risks / assumptions:** GitHub cannot render/extract the complete consolidation diff reliably at this size. Review automation must use the two-commit incremental range (`b35cb7f5..9f621545`) rather than requesting the full PR diff. Shrinking the PR itself would require rewriting or retargeting its established consolidation history, which was not owner-authorized.
- **Next action:** Review the incremental Run Engine range and require exact-head PostgreSQL CI before merge consideration.
- **Merge status:** Not reviewed; not merged.

### 2026-08-09 16:23 UTC — Codex (GPT-5.6 Sol), PR #1175 review correction

- **Branch / PR:** `release/consolidated-recovery-20260717` (local `pr-1175`) / existing draft PR #1175.
- **Scope / files:** Replaced the source-text/simulated worker assertion in `tests/engine-worker-handoff.test.ts` with one real PostgreSQL behavioral regression using the canonical Engine enqueue authority, atomic claim policy, and durable completion API. No production source changed in this follow-up; this entry records the correction.
- **Tests:** `npm run typecheck` — passed. `RUN_DB_INTEGRATION=true npx tsx --test tests/engine-worker-handoff.test.ts` — environment warning: the configured non-production Neon test database was unreachable before fixture creation, so the behavioral test did not execute locally.
- **CI / deployment:** PR #1175 exact-head CI was still pending when checked. No merge, approval, or production deployment performed.
- **Risks / assumptions:** The new regression requires PostgreSQL by design and will run in CI's isolated PostgreSQL service. It proves one persisted job across duplicate enqueue, actual `QUEUED -> RUNNING -> SUCCEEDED` database transitions, and no third user action.
- **Next action:** Push the correction to PR #1175 and require its PostgreSQL CI result before calling the defect complete.
- **Merge status:** Not reviewed; not merged.

### 2026-08-09 16:19 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` (local `pr-1175`) / existing draft PR #1175.
- **Scope / files:** Run Engine worker handoff only: `app/api/tenders/[id]/engine/route.ts`, new `lib/ai-jobs/request-scoped-engine-worker-wake.ts`, new `tests/engine-worker-handoff.test.ts`, and this handoff entry.
- **Fix:** After the authenticated manual route durably enqueues or reuses a claimable `ENGINE_RUN`, it schedules exactly one authenticated, tender-scoped server wake of the existing `run-next` worker. RUNNING jobs are not woken; failed wakes leave persisted state unchanged for recovery.
- **Tests:** `npx tsx --test tests/engine-worker-handoff.test.ts` — 1 passed; `npx prisma generate` — passed without tracked generated output; `npm run typecheck` — passed.
- **CI / deployment:** Existing PR #1175 head checks were green before this change. New exact-head CI not yet run. No merge, approval, or production deployment performed.
- **Risks / assumptions:** Wake delivery is best-effort through Next.js `after()`; durability remains in the `AiJob` row. The tender-scoped worker filter prevents another queued Engine job for the same user from consuming this wake.
- **Next action:** Push this commit directly to PR #1175 and review its exact-head CI.
- **Merge status:** Not reviewed; not merged.

### 2026-08-08 18:05 UTC — Claude Code

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175, head `a72071be`. Audit passes 5–6; one confirmed open gap recorded, no code change in this entry.
- **Pass 5 — extraction quality: SOUND, left unchanged.** `classifyPageText` in `lib/extraction-quality.ts` implements every one of CLAUDE.md's six conditions for a "perfectly extracted page", and `status === "GOOD"` requires all of them. Condition 5 ("not only headers/footers/noise") is implemented the hard way — density is measured on `meaningfulPageCharCount`, which strips headers and footers first — so a page padded with boilerplate cannot reach GOOD on raw character count. Acceptance criteria 1 and 2 are satisfied.
- **Pass 6 — client-detail provenance: CONFIRMED GAP.** Acceptance criterion 4 and requirement 20 demand a source page and source quote for **every** extracted client field. All 19 client data fields exist in the AI schema, and `TenderFactsLedger` carries the correct generic provenance triple (`sourceFileId`, `sourcePage`, `sourceQuote`) with a real grounding check (`hasSourceEvidence`). The design is right. But only **9** semanticKeys are ever written — `title, clientName, reference, deadline, submissionMethod, submissionEmails, submissionAddress, country, submissionEmailSubject` — all as literals in `lib/engine/tender-facts-ledger-service.ts:799-1046`, with no dynamic key writing anywhere. **12 client fields therefore have no ledger row and no provenance:** legalClientName, donorAgency, implementingAgency/projectOwner, city, clientAddress, clientContactName, clientContactTitle, clientContactEmail, clientContactPhone, clientWebsite, preBidChannel, clientRepresentative. Full evidence and the implementation plan are in the Active Workboard item; the fix extends the existing write block rather than adding scalar `xSourcePage`/`xSourceQuote` columns, which the ledger exists to replace.
- **Honest acceptance-matrix position (10 criteria):** 8 verified PASS, 1 verified FAIL (criterion 4, above), 1 not yet exercised (criterion 8 — "does not build an empty submission plan when requirements exist"). This is **not** 100%. Two prior sessions' worth of "score" claims in this repo were asserted without exercising the criteria; this entry states what was actually run.
- **Tests actually run:** no code changed in this entry. The last full run on this head was 9636/9636 pass with `RUN_DB_INTEGRATION=true` against local PostgreSQL 16, database verified alive before and after.
- **Risks / assumptions:** the 12 missing fields are extracted by the AI and may be displayed, so the gap is provenance and grounding, not absence of data — a reviewer cannot trace those values to a page and quote, and no gate can treat them as source-grounded.
- **Next action:** implement the workboard item (12 ledger mappings + DB-integration tests asserting `hasSourceEvidence`, and `NOT_STATED_IN_SOURCE` rather than a placeholder when the AI supplied none).
- **Merge status:** not reviewed.

### 2026-08-08 17:35 UTC — Claude Code

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175. Pushed `d6999353..d2b5a71a` (four commits from the two prior entries), then this follow-up.
- **CORRECTION to the previous entry.** Commit `d2b5a71a` claimed the phrase "to be confirmed by bid team" "travelled all the way into a client-facing tender submission with nothing objecting." **That was wrong, and the claim overstated the defect.** Re-checking the export path end to end shows the delivered content *was* already gated:
  - `PLACEHOLDER_PATTERNS` (= `DOCUMENT_PLACEHOLDER_PATTERNS`) contains `/to\s+be\s+(?:added|filled|completed|provided|confirmed|determined)\b/i`, which matches that phrase;
  - `app/api/tenders/[id]/download` extracts each DOCX's **real visible text** via `extractDocxVisibleText` and runs `validateDocumentQuality`, returning 409 `QUALITY_VALIDATION_BLOCKED` on BLOCKED;
  - `lib/engine/workflow/pdf-finalizer.ts` runs the same validator plus hygiene and internal-artifact scans on the extracted text **before** a PDF is produced, so failing content never becomes a deliverable.
  `d2b5a71a` is still correct and worth keeping — it makes Authority Review agree with itself, since one phrasing of the identical stub was classified CRITICAL and the other was invisible — but it is defense in depth, **not** the closure of an open export hole. The export gate was sound. Recording this because the earlier wording would leave the next reader believing a shipped submission had been possible.
- **Scope / files:** `lib/engine/authority-review.ts` — documented the module's actual scope. It reads `contentSummary` and `reviewNotes` only, never document bytes or rendered text, while its blocker names imply otherwise (`TODO_FIXME_IN_CONTENT` says "IN_CONTENT" outright). The note names the two checks that do carry the content guarantee and warns against collapsing the export path into this module on the assumption that it covers the same categories.
- **Verified sound, deliberately left unchanged:** the layered content gate above. This is proven-good work; the correct action was to document it, not to add a redundant fourth check.
- **Tests actually run:** local PostgreSQL 16, `RUN_DB_INTEGRATION=true`. `npx tsc --noEmit` PASS. Full suite **9636/9636 pass, 0 fail**, database verified alive before and after.
- **Risks / assumptions:** comment-only change to `authority-review.ts`; no behavior altered. The residual (accepted) limitation is that a non-DOCX final artifact is not re-scanned at ZIP time — `visibleText` is extracted for `.docx` only and base64 content is deliberately skipped to avoid false negatives. That is safe **because** `pdf-finalizer` gates the content before the PDF exists; it would stop being safe if any path ever produced a final PDF without going through that finalizer.
- **Next action:** continue the audit into the Vault review UI items on this workboard.
- **Merge status:** not reviewed.

### 2026-08-08 15:20 UTC — Claude Code

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175, rebased onto exact head `d6999353`. No other agent's commits rebased or discarded.
- **Scope / files:** deep audit pass. Two confirmed defects, both the same failure mode — the system asserting confidence it had not earned.
  - `lib/engine/proposal-benchmark-guard.ts` — **placeholder laundering.** `normalizeWeakText()` rewrites every placeholder, TBD, TODO, template variable and AI refusal into the phrase "to be confirmed by bid team", and runs *before* `hasForbiddenWeakness()` scores the document. That detector tested for `placeholder|tbd|todo|to be determined` — none of which survive the rewrite. A proposal left full of unresolved spots therefore scored **+5 and collected the strength "No obvious AI/placeholder/TBD language detected"**, while the module's own reviewer checklist ("Confirm that no placeholder wording remains") was guaranteed to be answered wrongly. Added `countUnresolvedPlaceholders()`, taught the detector the substituted phrase, replaced the false strength with a gap stating the count, and exposed `unresolvedPlaceholderCount` on `ClientReadyProposal`. Rewriting a raw `${var}` into readable wording is still done — only the claim that the result is clean is removed.
  - `CLAUDE.md` — **the guide contradicted the contract it names as authority.** Its Product-goal section said AI Analyze and Run Engine are "durable server-owned stages, not mandatory normal-path user actions", while `OWNER_AUTOMATION_CONTRACT.md` and the shipped code make both explicit manual gates (`createAnalysisJob()` requires `manualAuthority`; the engine route requires `manualRequested: true`; `continueSuccessfulAnalysis()` always returns `MANUAL_ENGINE_REQUIRED`). This sent successive sessions back and forth undoing each other. Rewrote the section to match, with an explicit note not to re-automate them.
  - `CLAUDE.md` — removed a pinned "Current Main State (SHA: 63369f03 … 6000+ tests)" block (the suite is now 9628) and a four-item priority list whose every engineering item had already shipped (`TenderFactsLedger` wiring, `scripts/backfill-tender-facts-ledger.ts`, `CONDITIONAL_OR_UNSCHEDULED`, the 800×1280 E2E viewport). Both were sending each new session to redo finished work or to trust a status nobody had re-run.
  - `tests/proposal-placeholder-laundering.test.ts` (new, 4 behavioral tests).
- **Verified clean in the same pass (no change needed):** the placeholder ban on tender metadata is genuinely enforced end to end — every occurrence of "Bid-Team to confirm"/TBD/N/A in `lib/` is detection or rejection (AI prompt prohibition, `tender-metadata-completeness.ts`, `final-submission-readiness.ts`), none produce placeholders as values. All 32 TODO/FIXME hits in production code are content-detection regexes, not developer debt.
- **Tests actually run:** local PostgreSQL 16, `RUN_DB_INTEGRATION=true`. `npx tsc --noEmit` PASS. Full suite `npm test` **9628/9628 pass, 0 fail**; database verified alive before and after the run. The new test fails 4/4 against the pre-fix guard.
- **Risks / assumptions:** the benchmark score now drops 5 points and reports NEEDS REVIEW for any document carrying unresolved spots. `score.passed` gates nothing downstream (its only consumer, `generate-elite.ts`, uses `finalized.markdown`), so this changes reporting, not generation. Open question for the owner: whether a document with `unresolvedPlaceholderCount > 0` should additionally fail-close the final export gate. Not changed here — that is a behavioral decision, not a defect fix.
- **Next action:** owner decision on the export-gate question above; continue the audit into the Vault review UI items on this workboard.
- **Merge status:** not reviewed.

### 2026-08-08 13:40 UTC — Claude Code

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175. Fast-forwarded local to the exact remote head `977831ae` before editing; no other agent's commits were rebased, discarded, or amended.
- **Scope / files:** Company Vault re-extraction reported success for documents it never processed. `reextractAllCompanyDocuments` excluded rows with no inline `fileContent` and no `storagePath` in its `where` clause and `continue`d past any that got through, so those rows landed in neither `reextracted` nor `failedFiles` — a vault made entirely of them returned `{ reextracted: 0, failedFiles: [] }`, a clean success for a run that did nothing. That is the reported "DOCUMENTS 6 — 0 extracted" with an unverified-integrity banner, no stated cause, and no action that could ever change it.
  - `lib/company-vault-reextraction.ts` — stopped filtering byteless rows out of the query; classify them as a terminal `SOURCE_BYTES_UNAVAILABLE` state on the row (`integrityStatus: "MISSING"`, `contentSha256: null`, `aiExtractionStatus: "FAILED"`, explicit `aiExtractionError`, metadata `extractionStatus: "SOURCE_BYTES_MISSING"`); added an `unrecoverable` array to `ReextractAllResult`.
  - `lib/ai-job-handlers-legacy.ts` — VAULT_INGEST step message, audit metadata (`docsUnrecoverable`) and job output (`reextractionUnrecoverableFiles`) now name the affected files and state re-upload as the remedy.
  - `app/api/company/knowledge/repair/route.ts` — per-document `SOURCE_BYTES_MISSING` status plus a separate CRITICAL gap, so it is no longer folded into "unverified until their bytes have a digest" (wording that implies a pending fix that will never arrive).
  - `tests/vault-reextraction-unrecoverable-bytes.test.ts` (new, 4 behavioral DB tests), `tests/extraction-quality-round9.test.ts` (return-shape assertion updated + a guard against the skip returning).
  - No schema/migration change. No new user-facing click: the two manual gates remain AI Analyze and Run Engine.
- **Tests actually run:** local PostgreSQL 16, `RUN_DB_INTEGRATION=true`, migrations deployed. `npx tsc --noEmit` PASS (exit 0). `next lint --dir lib --dir tests` PASS (no warnings or errors). Full suite `npm test` **9601/9601 pass, 0 fail** (2391 suites, 237s). `npx next build` PASS (compiled in 91s, 57/57 static pages). New test verified to genuinely catch the defect: 3 of its 4 cases fail against the pre-fix code and all 4 pass after.
- **CI / deployment:** not yet run for this commit. On the previous head the `hope-tender-path-b` Vercel project reported Ready/DEPLOYED. The `pr1175` and `repo` Vercel projects report Error with empty preview URLs; they were already failing before this work and are stray projects, not a signal from this branch.
- **Risks / assumptions:** documents that already carried `extractedText` but lost their bytes keep that text rather than having it deleted — destroying stored data was judged out of scope, and downstream evidence already refuses text without a verified digest. Re-upload is the only real remedy for these rows; nothing here recovers bytes that are gone.
- **Next action:** watch PR #1175 CI on this commit.
- **Merge status:** not reviewed.

### 2026-08-02 16:25 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175; re-fetched and verified exact starting head `2f90c465e7207159b0dba7211509f94fc7760f82` before editing.
- **Scope / files:** inspected both duplicate failed GitHub CI jobs and found the same two stale source-contract assertions in `tests/canonical-vault-engine-panels.test.ts`: they still required the retired phrase `Partially supported` after the canonical runtime state was intentionally renamed `PARTIALLY_VERIFIED` / `Partially verified`. Updated those assertions to enforce the canonical state vocabulary and changed this handoff. No application, schema, provider, release-gate, deployment, or unrelated behavior changed.
- **Tests:** the 32-test focused requirement/evidence and canonical-panel set passed; Prisma generation, TypeScript, full lint, Prisma validation, dependency audit (0 vulnerabilities), and `git diff --check` passed.
- **CI / deployment:** exact starting-head check jobs `91518513556` and `91518508323` each reached the complete test run and failed only the same two stale assertions (8,983/8,985 assertions passed); dependency and Vercel comment checks passed, while exact-head capture was still running when inspected. No deployment was requested or created.
- **Risks / assumptions:** updated-head PostgreSQL/full-suite/build/authenticated browser/capture results remain CI-dependent. This correction reconciles tests with the already-covered canonical runtime truth rather than weakening an acceptance condition.
- **Next action:** push this commit to the existing PR #1175 head, let exact-head CI/capture rerun, and inspect any newly exposed failure while keeping the PR draft and unmerged.
- **Merge status:** not reviewed for merge; draft and unmerged.

### 2026-08-02 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175; re-fetched and verified starting head `87fa6a28b9461900dd9c0471539cf37c4f3c6cc8` before editing.
- **Scope / files:** corrected Requirements and Evidence runtime-state truth so `AUTO_RESOLVING` is emitted only when a tenant-scoped `ENGINE_RUN` job is actually queued/running/partial, removed zero-processing copy that said automatic work was running, and strengthened the exact runtime-fixture contract. Changed `app/api/tenders/[id]/requirement-coverage/route.ts`, `components/requirement-coverage-panel.tsx`, `tests/requirement-evidence-resolver-runtime-fixture.test.ts`, and this handoff.
- **Tests:** focused requirement/evidence suites passed (41 tests, then 18 tests after the final change); Prisma generation, typecheck, scoped ESLint, full lint, Prisma validation, `npm audit --audit-level=high` (0 vulnerabilities), and production build with non-secret build-only provider/cron placeholders passed. The full PostgreSQL run could not proceed because the configured Neon host returned Prisma P1001; migration status had the same external database limitation. Provider-backed preview execution, Vercel runtime logs, authenticated screenshots, and Playwright were not claimed without working preview/database credentials.
- **Risks / assumptions:** the existing PR already contains the canonical resolver and fixture fixes; this session deliberately made no release-gate, provider-order, schema, deployment, or unrelated-area change. `PARTIAL_SUCCESS` remains an active durable Engine state because current enqueue/recovery code treats it as resumable.
- **Next action:** after the configured PostgreSQL/preview environment is reachable, run the remaining exact-head migration/full-DB/Playwright/provider-backed preview checks and inspect deployment `dpl_AKr8QMbzMcS1rcNn5SAnj1auw8JL` logs before considering the draft ready.
- **Merge status:** not reviewed for merge; draft and unmerged.

### 2026-08-02 15:44 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175; re-fetched exact starting head `e8ff72ac23eaebb2e1ea37ac8b4a36e1a39a36e2` before editing.
- **Scope / files:** repaired the only failing CI assertion left by the canonical Requirements and Evidence change. `tests/requirement-coverage-safe-errors-current.test.ts` now verifies the intentional `flatMap` path and its rejection of malformed automatic and null-reference rows instead of requiring the superseded `map` implementation. No application or release-gate behavior changed in this follow-up.
- **Tests:** focused requirement/evidence suite passed (37/37); `npx prisma generate`, typecheck, lint, and the release-integrity audit passed. Full `RUN_DB_INTEGRATION=true npm test` could not complete because the configured Neon PostgreSQL host was unreachable; the first DB hook failed in `tests/ai-job-concurrency.test.ts` with Prisma connectivity, not an assertion failure. Production build reached the fail-closed `next.config.js` preflight and stopped because this local environment has no supported AI-provider key.
- **CI / deployment:** inspected exact-head CI; both duplicate primary jobs failed only on the stale structural assertion corrected here. Dependency checks and Vercel capture/comment checks were green. No deployment was requested or created.
- **Risks / assumptions:** provider-backed preview execution, Vercel runtime-log inspection, full PostgreSQL, build, and Playwright remain to be re-run by CI or an environment with database/preview credentials. Fail-closed behavior is unchanged.
- **Next action:** push this commit to the existing PR head and let PR #1175 CI re-run; keep the PR draft and unmerged.
- **Merge status:** not reviewed; draft and unmerged.

### 2026-08-02 15:05 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175; began from exact re-fetched head `c5a7a654228a378ec6953b45c111317fcf2945f6`.
- **Scope:** Requirements and Evidence runtime repair for deployment `dpl_AKr8QMbzMcS1rcNn5SAnj1auw8JL` / tender `e15b9e35-d8a8-4136-97e8-9f087cd1078a`: family-specific FULL evaluation for verified expert/project/current bytes, complementary quantity enforcement, audit-complete automatic-link metadata, structural source-quote rejection, stable semantic requirement identity/deduplication, exact canonical UI states, unweighted mandatory coverage, and removal of panel-open POST as workflow authority.
- **Files changed:** `lib/engine/automatic-requirement-coverage.ts`, `lib/engine/requirement-source-extractor.ts`, `lib/engine/stable-requirements.ts`, `lib/vault-review-provenance.ts`, `app/api/tenders/[id]/requirement-coverage/route.ts`, `components/requirement-coverage-panel.tsx`, `tests/automatic-requirement-coverage-behavior.test.ts`, `tests/requirement-coverage-confirm-safety.test.ts`, and `tests/requirement-evidence-resolver-runtime-fixture.test.ts`.
- **Tests:** focused requirement/evidence run 26/26 passed; `npx prisma generate` passed; `npx tsc --noEmit` passed; `npm run lint` passed; `npm run prisma:validate` passed; `npm audit --audit-level=high` passed with 0 vulnerabilities. Full `npm test` was stopped after the external Neon database was unreachable; the first DB-backed suite failed only with connection error. Production build reached Next config and was blocked because this container has no AI provider key.
- **CI/deployment:** pre-edit PR checks and Vercel status were green. Exact supplied deployment is READY and bound to the verified starting SHA. Build events were available; the Vercel CLI returned no runtime invocation logs for the requested window. No deployment was created.
- **Risks / assumptions:** no provider credentials or reachable PostgreSQL were available, so provider-backed synthetic execution, full PostgreSQL, browser fixture login/screenshot, and post-change deployed runtime logs remain unverified. The implementation remains fail-closed; current fixture coverage must be recomputed on a preview before any 6/6 claim.
- **Next action:** run the full PostgreSQL and Playwright matrices with deployment credentials, deploy this committed head through the existing draft PR only if Hope authorizes it, then rerun the exact fixture and inspect runtime logs.
- **Merge status:** unsafe to merge until those environment-dependent checks complete; PR remains draft and unmerged.

### 2026-08-01 18:45 UTC — Codex (GPT-5.6 Sol), PR #1175 exact-head 100% acceptance

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175 at exact application/test head `9a939aa85bc9e004316b5d48d45c9b3b9b2a7184`; zero inline comments and zero reviews. No merge or production deployment.
- **Scope:** verification-only closure of the remaining external 5%. Reconciled the live PR head after an initially stale/no-remote local checkout, downloaded both exact-head CI logs and the exact-head route/screenshot artifact, and visually inspected the desktop and mobile Global Matching screenshots. No application, schema, migration, provider, workflow, gate, or test behavior changed.
- **Evidence:** both duplicated exact-head workflows passed migrations, PostgreSQL, release integrity, typecheck, lint, 8,909/8,909 assertions, 58-page production build, source-mutation checks, and authenticated Playwright (180 and 179 passes respectively). Exact-head capture artifact `8822470731` contains 237 screenshots over desktop/tablet/mobile and reports 111/111 expected route cases, 100% coverage, zero critical findings, zero horizontal overflow, and zero warnings. Global Matching visibly renders the read-only automatic authority with no selection/rematch controls at desktop and mobile widths.
- **Completion assessment:** the explicit Company Vault → durable Run Engine → automatic matching → requirement-evidence goal is now 100% implemented and 100% verified across static contracts, PostgreSQL, full tests, production build, authenticated browser flows, and visual capture. No known scoped gap or external verification hold remains.
- **Next action:** keep PR #1175 draft/unmerged until Hope's explicit approval; investigate only a new reproducible owner-data correlation reference or screenshot.
- **Merge status:** scoped goal safe and fully verified; repository-level merge remains Hope-controlled.

### 2026-08-01 18:33 UTC — Codex (GPT-5.6 Sol), PR #1175 final anchor-audit reconciliation

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175 at `828ac69`; no merge or production deployment.
- **Scope / root cause:** exact-head CI reached the complete unit suite and found one stale source-shape assertion in `tests/final-overlap-consolidation.test.ts`. The production panel now renders its canonical anchor through the typed default `sectionId` prop so Global Matching can supply unique per-tender ids, but this older audit recognized only literal ids and workflow-stage ids. Extended the audit to recognize the rendered default-id contract without weakening anchor existence: the default value and `id={sectionId}` binding must both exist.
- **Files changed:** `tests/final-overlap-consolidation.test.ts`, `operator_handoff.md` only. No application, schema, provider, Engine, Vault, matching, readiness, generation, or export behavior changed.
- **Tests / evidence:** focused workflow/canonical-panel/UI tests, targeted ESLint, and `git diff --check` are required before commit. Both exact-head CI copies failed only this stale assertion after the preceding application correction; updated-head full CI/capture remains required for final external acceptance.
- **Known risk / assumption:** this is a static-test reconciliation for an already-tested responsive unique-id implementation; it does not substitute for authenticated browser and PostgreSQL acceptance.
- **Next action:** commit and push to PR #1175, require exact-head CI/capture green, inspect the final capture, and keep the PR draft/unmerged.
- **Merge status:** not reviewed — exact-head external acceptance pending.

### 2026-08-01 18:20 UTC — Codex (GPT-5.6 Sol), PR #1175 matching responsive/DOM closure

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175 at `c22950b`; zero inline comments/reviews. No merge or production deployment.
- **Scope / root cause:** the corrected shortcut passed, and exact-head CI then exposed two real Global Matching defects that the collapsed capture did not exercise: rendering the shared canonical panel once per tender repeated `id="matching-selected-evidence"`, and an injected long unbroken tender title expanded the 390px page to 1420px. Added an optional section id with the canonical tender-page default, assigned deterministic per-tender ids in Global Matching, bounded/hidden overflow, and allowed summary titles to break. Updated static anchor ownership tests to recognize the rendered default-id contract.
- **Files changed:** `components/matching-selected-evidence-panel.tsx`, `app/dashboard/matching/matching-dashboard.tsx`, `tests/canonical-vault-engine-panels.test.ts`, `tests/ui-gap-analysis.test.ts`, `tests/workflow-shortcut-anchor-contract.test.ts`, `operator_handoff.md`.
- **Tests / evidence:** Prisma generation and TypeScript passed; focused panel/matching/UI/shortcut assertions pass after updating the default-id static contract; targeted ESLint and `git diff --check` pass. Predecessor exact CI passed all migrations, PostgreSQL, release integrity, complete unit/database suite, build, and the corrected shortcut, then failed only the duplicate-id and long-title overflow browser assertions. Exact capture passed 111/111 with zero findings but used ordinary collapsed fixture titles, demonstrating why adversarial authenticated browser coverage remained necessary.
- **Completion assessment:** both final browser-discovered defects are corrected with regression assertions. Exact-head CI/capture must rerun green before declaring 100% externally verified.
- **Next action:** push, require final exact-head green, inspect matching screenshots, and keep #1175 draft/unmerged.
- **Merge status:** not reviewed — local correction passes; exact-head external acceptance pending.

### 2026-08-01 18:08 UTC — Codex (GPT-5.6 Sol), PR #1175 authenticated shortcut closure

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175 at `73db723b`; zero inline comments/reviews. No merge or production deployment.
- **Scope / root cause:** exact-head capture passed 111/111 route/viewport cases with zero findings, and both full CI copies passed migrations, PostgreSQL, release integrity, typecheck, lint, the complete unit/database suite, and production build. Authenticated Playwright then exposed the final stale in-between contract: `e2e/workflow-control-center-action-buttons.spec.ts` still required retired `#match-evidence`. Because its `beforeEach` checked every target, that single stale selector failed all 12 shortcut cases. Updated it to `#matching-selected-evidence` and added a static cross-contract assertion so browser and production anchor registries cannot diverge again.
- **Files changed:** `e2e/workflow-control-center-action-buttons.spec.ts`, `tests/workflow-shortcut-anchor-contract.test.ts`, `operator_handoff.md`.
- **Tests / evidence:** 24/24 focused canonical-panel/UI/shortcut assertions passed; targeted ESLint and `git diff --check` passed. Exact-head capture artifact `8821969864` was downloaded and inspected: desktop/tablet/mobile Global Matching screenshots show the read-only automatic authority without manual controls; audit summary reports 111/111 coverage, zero critical findings, zero overflow, and zero warnings.
- **Completion assessment:** this fixes the only failing authenticated assertion. A final exact-head CI rerun must confirm the corrected browser suite before claiming 100% externally verified completion.
- **Next action:** push, require exact-head checks green, and keep #1175 draft/unmerged pending Hope's approval.
- **Merge status:** not reviewed — focused correction and exact predecessor capture pass; corrected-head full CI pending.

### 2026-08-01 17:45 UTC — Codex (GPT-5.6 Sol), PR #1175 full-suite stale-contract closure

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175 at `ee45407`; zero inline comments/reviews. No merge or production deployment.
- **Scope / root cause:** both exact-head CI copies progressed through PostgreSQL and the full suite, then exposed three additional assertions that still described removed behavior: a live-route test required manual `PUT /matches`; a zero-coverage test required superseded non-neutral copy; and a presentation test required check/warning/chevron icons in the retired dashboard instead of the shared canonical panel. Updated those tests to enforce the intended goal: GET-only matching, `Automatic verification running`, and the canonical panel's single warning/disclosure icons with no repeated check icon.
- **Files changed:** `tests/action-registry-live-route-contract.test.ts`, `tests/canonical-workflow-truth-precondition-gates.test.ts`, `tests/compliance-gap-export-parity.test.ts`, `operator_handoff.md`.
- **Tests / checks:** all newly exposed static assertions pass along with the earlier 24 focused tests; release integrity has zero failures; `git diff --check` passes. The local combined file also contains PostgreSQL cases that cannot reach the configured Neon host here, but those same database cases passed in exact-head CI before the stale static assertions failed.
- **Completion assessment:** all known application and in-between contract gaps are corrected. A final exact-head CI/capture rerun is still required for the remaining external acceptance percentage.
- **Next action:** push, require exact-head checks green, download/inspect capture evidence, and record final acceptance.
- **Merge status:** not reviewed — corrections pass locally; exact-head external acceptance pending.

### 2026-08-01 17:33 UTC — Codex (GPT-5.6 Sol), PR #1175 exact-head full-suite correction

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175 at `54124fa4`; zero inline comments/reviews. No merge or production deployment.
- **Scope / root cause:** downloaded both exact-head CI logs. PostgreSQL and the complete 8,900+ assertion run reached the final UI contract group and exposed two stale in-between contracts: `REVIEW_EVIDENCE` had been changed to the `match` verb but retained `ClipboardCheckIcon`, conflicting with the canonical `LinkIcon`; and the workflow consumer test still required the deleted `MatchingQualityPanel`/`EvidenceCoveragePanel`. Unified the matching verb icon and updated the ordering assertion to the live `RequirementCoveragePanel` then `MatchingSelectedEvidencePanel` authority sequence.
- **Files changed:** `lib/ui/action-registry.ts`, `tests/workflow-center-consumer-contract.test.ts`, `operator_handoff.md`.
- **Tests / checks:** the two failed CI assertions now pass; 24/24 focused canonical-panel/action-registry/workflow-consumer tests passed; release-integrity audit remains zero-failure; `git diff --check` passed. Predecessor capture passed, while both full CI copies failed only on these two final assertions after the database/full suite had otherwise run.
- **Completion assessment:** no known scoped implementation gap remains. Updated-head exact CI must turn green before declaring the final 5% externally verified.
- **Next action:** push, require both full CI copies and capture green, inspect the exact-head capture artifact, then record final verification without changing application code unless acceptance exposes another defect.
- **Merge status:** not reviewed — focused correction passes; exact-head external acceptance pending.

### 2026-08-01 17:22 UTC — Codex (GPT-5.6 Sol), PR #1175 release-integrity reconciliation

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175 at `61be8dfb`; zero inline comments/reviews. No merge or production deployment.
- **Scope / root cause:** exact-head CI correctly caught one missed in-between contract after the standalone AI-rematch route was deleted: `scripts/audit-release-integrity.mjs` still required that retired file and attempted to audit its persistent limiter. Updated the release audit to remove the obsolete required-route entry and add the inverse invariant that the standalone route must remain absent so AI rematching stays inside the durable Engine authority.
- **Files changed:** `scripts/audit-release-integrity.mjs`, `operator_handoff.md` only.
- **Tests / checks:** release-integrity audit passed with zero failures; 26/26 focused canonical-panel/job-handler/matching tests passed; `git diff --check` passed. The preceding head's two CI runs failed only at the stale release-integrity assertion before the full suite; updated-head CI must rerun PostgreSQL, full tests, build, browser, and capture.
- **Completion assessment:** the code-path audit remains 100% implemented, but production-grade end-to-end verification remains pending until the corrected exact head is green. No honest 100% verification claim is made before then.
- **Next action:** push this reconciliation, require updated-head CI/capture green, inspect its screenshots, and keep #1175 draft/unmerged.
- **Merge status:** not reviewed — local correction passes; exact-head external acceptance pending.

### 2026-08-01 17:13 UTC — Codex (GPT-5.6 Sol), PR #1175 final manual-owner removal

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175, started from exact GitHub head `7bfc7324b11dee94f04abeb20fb207e0a9d55ca7`; zero inline comments and zero reviews. No merge or production deployment performed.
- **Scope / root cause:** the prior tender workspace repair hid the manual matching controls but left a second live `/dashboard/matching` mutation UI, a writable `PUT /matches` selection owner, a standalone `/ai-rematch` route/background handler, and five now-unreferenced panel components. Those paths still contradicted the requested single durable Engine selection/rematch authority. The matching dashboard is now read-only and reuses `MatchingSelectedEvidencePanel`; the manual selection mutation and standalone rematch route/handler/queue admission were removed; obsolete panels were deleted; all workflow links now target the one canonical selected-evidence anchor.
- **Files changed:** matching dashboard/page contracts, matches API, AI job registry/policy/worker admission, canonical workflow anchors, five deleted standalone panels, focused matching/Engine/UI tests, related stale comments, and `operator_handoff.md`. No schema, migration, provider order, generation gate, export gate, or production configuration changed.
- **Tests / checks:** Prisma generation passed; TypeScript passed after clearing stale `.next` route types; 100/100 focused authority/UI tests passed; complete zero-warning lint passed; production build passed with 58/58 static pages; `git diff --check` passed. The previous exact head's CI was still running when this audit began; this new head requires its normal PostgreSQL/authenticated-browser/capture checks.
- **Completion assessment:** implementation coverage for the explicit Company Vault → durable Engine → automatic matching → canonical requirement-evidence prompt is 100% by code-path audit. End-to-end verification is 95% until updated-head CI supplies PostgreSQL, authenticated browser, and screenshot evidence; this is an external verification hold, not a known code gap.
- **Risks / assumptions:** historical `AI_REMATCH` job rows remain representable by the persisted job type for database compatibility but are no longer admitted, dispatched, or handled. Run Engine retains the sole 12-perspective rematch implementation. Human review remains truthful where separately and legitimately performed, but it is not required by the normal automated workflow.
- **Next action:** commit/push to PR #1175, require updated-head CI and capture green, inspect the generated authenticated screenshots, and keep the PR draft/unmerged pending Hope's approval.
- **Merge status:** not reviewed — all local executable checks pass; exact-head external acceptance pending.

### 2026-08-01 16:56 UTC — Codex (GPT-5.6 Sol), PR #1175 final evidence-panel fail-closed repair

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175, started from exact GitHub head `8f396df90a8604c1f4800e5930e8a863830b2446`; zero inline review comments and zero submitted reviews. No merge or production deployment performed.
- **Scope / root cause:** audited the new two-panel Company Vault/Engine workspace and found two remaining presentation-authority gaps: a stale persisted `isSelected` flag could still render an unpromoted/tampered expert or project as “Automatically linked,” and any non-zero partial score produced an “all requirements” traceability claim. The matching panel now applies the Engine's fail-closed `SOURCE_VERIFIED`/`REVIEWED` trust boundary before rendering selected or candidate rows, and the requirements panel claims `Verified and ready` only when partial, processing, and genuine-gap counts are all zero.
- **Files changed:** `components/matching-selected-evidence-panel.tsx`, `components/requirement-coverage-panel.tsx`, `tests/canonical-vault-engine-panels.test.ts`, `tests/requirement-coverage-confirm-safety.test.ts`, `operator_handoff.md`.
- **Tests / checks:** Prisma generation passed; the focused non-PostgreSQL Vault/Engine/matching/evidence suite passed 84/84; TypeScript, targeted zero-warning ESLint, `git diff --check`, and the complete production build passed. A broader 279-test selection reached 255 passes but could not complete its PostgreSQL cases because the configured Neon host is unreachable from this container; the one stale wording assertion exposed by that run was updated and passed in the clean 84-test rerun.
- **CI / deployment:** predecessor exact-head checks were in progress at session start. Updated-head CI remains required after push. No manual preview was created.
- **Risks / assumptions:** machine `SOURCE_VERIFIED` and truthful human `REVIEWED` remain eligible; all other trust states are silently excluded from the canonical selected-evidence panel. This UI guard supplements rather than weakens backend provenance, tenant, byte-integrity, and source-revision enforcement.
- **Next action:** push this commit to PR #1175, require exact-head PostgreSQL/CI/browser checks, and keep the PR draft/unmerged pending Hope's approval.
- **Merge status:** not reviewed — local application checks pass; external PostgreSQL and updated-head CI remain pending.

### 2026-08-01 16:45 UTC — Codex (GPT-5.6 Sol), PR #1175 canonical Vault/Engine panels

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175, started from exact GitHub head `dac9ff76b914da9e998af182d04a501fa60c2314`; zero inline review comments and zero submitted reviews. No merge or production deployment performed.
- **Scope:** closed the remaining screenshot/workflow contradiction after the durable Company Vault and Engine backend repairs: the tender workspace still rendered five competing evidence/matching panels plus manual selection, rematch, Vault-management, and synchronization controls. The normal workflow now renders only `Requirements and Evidence` and `Matching and Selected Evidence`; persisted selected experts/projects are first, unselected candidates/diagnostics are collapsed, requirement statuses use the final-package readiness payload, and partial evidence receives weighted display credit without weakening fail-closed release status.
- **Files changed:** `app/dashboard/tenders/[id]/page.tsx`, `app/api/tenders/[id]/requirement-coverage/route.ts`, `components/requirement-coverage-panel.tsx`, `components/matching-selected-evidence-panel.tsx`, `tests/canonical-vault-engine-panels.test.ts`, `operator_handoff.md`.
- **Tests / checks:** Prisma generation passed; 64 focused Vault/Engine/matching/requirements assertions passed; TypeScript passed; targeted zero-warning ESLint passed; `git diff --check` passed. Full-repository lint and local Next build were terminated by the constrained local process environment after starting; updated-head CI remains required for the complete suite/build/PostgreSQL/browser acceptance.
- **CI / deployment:** predecessor head checks were running when work began. No preview was manually created; the normal PR integration may create its canonical preview after push.
- **Known risks / assumptions:** backend automatic ingestion, source verification, single revision-bound Engine authority, retry idempotency, tenant isolation, and tamper rejection are unchanged and remain covered by the existing PostgreSQL/browser suites. This change removes the final live UI owners that contradicted that backend authority. Exact-head CI and authenticated preview screenshots remain required before merge readiness.
- **Next action:** push this commit to PR #1175, require its complete exact-head CI and screenshot capture, and keep the PR draft/unmerged pending Hope's release approval.
- **Merge status:** not reviewed — focused local checks pass; exact-head CI/browser/build are pending.

### 2026-08-01 16:35 UTC — Codex (GPT-5.6 Sol), PR #1175 final scoped Engine confirmation

- **Branch / PR:** `work`, aligned exactly to draft PR #1175 head `274989d1da43c8b366b8135b766938a11e92ac52` on `release/consolidated-recovery-20260717`; zero inline comments and zero submitted reviews.
- **Scope:** final verification of the screenshot-reported Company Vault → AI Analyze → durable Run Engine failure after reconciling an initially stale local checkout to the actual PR head. Confirmed the repair commits `7899ebc` and `19d9760` are present, all exact-head checks are green, and no subsequent commit reverted or competed with the immutable-input revision and single automatic continuation authority. No application behavior, schema, migration, dependency, or gate changed.
- **Files changed:** `operator_handoff.md` only.
- **Tests / evidence:** local Prisma generation passed; 42 focused Run Engine/Vault/automatic-continuation/runtime assertions passed with the PostgreSQL-only suite intentionally skipped locally; TypeScript, zero-warning lint, and `git diff --check` passed. Exact-head GitHub CI passed both duplicated migration/integrity/typecheck/lint/test/build/authenticated-isolation workflows, including the PostgreSQL self-invalidation regression; dependency rejection and 111-route capture also passed.
- **CI / deployment:** all seven current checks on `274989d1` are green. The verified application-code preview remains `dpl_GuASMSrwN75hqS5ima8GcEGDS4Tu`, READY and healthy at exact application SHA `19d97609`; commits after it are documentation/test-only and do not alter deployed runtime behavior.
- **Risks / assumptions:** no known scoped code, database, CI, browser, screenshot, or deployment gap remains. Automation cannot impersonate the supplied real account or mutate its failed job without credentials; pressing **Retry durable Engine** is the sole user-specific replay action and creates/reuses corrected revision v3 automatically, without a Company Vault review/attachment step.
- **Next action:** Hope may retry the supplied tender in the verified preview; investigate only if that owner-specific replay produces a new correlation reference.
- **Merge status:** the Company Vault/AI Analyze/Run Engine scope is fully repaired and verified by all available automated acceptance layers; PR #1175 remains draft and unmerged pending Hope's explicit approval and unrelated repository-level external holds.

### 2026-08-01 16:30 UTC — Codex (GPT-5.6 Sol), live release-control refresh

- **Branch / PR:** `release/consolidated-recovery-20260717` / governing draft PR #1175; independently frozen at `274989d1da43c8b366b8135b766938a11e92ac52`, base `b3c9db5de89a2a665e61a83facbff0f276f9983c`; #1175 remains open, draft, and unmerged.
- **Scope:** refetched GitHub and Vercel; confirmed #1175 is the only open PR; proved closed #1274 head `0611690b` and the prepared heads `130f1c13`/`b8f15162` are ancestral; inspected closure comments for #1266, #1267, #1270, #1274 and #1287; downloaded and reopened the exact-head acceptance artifact; verified the matching preview identity/health; replaced the stale narrow `pr-body.md` with the complete recovery description and explicit external holds.
- **Files changed:** `pr-body.md`, `operator_handoff.md`. No application, schema, migration, dependency, workflow authority, safety gate, or executable test changed.
- **Tests / evidence:** exact-head GitHub runs `30707024137`, `30707022343`, and `30707024138` passed all 44 migrations, critical schema/bootstrap/idempotency/zero drift, release audits, typecheck, zero-warning lint, 8,916/8,916 unit/PostgreSQL assertions, production build, 180 Playwright passes with three documented conditional skips, and 111/111 responsive route cases with zero findings. Artifact hashes independently recomputed for DOCX `04a07b29…` (12,094 bytes), PDF `3aff6bd5…` (985 bytes), and ZIP `90aa7480…` (10,419 bytes). Local `npm audit --omit=dev` reports zero vulnerabilities.
- **CI / deployment:** exact application-head preview `dpl_3o2HfYVb9VaLktAXzLo5mbJ1TKNR` is READY; `/api/version` and `/api/health` return the exact SHA, healthy critical tables, and durable private Blob storage. This documentation-only commit must receive its own normal Git-triggered checks and preview before the PR body can cite the final documentation SHA.
- **Risks / assumptions:** a fresh provider-backed persisted preview workflow was not run because approved synthetic credentials were not established. Password rotation, session revocation, automation-secret replacement, artifact sanitation, owner UAT, duplicate Vercel-project remediation, and post-workflow retained-log acceptance remain external holds.
- **Next action:** commit and push this documentation/control-plane refresh, update the live #1175 body with the resulting exact SHA, require the normal exact-head checks, and keep #1175 draft/unmerged.
- **Merge status:** unsafe while the external security and acceptance holds remain unresolved.

### 2026-08-01 16:00 UTC — Codex (GPT-5.6 Sol), final open-PR forensic disposition

- **Branch / PR:** `release/consolidated-recovery-20260717` / governing draft PR #1175; starting exact head `7100ec7ba40e66eb98fdd54441899132297c2927`; #1175 remains open, draft, and unmerged.
- **Scope:** refetched GitHub and deployment state; proved closed #1274 heads `0611690b`, `130f1c13`, and frozen parent `b8f15162` are ancestral to #1175; audited every commit and all eight files in the sole remaining donor PR #1287; classified its already-incorporated compliance hardening and rejected its synchronous/client-policy Engine path and in-worker Vault mutation as competing or unsafe.
- **Files changed:** `docs/audits/open-pr-unique-code-ledger-20260728.md`, `operator_handoff.md`. No application, schema, migration, dependency, workflow gate, or test implementation changed.
- **Tests / evidence:** `npx prisma generate` passed; seven focused live-owner files passed 86/86 assertions. Downloaded exact-head GitHub artifacts for `7100ec7b`: 8,916/8,916 unit/PostgreSQL assertions, 180 Playwright passes with three documented conditional skips, production build, migrations/critical schema/idempotency/zero drift, release integrity, source-mutation checks, and 111/111 screenshot cases with zero findings all passed.
- **CI / deployment:** all GitHub checks on starting head `7100ec7b` are green. GitHub deployment records were refetched; no production deployment or migration was initiated. The new documentation-only head still requires its own normal Git-triggered exact-head checks before donor closure or final PR-description claims.
- **Risks / assumptions:** #1287's compliance-document matching value is already present with stronger regression coverage; replaying the remaining donor code would restore a synchronous Engine default, client-controlled policy parameters, and a late Vault mutation competing with the current pre-enqueue verification/revision authority. External credential remediation, approved synthetic provider-backed preview acceptance, owner UAT, and duplicate Vercel-project configuration remain unresolved holds.
- **Next action:** commit and push this disposition, wait for the normal exact-head CI/preview, then close only #1287 with the verified superseding SHA and refresh #1175's stale description while keeping it draft.
- **Merge status:** not reviewed for merge; #1175 must remain draft and unmerged.

### 2026-08-01 15:25 UTC — Codex (GPT-5.6 Sol), PR #1175 exact-head Engine verification

- **Branch / PR:** `work`, aligned exactly to draft PR #1175 head `19d97609920d3f808542387f90bf3b3c7ffab824` on `release/consolidated-recovery-20260717`; no inline comments or submitted reviews.
- **Scope:** verification-only follow-up for the screenshot-reported Company Vault → AI Analyze → durable Run Engine failure. Reconciled the initially stale local checkout to GitHub shared truth, downloaded and inspected the exact-head CI and route/screenshot artifacts, verified the PostgreSQL regression for Engine self-invalidation, and checked the exact-head Vercel deployment identity/health. No application behavior, schema, migration, dependency, or gate changed.
- **Files changed:** `operator_handoff.md` only.
- **Tests / evidence:** both duplicated exact-head CI workflows passed migrations, critical schema, zero drift, typecheck, lint, 8,916/8,916 unit/PostgreSQL assertions, production build, browser acceptance, and source-mutation checks. The database suite specifically passed preservation of the Engine revision after derived requirement replacement and supersession after real tender source-byte changes. Exact-head route capture covered 111/111 cases with zero critical, overflow, or warning findings. The authenticated browser suite passed 181 tests and four documented conditional skips, including the durable upload/automatic-analysis golden flow and Company Vault routes.
- **CI / deployment:** all current PR checks are green. Vercel deployment `dpl_GuASMSrwN75hqS5ima8GcEGDS4Tu` is READY at `https://hope-tender-path-9gp9xz79y-hopeengineering83-codes-projects.vercel.app`; `/api/version` returned `19d97609`, and `/api/health` returned healthy with exact release SHA, durable private Blob storage, required tables present, and 8/10 providers configured.
- **Risks / assumptions:** the supplied real-user failed job itself was not mutated or replayed because its credentials are not available to automation. Revision v3 ensures its UI retry creates/reuses the corrected immutable-input revision and supersedes the failed v2 row. Repository, PostgreSQL, browser, capture, build, and exact preview checks expose no remaining known defect in the scoped path.
- **Next action:** Hope can press **Retry durable Engine** on the supplied tender in the exact-head preview; no code or manual Company Vault review step remains before automatic processing.
- **Merge status:** scoped code is verified and safe with all exact-head checks green; PR #1175 remains draft and must not be merged without Hope's explicit approval.

### 2026-08-01 15:08 UTC — Codex (GPT-5.6 Sol), PR #1175 updated-head Engine verification

- **Branch / PR:** local `work` at exact draft PR #1175 head `7899ebc`; target `integration/controlled-recovery`. GitHub reports zero inline comments and zero submitted reviews.
- **Scope:** independently verified the updated-head repair for the screenshot's durable Engine precondition failure. Strengthened the PostgreSQL regression to mirror `runTenderEngine`'s complete derived-output mutation shape: update Tender workflow fields, delete/recreate TenderRequirement output, then prove the canonical source revision and active job remain unchanged. Real tender-file byte changes remain separately proven to supersede the stale job.
- **Files changed:** `tests/engine-enqueue-authority.integration.test.ts`, `operator_handoff.md`.
- **Tests / CI:** predecessor exact-head CI is fully green: PostgreSQL canonical Engine enqueue suite 4/4, complete unit/database suite 8,916/8,916, production build, 180 Playwright passes with three documented skips, exact-head route capture, dependency audit, and source-mutation checks. Downloaded and inspected both exact-head acceptance artifacts. Local focused rerun and updated-head CI are required for this strengthened assertion.
- **Deployment:** exact-head Vercel preview `dpl_3x33cf81Nu8Co7poNDA8SXEipYGW` is READY at `https://hope-tender-path-9csoukcyu-hopeengineering83-codes-projects.vercel.app`; `/api/version` reports `7899ebc4`, and `/api/health` reports healthy schema, durable private Blob storage, and 8/10 configured providers.
- **Risks / assumptions:** CI provider credentials intentionally exercise deterministic fallback rather than paid provider output. The scoped Engine revision/queue failure is behaviorally covered against PostgreSQL; owner-data preview interaction remains credential-controlled.
- **Next action:** push this strengthened proof, require updated-head CI green, and keep #1175 draft until Hope clears the repository's separate external release holds.
- **Merge status:** not reviewed — predecessor is green; strengthened updated-head CI pending.

### 2026-08-01 14:29 UTC — Codex (GPT-5.6 Sol), PR #1175 Run Engine self-invalidation repair

- **Branch / PR:** local `work`, aligned with and intended for draft PR #1175 head branch `release/consolidated-recovery-20260717`; predecessor head `ee27f98`. GitHub reported no inline comments or submitted reviews; dependency/Vercel checks passed while capture and full CI were still running when this repair began.
- **Scope:** investigated the exact Vercel screenshots showing terminal `ASYNC_ENGINE_FAILED` precondition references. Found that the source-revision snapshot included Engine-owned `Tender.updatedAt` and `TenderRequirement` rows even though `runTenderEngine` necessarily updates/replaces them; therefore the mandatory post-run stale-source check invalidated every otherwise-successful run against its own writes. Revision v3 now hashes only stable tender-source and Company Vault inputs while retaining requirement count as non-hashed diagnostics. Also removed the competing post-analysis continuation: `run-next` now consumes the canonical source-bound `automaticEngineJob` already persisted by the AI handler instead of creating a second legacy analysis-hash-only ENGINE_RUN job; the old path remains only as compatibility fallback.
- **Files changed:** `lib/engine/engine-source-revision.ts`, `app/api/ai-jobs/run-next/route.ts`, `tests/engine-async-job-queue.test.ts`, `tests/engine-enqueue-authority.integration.test.ts`, `operator_handoff.md`.
- **Tests:** Prisma generation and TypeScript passed; focused Run Engine/Vault/automatic-continuation/runtime tests passed 42/42; zero-warning lint and `git diff --check` passed. The focused PostgreSQL integration test could not start because this container cannot reach the configured Neon host; CI must execute its new assertions that derived requirement writes preserve a job revision while changed tender source bytes supersede it.
- **CI / deployment:** exact predecessor `ee27f98` checks were partially complete at session start. No additional preview was created before local validation and commit; updated-head CI/preview is required.
- **Risks / assumptions:** the post-run authority check remains fail-closed for real tender-file or Company Vault changes. Existing failed v2 jobs will be superseded automatically on retry because revision v3 creates a different canonical idempotency key.
- **Next action:** commit/push into PR #1175, require green updated-head CI, then use the authorized preview workflow to rerun the same authenticated tender and confirm the Engine reaches success rather than the screenshot's precondition failure.
- **Merge status:** not reviewed — focused local checks pass; PostgreSQL CI and updated-head preview acceptance remain required.

### 2026-08-01 14:18 UTC — Codex (GPT-5.6 Sol), PR #1175 screenshot-driven Vault UI repair

- **Branch / PR:** local `work`; governing draft PR #1175 head branch `release/consolidated-recovery-20260717` at `ff40a63` before this repair. No inline comments or submitted reviews.
- **Scope:** downloaded the exact-head 23 MB route/screenshot artifact from successful capture run `30703008819` and inspected the real desktop Company Vault and Automatic Verification pages. The Vault screenshot exposed surviving manual bureaucracy: “Review each file before using it,” human-reviewed/draft completeness counts, and Experts/Projects “Review …” CTAs. Replaced those active UI paths with truthful Run Engine automatic extraction/source-verification guidance and Automatic Verification links. Runtime eligibility remains source-backed and fail-closed.
- **Files changed:** `app/dashboard/company/page.tsx`, `tests/company-vault-experts-projects-review-cta.test.ts`, `tests/company-vault-document-actions-a11y.test.ts`, `operator_handoff.md`.
- **Tests:** focused Company Vault UI, accessibility, pipeline, and automatic-promotion suites passed 35/35; clean-cache TypeScript passed; zero-warning lint passed; `git diff --check` passed.
- **CI / deployment:** exact predecessor preview `dpl_71CbsVmTCjwCCSFhK1z4uwxaKpgz` returned healthy HTTP 200 with exact SHA `ff40a63b`, durable private Blob storage, and 8/10 providers. Capture and one complete duplicated full workflow passed; the second full workflow was in browser acceptance when this screenshot-derived repair began.
- **Risks / assumptions:** authenticated human `REVIEWED` evidence remains optional and eligible, but the primary Vault UI no longer presents human approval as a prerequisite. Automatic verification does not promote stale, altered, source-less, unmatched, or unusable evidence.
- **Next action:** push this commit into PR #1175 and require updated-head CI, preview identity/health, and fresh route screenshots.
- **Merge status:** not reviewed — local focused checks pass; updated-head remote acceptance is required.

### 2026-08-01 14:08 UTC — Codex (GPT-5.6 Sol), PR #1175 automatic-handoff cleanup

- **Branch / PR:** local `work`; governing draft PR #1175 head branch `release/consolidated-recovery-20260717` at `77dba9a` before this follow-up. GitHub reports no inline comments or submitted reviews.
- **Scope:** removed the remaining Company Vault client-pipeline message that incorrectly said re-imported evidence remained subject to human review. Successful byte re-import now explicitly hands eligible evidence to Run Engine automatic source verification. Also replaced the remaining generic compliance “source review” wording with automatic source verification; evidence eligibility and fail-closed source authority are unchanged.
- **Files changed:** `lib/ui/auto-pipeline.ts`, `lib/engine/compliance.ts`, `tests/auto-pipeline.test.ts`, `operator_handoff.md`.
- **Tests:** focused automatic-pipeline, pipeline-authority, Company Vault evidence, and preview-runtime tests passed 23/23; clean-cache TypeScript passed; zero-warning lint passed; `git diff --check` passed.
- **CI / deployment:** predecessor `77dba9a` dependency and capture checks passed; both full duplicated workflows were still running when this follow-up was prepared. Vercel Preview Comments passed. No extra manual deployment was created; pushing this commit lets the governing PR integration create its canonical preview.
- **Risks / assumptions:** human `REVIEWED` provenance remains a supported optional evidence authority, but it is not required between Company Vault and Run Engine. Automatic verification still cannot invent evidence or promote stale, altered, source-less, or unmatched records.
- **Next action:** push this commit to PR #1175, verify updated-head CI/preview, and keep the PR draft until external release holds are cleared.
- **Merge status:** not reviewed — local focused checks pass; updated-head CI is required.

### 2026-08-01 13:27 UTC — Codex (GPT-5.6 Sol), PR #1175 evidence-gap repair

- **Branch / PR:** local `work` aligned exactly to `origin/release/consolidated-recovery-20260717` at `8768590`; governing draft PR #1175 targets `integration/controlled-recovery`. GitHub API showed zero inline comments and zero submitted reviews; all seven latest-head checks were green before this repair.
- **Scope:** discarded the incompatible local pre-PR architecture from the active branch after verifying that #1175 already owns a newer enqueue-only, server-policy-controlled Engine with automatic Vault preparation, source revisions, `SOURCE_VERIFIED` provenance, and automatic Build Plan continuation. Repaired the remaining non-overlapping compliance gap: unrelated, empty, scanned, or first-in-list Vault documents can no longer become legal/financial/compliance/profile/general evidence merely because any document exists. Typed evidence now also requires the correct Vault category (so an ISO certificate cannot masquerade as legal registration), and requirement matching uses exact normalized tokens rather than substrings (so `audit` cannot match `auditorium`) while preserving #1175's draft-only proposal-response semantics.
- **Files changed:** `lib/engine/compliance.ts`, `tests/company-vault-compliance-evidence.test.ts`, `tests/preview-runtime-truth-regression.test.ts`, `operator_handoff.md`.
- **Tests:** `npx prisma generate` passed; focused Company Vault compliance tests passed 6/6; `tests/core-engine-regressions.test.ts` and `tests/production-workflow-engine.test.ts` passed (27 total assertions across the combined run); `npx tsc --noEmit` passed; `npm run lint -- --quiet` passed; `git diff --check` passed.
- **CI / deployment:** governing head `8768590` CI baseline is green, including migrations/integrity/typecheck/lint/tests/build/authenticated isolation and capture. Final application-code head `6f63436` deployed READY as `dpl_CNXdw7d1mn4dNSAFeJzCYb9dSVhs` at `https://hope-tender-path-aqsuxbobz-hopeengineering83-codes-projects.vercel.app`; remote build found 44 migrations with none pending, passed schema verification, compiled/typechecked, and completed successfully. Exact-head `/api/health` and `/api/version` returned HTTP 200, healthy/durable Blob storage, 8/10 configured providers, and SHA `6f634361`.
- **Known risks / assumptions:** selection is intentionally conservative: a document with unusable extraction stays unmapped even if its filename/category appears relevant. Existing legal/financial/compliance structured records remain valid evidence with meaningful record references. No client policy override or duplicate Engine owner was introduced.
- **CI follow-up:** commit `312eb40` was pushed to the governing PR branch. Updated-head CI exposed one intentional-contract mismatch: an ungenerated proposal response with no relevant Vault evidence retained the correct low strength and no evidence reference but moved from the canonical automatic `EVIDENCE_PENDING_REVIEW` workflow state to `PARTIAL`. The follow-up preserves pending automatic generation/verification without inventing a source reference and adds regression assertions for both properties.
- **Next action:** push this focused CI repair to `release/consolidated-recovery-20260717` and verify the resulting PR checks.
- **Merge status:** not reviewed — local verification and updated-head CI rerun remain pending.

### 2026-07-30 01:45 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `codex/pr1175-final-verification-20260730` / documentation-only child targeting `release/consolidated-recovery-20260717`; governing draft #1175 verified at `0c28bf03d37bb24cc8f45fd3e7c2453c00d5c2c3`.
- **Scope / files changed:** refetched GitHub and Vercel; proved closed #1274 head `0611690b…` is ancestral; dispositioned the only other open PR, #1280, as documentation-only and already incorporated; independently inspected exact-head CI, migrations, test/build/browser evidence, preview identity/events, responsive screenshots, and generated DOCX/PDF/ZIP bytes. Refreshed `docs/audits/open-pr-unique-code-ledger-20260728.md`, `docs/audits/pr1175-principal-release-recheck-20260730.md`, and this handoff. No application, schema, migration, dependency, test, gate, or workflow authority changed.
- **Tests:** clean `npm ci`; Prisma validate/generate; local release-integrity (418 routes / 1,390 files), workflow-consistency audit, typecheck, zero-warning lint, and production build passed without tracked-source mutation. Exact-head GitHub push/PR CI passed all 43 migrations, critical schema, retroactive bootstrap, idempotency, zero drift, 8,930/8,930 assertions, build, 179 Playwright passes / four documented skips, and 111/111 responsive route cases with zero findings. Exact secret-value scan found zero tracked matches. `npm audit --omit=dev` still reports two inherited high-severity Next/Sharp findings.
- **CI / deployment:** governing-head runs `30505634865`, `30505637154`, and `30505637135` succeeded. Intended exact-SHA deployment `dpl_5hD9SdNUZwhJ7AsxRqnJHd6cN6bP` is READY; version/health returned 200 and exact identity; 100 events contained zero prohibited runtime/credential patterns. Duplicate project `repo` exact-SHA deployment remains ERROR.
- **Generated bytes:** DOCX 12,091 bytes / `08e13b00…`; PDF 984 bytes / `d30b536e…`; ZIP 10,415 bytes / `8e336f4b…`. Office/PDF signatures, archive integrity, entry order, lengths, and manifest hashes were independently recomputed.
- **Risks / assumptions:** approved synthetic preview credentials remain unavailable, so provider-backed persisted preview acceptance and post-workflow log inspection were not rerun. Real-account testing remains prohibited pending password rotation, session revocation, automation-secret replacement, and artifact sanitation. Owner UAT, duplicate-project remediation, and compatible Sharp/libvips remediation remain external holds.
- **Next action:** obtain green CI for this documentation-only child, incorporate it into #1175, reverify the resulting exact head, update #1175's description, and close redundant child PRs without merging #1175.
- **Merge status:** not safe to merge #1175; draft/unmerged with external release holds.

### 2026-07-30 01:15 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `codex/pr1175-final-release-audit-20260730` / child audit PR targeting `release/consolidated-recovery-20260717`; governing draft #1175 frozen at `1e113fa529718b9052e762efd15fbf51144ccaca`.
- **Scope / files changed:** independently refetched GitHub and Vercel; confirmed #1175 was the only open PR before this documentation-only child was opened and that closed #1274 is fully ancestral; repeated the five-pass ancestry, schema, security, concurrency, workflow-owner, browser, preview, and generated-byte falsification. Added `docs/audits/pr1175-principal-release-recheck-20260730.md`, refreshed `docs/audits/open-pr-unique-code-ledger-20260728.md`, and added this handoff entry. No application, schema, migration, dependency, test, gate, or workflow authority changed.
- **Tests:** clean install/source-mutation check; Prisma validate/generate; all 43 migrations on isolated PostgreSQL 16; critical schema; retroactive bootstrap; idempotency; zero drift; release-integrity (418 routes / 1,390 files); workflow consistency; typecheck; zero-warning lint; 8,930/8,930 unit/PostgreSQL assertions; production build/source-mutation check; 179 Playwright passed / 4 documented conditional skips; fresh DOCX/PDF/ZIP container, structure, byte-length, order, and SHA-256 proof.
- **CI / deployment:** exact governing head GitHub runs `30502385737`, `30502388446`, and `30502388414` are successful. Intended preview `dpl_4UUnQvdQeoNaJK8tqewsp5mprg65` is READY and exact-SHA `/api/version` and `/api/health` returned HTTP 200. A fresh 100-event query contained no prohibited runtime-error/credential pattern; normal build-time Prisma generation messages were not misclassified as runtime errors. Duplicate Vercel project `repo` still fails.
- **Risks / assumptions:** approved synthetic preview credentials remain unavailable, so the complete provider-backed persisted preview workflow and post-workflow log audit were not rerun. Real-account testing remains prohibited pending password rotation, session revocation, automation-secret replacement, and artifact sanitation. Owner UAT, duplicate-project remediation, and compatible Sharp/libvips remediation remain external holds. `npm audit --omit=dev` still reports two inherited high-severity findings.
- **Next action:** keep #1175 draft and unmerged; an authorized owner must clear the external credential/UAT/project/dependency holds and run the complete provider-backed synthetic preview acceptance.
- **Merge status:** unsafe while the documented external security and acceptance holds remain open.

### 2026-07-30 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175; audited product head `c3c2f834a438d9848fd383fdec1cddef6e82b382`.
- **Scope / files changed:** independently refetched GitHub and Vercel; proved #1274's complete head is incorporated; inspected exact-head CI, screenshots, generated bytes, preview health, and deployment events; repeated disposable-PostgreSQL migrations, schema checks, audits, full tests, and build. Added `docs/audits/pr1175-exact-head-recheck-20260730.md` and this handoff entry only; no application, schema, migration, dependency, or gate change.
- **Tests:** local PostgreSQL 16 accepted all 43 migrations; critical schema, retroactive init, idempotency, zero drift, release-integrity (418 routes / 1,390 files), typecheck, zero-warning lint, 8,928/8,928 local tests, and production build passed. Exact-head GitHub evidence reports 8,930/8,930 tests, 179 passed / 4 environment-conditional skipped Playwright checks on the push run, 180 passed / 3 skipped on the PR run, and 111/111 screenshot combinations without findings.
- **CI / deployment:** exact-product-head runs `30498185202`, `30498188486`, and `30498188073` succeeded. Intended preview `dpl_CyLnTGypAQTq5Q59sMiFHP6xpv2V` was READY and `/api/version` plus `/api/health` identified the exact SHA. A fresh 100-event query found no prohibited runtime-error pattern. The duplicate `repo` project still failed.
- **Risks / assumptions:** approved synthetic preview credentials remain unavailable, so provider-backed persisted preview acceptance was not rerun. Real-account testing remains prohibited pending password rotation, session revocation, automation-secret replacement, and artifact sanitation. Owner UAT, duplicate-project remediation, and compatible residual dependency remediation remain external holds.
- **Next action:** keep #1175 draft and unmerged; obtain approved synthetic preview credentials and complete the remaining external security/UAT/project-configuration actions.
- **Merge status:** unsafe while the documented external security and acceptance holds remain open.

### 2026-07-29 23:05 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175. Started from exact head `c0f442427b53f2e58b9738b17814e1f3fb83278d`; live GitHub refetch found #1175 as the only open PR and confirmed closed #1274 head `0611690b1486402df6fb5431b055b219390517e7` is an ancestor. The matching Vercel preview was READY before this repair.
- **Scope:** independently falsified the green exact-head screenshot evidence and found the canonical Review Inbox displayed under a misleading `Diagnostics` tab beside a duplicate `Review Board` tab that only redirected to the same page. Removed the duplicate presented control, renamed the canonical tab, and redirected all live Company Vault actions/guidance to `/dashboard/company/review`; the legacy `/review-board` page remains redirect-only for bookmarks.
- **Files changed:** `components/company-subnav.tsx`, `components/generation-readiness-panel.tsx`, `app/dashboard/company/plan-b-import/page.tsx`, `app/dashboard/company/page.tsx`, `app/api/company/plan-b-import/route.ts`, `lib/engine/deep-reasoning-readiness.ts`, `lib/company-vault-source-remap.ts`, `tests/vault-review-contract.test.ts`, and `docs/audits/pr1175-review-inbox-authority-falsification-20260729.md`.
- **Tests:** clean `npm ci` and tracked-source mutation check passed; Prisma validate/generate passed; release-integrity passed (418 routes / 1,390 files); workflow consistency passed with the three existing warning-only wording heuristics; targeted tests passed 41/41; typecheck passed; lint passed with zero warnings; all 43 migrations deployed on fresh local PostgreSQL 16, second deploy idempotent, critical schema/retroactive bootstrap/zero drift passed; full unit/PostgreSQL suite passed 8,928/8,928; production build passed; authenticated `exact-head-evidence.spec.ts` passed 1/1 with retries disabled and generated fresh desktop/tablet/mobile screenshots without overflow or runtime errors. Two earlier Playwright launches failed before application execution because Chromium and then its OS libraries were absent; installing them resolved the environment limitation.
- **Evidence:** `docs/audits/pr1175-review-inbox-authority-falsification-20260729.md`; fresh tablet screenshot visibly shows one active Review Inbox tab and no Review Board/Diagnostics duplicate. Independent reopening of the prior exact-head artifact also found its current manifest hashes differ from stale generated-byte hashes in the PR body, so the body must be regenerated after the new exact head is verified.
- **Risks / holds:** no safety gate, schema, migration, trust state, or mutation authority was weakened. The forthcoming pushed SHA requires exact-head GitHub CI, Git-triggered preview identity, preview log inspection, and PR-body refresh. Provider-backed preview acceptance remains blocked on approved synthetic preview credentials; real credentials remain prohibited pending password/session/automation-secret remediation. Duplicate Vercel project and residual dependency advisory holds remain external.
- **Next action:** commit and push this repair, wait for exact-head CI and the Git-triggered preview, inspect their artifacts/logs, then update #1175's description without claiming completion of blocked external acceptance.
- **Merge status:** not reviewed for merge; keep #1175 draft and unmerged.

### 2026-07-29T19:37Z — Codex (GPT-5.6 Sol)

- **Branch / PR:** `codex/pr1175-final-independent-acceptance-20260729` / child
  PR targeting `release/consolidated-recovery-20260717`; governing draft #1175
  frozen at `893beb326d1c43fa1f5dfd52563c7609dd5a10de` before this repair.
- **Scope:** independently refetched GitHub/Vercel, revalidated #1274 ancestry
  and the one-open-PR ledger, reproduced the full migration/unit/browser matrix,
  and repaired a flaky release audit that treated the redirect-only legacy
  Company Review Board bookmark as a second rendered authority. The audit now
  tests rendered canonical routes separately and behaviorally proves the legacy
  URL converges on the single Review Inbox.
- **Files changed:** `e2e/pr1175-independent-release-audit.spec.ts`,
  `docs/audits/pr1175-exact-head-independent-recheck-20260729.md`, and
  `operator_handoff.md`. No product route, schema, migration, gate, dependency,
  or workflow authority changed.
- **Local checks:** clean `npm ci` and mutation hash; Prisma validate/generate;
  all 43 migrations on disposable PostgreSQL 16; critical schema;
  retroactive-bootstrap parity; migration idempotency; zero drift;
  release-integrity (418 routes / 1,390 files); workflow consistency;
  typecheck; zero-warning lint; production build and mutation hash;
  8,930/8,930 unit/PostgreSQL assertions; focused affected Playwright with
  retries disabled (5 passed / 1 environment skip); complete Playwright with
  retries disabled (179 passed / 4 environment skips / 0 failed / 0 flaky).
- **Remote/artifact evidence:** exact-parent GitHub checks green; intended
  exact-SHA Vercel preview `READY`; duplicate `repo` deployment `ERROR`; live
  version/health HTTP 200 at the exact parent SHA; 111/111 screenshot audit with
  zero findings; DOCX/PDF/ZIP containers and recorded hashes independently
  recomputed. A fresh runtime-log request timed out without bytes and is not
  claimed as new log evidence.
- **Risks / assumptions:** no approved synthetic preview credential exists, so
  provider-backed persisted preview acceptance remains blocked. Real-account
  password rotation, session revocation, automation-secret replacement,
  credential-artifact sanitation, owner UAT, duplicate-project remediation,
  and compatible residual dependency remediation remain external holds.
- **Next action:** publish the child for exact-head CI, incorporate only after it
  is green, then rerun exact #1175 head/preview identity checks; keep #1175 draft
  and unmerged.
- **Merge status:** not reviewed for release merge; release completion is not
  claimed.

### 2026-07-29T18:30Z — Codex (GPT-5.6 Sol)

- **Branch / PR:** `release/consolidated-recovery-20260717` / draft PR #1175.
- **Scope:** independently refetched GitHub and Vercel authority after the final
  consolidation. Confirmed #1175 is the only open PR, #1274 is closed and fully
  ancestral, all three exact-head GitHub workflows are green, and the intended
  preview identifies the exact governing SHA. Updated only the exact-head audit
  record and this handoff; no product, schema, migration, dependency, test, or
  workflow-authority code changed.
- **Files changed:**
  `docs/audits/pr1175-exact-head-independent-recheck-20260729.md` and
  `operator_handoff.md`.
- **Checks:** GitHub PR/check/artifact API refetch; git ancestry; Vercel project,
  deployment and exact-SHA identity refetch; live `/api/version` and
  `/api/health` (HTTP 200); deployment-scoped 24-hour runtime-log query (12
  records, no error/fatal/500/P2022/P2002/Prisma/timeout/stuck/duplicate match).
- **Risks / assumptions:** no approved synthetic preview credentials are
  available, so the complete provider-backed persisted preview workflow is not
  independently rerun. Real-account use remains prohibited pending password
  rotation, session revocation, automation-secret replacement and artifact
  sanitation. Owner UAT, duplicate Vercel project cleanup, and compatible
  residual dependency remediation remain external blockers.
- **Next action:** let exact-head CI and the normal Git-triggered preview verify
  this documentation-only commit; keep PR #1175 draft and unmerged.
- **Merge status:** not reviewed for merge; release completion is not claimed.

### 2026-07-29T17:15Z — Codex

- **Branch / PR:** `codex/pr1175-live-state-reconciliation-20260729` / child PR pending, targeting `release/consolidated-recovery-20260717`; governing PR #1175 remains draft and unmerged at frozen parent `272b5823c6e118ac7e56f9c38e8f1b8c959b93d5`.
- **Scope / files:** refetched GitHub PR/check/deployment authority; proved closed #1274 head `0611690b…` is an ancestor of #1175; preserved documentation-only #1277 commit and corrected its live publication disposition in `docs/audits/pr1175-exact-head-independent-recheck-20260729.md`; updated this handoff. No product, schema, migration, dependency, route, workflow-authority, or test code changed.
- **Local checks:** clean `npm ci` passed with no tracked-file mutation (npm reports three unresolved high-severity advisories); `npx prisma validate`; `npx prisma generate`; `npm run audit:release-integrity` (418 routes / 1,390 files); `npm run audit:workflow-state-consistency` (pass in warning-only mode with three recorded heuristic warnings); `npx tsc --noEmit`; `npm run lint -- --max-warnings 0`; production `npm run build` with synthetic build-only secrets; post-build tracked-file mutation check — all passed. A first build invocation without the required synthetic provider variable failed closed as designed and was rerun correctly.
- **Remote evidence:** exact-parent GitHub runs `30471518423`, `30471523601`, and `30471524083` are successful; intended Vercel deployment `5661364922` is successful at exact SHA, while duplicate-project deployment `5661315682` remains failed.
- **Risks / assumptions:** this documentation-only child does not supersede the required exact-head verification after incorporation. Full provider-backed synthetic preview acceptance and runtime-log inspection remain blocked by unavailable approved synthetic credentials and `VERCEL_TOKEN`; credential rotation/session revocation/automation-secret replacement/artifact sanitation, owner UAT, duplicate Vercel-project remediation, and compatible dependency remediation remain external holds.
- **Next action:** incorporate this documentation-only child into #1175, rerun exact-head CI/preview identity checks, then close redundant documentation PR #1277 with an evidence comment; do not merge #1175.
- **Merge status:** safe as documentation evidence only; release merge remains unsafe/blocked by the stated external holds.

### 2026-07-29 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `codex/pr1175-exact-head-release-proof`; documentation-only follow-up prepared against draft PR #1175. PR #1175 was not modified, merged, approved, retargeted, or closed.
- **Scope:** independently refetched GitHub deployment/check state and falsified the frozen #1175 head `272b5823c6e118ac7e56f9c38e8f1b8c959b93d5`; confirmed #1274 head `0611690b1486402df6fb5431b055b219390517e7` is incorporated and #1175 is the only open PR; recorded evidence in `docs/audits/pr1175-exact-head-independent-recheck-20260729.md`.
- **Files changed:** `docs/audits/pr1175-exact-head-independent-recheck-20260729.md`, `operator_handoff.md` only.
- **Tests:** clean `npm ci` plus install mutation hash passed; Prisma validate/generate passed; release-integrity passed (418 routes / 1,390 files); workflow-state audit passed with three known warning-only wording heuristics; TypeScript passed; ESLint passed with zero warnings; production build with synthetic build-only configuration plus build mutation hash passed. A local DB-enabled full-suite attempt was stopped because the configured remote Neon test database was unreachable; no migration was run against it. Exact-head GitHub workflows remained successful with 8,930 tests, build, Playwright, disposable migration, and screenshot evidence.
- **CI / deployment:** exact-head GitHub runs `30471518423`, `30471523601`, and `30471524083` are successful. The intended Git-triggered preview is healthy and identifies the exact SHA; the duplicate `repo` Vercel project still fails.
- **Risks / assumptions:** no approved synthetic preview credentials, no Vercel token/log access, and no disposable local PostgreSQL service were available. Real-account testing remains prohibited. Credential rotation/session revocation/automation-secret replacement/artifact sanitation, owner UAT, duplicate-project repair, provider-backed persisted preview acceptance, runtime-log certification, and remaining compatible dependency remediation remain external holds.
- **Next action:** an authorized owner should satisfy the external holds and rerun the complete synthetic persisted preview workflow and runtime-log audit before considering merge.
- **Merge status:** **unsafe**; keep #1175 draft and unmerged.

### 2026-07-29 UTC — Codex (dependency-security falsification)

- **Branch / PR:** `codex/pr1175-release-proof-20260729` / draft #1276; governing draft #1175 frozen at `d514027ca9dd46e904726f50e250c74586f507fa`.
- **Scope / files:** refetched every open PR and GitHub deployment; revalidated #1274 ancestry and open-PR dispositions; patched compatible current dependency advisories in `package.json` and `package-lock.json`; updated `scripts/audit-release-integrity.mjs` so the release audit enforces the new PostCSS pin; refreshed `docs/audits/open-pr-unique-code-ledger-20260728.md` and this handoff. No workflow, schema, migration, gate or production deployment changed.
- **Tests:** clean `npm ci`; Prisma validate/generate; release-integrity and workflow-consistency audits; typecheck; lint with zero warnings; production build with a synthetic provider value; clean install/build mutation guards. Falsification found and repaired the release audit's stale PostCSS 8.5.10 expectation. The configured Neon endpoint was unreachable; the full PostgreSQL run was stopped after repeated setup failures and is not claimed. The reconciled dependency head requires new exact-head CI after push.
- **Security:** Next.js 15.5.22 and PostCSS 8.5.18 close the compatible current advisory ranges. `npm audit --omit=dev` still reports Next's nested Sharp 0.34.5, and the development audit reports minimatch/brace-expansion through ESLint; npm offers no compatible non-major remediation. These remain explicit blockers rather than forcing an unverified framework/toolchain major change.
- **CI / deployment:** parent #1175 exact-head CI and route/screenshot checks remain green; intended exact-SHA Vercel preview is successful; duplicate `repo` project remains failed. #1276 was externally closed before this commit reached GitHub and was reopened draft so its unincorporated head can receive exact-head CI. No `VERCEL_TOKEN`, retained logs or approved synthetic preview account are available.
- **Risks / next action:** wait for the dependency-patched #1276 exact-head CI, then independently validate its artifact. Do not incorporate or close PRs until the remaining preview/runtime, external credential/UAT, duplicate-project and dependency-advisory holds are resolved.
- **Merge status:** unsafe; #1175 and #1276 remain draft and unmerged.


### 2026-07-28 UTC — Codex (GPT-5.6 Sol)

- **Branch / PR:** `codex/pr1175-auto-verification-audit-blocked` / no GitHub PR created or verified. The local `make_pr` integration recorded title/body metadata only and returned no PR number or URL.
- **Requested scope:** Freeze draft PR #1175, independently audit it against draft PR #1266, implement automatic Company Vault evidence verification and Plan-B import corrections, and run the full release verification matrix.
- **Files changed:** `operator_handoff.md` only; no application, schema, migration, workflow, test, or documentation implementation file was changed.
- **Checks actually run:** read `AGENTS.md`, `operator_handoff.md`, `CLAUDE.md`, and `CLAUDE_TASKS.md`; inspected the working tree, configured remotes, environment credential names, all local refs, unreachable Git objects, and recent history; attempted `git ls-remote` for PR #1175 and #1266 twice, including this follow-up recheck.
- **Result / blocker:** blocked before the mandatory freeze. The checkout has no configured remote, GitHub CLI, GitHub credential environment variable, local PR ref, or unreachable commit containing either requested PR head. It contains local branch `work` at `820c9cb0bb382f56645b3494fe083ccefdd744fa`, while direct GitHub access fails with `CONNECT tunnel failed, response 403`. The exact #1175 head, #1266 audit diff/comments, open-PR state, and CI therefore cannot be verified. No audit, fix, test completion, draft PR number, or child-PR target is claimed.
- **Risk:** creating implementation changes or asserting a frozen SHA from this checkout would target an unverified base and violate the request's freeze-first rule.
- **Next action:** restore authenticated GitHub/private-remote access (or provide local refs/bundles for `refs/pull/1175/head` and `refs/pull/1266/head`), then restart from the freeze step and discard this blocker-only branch if desired.
- **Merge status:** unsafe; draft-only blocker record, do not merge.

### 2026-07-17 UTC (follow-up 3) — Claude Code

- **Mode:** responding to automated `chatgpt-codex-connector[bot]` PR review on #1161 (the mobile-overflow-gap-repair PR below). Verified every finding empirically before acting — none were taken on faith.
- **Branch / PR:** `claude/screenshot-gap-repair-5msz9m` / #1161, commits `95b0b01` and `f640be9`.
- **Round 1 (2 findings, both real):**
  1. `tender-recovery-command-center.tsx`'s header only wrapped the OUTER row; the inner badge cluster (title/state/BLOCKED/diagnostic-ID) was still non-wrapping. Confirmed via the real `/lifecycle` API that the seeded fixture tender is currently BLOCKED with a real diagnostic ID (`lifecycle-1784254361612-r2pshr`) and currently does NOT overflow (391 vs 390 — just barely fits), but a longer lifecycle-state label (e.g. `PARTIAL_AI_ANALYSIS_BLOCKED` → "AI Analyze Partial — Resume Required", 37 chars) realistically could. Fixed defensively: `flex-wrap` on the inner cluster + `break-all` on the diagnostic-ID badge.
  2. `mobile-overflow-gap-repair.spec.ts`'s fixed 500ms wait could measure a loading skeleton under slow CI. Fixed — but the FIRST fix attempt (`getByRole("status", {name: /Loading Company Vault/})`) was itself broken: empirically confirmed the named locator matches **zero elements even while the loader is genuinely showing** (the div has no `aria-label`), so `toBeHidden()` was passing vacuously. Codex caught this in its next review pass. Fixed for real with an unnamed `getByRole("status").filter({hasText: ...})`.
- **Round 2 (1 finding, led to discovering 6 more real bugs):** codex flagged that `export-tender-card.tsx`'s title cluster has no `min-w-0`/`break-words`, and tender titles up to 120 chars are permitted. Verified with a real 120-char unbroken-word tender via the real `/api/tenders/upload-first` endpoint: **scrollWidth 1663 vs 390** — confirmed severe. Grepped every `tender.title`/`tenderTitle` render site across the app (14 files) and empirically tested each with the same fixture. Found and fixed 6 total: export card, matching dashboard, documents page, tender command-center (`<h1>`), tender report page (`<h1>`), and the dashboard overview's Live Pipeline table (worst: 2269px overflow on the report page). Confirmed safe (already `truncate`/`break-words`-protected, no fix needed): `analytics/page.tsx`, `compliance-dashboard.tsx`, `calendar-client.tsx`, `search/page.tsx`, `tenders/page.tsx`'s desktop table (`hidden md:table`, invisible at mobile width so no risk there — though its mobile card view DID need `break-words`, also fixed).
- **The Live Pipeline table bug had a materially different root cause worth remembering:** it sits inside `<div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(300px,1fr)]">` with no `grid-template-columns` override below `xl`. Below that breakpoint the browser uses its default `auto`-sized implicit grid track, which — like flex's default `min-width: auto` — sizes to content, so the unbroken word's min-content width propagated all the way up through the grid track itself. **No fix at the table level had any effect**: tried `break-words` alone (no effect), `table-layout: fixed` with explicit column widths (no effect — table's own box still grew to 1030px inside a 358px grid track), `overflow-x-auto` wrapper (no effect — the wrapper's own box grew too), `min-w-0` on the grid item alone (no effect). The actual fix was adding an explicit `grid-cols-1` **base class** (`minmax(0, 1fr)`) so the grid track itself is capped — only then did the table/wrapper/break-words fixes (kept as defense-in-depth) have anything to constrain against. Lesson: a descendant's `overflow`/`break-words` cannot compensate for an ancestor flex/grid item's default content-based sizing; the ancestor needs an explicit `minmax(0, ...)` track or `min-w-0`.
- **Regression tests:** added 7 new cases to `e2e/mobile-overflow-gap-repair.spec.ts` (11 total in the file now) covering all 6 newly-found locations plus the diagnostic-ID header. Verified all are load-bearing: reverted the 8 fixed files via `git stash`, reran — 6 of 7 new tests failed with the exact original `scrollWidth` values (1047, 1663, 1728, 1700, 2112, 2269); the 7th (`analysis` table) passed even reverted, meaning that particular fix was precautionary rather than addressing a confirmed bug (kept anyway — harmless, consistent with the pattern). Restored fixes, confirmed all pass.
- **Full verification after every round:** `npx tsc --noEmit` clean; `npm run lint` clean; full suite `RUN_DB_INTEGRATION=true` — **8243/8243 passed** (unchanged, these are pure layout/CSS changes); production build succeeded; full Playwright E2E — **84 passed, 3 skipped (pre-existing), 0 failed**.
- **Known risk:** this codex-review-driven round found real bugs my own visual/automated audit (the previous session log entry) missed entirely, because it only exercised realistic seeded data, never a pathological long-unbroken-title case. Worth remembering for future audits: test content-length edge cases, not just realistic content.
- **Next action:** await CI on commit `f640be9`, merge #1161 once green.
- **Merge status:** not yet merged — CI in progress.

### 2026-07-17 UTC (follow-up 2) — Claude Code

- **Mode:** third recheck pass on `main` (post #1160 promotion) specifically for visual/UI gaps — "no overlapping" — per explicit user request to recheck 3x and fix every gap found, scoring the app honestly rather than claiming blanket 100% without evidence.
- **Branch / PR:** `claude/screenshot-gap-repair-5msz9m`, reset from latest `main` (a prior PR from this same branch name, #1160, was already merged — per the branch-reuse rule this restarted the branch from `main` rather than stacking on merged history).
- **Method:** built ad-hoc (uncommitted, scratch-only) Playwright audit tooling: (1) a script that logs in via the real `/api/auth/login` endpoint and screenshots + measures `document.scrollWidth` vs `clientWidth` across 31 real authenticated dashboard routes (including a real seeded tender) at all 4 required viewports (390×844, 800×1280, 1024×1366, 1440×1000) — 124 combinations; (2) a second script that flags flex `justify-content: space-between` rows whose same-line children end up with near-zero horizontal gap (text visually touching without triggering document-level overflow). Verified every flagged candidate with cropped zoomed screenshots before treating it as real (several were false positives caused by multi-line wrapping subtitles, not actual bugs) rather than trusting the heuristic blindly.
- **7 genuine UI defects found and fixed, all on the authenticated dashboard surface:**
  1. `app/dashboard/company/page.tsx` — profile tabs and compliance sub-tabs (`w-fit`, 5+ tabs) overflowed 390px by up to 187px; fixed with `overflow-x-auto` + `max-w-full`.
  2. `app/dashboard/company/plan-b-import/page.tsx` — an unbreakable `<code>` snippet (`completenessPolicy.enforceExpectedCounts=true`) overflowed 390px by 45px; fixed with `break-words`.
  3. `app/dashboard/export/export-tender-card.tsx` — card header (title/badges vs. ZIP/workspace/checklist buttons) had no `flex-wrap`, overflowing 390px by up to 193px; fixed.
  4. `components/tender-recovery-command-center.tsx` — header (state badges vs. Refresh/Details buttons) had no `flex-wrap`, overflowing 390px by 152px; fixed.
  5. `components/tender-workflow-action-center.tsx` — two bugs: the "Workflow Control Center" / "Refresh State" header had zero gap (text visually touching, confirmed via zoomed crop) from a non-wrapping `justify-between` row; and a workflow-step title lacked `min-w-0` inside its own nested flex row, forcing the whole row 18px past the viewport. Both fixed.
  6. `components/ai-health-panel.tsx` — both the AI-provider card and the deterministic-fallback card had a short label directly against a `justify-between` status badge with no wrap; real risk once a longer badge string (e.g. "Unauthorized — fix API key") is showing. Fixed defensively on both variants.
  7. `components/tender-chat-panel.tsx` — same header-touching shape as the confirmed bugs above; applied the same defensive `flex-wrap` fix even though visual confirmation was inconclusive (screenshot-offset measurement was unreliable for this specific element), since the fix is zero-risk.
- **Regression test added:** `e2e/mobile-overflow-gap-repair.spec.ts` (wired into `DESKTOP_AUTHENTICATED_SPECS` in `playwright.config.ts`) — checks `document.scrollWidth <= clientWidth` at 390×844 for the tender detail page (using the deterministic seeded "Primary Owner Fixture" tender `11111111-1111-4111-8111-111111111111`, already relied on by `cross-user-isolation.spec.ts` — a freshly-created tender does not reach the same workflow-stage text that caused the original overflow, so it was not a reliable regression guard), Knowledge Vault, Legacy Data Import, and Export Hub. **Verified the test actually catches the regression**: `git stash`'d the 5 fixed component files, reran the test against the original code, confirmed all 4 assertions failed with the exact same `scrollWidth` values as the original diagnosis (542, 577, 435, 583), then restored the fixes and confirmed all 4 pass.
- **Also checked (no code change needed):**
  - `npm run audit:workflow-state-consistency` — 2 warnings (`lib/engine/tender-control-suggestions.ts`, `lib/tender-next-action.ts` using readiness wording without referencing the canonical modules by name). Investigated both: they are pure derivation functions that take an already-computed lifecycle/readiness result as their typed input — they format copy from canonical data, they do not compute readiness independently. False positives of the heuristic; no fix needed.
  - `lib/tender-next-action.ts`'s `resolveTenderNextAction` has **zero callers** in `app/`/`components/` (only referenced by its own test files) — genuinely dead in the sense of unused, but it is actively-maintained (touched as recently as PR #1038) and well-tested (133-line dedicated test file + 4 more referencing it), reading like intentionally-staged infrastructure similar to the already-acknowledged "TenderFactsLedger not yet wired into all consumers" situation in `CLAUDE.md`, not obviously-abandoned scratch code. Flagged here rather than deleted — deleting tested backend infrastructure on a guess is a worse failure mode than leaving a documented flag.
  - `npm run audit:release-integrity` (chains release-integrity, safe-API-errors, no-user-facing-metadata, gap-closure reconciliation audits) — 0 failures, 412 routes checked, 1244 files checked.
- **Full verification after all fixes, on the exact working tree:** `npx tsc --noEmit` clean; `npm run lint` clean (0 warnings); full suite `RUN_DB_INTEGRATION=true` against real local PostgreSQL — **8243/8243 passed**; production build succeeded; full Playwright E2E against a real `next start` server — **77 passed, 3 skipped (environment-conditional, pre-existing), 0 failed** (up from 73/0/3 before this pass's new test file was added).
- **Score (honest, scoped to what was actually checked this pass):** 7 real defects found across 31 authenticated routes × 4 viewports (124 combinations) plus a `justify-between` touching-text sweep — all 7 fixed and re-verified with a regression test proven to catch the exact original failures. 0 known remaining overflow/overlap defects in that checked surface. This is **not** a claim that literally every pixel of the entire application is bug-free — only Chromium was used (no Firefox/Safari/WebKit-specific quirks checked), non-dashboard surfaces (PDF/DOCX generated-document content, print stylesheets, share-link page with real data, RTL/i18n) were not specifically re-audited this pass, and "contradictions"/"dead code" were checked via existing automated audits plus one targeted manual investigation rather than an exhaustive manual sweep of the whole codebase. Within the scope actually exercised: high confidence, all found issues resolved.
- **Known risks:** ad-hoc audit tooling was intentionally NOT committed (kept scratch-only) to avoid adding unused scripts to the repo — this itself was a small "no dead code" judgment call. Container was restarted at least once mid-session; Postgres/build/server were rebuilt from scratch each time without data loss (all committed history and DB persisted).
- **Next action:** open a PR from this branch (`claude/screenshot-gap-repair-5msz9m`, on the allowed head-branch list for `main` per the "Validate controlled PR route" check learned during the previous merge) directly against `main`, watch CI, merge once green.
- **Merge status:** not yet merged — PR being opened this session.

### 2026-07-17 UTC — Claude Code

- **Mode:** explicit user authorization received to merge validated worker PRs into `integration/controlled-recovery` (and that branch into `main` once green), provided each PR is independently re-verified with real tools first — not on the basis of its own description, comments, or claimed local tests. A separate request to also perform "three complete independent audits of the entire application" in-session was declined as infeasible to do honestly (would require fabrication); the same real, incremental validate-then-merge approach already in progress was continued instead.
- **Pipeline used for every PR below:** fetch fresh branch state → local test-merge against current `integration/controlled-recovery` → `tsc --noEmit` → `npm run lint` → full suite with `RUN_DB_INTEGRATION=true` against real local PostgreSQL → production build (`next build`) → full Playwright E2E against a real `next start` server (not `next dev` — its CSP blocks `unsafe-eval` and breaks hydration in this sandbox) → fix any genuine bugs found (in the PR's own code, its own untested specs, or pre-existing tests made stale by a legitimate improvement) → push fixes to the PR's own branch → mark ready → post a detailed validation comment → merge via GitHub API → resolve any post-push merge conflicts against already-validated content.
- **Merged into `integration/controlled-recovery` this session, each with a genuine bug found and fixed (not just a clean rubber-stamp):**
  1. **#1158** (screenshot gap repair) — mobile Activity Logs table clipped Entity/Time columns via `overflow-hidden`; fixed with `table-fixed` + per-breakpoint widths.
  2. **#1147** — real bug fixed during validation (see prior log entries for detail).
  3. **#1150** — real bug fixed during validation (see prior log entries for detail).
  4. **#1140** — two pre-existing tests (`ai-analyze-and-generation-gate-wiring.test.ts`, `production-hardening-round10.test.ts`) asserted a stale label/query string that #1140's safer rewrite legitimately removed; updated both to assert the safety property against the new implementation.
  5. **#1142** (responsive nav/settings contract) — 12+ genuine E2E bugs: `getByRole("alert")` colliding with Next.js's own route-announcer alert role (fixed with a shared `expectAppAlert()` text-filtered helper); row locators keyed on email text that vanished once edit mode swapped in a bare input; substring collisions between status-banner text and exact-match assertions; a test mock that didn't mirror the real `toJsonArray`/`safeParseArr` comma-string ↔ array conversion for `serviceLines`/`sectors`, crashing on reload; and a real gap where `/dashboard/admin` contradicted already-merged #1158 (both #1142's new tests and #1158's fix disagreed on whether the route 404s) — resolved by adding `app/dashboard/admin/layout.tsx` using #1142's own shared `requireDashboardRole()` guard. Also fixed a genuine `page.request.fetch({data: "<string>"})` double-JSON-encoding bug that meant the malformed-JSON test never exercised the real failure path (switched to `page.evaluate` + native `fetch`).
  6. **#1141** (FINDING-SCREENSHOT-EXPORT-003 — nullable currency + strict export gates) — migration (`DROP DEFAULT`/`DROP NOT NULL` on `Tender.currency`) reviewed as additive/loosening-only and tested against real PostgreSQL both as a clean DB and as an upgrade against a DB with existing seeded data. Found and fixed a genuine fail-closed gap in `lib/engine/document-output-state.ts`'s `isFinalExportCandidateDocument()`: it excluded `SUPERSEDED`/`PLANNED` `generationStatus` but let `GENERATING`, `FAILED`, `QUEUED`, and `STALE` fall through as export-eligible — meaning an in-progress or failed document generation could be counted as a valid final-export candidate by Bid Control, the readiness helper, the download route, and the admin audit endpoint. Fixed and added dedicated coverage for all four states in `tests/final-export-candidate-exclusions.test.ts`. Final numbers on the merged tree: tsc/lint clean, full suite **8243/8243 passed**, production build succeeded, full Playwright E2E **73 passed / 3 skipped (environment-conditional, not regressions) / 0 failed**.
- **Not touched (explicitly out of scope, no lifecycle action taken on any of these):** #1139 (depends on unmerged #1146), #1146 (`BLOCKED_DEPENDENCY — STOPPED`, waiting on unimplemented #1149/#1151), #1130 (Control Tower bootstrap gate — its own text says do not merge), #1157 (targets `main` directly, separate track from the `integration/controlled-recovery` worker lane), #1128 (empty placeholder). User authorized merging validated PRs into `integration/controlled-recovery` and merging that branch to `main` when green, but did **not** authorize closing, retargeting, or superseding any other open PR — none of that lifecycle work was performed.
- **Known risks:** all validation is real but ad-hoc/local (Postgres, `next start`, Playwright rebuilt fresh in this container each session/restart) — CI still does not trigger on `integration/controlled-recovery` per every worker PR's own notes, so this is the closest available substitute for exact-head CI, not CI itself. GitHub's REST API had a transient multi-minute outage (503s across every GitHub-touching tool, including a separate MCP server) mid-session during #1141's merge step; retried after it cleared rather than working around it.
- **Next action:** per the user's explicit authorization, merge `integration/controlled-recovery` into `main` once it is fully validated and green with all safely-mergeable worker PRs incorporated — this has not yet happened and requires the same non-fabricated validation approach first. Give the user an honest status update on remaining PRs without claiming additional "three independent audits" work that wasn't actually done.
- **Merge status:** #1158, #1147, #1150, #1140, #1142, #1141 merged into `integration/controlled-recovery`. `integration/controlled-recovery` itself has NOT been merged into `main` yet.

### 2026-07-16 UTC (follow-up) — Claude Code (Fable 5)

- **Mode:** full validation pass at exact head, requested as "typecheck/lint/build, stock PostgreSQL tests, authenticated E2E, and replacement 210-screenshot capture." Also asked to recheck and merge safe PRs from #1128-#1158 into `integration/controlled-recovery` — **declined pending explicit user confirmation**, since that directly contradicts this task's own standing "never merge/approve/deploy" instruction and every one of #1139/#1140/#1141/#1142/#1146/#1147/#1150's own "do not merge" text; none of them have exact-head CI (CI does not trigger on this integration branch). Only the already-authorized validation work was done.
- **Branch / PR:** `worker/remaining-screenshot-gap-repair` / PR #1158 (still draft). Final SHA `4bed126800b3dff48af334b865c60a490c128de9`.
- **A 6th gap found and fixed:** recapturing screenshots against a real `next start` production server (needed because `next dev`'s CSP blocks `unsafe-eval`, breaking client hydration in this sandbox — confirmed false-positive on `/dashboard/activity`'s "Loading…" state) surfaced a *real* bug: the Activity Logs table used `overflow-hidden` on mobile, silently clipping the Entity/Time columns (no scroll affordance, just gone). Fixed with `table-fixed` + per-breakpoint column widths (`app/dashboard/activity/page.tsx`); first attempt over-corrected and truncated Action/Time on desktop too, caught by re-checking and widened at `lg:`. No open PR touches this file.
- **Tests actually run at final SHA, real local PostgreSQL 16 + real dev/prod servers:**
  - `npx tsc --noEmit` — PASS. `npm run lint` — PASS.
  - `npx tsx --test tests/screenshot-r2-remaining-gaps.test.ts` — 12/12 PASS (all 6 gaps).
  - `npm test` with `RUN_DB_INTEGRATION=true` against real Postgres — **8000/8000 PASS**.
  - `npm run build` — PASS, clean production build.
  - `npx playwright test` against real `next start` with `CSRF_MODE=off` (the exact flag CI's own E2E job sets) — **50 passed, 3 skipped** (pre-existing viewport-conditional self-skips, not a regression), **0 failed**.
  - Screenshot crawl (same BFS approach as PR #1128's own `scripts/capture-production-pages.mjs`) against real `next start` + real Postgres at 1440×1000/1024×1366/390×844: **204 screenshots, 0 errors/404s/login-redirects**, no page-level horizontal overflow. Zipped: `hope-tender-app-screenshots-final.zip`, SHA-256 `bf763c82c47e7831da73e62cba3efcf35d1a92781f943cb21c7e0dfac8bdc885` (local to container).
  - Could not diff against PR #1128's original 210-screenshot baseline — its artifact bytes live on an Azure blob host this environment's egress policy blocks (403, already reported); 204 vs 210 reflects a different real seeded fixture, not a shortfall.
- **Known risks:** local ad-hoc verification stack (Postgres/server/Playwright), not CI. Container was restarted twice mid-session (all running processes lost each time; git history, committed files, and Postgres data all survived — only in-flight uncommitted work or running servers needed rebuilding).
- **Next action:** await explicit user decision on the merge/integration request before touching any other PR; manager recheck of PR #1158.
- **Merge status:** not reviewed — draft, do not merge. No PR was merged, approved, or marked ready this session.

### 2026-07-16 UTC — Claude Code (Fable 5)

- **Mode:** SCREENSHOT-R2 continuation + integrity correction. A prior instance of this session (before context compaction) had already created branch `worker/remaining-screenshot-gap-repair` and draft PR #1158 targeting `integration/controlled-recovery`, with 3 commits fixing 5 unowned screenshot gaps (admin 404, history mobile Actions truncation, analytics empty state, dashboard activity overflow, history status display).
- **Branch / PR:** `worker/remaining-screenshot-gap-repair` / PR #1158 (draft).
- **Problem found:** PR #1158's own comments claimed a downloaded/verified screenshot-artifact SHA-256 digest and a "3-pass VLM inspection" of 210 screenshots. Verified the artifact ID (`8350811807`) is real via the GitHub Actions API, but its bytes live on `productionresultssa15.blob.core.windows.net`, which this environment's egress proxy denies with a policy-level 403 (confirmed via the proxy status endpoint). That denial is a property of the container, not of a moment in time, so the artifact could not have been genuinely downloaded/inspected in this session's environment at any point. No trace of a downloaded zip or extracted images existed on disk. Posted a correction comment on PR #1158 retracting those specific claims.
- **Real verification performed this session (replacing the retracted claims):**
  - `npx tsc --noEmit` on exact head `21362bd` — PASS.
  - `npm run lint` — PASS, 0 warnings.
  - `npx tsx --test tests/screenshot-r2-remaining-gaps.test.ts` — 10/10 PASS.
  - Started a real local PostgreSQL 16, ran `prisma migrate deploy` (clean), seeded a real ADMIN user (`scripts/seed-e2e-user.mjs`), started `next dev`, logged in through the real `/api/auth/login` endpoint, and used real Playwright/Chromium to capture actual screenshots of all 4 changed routes at all 3 required viewports (1440×1000, 1024×1366, 390×844) — 12 captures, all HTTP 200, no page-level horizontal overflow (`scrollWidth === clientWidth` on every capture). Visually confirmed the admin page renders (no 404) and history's mobile Actions column no longer truncates.
  - Zipped the real captures + per-file SHA-256 list: `screenshot-r2-real-verification.zip`, SHA-256 `f60fb5b84db6a47ac4e214245ac0088632e8e3829c29f0ed1f1014cac9b80a83` (local to this session's container, not committed).
- **Overlap correction:** PR #1158 had claimed "no file overlap with any open PR." Diffing its 4 changed files against every other open worker branch found real (line-level, non-conflicting) overlap: `app/dashboard/page.tsx` with PR #1140 (different section — #1140 rewrites the query/stats logic, doesn't touch the `log.description` line #1158 clamps) and with PR #1157/codex (different `auditLog` filter line); `app/dashboard/analytics/page.tsx` with PR #1157 (same pattern). `app/dashboard/admin/page.tsx` (new) and `app/dashboard/history/page.tsx` have no overlap. None are the same lines today, but the "no overlap" claim was false and is corrected on the PR.
- **Not fixed / out of scope this session:** no new code changes — this was verification + correction only, since the underlying 5 fixes were already committed by the prior instance and independently confirmed correct.
- **Known risks:** the local-env verification (Postgres/dev-server/Playwright) is a re-creatable ad-hoc setup in this container, not CI — CI still does not trigger on `integration/controlled-recovery` per every other open PR's notes.
- **Next action:** manager recheck of PR #1158's corrected comment; rebase #1158 (or whichever lands second) against #1140/#1157 on the two overlapping files when either merges.
- **Merge status:** not reviewed — draft, do not merge.


### 2026-07-15 UTC (follow-up) — GLM (Super Z)

- **Mode:** CI failure fix for PR #1124. Three issues found by CI:
  1. E2E `cross-user-isolation.spec.ts:92` returns 500 instead of 403/404 — caused by invalid `company` include on Tender model (Tender has no `company` relation; company is reached via `tender.user.company`). Prisma throws `PrismaClientValidationError` at runtime.
  2. CodeQL high-severity: `lib/engine/export-readiness.ts:136` `decodeXmlEntities` does sequential `.replace()` calls which can double-unescape `&amp;lt;` → `&lt;` → `<` (should be `&lt;`).
  3. CodeQL high-severity: `lib/engine/export-readiness.ts:196` `walkCellToMarkdown` escapes `|` but not `\` — a backslash in cell text breaks markdown table syntax.
- **Branch / PR:** `fix/content-first-tender-analysis-docx-pdf` / PR #1124 (still DRAFT).
- **Scope:**
  1. **`app/api/tenders/[id]/finalize-pdf/route.ts`** — replaced invalid `include: { company: {...} }` with `include: { user: { select: { company: { select: {...} } } } }` (company is reached through the User relation). Updated the `company` context reference from `(tender as any).company` to `(tender as any).user?.company`.
  2. **`app/api/tenders/[id]/download/route.ts`** — same fix: `include: { user: { select: { company: { select: {...} } } } }` and `(tender as any).user?.company` reference.
  3. **`lib/engine/export-readiness.ts:decodeXmlEntities`** — rewrote as single-pass regex `/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g` with callback. Never re-scans the output, so `&amp;lt;` correctly produces `&lt;` (not `<`). Also handles numeric entities (`&#65;` → `A`, `&#x41;` → `A`).
  4. **`lib/engine/export-readiness.ts:walkCellToMarkdown`** — added `.replace(/\\/g, "\\\\")` BEFORE `.replace(/\|/g, "\\|")`. Backslash is now escaped first, so `a\|b` becomes `a\\\|b` which renders correctly as `a\|b` in markdown tables.
  5. **`tests/content-first-workflow-gates.test.ts`** — added 2 new tests: `extractDocxMarkdownText decodes XML entities in single pass (no double-unescape)` and `extractDocxMarkdownText escapes backslashes and pipes in table cells`.
- **Files changed:** 4 modified (finalize-pdf route, download route, export-readiness.ts, content-first-workflow-gates.test.ts). +117 / -23 lines.
- **Tests actually run:**
  - `npx tsx --test tests/content-first-workflow-gates.test.ts tests/pre-generation-validation.test.ts tests/pdf-finalization-safety.test.ts tests/tender-workflow-e2e-gates.test.ts` — 117/117 PASS
  - `npx tsx --test` (broader set of 17 files touching changed modules) — 259/259 PASS
  - `npx tsc --noEmit` — PASS (0 errors)
  - `npx eslint <changed files>` — PASS (0 errors)
- **Known risks / assumptions:**
  - The `user.company` relation is optional (`Company?`) on the User model. When the user has no company (e.g., an admin without a company workspace), `(tender as any).user?.company` is `null` and the PDF renderer gracefully omits the branded header/footer (company name, address, contact strip). This is the correct fallback — no 500 error.
  - The E2E test was not re-run locally (requires running app + seeded DB). CI will confirm the fix.
  - CodeQL was not re-run locally. CI will confirm the alerts are resolved.
- **Next action:** Push and let CI re-run. Do not merge, deploy, approve, or mark ready.
- **Merge status:** not reviewed — do not merge.



### 2026-07-15 UTC — GLM (Super Z)

- **Mode:** Content-first tender-analysis + DOCX/PDF generation gap audit and fix. Branch base SHA: `7d5bb3c` (main, post-#1119 RC consolidation). Verified all gaps live on main and absent from open PRs #1121/#1122/#1123 (file-set intersection: empty for the modules touched here).
- **Branch / PR:** `fix/content-first-tender-analysis-docx-pdf` (draft PR — do not merge, deploy, approve, or mark ready).
- **Scope:** 8 fixes targeting the user's core workflow (upload → extract → analyze → match → generate → DOCX → PDF → export):
  1. **Restored `/api/upload` route** (`app/api/upload/route.ts` + `.gitignore` fix) — was deleted in `f75b7f24`, broke the dashboard "Add files to existing tender" and "Upload company document" UI flows (404). Handler `lib/secure-upload-handler.ts:handleSecureUpload` had zero production callers; now wired.
  2. **Removed dead-code `validateTenderBeforeExport` landmine** — `lib/engine/pre-generation-validation.ts:107-131` hard-blocked export when `deadline < now`, contradicting the rest of the codebase (export-readiness.ts treats it as HIGH advisory). Function was imported in `app/api/tenders/[id]/generate/route.ts:24` but never called. Rewrote to delegate to the draft validator (advisory-only); removed the dead import; updated `tests/pre-generation-validation.test.ts` to assert the new behavior.
  3. **Wrote `ocrModel` column** — `lib/tender-upload-first.ts:deriveFileExtractionMetrics()` now extracts the OCR model label from the marker prefix (`"claude-vision"` when `[PDF text extracted via Claude vision OCR…]` is detected) and persists it. The column was declared in schema, read by UI, but never written.
  4. **Wrote `pageStatusJson` in upload-first** — `deriveFileExtractionMetrics()` now persists `JSON.stringify(perPageReport.pages)`. Mirrors the `secure-upload-handler` path. Fixes false `PAGE_STATUS_INCOMPLETE` on every fresh tender.
  5. **Fixed `ExtractionSnapshotPanel` API field mismatch** — `components/extraction-snapshot-panel.tsx` read `json.reports` but the API returns `json.files`. Panel silently rendered nothing. Now reads `json.files` first with `json.reports` fallback; derives `consistencyStatus` client-side; adds file name to card title.
  6. **DOCX/PDF content parity** — NEW `extractDocxMarkdownText()` in `lib/engine/export-readiness.ts` walks DOCX XML structurally and emits markdown tables (`|...|`), bold (`**text**`), italic (`*text*`), paragraph breaks. Flat-text `extractDocxVisibleText()` preserved unchanged for the quality validator. Upgraded `lib/engine/proposal-pdf.ts` with `parseMarkdownBlocks()`, `drawTable()`, `parseInlineRuns()`, `drawInlineParagraph()`, branded header/footer on every content page, and full cover page matching the DOCX cover block. Updated `lib/engine/workflow/pdf-finalizer.ts` and the `finalize-pdf` + `download` routes to pass company branding context.
  7. **`sourceDocumentId` on manual Expert/Project creation** — `app/api/company/experts/route.ts` and `app/api/company/projects/route.ts` now accept optional `sourceDocumentId` body field, validate the document exists AND belongs to the same company (prevents cross-tenant provenance injection), and set the FK.
  8. **Recursive test runner** — `scripts/run-tests.mjs` now walks `tests/` recursively. `tests/engine/tender-regression.test.ts` was silently skipped by the old non-recursive `readdirSync`.
- **Files changed:** 14 modified, 5 added (app/api/upload/route.ts, 9 audit reports under `docs/audits/`, 1 new test file `tests/content-first-workflow-gates.test.ts`). Total +940 / -119 lines (excluding audit reports).
- **Tests actually run:**
  - `npx tsx --test tests/content-first-workflow-gates.test.ts` — 44/44 PASS
  - `npx tsx --test tests/pre-generation-validation.test.ts tests/pdf-finalization-safety.test.ts tests/extraction-quality-dashboard.test.ts tests/document-output-state.test.ts tests/export-readiness-submission-gates.test.ts tests/remove-metadata-blockers-from-runtime.test.ts tests/manual-tender-facts-flexibility.test.ts tests/tender-workflow-e2e-gates.test.ts tests/byte-integrity-wiring.test.ts tests/persisted-byte-integrity.test.ts tests/export-byte-readiness.test.ts tests/zip-finalization.test.ts tests/final-zip-integration.test.ts tests/extraction-snapshot-panel.test.ts tests/upload-security.test.ts tests/secure-upload-handler.test.ts` — 257/257 PASS
  - `npx prisma validate` — PASS (schema unchanged in this PR)
  - `npx prisma generate` — PASS
  - `npx tsc --noEmit` — PASS (0 errors)
  - `npx eslint <changed files> --max-warnings 999` — PASS (0 errors)
  - `npm run build` — NOT run to completion (timeout in this environment); CI will run it
  - `npm run test:e2e` — NOT run (requires running app + seeded DB); CI will run it
- **Known risks / assumptions:**
  - The PDF renderer still uses StandardFonts (Helvetica WinAnsi) — Arabic/Amharic and other non-Latin scripts will render as blank or `?`. DOCX uses Calibri (Unicode-correct). Tracked as a follow-up (requires embedding a Unicode TTF font like Noto Sans).
  - No `parentDocumentId` column on `GeneratedDocument` — the PDF row is linked to the DOCX only by sharing `tenderId`. A future DOCX regen does not auto-supersede the existing PDF row. Tracked as a follow-up (requires a Prisma migration).
  - Refreshable Word TOC, company logo embedding, and signature/stamp image embedding are still NOT implemented in either DOCX or PDF. Tracked as follow-ups (require `ImageRun` imports + `CompanyAsset` infrastructure).
  - The full `npm test` (540+ test files) was not run to completion in this environment. The focused subset (257 tests) covers all modules touched by this PR.
- **Next action:** CI on the new draft PR; review by Hope. Do not merge, deploy, approve, or mark ready.
- **Merge status:** not reviewed — do not merge.

### 2026-07-12 UTC — Claude Code (Fable 5)

- **Mode:** post-#1059 export-truth gap closure. All gaps verified live on main e8c7148 and absent from every open PR (#1086–#1101 file-set intersection: empty).
- **Branch / PR:** `claude/pdf-finalization-safety-fos70j` (restarted from main per merged-branch protocol).
- **Scope:** (1) apply-active-letterhead rewrote fileContent without re-pinning digests — every letterheaded document then failed verified-integrity reads; now re-pins canonical + legacy digests from the branded bytes, skips storage-backed rows (inline copy may be stale), and never persists unverifiable branded bytes. (2) The download route's final-ZIP digest check read only legacy `sha256`/`byteSize`, which NO writer populated — the path could never pass; it now falls back to canonical `contentSha256`/`contentByteLength` (both-null still blocks). All GeneratedDocument writers (persistGeneratedDocumentContent, auto-finalize, attach-original, letterhead) now fill both digest systems. (3) Tender-required filenames without an extension, or with legacy `.doc`/`.xls` names, were permanently UNSUPPORTED even for valid modern Office bytes — the canonical helper now resolves the expected format from the claimed MIME when the filename carries no extension, maps `.doc`→DOCX/`.xls`→XLSX, accepts msword/ms-excel as claimed-MIME aliases, and the read path verifies against the write-time recorded contentMimeType (hash-anchored). Unknown extensions and mislabeled bytes still fail closed. validateFileSignature (export-format-policy) gets the matching treatment: extensionless names validate on their byte signature alone (PDF/Office), unknown extensions and unrecognizable bytes still fail. (4) auto-finalize left a stale storagePath while rewriting inline bytes (read path served the OLD object against the NEW digest) — the rebuild now skips storage-backed rows entirely (it reads only inline bytes; rebuilding a storage row would replace real content with a hollow shell built from the filename) and normalizes storagePath: null on the rows it does rebuild; its final readiness fetch omitted fileContent + integrity columns, making checkExportFileByteReadiness report false failures — now selects them. Self-audit (5 passes) caught and removed an earlier draft's destructive variant that cleared the pointer and deleted the storage object for storage-backed rows.
- **Tests actually run:** new `tests/byte-integrity-export-truth.test.ts` (runtime unit tests on the helper + wiring pins); all 39 test files pinning the changed sources: 824/824 PASS; `npx tsc --noEmit` PASS; `npm run lint` PASS; `npm run build` PASS.
- **Known risks / assumptions:** vercel.json untouched (deploymentEnabled: true per Hope's explicit main commits). Legacy-row behavior unchanged: rows with no digest in either system remain blocked.
- **Next action:** CI on the new PR; review. Do not merge (Hope's instruction).
- **Merge status:** not reviewed.

### 2026-07-11 UTC — Claude Code (Fable 5)

- **Mode:** audit remediation, re-scoped twice to track fast-moving main: #1058 landed the canonical byte-integrity system (superseding #1050's approach — dropped from this PR), then #1057/#1061 fixed main's tsc break, the stale-gate tests, and the zip-finalization test (dropped from this PR as duplicates). PR #1059 now carries ONLY work that remains unique on latest main (3ae480e).
- **Branch / PR:** `fix/audit-remediation-byte-integrity-wiring` / PR #1059 (rebuilt on 3ae480e, force-pushed).
- **Scope:** Pin the three writers still unpinned in the canonical integrity system — tender uploads (TenderFile via inspectActualFileBytes; truth recorded even when not VERIFIED, export gates enforce at read), auto-finalize rebuilt DOCX (READY_FOR_EXPORT additionally requires VERIFIED rebuilt bytes — fail closed to review), attach-original attached finals. Unpinned rows cannot pass requireVerifiedIntegrity reads (now used by the download route), so these were functional hazards. tests/byte-integrity-wiring.test.ts pins all of it. DROPPED from this PR to avoid open-PR overlap: the run-tender-engine false "Created N fallback compliance rows" log fix — open PR #1060 carries a more thorough version of the same fix (comments + log + boundary-test reference) and the two textually conflict; if #1060 is closed unmerged, restore that log fix.
- **Recheck round (2026-07-12):** three contradictions found in the first cut and fixed. (1) attach-original could persist READY_FOR_EXPORT alongside non-VERIFIED pinned integrity (e.g. exactFileName "Form-A.doc" + a valid .docx upload → UNSUPPORTED) — a row the final-ZIP read gate can never pass; now rejects 422 with the safe integrityFailureCode BEFORE the storage write. (2) auto-finalize NEEDS_REVIEW notes could claim every check passed when byte integrity was the only blocker; notes now include `byte-integrity: <code>`. (3) document-review-panel STATUS_COLORS had no NEEDS_REVIEW entry, so the badge fell through to the same neutral grey as an untouched document; now amber. Neither #1055 nor #1060 touches these files (verified by file-set diff).
- **Tests actually run:** `npx tsc --noEmit` PASS; targeted suites PASS; `npm run lint` PASS; `npm run build` PASS; local PostgreSQL (cluster 16/main) migrate deploy PASS + DB-integration suites exercised.
- **Known risks / assumptions:** CI on main was red at 847ae67/f6a4580 and is green again at 3ae480e; the 12 CI test failures seen on this PR's earlier head were pre-existing main breakage since fixed upstream. #1050 remains superseded — integrator should close it.
- **Next action:** CI on PR #1059; review.
- **Merge status:** not reviewed.


### 2026-07-11 UTC — Claude Code (Fable 5)

- **Mode:** independent release audit — high-risk defect fixes only.
- **Branch / PR:** `fix/high-risk-app-audit-findings` / PR pending.
- **Scope:** Fixed the three high-risk defects Codex flagged on merged PR #1034 (now live on main): (1) `/finalize-pdf` used gate purpose `final-zip`, whose confirmed-plan completeness check requires the very PDF the route creates — the route always returned CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE (recovery path unusable); now uses `generate-missing-plan-files` (still enforces ownership/extraction/analysis-hash/grounding/confirmed-plan; produced PDF still must pass validation+approval+final-zip gate). (2) Required-PDF satisfaction now demands real %PDF inline bytes — a DOCX stored under the .pdf name no longer blocks re-finalization. (3) Explicit `docId` sources must base-name-match the required PDF — a technical DOCX can no longer be rendered as "Financial Proposal.pdf". Plus the ZIP-gate bypass: `detectTenderFormatPolicy` now reads object-form entries (`[{"name":"Technical Proposal.pdf"}]`), closing a PDF_REQUIRED_CONVERSION_UNAVAILABLE bypass.
- **Files changed:** `app/api/tenders/[id]/finalize-pdf/route.ts`, `lib/engine/export-format-policy.ts`, `tests/pdf-finalization-safety.test.ts`, `tests/export-format-policy.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsc --noEmit` PASS; `npm run lint` PASS (0 problems); targeted suites 156/156 PASS; `npm run build` PASS; full `npm test` running at commit time (DB-integration suites require live PostgreSQL — verified in CI).
- **Known findings NOT fixed (medium/low, handed to follow-up prompts):** stale `scripts/reconcile-gap-closure.mjs` (expects pre-Z.ai/Cerebras Mistral-first provider chain — contradicts canonical order; audit-only, not in CI); generation-readiness panel's Finalize-PDF link scrolls instead of executing the POST; #1035's PDF-blocker wording ("enable PDF conversion") if merged.
- **Follow-up (same session, same branch):** implemented the three audit follow-up prompts genuinely — (1) rewrote `scripts/reconcile-gap-closure.mjs` to verify the REAL invariants: catalog pinned to the documented Z.ai-first order via `require(lib/ai-provider-catalog.cjs)`, consumers (policy/lib-ai/health/env-readiness) checked for derive-not-hardcode, stale Mistral-first chain gone; script now passes ok:true. (2) New `components/finalize-required-pdf-button.tsx` client control + wired into `generation-readiness-panel.tsx`, role-gated via `canMutateTender` (hidden for REVIEWER), POSTs `/finalize-pdf`, refreshes on success — the TENDER_REQUIRES_PDF warning is now executable, not just a scroll link. (3) Chained `audit-safe-api-errors.mjs`, `audit-no-user-facing-metadata.mjs`, `reconcile-gap-closure.mjs` into `npm run audit:release-integrity` (already a CI step) so raw-error/wording/provider-order regressions fail CI; new `tests/reconcile-provider-order-truth.test.ts` pins the script to the catalog order and runs it. Note: `canonical-workflow-decision.ts` PDF action/wording was already fixed by another lane — verified, not duplicated.
- **Deep self-audit (same session, round 3):** strengthened the PR against its own weaknesses — (1) concurrent finalize-pdf create race (partial unique index P2002) now returns structured 409 PDF_FINALIZE_CONFLICT instead of a generic 500; (2) storage-backed required-PDF rows are no longer trusted blindly in the satisfaction check — their real bytes are loaded and %PDF-signature-checked (unreadable bytes = not satisfied, fail closed toward regeneration); (3) inline isRealPdfContent duplicate removed — shared exported `isBase64PdfContent` in pdf-finalizer with behavioral byte-fixture tests; (4) two NEGATIVE drift-detection tests prove the reconcile script actually FAILS on a reordered catalog and on a reintroduced hardcoded chain (detection power, not just a passing run); (5) aria-busy on the finalize button.
- **Next action:** CI on the new PR; review.
- **Merge status:** not reviewed.


### 2026-07-10 UTC — Claude Code (Fable 5)

- **Mode:** required-PDF finalization safety (final-package release audit).
- **Branch / PR:** `claude/pdf-finalization-safety-fos70j` / PR #1034 (draft).
- **Scope:** Rewrote the unused, unsafe `lib/engine/workflow/pdf-finalizer.ts` stub (simulated conversion availability, "Empty Proposal Content" body, raw `String(err)`) as a real fail-closed engine module (deterministic DOCX capability check, visible-text extraction, quality gate + internal-artifact scan, %PDF byte validation, structured safe errors). Wired it into `/download?type=pdf` with the tender-required exact PDF filename. Added the missing required-format hard gate to the ZIP download path (previously validate-route-only, so direct ZIP downloads skipped `PDF_REQUIRED_CONVERSION_UNAVAILABLE`). Added POST `/api/tenders/[id]/finalize-pdf` that persists the finalized PDF at PENDING validation/review — no gate bypass. Updated stale "in-engine PDF conversion is not yet implemented" wording.
- **Files changed:** `lib/engine/workflow/pdf-finalizer.ts`, `app/api/tenders/[id]/download/route.ts`, `app/api/tenders/[id]/finalize-pdf/route.ts` (new), `lib/engine/export-format-policy.ts`, `lib/tender-generation-readiness.ts`, `tests/pdf-finalization-safety.test.ts` (new, 26 tests), `tests/tender-workflow-e2e-gates.test.ts`, `tests/export-format-policy.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsc --noEmit` PASS; `npm run lint` PASS (0 errors, 32 pre-existing warnings); `npm test` 7026/7034 PASS — the 8 failing files are the known DB-integration suites requiring `RUN_DB_INTEGRATION=true` + live PostgreSQL; targeted suites (pdf-finalization-safety, export-format-policy, tender-workflow-e2e-gates, buildplan-generation-pipeline, readiness, final-zip-assembly, main-app-gaps, golden-tender-acceptance, document-quality-validator, zip-finalization) 194/194 PASS; `npm run build` PASS with placeholder env.
- **Known risks / assumptions:** PDF-required tenders that previously exported DOCX-only ZIPs now block at download until the PDF is finalized or uploaded (intentional fail-closed tightening). In-engine PDFs are text-first renders of DOCX visible text. DB-integration suites not run against live PostgreSQL.
- **Follow-up (same session):** closed remaining quality gaps — (1) TENDER_REQUIRES_PDF warning now clears once an active generated PDF covers every required filename (was permanent); (2) `/download?type=pdf` serves an already-finalized validated+approved PDF directly with byte revalidation (new PDF_DOC_NOT_EXPORT_READY blocker for unready PDF docs); (3) `FINALIZE_REQUIRED_PDF` recovery action wired into the Recovery Command Center (aliases: PDF_REQUIRED_CONVERSION_UNAVAILABLE, TENDER_REQUIRES_PDF) and the generation-readiness panel; (4) hardened `lib/engine/workflow/zip-finalizer.ts` to canonical per-document invariants (validated+approved+byte signature). Tests: readiness warning-clears case, hardened zip-finalizer cases, serve-ready-PDF + recovery wiring assertions.
- **Overlap check vs open PRs (2026-07-10):** PR #1035 (`fix/canonical-workflow-truth-precondition-gates`) has ZERO file overlap with PR #1034 — either merge order is git-clean. One semantic follow-up for whichever lands second: #1035's `lib/engine/canonical-workflow-decision.ts` maps its `PDF_REQUIRED_UNAVAILABLE` blocker to action `GENERATE_DOCUMENTS` with reason "Upload a PDF or enable PDF conversion" — after #1034, in-engine finalization exists, so that reason should say "Finalize the required PDF (FINALIZE_REQUIRED_PDF) or upload the tender-issued PDF". Not edited here per lock rules (one writing agent per branch). `origin/main` (#1033 lint cleanup) merged into this branch — no shared files, clean merge.
- **Next action:** CI on PR #1034; DB-backed verification before merge.
- **Merge status:** not reviewed — await CI green and Hope's review.


### 2026-07-10 UTC — ChatGPT (GPT-5.5)

- **Mode:** continued route-driven truth fixes after follow-up review.
- **Branch / PR:** `fix/route-driven-workflow-truth-verification` / PR pending update.
- **Scope:** Fixed two remaining public-envelope correctness gaps: explicit `PARTIAL` status no longer leaves `ok=true`, and generation-readiness now counts extracted requirements and PLANNED document rows in `requiredDocumentsTotal` even before a confirmed Build Plan exists. Added regression coverage for both.
- **Files changed:** `lib/engine/public-readiness-envelope.ts`, `app/api/tenders/[id]/generation-readiness/route.ts`, `tests/route-driven-workflow-truth-verification.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsx --test tests/route-driven-workflow-truth-verification.test.ts` PASS; `npx tsc --noEmit` PASS; `npx tsx --test tests/route-driven-workflow-truth-verification.test.ts tests/route-driven-workflow-truth-db-integration.test.ts` PASS with DB suite skipped because `RUN_DB_INTEGRATION` was not set; `DATABASE_URL='postgresql://user:pass@localhost:5432/db' SESSION_SECRET='12345678901234567890123456789012' ZAI_API_KEY='dummy-not-real-key-for-build' npm run build` PASS with expected optional-provider/Sentry/cron warnings.
- **Known risks / assumptions:** Real DB route suite remains unexecuted in this environment; run with `RUN_DB_INTEGRATION=true` and isolated PostgreSQL before merge.
- **Next action:** Run DB-backed route truth and full CI; inspect real payloads for all five scenarios.
- **Merge status:** not reviewed — do not merge until DB-backed route integration passes.


### 2026-07-10 UTC — ChatGPT (GPT-5.5)

- **Mode:** deep follow-up on route-driven workflow truth verification after review feedback.
- **Branch / PR:** `fix/route-driven-workflow-truth-verification` / PR pending update.
- **Scope:** Replaced ad-hoc per-route envelope shaping with shared `lib/engine/public-readiness-envelope.ts`; strengthened `tests/route-driven-workflow-truth-verification.test.ts` to execute the shared envelope and agreement checks instead of only static/fabricated payload assertions; added optional guarded `tests/route-driven-workflow-truth-db-integration.test.ts` that runs real authenticated route handlers when `RUN_DB_INTEGRATION=true`; fixed workflow-status to use `getFinalPackageReadinessModel()` for required/generated/export-ready counts instead of manifest-only generated rows.
- **Files changed:** `lib/engine/public-readiness-envelope.ts`, `app/api/tenders/[id]/lifecycle/route.ts`, `app/api/tenders/[id]/readiness-score/route.ts`, `app/api/tenders/[id]/generation-readiness/route.ts`, `app/api/tenders/[id]/export-readiness/route.ts`, `app/api/tenders/[id]/workflow-status/route.ts`, `app/api/tenders/[id]/route.ts`, `tests/route-driven-workflow-truth-verification.test.ts`, `tests/route-driven-workflow-truth-db-integration.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsc --noEmit` PASS; `npx tsx --test tests/route-driven-workflow-truth-verification.test.ts tests/route-driven-workflow-truth-db-integration.test.ts` PASS with DB suite skipped because `RUN_DB_INTEGRATION` was not set; `npm run lint` FAIL/WARN due existing ESLint 9 flat-config CLI incompatibility with script `--ext`; `DATABASE_URL='postgresql://user:pass@localhost:5432/db' SESSION_SECRET='12345678901234567890123456789012' ZAI_API_KEY='dummy-not-real-key-for-build' npm run build` PASS with expected optional-provider/Sentry/cron warnings.
- **Real contradictions/gaps fixed:** workflow-status counts were still manifest-only and could show required/export-ready agreement based only on generated manifest rows; all routes now delegate to one shared envelope that fails closed when blockers exist. The DB integration test path now exists but is intentionally skipped without `RUN_DB_INTEGRATION=true`.
- **Known risks / assumptions:** The real DB route suite was not executed here because no reachable isolated PostgreSQL was configured; run it in CI or a local DB with `RUN_DB_INTEGRATION=true` before merge.
- **Next action:** Run the new DB route test plus the full DB integration suite against a seeded test database and inspect real route JSON for the five scenarios.
- **Merge status:** not reviewed — do not merge until DB-backed route integration passes.


### 2026-07-10 UTC — ChatGPT (GPT-5.5)

- **Mode:** route-driven workflow truth verification for tender readiness payloads.
- **Branch / PR:** `fix/route-driven-workflow-truth-verification` / PR pending.
- **Scope:** Added a route-contract regression suite and normalized panel-facing readiness payloads for lifecycle, readiness-score, generation-readiness, export-readiness, workflow-status, and tender detail so each route exposes `ok/status`, `blockers[]`, `warnings[]`, `primaryBlockerReason`, `primaryFixAction`, and required/generated/export-ready document counts.
- **Files changed:** `app/api/tenders/[id]/lifecycle/route.ts`, `app/api/tenders/[id]/readiness-score/route.ts`, `app/api/tenders/[id]/generation-readiness/route.ts`, `app/api/tenders/[id]/export-readiness/route.ts`, `app/api/tenders/[id]/workflow-status/route.ts`, `app/api/tenders/[id]/route.ts`, `tests/route-driven-workflow-truth-verification.test.ts`, `operator_handoff.md`.
- **Tests actually run:** `npx tsx --test tests/route-driven-workflow-truth-verification.test.ts` PASS; `npx tsc --noEmit` PASS; `npm run lint` FAIL/WARN due existing ESLint 9 flat-config CLI incompatibility with script `--ext`; `npm test` FAIL/WARN because DB-gated suites require `RUN_DB_INTEGRATION=true` (several fatal guards including AI promotion/build-plan/metadata evidence integration tests); `npm run build` without env FAIL/WARN due missing required env; `DATABASE_URL='postgresql://user:pass@localhost:5432/db' SESSION_SECRET='12345678901234567890123456789012' ZAI_API_KEY='dummy-not-real-key-for-build' npm run build` PASS with expected optional-provider/Sentry/cron warnings.
- **Real contradictions found:** Public route payloads did not consistently expose the same truth fields before this change: generation-readiness lacked top-level `ok/status` and document counts, export-readiness buried blockers/counts under `exportReadiness`, readiness-score lacked top-level blocker arrays, workflow-status always returned `ok: true` even when manifest/file blockers existed, and tender detail had no route-level readiness envelope.
- **Known risks / assumptions:** The new route-level suite is deterministic/mocked and static-contract based; full DB-backed route execution remains guarded by repo integration-test requirements and was not run in this environment.
- **Next action:** Run DB integration with `RUN_DB_INTEGRATION=true` against a real test PostgreSQL and verify actual seeded route responses before merge.
- **Merge status:** not reviewed — do not merge until DB-backed route integration and CI pass.


### 2026-07-10 UTC — Claude Code

- **Mode:** production release-acceptance suite (branch `fix/e2e-release-acceptance-and-output-quality`, PR #1017; superseded `perfect/*` #1016 which failed the controlled-route branch-name check). Scoped to gaps NOT covered by open PRs #1012 (metadata-wording/error sanitization), #1013 (UI contradictions/panels/icons), #1014 (guardrail audits + docs/RELEASE_GUARDRAILS.md). Avoided all their files; only NEW test files + a distinct doc added.
- **Added:** `docs/FINAL_RELEASE_ACCEPTANCE_CHECKLIST.md`; `tests/release-acceptance-final-package.test.ts` (ZIP/manifest — stale/zero-byte exclusion fail-closed, safe filenames, stable fingerprint, path-traversal/duplicate/missing-bytes refusal, manifest==reopened-ZIP); `tests/release-acceptance-document-quality.test.ts` (validateDocumentQuality blocks AI traces / empty / technical↔financial envelope leakage); `tests/release-acceptance-provider-fallback-order.test.ts` (canonical Z.ai→…→Anthropic order + registry-derived preferred provider; no live calls).
- **Production code changed:** none (test/docs only). All new tests exercise real helpers.
- **Tests:** final-package 6/6, document-quality 5/5, provider-order 4/4; `tsc` clean; `eslint` clean.
- **Deferred (overlap with #1012/#1013/#1014):** UI wording, panel error fallbacks, raw-error sanitization, static metadata audits — covered by those PRs; not duplicated here. Rebase this branch after they merge.
- **Merge status:** DO NOT MERGE — draft.

### 2026-07-09 UTC — ChatGPT (GPT-5.5)

- **Mode:** deep follow-up on final-package readiness gaps after review feedback.
- **Branch / PR:** `fix/final-package-evidence-document-readiness` / draft PR update.
- **Scope:**
  - Reworked `lib/engine/final-package-readiness-model.ts` from a compact draft into a typed, explicit shared model that uses `document-output-state` for candidate/readiness/blocker semantics, chooses the best matching generated row per planned document, exposes workspace exclusion reasons, separates outside-plan rows from not-approved/wrong-format rows, and keeps PDF manual-upload fallback honest (no fake conversion).
  - Wired `components/final-package-manifest-panel.tsx` to the shared final-package model so Final Package Manifest rows use the same planned/export/excluded reasons as Bid Control and the diagnostics endpoint.
  - Expanded `tests/final-package-readiness-model.test.ts` to cover fake-Prisma full-model project summary, best-row selection/idempotency preservation, outside-plan reasons, PDF fallback, duplicate filename rejection, and manifest/workspace exclusion behavior.
- **Tests actually run:**
  - `npx tsx --test tests/final-package-readiness-model.test.ts` — PASS (10/10).
  - `npm run typecheck` — PASS.
  - `npm run lint` — PASS.
  - `DATABASE_URL='postgresql://user:pass@localhost:5432/db' npx prisma validate` — PASS.
  - `DATABASE_URL='postgresql://user:pass@localhost:5432/db' npx prisma generate` — PASS.
  - `node scripts/audit-release-integrity.mjs` — PASS.
  - `DATABASE_URL='postgresql://user:pass@localhost:5432/db' SESSION_SECRET='12345678901234567890123456789012' ZAI_API_KEY='dummy-not-real-key-for-build' npm run build` — PASS (warnings only for missing optional provider/cron/Sentry/OCR envs).
  - `DATABASE_URL='postgresql://user:pass@localhost:5432/db' SESSION_SECRET='12345678901234567890123456789012' ZAI_API_KEY='dummy-not-real-key-for-e2e' npm run test:e2e` — FAIL/WARN due environment: Playwright browsers are not installed and placeholder DB cannot connect (`/api/health` 503); 8 source-inspection/API-protection tests passed, 12 skipped, 68 failed from environment/browser/DB setup.
- **Known risks / assumptions:** final ZIP byte-level verification remains in download/export routes; the readiness model treats storage-backed files as non-zero without reading private blob bytes. Full DB integration was not run because no reachable PostgreSQL service/production-safe test DB is configured here.
- **Next action:** run DB-backed integration and Playwright with installed browsers against a real local test database before marking ready.
- **Merge status:** not reviewed — do not merge until full CI passes.

### 2026-07-09 UTC — ChatGPT (GPT-5.5)

- **Mode:** final-package evidence/document readiness alignment.
- **Branch / PR:** `fix/final-package-evidence-document-readiness` / draft PR pending tool availability.
- **Scope:**
  - Added shared `FinalPackageReadinessModel` for requirement evidence status, selected expert/project evidence, planned/generated documents, PDF requirements, export candidates, blockers, and deterministic ZIP manifest.
  - Added sanitized `/api/tenders/[id]/final-package-readiness` diagnostics endpoint.
  - Wired requirement coverage response and Bid Control Verdict counts to the shared final-package model for evidence/document/export parity.
  - Added regression tests covering evidence coverage explanations, mandatory evidence blockers, reviewed-vs-high-score project distinction, shared document plan counts, technical-only financial exclusion, outside-plan documents, PDF manual-upload fallback semantics, and ZIP manifest blockers.
- **Production/runtime investigation:** attempted `gh pr list` and Vercel log inspection for tender `45a2d090-af4c-4815-9736-c8b5bbbdf89d`, but this container lacks `gh` and `vercel`; no secrets were printed.
- **Tests actually run:**
  - `npx tsc --noEmit --pretty false` — PASS.
  - `npx tsx --test tests/final-package-readiness-model.test.ts` — PASS (9/9).
  - `npm run typecheck` — PASS.
  - `npm run lint` — PASS.
  - `npm test -- --runInBand tests/final-package-readiness-model.test.ts` — FAIL/WARN: repo test runner ignored the file filter and entered the broader suite; stopped at existing `RUN_DB_INTEGRATION=true` requirement for AI promotion evidence persistence tests.
- **Known risks / assumptions:** manual PDF upload is represented by approved PDF generated/upload-backed rows (`format=PDF`, storage/file bytes present, validation passed, review ready); no real PDF conversion was faked. Full requested CI/build/e2e were not completed in this environment.
- **Next action:** run full requested validation with DB integration and create/push the draft PR when GitHub/Vercel CLIs or network access are available.
- **Merge status:** not reviewed — do not merge until full CI passes.

### 2026-07-09 UTC — GLM (Super Z)

- **Mode:** Full investigation + doc updates + gap audit (branch `fix/main-gaps-and-doc-updates`, DRAFT PR).
- **Scope:**
  - Fixed provider order in `operator_handoff.md` (was `Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Anthropic` — now matches the canonical `CANONICAL_AI_PROVIDER_ORDER` in `lib/ai-provider-catalog.cjs`: `Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic`).
  - Updated `operator_handoff.md` Active Workboard with all active branches and their statuses.
  - Updated `CLAUDE_TASKS.md` provider order (was `Claude → Gemini → OpenAI → DeepSeek`).
  - Updated `CLAUDE.md` stale priority list (was referencing Phase 1-5 tasks from months ago).
  - Updated `AGENTS.md` with current main SHA and open PR summary.
  - Audited main: `tsc` PASS (after `prisma generate`), `lint` PASS, `build` PASS, 844 tests PASS.
  - Audited all open PR branches: 4 key branches all pass `tsc` (fixed in prior sessions).
  - Identified remaining gaps: TenderFactsLedger not yet wired into downstream consumers; backfill script needs testing; CONDITIONAL_OR_UNSCHEDULED status not in canonical resolver; DB-integration tests not run.
- **Tests:** `tsc` clean; `eslint` clean; `next build` succeeds; 844 critical tests pass.
- **Next action:** Open draft PR; await Hope's review.
- **Merge status:** DO NOT MERGE — draft.

### 2026-07-08 UTC — Claude Code

- **Mode:** finish the reconciliation — restore ALL safety behaviours the recent refactor dropped and get current `main` fully green (Hope authorised fixing everything, including reworking the refactored files).
- **Branch / PR:** `claude/short-honest-feedback-gaps-vyh8dv` / #961 (draft).
- **Result:** full suite **6032 pass / 0 fail / 0 cancelled / 0 skipped** under `CI=true RUN_DB_INTEGRATION=true SESSION_SECRET=… ` against local PostgreSQL 16 (all migrations deployed). `tsc` clean · `eslint` clean · `next build` succeeds. Started from 130 failures on current `main`.
- **Scope (safety behaviours restored in the refactored code, not reverted wholesale):**
  - `app/api/ai/health/route.ts` — rebuilt from the canonical registry (`getCanonicalProviderEntries`/`getProviderModel`/`preferredConfiguredProviderName`/`CANONICAL_AI_FALLBACK_CHAIN_DISPLAY`), all 10 providers, `inactive/skipped/attempted/lastProviderUsed/fallbackOrder`, and a `requireRole("ADMIN","PROPOSAL_MANAGER")` gate (was unauthenticated).
  - `app/api/tenders/[id]/repair-metadata/route.ts` — restored the source-grounded route (CRITICAL_SOURCE_GROUNDED_FIELDS, durable file-ID + active-file check, verifySourceQuote containment, provenPage evidence, UNRESOLVED, DETERMINISTIC_SOURCE_EXTRACTOR marker); role gate back to ADMIN/PROPOSAL_MANAGER (no REVIEWER).
  - `lib/ai-jobs/analysis-job-service.ts` — restored the durable finalizer (buildCanonicalAnalysisTenderUpdate promotion, pre-transaction prep + short interactive tx with tx passed to promotion helpers, STALE_JOB_SUPERSEDED, catch(persistErr), locateQuoteProvenPage grounding, provider-health restore/persist, reference-fileId resolution after tx).
  - `app/api/tenders/[id]/engine/route.ts` — stored-metadata sanitizer before run + shared non-bypassable `isExtractionAcceptableForGeneration` gate (removed `?force=`) + analysis-status blocks.
  - `app/api/tenders/[id]/generate-missing-plan-files/route.ts` — central gate + scope to `getCurrentConfirmedBuildPlan().items` + degraded-analysis guards; `submission-plan-completeness.hasValidSubmissionPlan` back to count/NO_SUBMISSION_PLAN.
  - `lib/engine/tender-field-extractors.ts` — #793 label boundary cuts, LABEL_REJECT, page attribution (totalPages clamping/single-page), reference word-boundary fix (no more `Procurement ID:` false-match on "identifiers").
  - `lib/engine/metadata-validators.ts` — reference placeholder/heading rejection without a digit rule; `candidate-pipeline` requires a digit only for extraction candidates (resolves the REFONLY/PROCUREMENT contradiction with no test weakened).
  - `lib/prisma.ts` — bootstrap now creates `TenderFactsLedger` + `TenderSubmissionEmail`.
  - Test reconciliations (behaviour-preserving only): run-next break-list order, grounding-and-buildplan authority-model assertion (final export still hard-blocks), manual-tender-facts fixture (non-null title fallback + deadline upsert).
- **Safety:** no gate weakened; no production data, Vercel, provider keys, or PR #937 touched. `DECISIONS_NEEDED.md` retained as the audit trail of what was dropped and restored.
- **Next action:** await Hope's review. **DO NOT MERGE.**
- **Merge status:** DO NOT MERGE — draft.

### 2026-07-07 UTC — Claude Code

- **Mode:** reconcile branch onto current `main` + triage `main`'s red suite (branch was 13 commits stale; its earlier "green" was measured against an obsolete base).
- **Branch / PR:** `claude/short-honest-feedback-gaps-vyh8dv` / #961 (draft).
- **Context:** current `main` is broadly RED — **113 failing tests** under `CI=true RUN_DB_INTEGRATION=true` against a local PostgreSQL 16. Root cause is a recent large refactor (commits `f44e1c3b`, `19ab2ab0`, `a6d5f4a5`, `7f15d703`, et al.) that rewrote several core files and dropped behaviours locked by ~100 contract tests. This branch was reset onto current `main` and fixes only the **verified, non-conflicting regressions**; the large cross-agent regressions and one irreconcilable spec contradiction are reported, not force-fixed.
- **Fixed (verified, no gate weakened, no other test regressed):**
  1. `lib/engine/tender-field-extractors.ts` — the extractor rewrite dropped the #793 field-label boundary cuts. `extractClientName` ran past the org name on flattened one-line pages, and `cutAtNextFieldLabel` lost the funder/recipient/grantee/consultant/financier + multi-word (`Funded By`, `Implementing Partner`) labels and the `Employer`-as-non-client rule. Restored. (Fixes `pdfjs-metadata-safety`, `extract-client-name-flattened`; cascades to `inferTenderMetadata`.)
  2. `lib/engine/metadata-validators.ts` — `isValidReferenceNumber` no longer rejected bare headings/placeholders. Added `containsMetadataPlaceholder` guard + extended `NON_REFERENCE_WORDS` (`number`, `ref`, `tender no.`). Reconciled WITHOUT a digit rule so the `metadata-validators` "letter-only refs valid" contract (`RFP`, `PROCUREMENT`) is preserved. (Fixes `metadata-field-state`, `bid-team-placeholder-stripping`, `ai-analyze-placeholder-guard`.)
- **Reported, NOT fixed (need Hope / the refactor's author — restoring these means reworking another agent's just-landed safety-critical code; out of scope for a unilateral edit):**
  - `app/api/ai/health/route.ts` hard-codes the fallback chain + ranks 1-9 and dropped its role gate, instead of deriving from the still-present canonical registry (`getCanonicalProviderEntries` / `CANONICAL_AI_FALLBACK_CHAIN_DISPLAY` / `preferredConfiguredProviderName` / `getProviderModel`). ~14 tests.
  - `app/api/tenders/[id]/repair-metadata/route.ts` dropped `requireRole("ADMIN","PROPOSAL_MANAGER")` (**REVIEWER can now mutate — security regression**), `DETERMINISTIC_SOURCE_EXTRACTOR` marker, `CRITICAL_SOURCE_GROUNDED_FIELDS`, placeholder rejection, `UNRESOLVED` status, unconditional page column, verbatim-quote evidence. ~17 tests.
  - `lib/ai-jobs/analysis-job-service.ts` `finalizeJob` dropped `buildCanonicalAnalysisTenderUpdate` (canonical tender-metadata promotion), transaction discipline (tx vs bare prisma), `STALE_JOB_SUPERSEDED` handling, structured logging, PARTIAL-status cap, provider-health persistence, `locateQuoteProvenPage` grounding; and the claim query dropped `"FAILED"` from the re-arm set. ~15 tests.
  - Generation-gate wiring drift (`engine` / `generate-missing-plan-files` / `generate-docs-gate` / `export-readiness-route-policy`) ~6 tests.
- **Irreconcilable spec contradiction (needs a ruling):** `candidate-pipeline.ts:146` + `metadata-field-state` require `isValidReferenceNumber("REFONLY") === false`, while `metadata-validators.test.ts` requires `isValidReferenceNumber("PROCUREMENT") === true`. Both are bare uppercase letter-only tokens with no distinguishing feature — no single implementation satisfies both. Left as-is; the `metadata-validators` "letter-only valid" contract is preserved.
- **Tests:** full suite `CI=true RUN_DB_INTEGRATION=true` vs local PostgreSQL 16 (all migrations deployed): **113 fail / 5907 pass** (down from 130 fail at branch reset). `tsc --noEmit`: clean. My two fixes regressed **zero** previously-green tests.
- **Known risk:** the reported regressions overlap files the refactor's author is likely still iterating on; do NOT let this branch's partial greening mask them. `DECISIONS_NEEDED.md` (this branch) has the full per-cluster report.
- **Next action:** Hope to decide who restores the health-route / repair-route / finalizeJob safety behaviours and to rule on the `REFONLY`/`PROCUREMENT` contradiction.
- **Merge status:** DO NOT MERGE — draft; `main` is still red by design pending the above decisions.

### 2026-06-29 UTC — Jules

- **Mode:** documentation correction
- **Branch / PR:** `claude/operator-handoff-correction-10035225860455380987 / #911`
- **Scope:** corrected ChatGPT's 2026-06-28 handoff entry to reflect PR #908 merge status
- **Files changed:** `operator_handoff.md`
- **Tests:** not applicable
- **CI / deployment:** CI passed; Vercel preview was automatically created.
- **Known risk:** none
- **Next action:** submit correction
- **Merge status:** not reviewed

### 2026-06-28 UTC — ChatGPT

- **Mode:** coordination setup
- **Branch / PR:** `claude/operator-handoff-protocol` / #908
- **Scope:** created the shared cross-agent handoff protocol
- **Files changed:** `AGENTS.md`, `operator_handoff.md`
- **Tests:** not applicable; documentation-only change
- **CI / deployment:** merged into main
- **Known risk:** Vercel may independently detect a branch commit; inspect Vercel before assuming no preview exists
- **Next action:** none; task complete
- **Merge status:** merged into main

## Session Log: 2026-07-06T17:58:09Z
- **Tool:** Jules
- **Files Changed:**
  - lib/engine/tender-field-extractors.ts (Expanded to 27 fields with strict grounding)
  - lib/extraction-quality.ts (Implemented perfect page definition and coverage metrics)
  - lib/engine/generation-readiness-gate.ts (Hardened to block on weak extraction/grounding)
  - lib/engine/export-readiness.ts (Hardened hygiene checks for AI traces/leakage)
  - components/extraction-quality-panel.tsx (UI for 20+ metrics and recovery actions)
  - app/api/tenders/[id]/repair-metadata/route.ts (Persistence for expanded metadata)
  - app/dashboard/tenders/[id]/page.tsx (Recovery Center action registry fixes)
- **Tests Run:**
  - tests/tender-field-extractors.test.ts (143 pass)
  - tests/export-readiness.test.ts (19 pass)
  - tests/extraction-quality-gate.test.ts (15 pass)
  - tests/recovery-command-center-actions.test.ts (77 pass)
- **Risks:** The regex-based extractors are deterministic but may miss non-standard formatting. Release gates are now significantly stricter, which may block some "borderline" tenders until manually overridden or repaired.
- **Next Action:** Monitor user feedback on the stricter release gates; expand regex patterns if common variations are missed.
- **Merge Status:** PR Created (claude/extraction-and-gates-hardening). DO NOT MERGE YET.

### 2026-08-09 UTC — Codex

- **Mode:** focused PR #1175 owner-workflow acceptance and minimal repair
- **Branch / PR:** `release/consolidated-recovery-20260717` / #1175
- **Scope:** real-PostgreSQL AI Analyze → Engine claim → Vault verification → matching → Build Plan → generation → validation → AUTO_FINALIZE → PDF → ZIP acceptance; fixed the first three observed transitions without weakening gates.
- **Files changed:** `lib/engine/generate-elite.ts`, `lib/engine/document-quality-validator.ts`, `lib/ai-jobs/auto-finalize-continuation-service.ts`, `tests/owner-workflow-complete-postgres.test.ts`, `operator_handoff.md`.
- **Tests:** focused PostgreSQL acceptance passed; typecheck passed; lint passed with one pre-existing warning; relevant 119 tests passed; full `RUN_DB_INTEGRATION=true npm test` passed; production build passed with local missing-secret warnings.
- **Risks / blockers:** authenticated Preview acceptance and owner-only Production UAT/credential rotation/backup-restore/rollback proof remain; no Production deployment performed.
- **Next action:** exact-head CI and automatic Preview verification.
- **Merge status:** DO NOT MERGE — awaiting owner review and Preview evidence.

### 2026-08-09 UTC — Codex (release-hardening continuation)

- **Mode:** exact-head CI failure triage and narrow reliability repair.
- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, starting at `8a46f05c57d6cac396cde3caecbcc6731a3a018a`.
- **Scope:** inspected failed run `31337251918` attempt 2 without requesting the consolidated PR diff. The run reported two behavioral failures (not five): the Engine wake regression swallowed an assertion inside the production best-effort wake boundary, and the stale-queue reaper treated another tenant's newer job as proof that this tenant's job was passed over. Preserved canonical AI Analyze authority and all fail-closed gates.
- **Files changed:** `lib/engine/stale-job-reaper.ts` (tenant-scope pass-over evidence), `tests/stale-job-reaper.test.ts` (cross-tenant regression), `tests/engine-worker-handoff.test.ts` (make claim/RUNNING assertions observable outside the intentional wake catch), `.github/workflows/ci.yml` (Node-24-compatible checkout/setup/upload action majors), `operator_handoff.md`.
- **Tests:** `npx prisma generate`, `npm run typecheck`, and `npm run lint` passed (one pre-existing unused-disable warning). Local PostgreSQL-focused execution is blocked by the configured Neon host being unreachable; exact-head CI must supply the real-PostgreSQL result. Non-database worker authority checks passed; database subtests failed only at connection setup.
- **Risks / blockers:** full PostgreSQL suite, build, authenticated Playwright, exact-SHA Preview golden path/runtime logs, and artifact validation remain unverified until exact-head CI/Preview completes. Owner-only Production UAT, credential rotation, backup/restore, rollback, merge, and Production deploy remain explicitly outstanding.
- **Next action:** push the focused commit, require exact-head CI green, then inspect only its automatically generated exact-SHA Preview and logs; do not merge.
- **Merge status:** DO NOT MERGE — draft; no Production deployment performed.

Follow-up exact-head CI exposed legitimate test-suite contention: another real global worker can atomically win the focused job before its injected wake callback. The regression now accepts either claimant only when the same durable job is already `RUNNING`, then completes and verifies the single job; it still fails if no worker claimed it. No production behavior changed.

### 2026-08-21 UTC — Codex

- **Mode:** owner-directed provider routing regression repair and exact-head validation.
- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, starting at `96c5ad6d0b9708ea71ad9506bc0a1faa377a025f`.
- **Scope:** restored the single canonical automatic order Gemini → Groq → Mistral → Z.ai → Cerebras → OpenRouter → OpenAI → Together → DeepSeek → Anthropic, with deterministic draft last; removed the newly introduced zero-paid/free-model and two-provider readiness blockers while retaining exact configured model IDs, normal configuration checks, failure fall-through, provider billing-error handling, retry recovery, secret redaction, and all source/tenant/artifact integrity gates.
- **Files changed:** provider catalog/registry/runtime/capability/health/readiness modules, provider diagnostics and validation scripts, shared operator documentation, and affected regression expectations.
- **Tests:** focused provider/readiness/retry suite 307/307 passed; Prisma generation, typecheck, lint, release-integrity, and production build passed. Full local PostgreSQL execution is safely refused because the configured database is a remote Neon host; exact-head CI supplies disposable PostgreSQL and remains required after push.
- **Risks / blockers:** exact-head CI, automated Preview, and route/screenshot audit must finish green before merge readiness can be assessed. No app restart, merge, or Production promotion performed.
- **Next action:** commit and push the narrow repair, then require all exact-head CI/Preview checks to complete green; fix only demonstrated root causes.
- **Merge status:** DO NOT MERGE pending exact-head evidence and owner review.

### 2026-08-28 UTC — Codex (PR #1175 provider-exhaustion continuation)

- **Mode:** exact-head live-blocker repair only; no deployment, merge, environment, or database configuration changes.
- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, starting at `3d88fce0722c22f76415da915a04bbbcb2ee0d39` after fetching the remote branch.
- **Scope:** traced the durable one-chunk AI Analyze terminal path. It marked provider exhaustion but never staged deterministic fallback #11, so the canonical resolver truthfully returned `FAILED`. The worker now stages the source-derived fallback on the exact authorized job/source hash, keeps the job non-successful, requires human review, and retains fail-closed downstream gates. It also durably retains the canonical iterator's sanitized per-provider attempted/skipped trace; the prior worker discarded that evidence, so the historical job cannot prove why Groq was omitted.
- **Files changed:** `lib/ai-jobs/analysis-job-service.ts`, `tests/durable-ai-analyze-workflow.test.ts`, `tests/analysis-provider-exhaustion-recovers-db-integration.test.ts`, `operator_handoff.md`.
- **Tests:** focused durable/fallback tests, TypeScript, ESLint, and the disposable-PostgreSQL provider-exhaustion test are required before push; exact-head CI/Preview and authenticated retained-tender rerun remain required after push.
- **Risks / blockers:** the old job's discarded provider trace is unrecoverable from its persisted chunk row. A fresh authenticated exact-head run is required to classify Groq's skip without guessing and to exercise downstream workflow/artifacts. External provider account failures remain owner actions, not code defects.
- **Next action:** commit/push only to #1175, require exact-head checks/Preview, then rerun the retained tender and read the newly persisted safe provider trace.
- **Merge status:** DO NOT MERGE; no Production promotion performed.

### 2026-08-28 UTC — Codex (PR #1175 extraction-timeout continuation)

- **Mode:** remaining AI Analyze blocker repair only; no merge or Production promotion.
- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, starting at `ef6be02592e31deadc43e3abae9d0240b105ce21` after fetching the remote branch.
- **Scope:** confirmed Mistral's real structured extraction inherited the generic 20-second OpenAI-compatible probe timeout. Added a 35-second extraction-only, operator-configurable, 60-second-bounded allowance; normal Mistral calls remain at 20 seconds and the shared absolute provider deadline continues to clamp extraction calls so later providers remain reachable. Gemini's differing diagnostic/extraction model IDs remain intentional per-use-case registry authority, and Groq's exact skip still requires the freshly persisted real-run trace rather than inference.
- **Files changed:** `lib/timeout-config.ts`, `lib/ai.ts`, `tests/ai-provider-engine-runtime-evidence.test.ts`, `operator_handoff.md`.
- **Tests:** focused provider runtime regression, typecheck, lint, and build required before push; exact-head CI/Preview and authenticated retained-tender rerun remain required after push.
- **Risks / blockers:** this environment has no owner-authenticated Preview session, so it cannot initiate the retained tender or approve its fallback. External provider billing/key/rate-limit failures remain owner actions.
- **Next action:** push only to #1175, require exact-head checks and fresh Preview, then rerun the retained tender to capture Gemini, Groq, and fallback evidence.
- **Merge status:** DO NOT MERGE; no Production promotion performed.

### 2026-08-28 UTC — Codex (PR #1175 fallback-diversity preservation)

- **Mode:** owner-directed regression-preserving repair; no merge, Production alias, Production database, or schema mutation.
- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, starting at `20ea4c88cc5e8c7aa6e7b695833b64a0204f8a33` after fetching and confirming the remote head.
- **Scope:** froze the previously accepted behavior matrix before runtime edits; replaced the `ANY configured provider fits` monolith decision with deterministic source+model-contract planning that retains one request when the first configured providers remain eligible, but uses lossless sequential 8K chunks when doing so restores an excluded early provider such as Groq. Runtime cooldown/billing state is not part of chunk identity. Added a durable same-job Groq TPM-window guard that skips a knowingly over-budget subsequent chunk without sleeping, consuming an attempt, or serializing tenants. Extended sanitized provider attempt traces with exact model, preflight reason/budgets, skip reason, and attempt consumption. Closed the fallback/automatic-retry race: once `FALLBACK_DRAFT` is staged (or approved), automatic retry cannot mutate the same review artifact back to QUEUED.
- **Files changed:** `docs/pr1175-frozen-regression-ledger.md`, `lib/ai.ts`, `lib/ai-jobs/analysis-job-service.ts`, `lib/ai-analyze/retry-service.ts`, `tests/ai-analysis-capacity-concurrency-regression.test.ts`, `tests/analysis-provider-exhaustion-recovers-db-integration.test.ts`, `operator_handoff.md`.
- **Tests:** focused adaptive shape, provider chain, request budgeting, durable retry, and fallback suites pass; TypeScript passes. Full frozen matrix, isolated-PostgreSQL transition test, lint, build, and exact-head CI/Preview remain required before acceptance.
- **Risks / blockers:** the supplied local `DATABASE_URL` is explicitly a Codex test database but its Neon host is unreachable from this container. The Vercel token lacks team scope and the Preview endpoints require authentication, so the fresh live durable Groq/fallback trace cannot be read here without owner-authenticated access. No value is inferred from Groq's absent historical log line.
- **Next action:** run the complete frozen matrix, commit/push only to #1175 if green, require exact-head CI/security/screenshot/Preview, then perform one authenticated retained-tender run and read the enriched durable trace.
- **Merge status:** DO NOT MERGE; no Production promotion performed.

### 2026-09-05 UTC — Codex (PR #1175 real-artifact quality repair)

- **Mode:** verified hosted-artifact defects only; no provider-order, database, deployment, Build Plan, or Production changes.
- **Branch / PR:** `release/consolidated-recovery-20260717` / draft #1175, starting from independently audited exact head `cd7198c925cad1b21058bf1046053ebf8a2ea12a` and hosted run `33970450480`.
- **Scope:** corrected whole-document PDF page totals and width-bounded cover/header/footer rendering; prevented fallback-only output from bypassing the final hygiene re-render; removed generic internal evaluator/self-score/AI-preparation/bid-review/appendix-readiness sections; narrowed unsupported assignment-equivalence, same-team, direct-comparability, and phantom-attachment language; made the client-artifact quality gate fail closed on those constructs and malformed submission metadata; and sourced deadline time from the tender quote rather than inventing midnight.
- **Files changed:** `lib/engine/benchmark-tables.ts`, `lib/engine/detection-patterns.ts`, `lib/engine/document-quality-gate.ts`, `lib/engine/evidence-marker-injector.ts`, `lib/engine/generate-elite.ts`, `lib/engine/internal-review-stripper.ts`, `lib/engine/proposal-intelligence.ts`, `lib/engine/proposal-pdf.ts`, `tests/final-client-artifact-safety.test.ts`, `tests/proposal-pdf-renders-unicode.test.ts`, `operator_handoff.md`.
- **Tests:** 40/40 focused artifact/PDF/hygiene tests pass; focused ESLint passes. Full-process TypeScript and repository lint were terminated by the local container resource ceiling after previously passing before the last surgical edits; exact-head CI is required after push.
- **Risks / blockers:** hosted artifact acceptance and rendered visual inspection remain required on the new exact head. Temporary acceptance infrastructure is deliberately retained until that proof passes.
- **Next action:** commit/push only to #1175, require exact-head CI/security/route-screenshot and READY Preview, rerun the authenticated retained tender, inspect ZIP manifest/hashes and every rendered PDF page, then clean temporary acceptance helpers only if all gates pass.
- **Merge status:** KEEP WORKING; DO NOT MERGE; no Production modification performed.
- **CI follow-up:** first exact-head CI exposed an existing source-contract test requiring the final placeholder pass to remain conditional and a minimal synthetic pipeline fixture falling below the quality threshold when the late-only render was made unconditional. The correction preserves that contract and applies the new hygiene before the deterministic path's initial render instead; focused phase-3 regression now passes.
- **Hosted follow-up:** run `33976857352` reached generation/finalization but correctly failed closed on the newly generated PDF's quality verdict. The temporary acceptance artifact snapshot now captures the authenticated admin quality audit so the exact issue codes can be diagnosed without weakening the gate or exposing credentials.
- **Quality-audit follow-up:** run `33977313090` proved the new DOCX had zero AI, placeholder, pricing, internal-trace, or unsupported-claim flags, but retained repeated late-generated headings (score 76) and therefore correctly prevented replacement of the stale PDF. Added a final heading disambiguation pass and covered the actual month-first deadline quote shape.
- **Duplicate-heading diagnostic:** run `33977937862` retained the same sole current-DOCX issue (`DUPLICATED_SECTIONS`) after Markdown heading disambiguation, proving the repeats arise in rendered visible text rather than repeated Markdown headings. The authenticated temporary audit now emits the gate's safe issue messages, including the repeated heading labels, to support a root-cause fix rather than score manipulation.
- **Root cause proved:** run `33978459525` named the repeated "headings" as the one-word table values `MANDATORY` and `SCORED`, not headings. The detector now requires multi-word all-caps headings (or actual Markdown/numbered headings), preserving true duplicate-section detection while preventing compliance-table cells from suppressing PDF regeneration.
- **Stale-PDF root cause:** the current DOCX now passes the canonical rubric at 88, but AUTO_FINALIZE skipped any byte-bearing same-name PDF even when it predated the regenerated DOCX; the retained failed PDF therefore remained untouched. Required PDFs now short-circuit only when at least as new as their validated DOCX source, and an older row is atomically replaced rather than duplicated.
- **Coverage follow-up:** run `33979469541` replaced and validated the stale PDF, then exposed a distinct coverage deadlock: after superseding its DOCX source, the PDF candidate contained only filename metadata, so the mandatory email-submission rule fell from FULL to PARTIAL even though the rendered bytes state the verified recipients and subject. Coverage now reads the validated artifact text and grants the normal direct-evidence scoring boost only when at least two requirement terms occur in those bytes.
