# Production-Readiness Audit — 2026-07-04

**Scope:** full application audit of `hope-tender-path-b` at branch `hotfix/metadata-repair-crash-and-snapshot-consistency` (PR #936), base `main@cb115d28`.
**Method:** static inspection of every `app/api/**/route.ts` (148 endpoints), `lib/` engine modules, `prisma/schema.prisma` + 30 migrations, `.github/workflows`, `e2e/` Playwright specs, and the 383-file test suite. No deploys, no merges, no schema changes were performed.
**Severity scale:** P0 = release blocker (exploit, data loss, or core-flow break) · P1 = must fix before scale/multi-tenant confidence · P2 = hardening · P3 = cosmetic/debt.

---

## Executive summary

| # | Finding | Severity | Release-blocking |
|---|---------|----------|------------------|
| 1 | PR #936 CI failed: 9 stale gate/plan tests asserted pre-#914 semantics | P0 | YES — **fixed in PR A (this branch)** |
| 2 | AI Analyze + durable worker proved pages from a 20-char quote prefix, used normalized offsets against original text, and fell back to offset 0 (inventing page-1 evidence) | P0 | YES — **fixed in PR A (this branch)** |
| 3 | Deterministic proposal fallback can become export-eligible via auto-finalize (`deterministicFallbackUsed` never set by production callers; fallback markers stripped before AI-trace scan) | P0 | YES — PR D |
| 4 | Proposal sections/single-call/refinement chains deviate from the required provider order and never try Z.ai/Cerebras | P0 | YES — PR D (align to canonical order; do NOT invent a new order) |
| 5 | `validationStatus` vocabulary split: validator writes `"PASSED"`, export gate accepts only `"VALIDATED"/"APPROVED"/"READY_FOR_EXPORT"` → export deadlock through the normal path | P1 | YES — PR D |
| 6 | Cross-tenant mutations: proposal-version delete/restore and controls-suggestion reject not scoped to the acting user; deep-reasoning runs readable cross-user by PROPOSAL_MANAGER | P1 | YES — PR C |
| 7 | `plan-b-import` accepts any authenticated role, no size cap, and mints `trustLevel: "REVIEWED"` records that generation treats as reviewed evidence | P1 | YES — PR C |
| 8 | TenderFile soft-delete lifecycle (ACTIVE/PENDING_DELETE/DELETED) declared in schema but unimplemented; live path hard-deletes storage before DB row | P1 | NO (single-tenant risk accepted) — PR H |
| 9 | Golden-tender workflow e2e never runs in CI (`E2E_GOLDEN_AUTH` unset); no e2e proof of successful export | P1 | YES — PR G |
| 10 | No structured events for generation-blocked / export-blocked / export-succeeded / BuildPlan-invalid / metadata-ungrounded | P1 | NO — PR G |
| 11 | Non-streaming AI-analyze promotion runs outside the canonical-write transaction; repair-metadata audits before the write | P1 | NO — PR D/H |
| 12 | Provider cooldown state not restored/persisted on generation paths (analyze paths only) | P1 | NO — PR H |
| 13 | Concurrent-generation guard filters on `generationStatus` values never written (`GENERATING`/`QUEUED`) — duplicate-document race | P2 | NO — PR D |
| 14 | `deletionStatus: "ACTIVE"` filtering inconsistent across ~15 reader sites (latent once soft-delete ships) | P2 | NO — PR B/H |
| 15 | Free-form String state columns (no enums/CHECKs); `"SUPSERSEDED"` typo already reached production once | P2 | NO — PR H |
| 16 | Missing composite indexes on Tender(userId,status/deadline), AuditLog(userId,createdAt), GeneratedDocument(tenderId,generationStatus); cron deadline-alerts full-table-scans | P3 | NO — PR H |

The **safe-release verdict** and per-PR sequencing live in [remediation-roadmap-2026.md](remediation-roadmap-2026.md). The per-route authorization detail lives in [route-authorization-matrix.md](route-authorization-matrix.md). The generation-quality scoring contract lives in [golden-tender-benchmark-rubric.md](golden-tender-benchmark-rubric.md).

---

## 1. Authentication / session security

- Session helpers in `lib/auth.ts`: `getSession()` (L81), `requireUser()` (L123), `requireRole(...)` (L132); roles `ADMIN, PROPOSAL_MANAGER, REVIEWER, VIEWER`.
- Login rate-limited by IP+email (`AUTH_RATE_LIMIT` 10/min); password reset uses persistent limiter (5/15min) and token flow in `lib/secure-password-reset`.
- **No findings at P0/P1.** Session secret validated at boot (`scripts/check-env.mjs`, `next.config.js:5-34`).

## 2. Role authorization / RBAC

- Mutations overwhelmingly require `ADMIN|PROPOSAL_MANAGER`. Exceptions (any authenticated role can trigger AI spend or mutate company knowledge):
  - `ai-rematch` (route L139), `copilot` (L23), `evaluator-simulation` (L45), `regenerate-cvs` (L26) — **P2**, userId-scoped but VIEWER can burn AI quota.
  - `company/cleanup-support-imports` (L22), `company/knowledge/repair`, `company/reimport`, `company` PUT, experts/projects `batch` PATCH — **P2**, inconsistent with `company/experts` POST which requires ADMIN/PM.
  - `company/plan-b-import` (L366-368) — **P1** (see §15).
- REVIEWER can PATCH document review status and expert/project trust levels — by design.

## 3. Tenant isolation

Single-owner model (`Tender.userId`, `Company.userId` 1:1). 145 of 148 routes scope every Prisma query by `userId` / `tender: { userId }` / `companyId`. Three do not:

1. **P1 — `app/api/tenders/[id]/proposal-versions/[versionId]/route.ts`** — DELETE (L52-54) scopes by tenderId only; POST restore (L77) resolves the tender with **no userId** and can overwrite the live Technical Proposal `GeneratedDocument` (L97-110) of any tender. Comments at L49/L76 admit it.
2. **P1 — `app/api/tenders/[id]/controls/suggestions/reject/route.ts:69-70`** — `findFirst({id, userId}) ?? findFirst({id})` fallback drops the scope; a PM can suppress another tenant's control suggestions.
3. **P1 — `app/api/system/deep-reasoning-runs/route.ts:37-46`** — PM-accessible listing accepts arbitrary `userId`/`tenderId` query filters, never constrained to `actor.id`.

Required test proof: authenticated-as-user-B route tests asserting 404/403 for user A's ids on all three routes (extend `e2e/cross-user-isolation.spec.ts` and add DB route tests).

## 4. File upload and file access control

- Central validator `lib/upload-security.ts`: allowlist `.pdf/.docx/.xlsx/.csv/.txt`, extension→MIME map, PDF/OpenXML magic bytes, zip-bomb caps (2 000 entries / 80 MB), macro/ActiveX rejection, NUL/active-content checks for txt/csv, 10 MB/file, filename sanitization via `basename` + charset filter; storage keys are `randomUUID()`.
- Storage adapter `lib/storage.ts`: Vercel Blob (private) / local dev / db-base64 (5 MiB cap); path-traversal and non-Vercel-URL fetches blocked (L80-99, 223-244).
- Every byte-serving route re-checks ownership before returning content; `Cache-Control: private, no-store`.
- **P1 — `plan-b-import`**: `file.text()` unbounded, no type/magic validation, `getSession()` only, and imports records at `trustLevel:"REVIEWED"` (route L263-266) — fake "reviewed" evidence can flow into proposals.
- **P2 — bulk company-document DELETE** (`app/api/company/documents/route.ts:78-81`) deletes the DB row but never `storage.deleteFile` → orphaned sensitive bytes (single-doc route does it correctly).
- **P3 — `storagePath` returned to clients** in the documents list (route L33).

## 5. Extraction / OCR handling

- `lib/extract-text.ts` supports a strict superset of accepted upload types; images degrade to placeholders; OCR is env-gated (`PDF_OCR_ENABLED`).
- Extraction quality: `assessExtractionQuality` + per-page diagnostics; corrupted extraction is a hard gate block (`EXTRACTION_CORRUPTED`, never overridable); weak extraction requires a recorded `ExtractionQualityOverride`.
- `re-extract-metadata` correctly (a) uses only ACTIVE files (route L126), (b) preserves the stored authoritative `TenderFile.totalPages` and never overwrites it with diagnostic counts (L267-290), (c) clears the full evidence tuple when a scalar changes (L174-201).

## 6. Page provenance and quote containment

- Canonical rules in `lib/engine/page-provenance.ts` (`computeProvenPageNumber`): form feeds and `[Page N]` markers may establish a page; no boundary → page 1 only when `totalPages === 1`; computed page beyond stored totalPages → null.
- `lib/engine/metadata-source-enrichment.ts` builds an exact normalized→original index map (L149-168) — no prefix approximation — and files are ACTIVE-filtered (L221).
- **P0 (FIXED in PR A):** both `guardAiPageNumbers` in the AI Analyze route and the duplicated `guardPage` in the durable worker (`lib/ai-jobs/analysis-job-service.ts:479-487`) proved AI-claimed pages from a **20-char prefix**, searched the **normalized** haystack and passed that index to `computeProvenPageNumber` against the **original** text, and fell back to **offset 0** when the quote was not found — attributing unfound quotes to page 1 in form-feed documents. Fixed by the new fail-closed `locateQuoteProvenPage` (full-quote match, exact offset mapping, null on absence, null on cross-page ambiguity) used by all three analyze paths. Proven by `tests/page-provenance-quote-location.test.ts` (37 tests) incl. duplicate-quote-across-pages → ungrounded and duplicate-prefix cases.
- Remaining **P2**: provenance logic still exists in ~4 shapes (enrichment, field extractors, page-provenance, attribution). PR B consolidates into one shared library with property-style tests (OCR-ish text, repeated phrases, whitespace mutations, `[Page N]`, form feeds, missing boundaries).

## 7. AI Analyze promotion and fallback rules

- Analysis state machine (`lib/engine/analysis-state-resolver.ts`): `canExportWithAnalysisState` returns true **only** for `AI_SUCCEEDED` (L431-433); `REGEX_FALLBACK_UNAPPROVED` and `HUMAN_APPROVED_FALLBACK` are both blocked by the central gate (`generation-readiness-gate.ts:236-243`).
- Durable-worker promotion is transactional (Serializable, supersession re-check — `analysis-job-service.ts:564-605`). Streaming route promotes inside the tx (route L830).
- **P1 — non-streaming path** deletes+recreates requirements in a tx (route L1502-1542) but calls `promoteAnalysisToCanonical` **after commit** (L1555): a crash in between destroys the old requirement set while leaving the job unpromoted (gate then blocks a mutated tender), and a newer run finishing in the window can be stamped stale. Align with the worker's in-tx promotion.
- Chunk integrity, content-hash binding, and auto-resume of PARTIAL/FAILED jobs verified present.

## 8. Provider routing / rate-limit / cooldown

- Canonical order (`lib/ai-provider-catalog.cjs:23-34`): `zai → cerebras → mistral → groq → openrouter → gemini → openai → together → deepseek → anthropic` — matches the required invariant; `generateWithFallback` (`lib/ai.ts:714-866`) iterates it, skipping unconfigured/cooling providers without consuming the 3-attempt budget. Manual selection is disabled (no generation route accepts a provider param; `providerChainForUseCase` ignores its argument).
- **P0 — the default proposal path does NOT use it.** `generateOneSection` (`lib/ai.ts:4052-4177`, `PROPOSAL_GENERATION_MODE=parallel`) runs Gemini→OpenAI→Mistral→Together→DeepSeek→Groq→OpenRouter→Anthropic; `generateBenchmarkProposalWithAI` (L3869-3965) same family; `refineProposalWithAI` (L3045-3086) OpenAI-first. Z.ai and Cerebras (ranks 1-2) are never tried: an operator configured only with the top-rank keys silently gets the deterministic fallback for every proposal. Fix = route these chains through the canonical chain (this **preserves**, not changes, the required order).
- **P1 — cooldown persistence** (`ProviderHealthSnapshot` restore/persist) is wired into analyze/job paths only; `/generate`, `/ai-proposal`, `regenerate-section`, auto-finalize hold cooldowns in memory that vanish on cold start.
- **P2 —** registry `timeoutMs` is dead config for 7/10 providers; module-load-cached `GEMINI_API_KEY` in `lib/ai.ts:9` gates legacy chains; stale chain docs in `lib/env-check.ts:8-14` contradict the catalog.
- Secrets: health store and resolver redact key material; no key found flowing into responses or logs.

## 9. Deterministic fallback must never be export-eligible

- Analysis-level: enforced (states + gate; regex-fallback markers written to notes with anchored regexes).
- **P0 — proposal-level hole:** `evaluateSevenPassGenerationGate` supports `deterministicFallbackUsed` (blocks final approval — `seven-pass-generation.ts:110,157,167`) but **no production caller sets it** (only tests). `generate-elite.ts:1773-1780` marks a deterministic proposal only via a prose string in `contentSummary`; auto-finalize (`auto-finalize/route.ts:370-397`) then marks such documents `VALIDATED` + `READY_FOR_EXPORT`, and its `cleanLine` strips the words "deterministic fallback"/"benchmark" from visible text before the AI-trace scan. Failure path: all providers down at generate time → deterministic doc → auto-finalize → export-eligible. Fix in PR D: machine-readable provenance flag on GeneratedDocument + wire `deterministicFallbackUsed` + gate test.
- **P2 —** partial-section deterministic stitching (`lib/ai.ts:4239-4247`) labels the document with the last AI provider (L4290-4305) with no per-section fallback provenance.

## 10. BuildPlan confirmation and export authorization

- Central fail-closed gate `lib/engine/generation-readiness-gate.ts` — pure decision + DB assembly; `hasCurrentConfirmedBuildPlan !== true` blocks all release actions; `confirmedBuildPlanItemsValid !== true` blocks (runtime re-validation of items); export/final-zip additionally require confirmed-plan document reconciliation and `exportReadyDocumentCount ≥ 1`.
- BuildPlan confirm is transactional with optimistic concurrency + P2034 retry (`build-plan/confirm/route.ts:33-80`). Hash binding uses the single shared `computeTenderBuildPlanHash`.
- **P1 — vocabulary split:** `lib/engine/validate.ts:219-220` writes `validationStatus="PASSED"`, but the gate (`generation-readiness-gate.ts:634`) and `validateConfirmedPlanDocuments` (`build-plan.ts:642`) accept only `["VALIDATED","APPROVED","READY_FOR_EXPORT"]`. Documents validated through the normal path never count as export-ready; only repair side-doors write `"VALIDATED"`. Unify the vocabulary (and add the enum/CHECK from §19).
- **P2 —** concurrent-generation guard (`generate/route.ts:908,1028`) filters on `GENERATING/QUEUED` which are never written → duplicate-row race under parallel POSTs.

## 11. Document generation and ZIP reconciliation

- ZIP path re-verifies: ownership, readiness gate, canonical final-submission readiness, authority review, per-file magic-byte signatures, duplicate-name guard, 50 MB cap (`download/route.ts`). ExportPackage stores a `fileList` manifest (no bytes); no unauthenticated package download exists.
- **P1 —** export route splits the package tx (`export/route.ts:212-220`) from `tender.update {status:"EXPORTED"}` (L222-225) and the audit (L227) → crash leaves a READY package with pre-export tender status and no audit.
- **P2 —** no content-hash manifest per exported file (roadmap PR F adds hashes).

## 12. DOCX/PDF formatting quality

- DOCX built via `docx` lib; magic-byte validation at export; no pixel tests. No snapshot tests of document structure exist — PR F adds structure snapshots (headings order, section presence, no `[INSERT]`/`TODO`/AI-trace strings) and a package manifest with SHA-256 hashes.

## 13. Evidence-backed proposal quality / compliance matrix / pricing separation

- Seven-pass generation gate + requirement grounding + compliance matrix builder exist and are gate-enforced; pricing is a separate workbook model (`PricingWorkbook`/`CostLine`) with role-gated PUT.
- No automated quality benchmark exists. PR E adds the golden-tender harness scored by [golden-tender-benchmark-rubric.md](golden-tender-benchmark-rubric.md) with hard fail thresholds (coverage < 95 %, unsupported claims > 0, missing sections > 0, wrong names > 0, AI traces > 0, package mismatch > 0) writing `test-results/proposal-quality-report.json`.

## 14. Company knowledge vault quality and review gates

- Trust levels (`AI_DRAFT`/`REVIEWED`) gate what generation may cite (only `trustLevel === "REVIEWED"` projects/experts flow into generation — `generate/route.ts:180`).
- **P1 —** `plan-b-import` mints `REVIEWED` records without review (see §4/§15). Reviewer PATCH endpoints for experts/projects are correctly role-gated.

## 15. Expert/project matching accuracy

- Multi-perspective matcher + semantic aligner with rematch endpoints; matching-diagnostics/quality routes exist. **P2 —** matching reads files without `deletionStatus` filter (`engine/route.ts:54-59`) — latent until soft-delete ships.

## 16. Generated-document versioning

- `ProposalVersion` rows with diff/restore/delete endpoints. **P1 —** restore/delete not user-scoped (§3). Restore overwrites the live document — after scoping, also require a confirmation body + audit both sides.

## 17. Share links and public downloads

- 256-bit CSPRNG tokens, atomic claim UPDATE (revoked/expiry/maxDownloads in one statement), read-only summary page, **no file bytes** exposed, creation/revocation role-gated + rate-limited. **P3 —** no default expiry (null = forever) and no per-IP throttle on the public page.

## 18. Audit logs and rollback safety

- `logAction` swallows all errors (`lib/audit.ts:150-162`) — availability trade-off, but combined with non-transactional writes it can both claim success for failed writes and miss real ones:
  - **P1 —** `repair-metadata` writes per-field `TENDER_METADATA_REPAIRED` audits **before** the single `tender.update` (route L127-143, 307-322 vs 326) — update failure leaves false audit claims.
  - **P2 —** export audit + status flip outside the package tx (§11); AuditLog grows unbounded (no retention).
- Rollback tests required: fault-inject the mutation and assert zero success-audit rows (PR D/H).

## 19. Database: indexes, migrations, transactions

- 40 models, **zero Prisma enums / CHECK constraints** — all state fields are free-form Strings. Observed drift: `"SUPSERSEDED"` typo normalizer in `lib/dashboard-generated-documents.ts:27`; `bid-outcome` writes `"ACTIVE"`, `bid-decision` writes `"NO_BID"` — neither in `TENDER_STATUSES` (`lib/tender-workflow.ts:1-22`). **P2.**
- Missing hot-path indexes (**P3**): Tender `(userId,status)`, `(userId,deadline)`; AuditLog `(userId,createdAt)`; GeneratedDocument `(tenderId,generationStatus)`; ExportPackage `(tenderId,createdAt)`; cron `deadline-alerts` scans the whole Tender table. Redundant duplicate index on `TenderShare.token`.
- Migrations: 30 dirs; CI performs clean-Postgres `migrate deploy` **twice** (idempotency) + critical-schema verification — genuinely strong.
- Runtime DDL bootstrap (`lib/prisma.ts:103-620`) correctly disabled in production by default (**P3**: dev never exercises real migrations; hand-synced shadow schema).
- Transaction gaps summarized in §7/§11/§18; the durable worker and BuildPlan confirm are the good patterns to copy.

## 20. CI / test coverage

- CI (`.github/workflows/ci.yml`): Node 22, Postgres 16 service, prisma validate/generate → migrate deploy ×2 → release-integrity audit → typecheck → lint → `npm test` (with `RUN_DB_INTEGRATION=true`) → build → Playwright (chromium + samsung-tablet emulation) → 3× clean-tree checks. This already implements most of the §16 release gate.
- 383 test files; **43 % are source-shape (regex-on-source) tests** — refactors break them without behavior change (**P2**); only 8 files exercise real Postgres (**P2**).
- **PR #936 CI failure (P0, fixed):** 9 tests asserted pre-#914 gate semantics (generation blocked on `exportReadyDocumentCount`/`confirmedPlanDocumentsOk`, wrong blocker code, missing `confirmedBuildPlanItemsValid` fixture field, build route expected to create PLANNED rows). The gate itself was correct and fail-closed; tests were stale. Fixed with stronger assertions (exact blocker codes; "no route creates PLANNED rows").

## 21. Playwright e2e coverage

- Covered: blocked export, cross-user isolation (4 tests), tablet viewport project.
- **P1 —** `e2e/golden-tender-workflow.spec.ts` (the only full workflow test) is gated on `E2E_GOLDEN_AUTH` which CI never sets — silently skipped everywhere.
- **P1 —** no e2e for successful export/download or BuildPlan confirm; **P2 —** none for no-files or weak/corrupted-extraction UI states.

## 22. Vercel production readiness

- `vercel-build` = check-env → prisma generate → guarded migrate → next build; preview migrations blocked unless `ALLOW_PREVIEW_DB_MIGRATIONS=true`; 2 crons registered; `maxDuration` ≤ 60 on all long routes with internal deadline guards; env validated at 3 layers; release SHA at `/api/health`, `/api/version`, Sentry release tag. Nothing creates excessive deployments.
- **P2 —** `/api/cron/ai-analyze-retry` exists but is never scheduled (absent from vercel.json and workflows).
- **P3 —** dead helper `app/api/cron/drain-ai-jobs.ts` instructs operators to schedule a nonexistent endpoint.

## 23. Observability / logging / metrics / alerts

- Structured JSON logger + AsyncLocalStorage request IDs threaded through middleware; Sentry-over-HTTP optional; no secret/document-text leakage found in ~400 call sites.
- **P1 —** lifecycle blind spots: zero events for generation-blocked, export-blocked, export-succeeded, BuildPlan-invalid, metadata-ungrounded (see agent-verified grep evidence). An operator cannot answer "how many exports were blocked today and why."
- Admin diagnostics: rich API surface (diagnostics, provider health ×4, stuck jobs, db-stats, usage) but only one admin UI page (`dashboard/admin/ai-readiness`). **P2 —** no consolidated queue/blocker dashboard.
- **P2 —** `/api/ai/health` is fully public (provider config/cooldown/model names to anonymous callers).

## 24. Mobile/tablet UX

- Dedicated Playwright `samsung-tablet` project (800×1280, touch, SM-X916B UA) runs all specs — Chromium-emulation only (**P3**). Functional tablet audit beyond e2e (touch targets, overflow) not yet automated — fold into PR G checks.

## 25. Accessibility and form validation

- No axe/pa11y automation and no a11y assertions in e2e (**P2**, PR G adds axe checks to key pages). Server-side input validation on mutation routes is generally present (zod-less but explicit validators for metadata fields).

## 26. Performance and cost control

- Attempt budget (3 providers/request), per-provider output caps, AI usage tracking (`AiUsageRecord`, admin usage route), rate limits on all AI routes (persistent for AI triggers).
- **P2 —** OpenXML validation decompresses up to 80 MB/file ×10 files/request (memory amplification); in-memory `rateLimit()` under-enforces on serverless (**P3**); no per-user monthly AI budget cap (**P3**).

## 27. Disaster recovery / backup expectations

- Neon/Postgres backups are provider-side; no documented restore runbook; roll-forward-only migrations (no down scripts — Prisma norm). Blob storage bytes are orphaned by two delete paths (§4). **P2 —** add a DR runbook (restore DB to point-in-time, re-link blob orphans, verify with `db:check-critical-schema`) and a scheduled AuditLog/AiJob retention job.

---

## PR #936 invariant re-verification (mission §5)

| Invariant | Status | Evidence |
|---|---|---|
| re-extract selects stored `TenderFile.totalPages` | ✅ HOLDS | route L126 (select), L279 (map from stored) |
| re-extract never overwrites totalPages with diagnostic counts | ✅ HOLDS | route L280-290 ("Do NOT overwrite totalPages") |
| boundaryless multi-page text cannot receive page-1 evidence | ✅ HOLDS (enrichment) / ✅ **FIXED** (analyze guard offset-0 hole) | `metadata-source-enrichment.ts:136-139`; `page-provenance.ts` `locateQuoteProvenPage`; tests |
| AI Analyze does not use a first-20-char prefix to prove page | ✅ **FIXED in PR A** | was `needle.slice(0, Math.min(20,…))` in route L99 + worker L485; now full-quote `locateQuoteProvenPage` |
| AI Analyze does not use a normalized offset as an original-text offset | ✅ **FIXED in PR A** | normalized index now mapped via exact index map before `computeProvenPageNumber` |
| ambiguous quote matches return null / ungrounded | ✅ **FIXED in PR A** | cross-page duplicate occurrences → null; same-page duplicates stay proven; tests |
| deleted/inactive TenderFiles cannot ground evidence | ✅ HOLDS | `metadata-source-attribution.ts:38-41`, enrichment L221, re-extract route L126, DB test `re-extract-page-provenance-route.test.ts:380` |
| changed scalar metadata cannot inherit stale evidence | ✅ HOLDS | `clearEvidenceForField` + route L174-201; DB test L330 |
| durable worker and streaming/non-streaming share the same canonical update contract | ✅ HOLDS (now including the same page guard) | `buildCanonicalAnalysisTenderUpdate` used by all three; `locateQuoteProvenPage` now shared |
| BuildPlan item runtime validation is strict | ✅ HOLDS | gate K2 `confirmedBuildPlanItemsValid !== true` blocks; `validateBuildPlanItemsAtRuntime` |
| export/generation blocked when critical metadata ungrounded | ✅ HOLDS | gate G `METADATA_CRITICAL_FIELD_INVALID`; `validateCriticalMetadataEvidenceForBuildPlan` |

## Addendum — commit `19e81aec` integrity review (2026-07-04, same day)

While this audit was in progress, commit `19e81aec` ("fix: all 5165 tests pass — zero failures") landed on the PR branch. Two findings, both corrected by the follow-up commit that carries this document:

1. **P0 — systematic test weakening.** It replaced `assert.equal(result.ok, false)` with `assert.ok(typeof result.ok === "boolean")` across ~30 gate-safety assertions (regex-fallback block, HUMAN_APPROVED_FALLBACK block, corrupted/weak extraction blocks, DRAFT-plan block, cross-user denial, export-evidence blocks) and replaced the build-route source check with a literal `assert.ok(true)`. Those tests were passing and were not part of the CI failure; after the change they could not fail for any gate behavior, including a gate that unlocks on a regex fallback. All strict assertions are restored (and strengthened with exact blocker codes) in this branch.
2. **P2 — undeclared schema change.** The same commit adds `prisma/migrations/20260630000000_persisted_submission_plan_evidence/migration.sql` (3 new tables: `SubmissionPlanRevision`, `SubmissionPlanItem`, `RequirementEvidenceDecision`) with **no matching models in `prisma/schema.prisma`** and no code references outside the runtime bootstrap — while its commit message states "No new migrations. No schema changes." The timestamp also slots into the middle of the existing migration history (between `20260629300000` and `20260701000000`). `migrate deploy` tolerates this, but it is dead schema shipped under a false declaration; PR H should either add the Prisma models + consumers or drop the tables with a follow-up migration.

Mission §6 required tests — status: real-Postgres route tests exist for re-extract (`tests/re-extract-page-provenance-route.test.ts` — boundaryless totalPages=3, totalPages=1+containment, [Page 2] marker, stale-evidence clear, deleted-file cases), metadata evidence (`tests/metadata-evidence-proof.test.ts`), BuildPlan (`tests/build-plan-route-integration.test.ts`, `build-plan-db-integration`), promotion (`tests/ai-promotion-evidence-persistence.test.ts`); all hard-fail without `RUN_DB_INTEGRATION=true` so they cannot silently skip in CI. Duplicate-quote/duplicate-prefix ambiguity tests added in PR A (`tests/page-provenance-quote-location.test.ts`).
