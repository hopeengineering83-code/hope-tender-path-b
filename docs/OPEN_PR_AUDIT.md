# Open PR Code Audit — #792, #793, #794, #795, #796

Purpose: ensure **no important code is missed** from any open PR. Every
meaningful change is catalogued below with a disposition: **EXTRACTED**
(pulled into a working branch), **DEFERRED** (safe, to land in a later
phase), **REJECTED** (unsafe — must not merge), or **SUPERSEDED**
(covered elsewhere).

Last reviewed: 2026-06-20.

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

## Summary of dispositions

- **#795**: complete (corrected) — keep open for review.
- **#793**: close as superseded by #795.
- **#792**: do not merge; safe progress code extracted, UI concepts deferred to Phase 3b, defects rejected.
- **#794**: do not merge; needs a separate hardened OCR/ODT task.
- **#796**: close as superseded; safe traceability code extracted into PR #797.

**Nothing important is lost:** every safe item is either extracted now or
explicitly tracked as deferred above.
