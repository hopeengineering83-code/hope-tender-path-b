# PR #1303 → PR #1175 Behavior Reconciliation

Reconciled 2026-08-29 UTC against the real remote state, not against any chat
summary or pinned SHA.

| Field | Value |
| --- | --- |
| #1175 head reconciled against | `b247a1394a540855f62b12911e28d92ba465e379` |
| #1303 head reconciled | `c9ff3208b9c6aca7485a1e9f07ebdc35577d57c6` |
| #1303 branch | `claude/tender-zip-end-to-end-1lm9sz` (base `main`) |
| #1303 title | "Make the pipeline produce a real ZIP, and test that it does" |
| Shared history | none — `git merge-base` is `05a9470a` on `main`; no #1303 commit is an ancestor of #1175 |

The two branches solved the same problem in parallel. Nothing was cherry-picked
in either direction, so every #1303 behavior had to be checked against #1175
individually rather than assumed present.

> **Note on the takeover brief.** The handoff described #1303 as
> "feat: enhanced tender parsing and mixed-file knowledge upload" on branch
> `claude/fix-platform-gaps-V8OZy`. Only the head SHA matched. The real PR
> touches four files and does not change tender parsing or vault upload at all.
> The classification below is drawn from the actual diff.

## Reconciliation table

`git diff 05a9470a..c9ff3208` is 4 files, +759/−21.

| # | #1303 change | Class | Evidence in #1175 |
| --- | --- | --- | --- |
| 1 | `authority-review.ts`: add `DocumentInput.documentText`; judge the document by its own text, falling back to metadata only when the caller has no bytes | **PRESENT_EQUIVALENT** | `lib/engine/authority-review.ts:113` declares `documentText`; `:200-201` uses it with the identical metadata fallback. Only prose wording of the doc-comment differs. |
| 2 | `authority-review.ts`: delete the local `PRICING_IN_TECHNICAL_RE` and defer to `containsPricingLeakage` | **PRESENT_EQUIVALENT** | `:41` imports `containsPricingLeakage`; `:257` calls it. The bare `\bprice\b` rule is gone from both. |
| 3 | `download/route.ts`: read a generated DOCX's visible text from its stored bytes | **SUPERSEDED_BETTER** | #1175 extracted one reader, `lib/engine/generated-document-text.ts`, imported at `download/route.ts:4`. #1303 inlines the helpers in the route. The shared module additionally reads **PDF** bytes (`%PDF-`) and caps decoded size at 32 MiB; #1303 handles neither and returns null for every finalized PDF. |
| 4 | `wordTextRuns` scanned with `indexOf`, not a backtracking regex (ReDoS) | **PRESENT_EQUIVALENT** | `generated-document-text.ts:45-65` — same cursor algorithm, same self-closing/`<w:tab/>` guard. |
| 5 | `decodeXmlEntities` in ONE pass, so `&amp;apos;` is not decoded twice | **PRESENT_EQUIVALENT** | `generated-document-text.ts:88-90` — same single `replace` over the five predefined entities. |
| 6 | `generate/route.ts`: normalise `-`/`_`/`.` to spaces in `classifySupportDoc` so `02-Company-Profile.docx` stops falling through to GENERIC | **PRESENT_EQUIVALENT** | `generate/route.ts:106` + the same rationale comment. |
| 7 | `generate/route.ts`: materialise a row for every CONFIRMED plan file that has none, so the normal path reaches a ZIP without the `generate-missing-plan-files` click | **PRESENT_EQUIVALENT** | `generate/route.ts:1155-1189` — same `findMissingGeneratedDocuments` loop, same `P2002` convergence, same warning string. This is the `CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE` / third-manual-click defect; both branches fix it identically. |
| 8 | `stripFileExtension` via `lastIndexOf` + alphanumeric check, not an anchored regex | **PRESENT_EQUIVALENT** | `generate/route.ts:96-104`. Behaviorally identical; #1175 inlines the `ext` local. |
| 9 | Test cleanup goes through `executeTenderDeletion` so `guard_canonical_requirement_set_delete()` does not silently strand a User + Tender in the shared CI database | **SUPERSEDED_BETTER** | `tests/pipeline-produces-real-zip-end-to-end.test.ts:481-505` — same helper, same GUC rationale, same loud-failure logging, **plus** a `PIPELINE_KEEP_FIXTURE=1` inspection path. |
| 10 | `tests/pipeline-produces-real-zip-end-to-end.test.ts` end-to-end ZIP proof | **SUPERSEDED_BETTER** | #1175's version is 584 lines vs 535 and carries all 7 of #1303's scenarios plus an 8th: *"validates only documents that pass the same canonical quality rubric shown by readiness"*. |

### Totals

```
PRESENT_EQUIVALENT:        7
SUPERSEDED_BETTER:         3
MISSING_REQUIRED:          0
OBSOLETE_OR_UNSAFE:        0
PR_1303_RECONCILED = YES
SAFE_TO_CLOSE_AS_SUPERSEDED = YES
```

Nothing was ported, because nothing was missing.

## Second reconciliation: uncommitted `claude/tender-zip-end-to-end-b1r2ek` work

The takeover container arrived checked out on `claude/tender-zip-end-to-end-b1r2ek`
at `820c9cb0` — not on the release branch — carrying 5 modified `lib/engine/*.ts`
files and 10 untracked `scripts/*.mjs` diagnostics from a sibling session. That
work was never pushed and would have been lost. It was captured before the tree
was cleaned and reconciled on the same terms.

| # | b1r2ek change | Class | Evidence in #1175 |
| --- | --- | --- | --- |
| A | `truncateQuoteVerbatim` — a truncated `sourceExactQuote` must stay a verbatim substring, because grounding asserts `extractedText.includes(quote)`; the old `…` suffix made every over-long quote permanently ungrounded | **PRESENT_EQUIVALENT** | `lib/engine/requirement-source-extractor.ts:115`, used at `:262` and at `source-grounded-requirement-map.ts:145`. |
| B | Propagate an evidence anchor through `normalizeStrategicRequirements` so a bundled requirement keeps a page + quote | **SUPERSEDED_BETTER** | The engine no longer calls it. `run-tender-engine.ts:198-247` ("FIX 6: Engine must NEVER re-analyze the tender") reuses the promoted AI Analyze requirements and carries all six source fields through verbatim. `normalizeStrategicRequirements` now has one caller, `analyzeTender` (`analysis.ts:361`), whose drafts carry no source evidence to propagate. |
| C | Carry `sourcePage`/`sourceQuote` from the AI result into engine requirements, preferring the AI quote over a lexical re-match | **SUPERSEDED_BETTER** | Same deleted code path as B. #1175 reuses promoted grounded requirements instead of re-mapping an in-engine AI call. |
| D | Exclude `Tender.title` from the analysis content hash, because AI Analyze writes the title back and thereby invalidates its own `analysisInputHash` | **SUPERSEDED_BETTER** | Reproduced at unit level on `b247a139`: the title is the first hashed line (`tender-analysis-content.ts`), so a title write-back does change the hash. But `analysis-job-service.ts:1395-1411` recomputes `computePersistedTenderAnalysisHash` from the **persisted post-write-back** tender inside the same `Serializable` transaction and rebinds `job.analysisInputHash` before exposing success. The immutable authorized provider input stays in `canonicalSnapshot.analysisInputHash`. #1175's approach is strictly safer: stripping the title from the hash would also stop a genuine owner rename from invalidating a stale analysis. |

```
MISSING_REQUIRED from b1r2ek: 0
```

The captured patch is retained outside the repository as session evidence only.
No part of it was applied.
