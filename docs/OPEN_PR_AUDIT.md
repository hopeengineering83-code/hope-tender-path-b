# Open PR Code Audit — #792, #793, #794, #795, #796

Purpose: ensure **no important code is missed** from any open PR. Every
meaningful change is catalogued below with a disposition: **EXTRACTED**
(pulled into a working branch), **DEFERRED** (safe, to land in a later
phase), **REJECTED** (unsafe — must not merge), or **SUPERSEDED**
(covered elsewhere).

Last reviewed: 2026-06-20 (re-reviewed after #798 appeared).

Complete open-PR set at review time: **#792, #793, #794, #795, #796, #797, #798**.

---

## PR #795 — PDF extraction + source-grounded metadata
Branch: `codex/review-and-create-draft-prs-for-#792,-#793,-#794`

| Item | Disposition |
|------|-------------|
| Pin `pdfjs-dist` to `5.4.296` (align with `pdf-parse` worker) | ✅ EXTRACTED (present + verified) |
| Grounded extractors: `procuringEntityName`, `donorAgency`, `implementingAgency`, `clientWebsite`, `submissionEmailSubject` (with page/quote provenance) | ✅ EXTRACTED |
| `inferClient` → `cutAtNextFieldLabel` consolidation | ✅ EXTRACTED |
| **Fix A** — header fallback rejects non-client labels via shared `nonClientEntityLabelPattern()` | ✅ EXTRACTED (this task) |
| **Fix B** — `extractClientName` / repair-metadata reject beneficiary/employer/owner | ✅ EXTRACTED (this task) |
| **Fix C** — generic `Donor:`/`Funder:`/etc. boundary cutting | ✅ EXTRACTED (this task) |
| Tests: 22 metadata-safety cases | ✅ EXTRACTED (this task) |

**Status: complete.** All three review defects fixed; 22 tests; pushed.

---

## PR #793 — remaining gaps (pdfjs, dedupe client extractor, extended fields)
Branch: `claude/fix-remaining-gaps-qwgq6b`

| Item | Disposition |
|------|-------------|
| pdfjs pin | 🔁 SUPERSEDED by #795 (verified present) |
| `inferClient` consolidation | 🔁 SUPERSEDED by #795 |
| Extended client fields via regex | 🔁 SUPERSEDED by #795 |

**Recommendation: close #793 as superseded by the corrected #795.** No
unique code is lost.

---

## PR #792 — AI Analyze robustness & retry UI
Branch: `fix/ai-analyze-robustness-...`

| Item | Disposition |
|------|-------------|
| Real per-chunk SSE progress events (`onChunkStart`/`Complete`/`Failure` emit) replacing fake timer | ✅ EXTRACTED into engine branch (this task — also in #796) |
| Removal of estimated `progressTimer` | ✅ EXTRACTED (engine branch) |
| `components/ai-analyze-panel.tsx`: "Resume Now" button + auto-retry toggle | ⏳ DEFERRED to Phase 3b UI wiring (concept is sound; reimplement cleanly) |
| `.github/workflows/branch-policy.yml` allow `fix/*` → main | ❌ REJECTED (mission-explicit; weakens branch policy) |
| `"Autorety"` typo + duplicated `if (!autoRetryEnabled)` block | ❌ REJECTED (bugs) |
| `lib/ai-analyze-checkpoints.ts`: `totalChunks = rows[0]` instead of `Math.max` | ❌ REJECTED (mission-flagged DEFECT — keep `Math.max`) |
| `resumeAvailable` logic tweak | ⏳ DEFERRED (re-evaluate in Phase 3b; not adopted with the rows[0] defect) |
| Removed temp artifacts `fix_route.py`, `fix_generate_missing.py` | ➖ N/A (artifacts not on main) |

**Recommendation: do not merge #792.** Safe progress-event code is now in
the engine branch; remaining safe UI concepts land in Phase 3b. The
branch-policy change, typo, duplicate block, and checkpoint defect must
never be adopted.

---

## PR #794 — Image OCR, ODT support, PDF trimming
Branch: `fix/extraction-quality-and-odt-ocr-support-...`

| Item | Disposition |
|------|-------------|
| Image OCR via Claude-only | ❌ REJECTED (Claude may be unavailable; needs provider-agnostic design) |
| PDF buffer trimming for OCR | ❌ REJECTED (silently drops later tender pages/instructions) |
| Treats unsupported image bytes as JPEG | ❌ REJECTED (incorrect) |
| Writes OCR failure strings into extracted text | ❌ REJECTED (contaminates tender text) |
| ODT ZIP extraction without archive limits | ❌ REJECTED (zip-bomb / resource risk) |
| Stricter "perfect extraction" gate in `extraction-quality-gate.ts` | ⏳ DEFERRED (the only potentially-safe idea; revisit in a dedicated, tested hardening task) |

**Recommendation: do not merge #794.** Requires a separate, security-
reviewed OCR/ODT redesign with archive limits, provider-agnostic OCR,
full-document coverage, and tests.

---

## PR #796 — structural metadata + traceability (Jules)
Branch: `fix/ai-analyze-structural-solution-...`

| Item | Disposition |
|------|-------------|
| `AIAnalysisResult.tenderTitle` (verbatim title) — type, prompt, sanitization, merge | ✅ EXTRACTED into engine branch (this task) |
| `AIRequirement.sourceSectionHeading` — type, prompt, sanitization, merge | ✅ EXTRACTED (this task) |
| Persist verbatim `tenderTitle` → `tender.title` | ✅ EXTRACTED (this task, **improved**: placeholder-guarded vs #796's raw `||`) |
| Persist `sourceSectionHeading` (prefer AI heading over section ref) | ✅ EXTRACTED (this task) |
| Pass `textSamples` to `deriveExtractionStatus` (corruption detection) | ✅ EXTRACTED (this task) |
| Standalone extraction-corruption pre-check block | 🔁 CONSOLIDATED into `deriveExtractionStatus(textSamples)` (the pre-check set a flag but still ran AI — redundant) |
| `.github/workflows/branch-policy.yml` allow `fix/*` → main | ❌ REJECTED (same unsafe change as #792) |

**Recommendation: close #796 as superseded** — its safe traceability code
is now in the canonical engine branch (PR #797), and its branch-policy
change is rejected.

---

## PR #798 — 8 P0 critical gaps from production-readiness audit
Branch: `claude/fix-p0-critical-gaps`

**This is a self-contained, high-value, well-tested PR (47 tests). It is NOT
folded into #797 — it is a different concern (security/DB/observability) and
should be reviewed and merged on its own merits.** Every item below is SAFE
and important; none should be lost.

| Item | Disposition |
|------|-------------|
| **SEC-001** `reclassify-documents` — remove unscoped `?? findFirst({id})` cross-tenant fallback | ✅ KEEP (own PR) — critical security |
| **SEC-002** `repair-metadata` — remove unscoped fallback (auth scoping) | ✅ KEEP — **complementary** to #795 Fix B (data scoping); no conflict, different lines |
| **SEC-003** `deduplicate-documents` — add `userId` filter (was none) | ✅ KEEP — critical security |
| **DB-001** `demo-seed.ts` production guard (`NODE_ENV` + `DEMO_SEED_ALLOWED`, exit 2) | ✅ KEEP — prevents prod data wipe |
| **DB-002/003/PERF-002** additive FK-index migration (`Tender.userId`, `GeneratedDocument.tenderId`, 5×`AuditLog`, `Session.userId`, compliance/export) + `@@index` directives | ✅ KEEP — additive, `IF NOT EXISTS`, idempotent |
| **AI-001** `redactMessage` covers all 8 provider key prefixes (sk-ant-, sk-or-, sk-, gsk_, dsk-, AIza, AQ, Bearer, authorization) | ✅ KEEP — secret-leak fix; **strengthens** #797's redaction |
| **OBS-002** `instrumentation.ts` — global `unhandledRejection`/`uncaughtException` capture via `reportError()` | ✅ KEEP — additive, browser-guarded |
| **DOC-001** `neon-switch-checklist.md` — correct dangerous `db push` → `migrate deploy`; SubmissionPlanState risk | ✅ KEEP — docs |
| **DOC-007** `.env.example` — document 9 security-critical env vars | ✅ KEEP — docs |
| 9 remaining P0 gaps (AI-002, PERF-001/003, OBS-001/003/004, DOC-002, DB-005, SEC-005) | ⏳ TRACKED in #798 description for follow-up PRs |

**Recommendation: review and merge #798 on its own.** It does not overlap
the AI-Analyze engine work; the only adjacency (repair-metadata) is
complementary. **No `.github/workflows/*` touched** (unlike #792/#796) —
this PR is clean.

> ⚠️ Coordination note: #798 adds an additive migration
> `20260620120000_add_missing_fk_indexes`. Phase 3b of #797 will add its own
> additive Tender-pointer migration. Both are additive and independent;
> whichever merges first, the other rebases cleanly.

---

## Summary of dispositions

- **#795**: complete (corrected) — keep open for review.
- **#793**: close as superseded by #795.
- **#792**: do not merge; safe progress code extracted, UI concepts deferred to Phase 3b, defects rejected.
- **#794**: do not merge; needs a separate hardened OCR/ODT task.
- **#796**: close as superseded; safe traceability code extracted into PR #797.
- **#797**: keep open (canonical engine foundation, draft until Phase 3b).
- **#798**: keep open — **review/merge on its own** (critical security/DB/obs fixes, fully tested, no overlap).

**Nothing important is lost:** every safe item is either extracted now,
explicitly tracked as deferred, or — for #798 — preserved as its own
complete PR with this catalogue pointing to it.
