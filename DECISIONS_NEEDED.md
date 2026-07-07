# Decisions Needed — `main` is broadly red after a recent refactor

**Branch:** `claude/short-honest-feedback-gaps-vyh8dv` (PR #961, draft) · **Base:** current `main`
**Repro:** `CI=true RUN_DB_INTEGRATION=true npm test` against a PostgreSQL 16 with all migrations deployed.

## Summary

`main` currently fails **113 tests**. They are **not** flakiness or brittle noise — a
recent large refactor (commits `f44e1c3b`, `19ab2ab0`, `a6d5f4a5`, `7f15d703`, and the
others that landed `main` ~13 commits ahead of where this branch was cut) rewrote several
core files and, in the process, dropped safety behaviours that ~100 contract tests lock in.

This branch fixes the two clusters that are **verifiably safe to fix without touching the
refactor's core files and without breaking any other contract**, and reports the rest for a
decision. Nothing here has been force-greened by weakening a gate or rubber-stamping a
regression.

`113 → 5907 pass` after this branch's two fixes reduced it from `130` at reset.

---

## ✅ Fixed on this branch (verified, zero regressions)

### 1. Extractor #793 boundary cuts — `lib/engine/tender-field-extractors.ts`
The extractor rewrite kept the function *names* but gutted the behaviour:
- `extractClientName` never applied `cutAtNextFieldLabel`, so a flattened one-line page
  (`"Procuring Entity: Org Name Reference: X Project: Y …"`) absorbed the following labelled
  fields into the client name.
- `cutAtNextFieldLabel` lost the `funder / funded by / recipient / grantee / consultant /
  financier / implementing partner` labels and multi-word handling.
- `Employer:` was still accepted as a client-seeding label (must be rejected per #793).

**Fix:** restored the label set (incl. multi-word), apply the cut inside `extractClientName`,
drop `Employer`. Fixes `pdfjs-metadata-safety`, `extract-client-name-flattened`; cascades to
`inferTenderMetadata` (which reuses `cutAtNextFieldLabel`).

### 2. Reference validator — `lib/engine/metadata-validators.ts`
`isValidReferenceNumber` stopped rejecting bare headings/placeholders.
**Fix (no digit rule):** added a `containsMetadataPlaceholder` guard and extended
`NON_REFERENCE_WORDS` with `number`, `ref`, `tender no.`. This preserves the
`metadata-validators` contract that letter-only refs (`RFP`, `PROCUREMENT`) are valid.
Fixes `metadata-field-state`, `bid-team-placeholder-stripping`, `ai-analyze-placeholder-guard`.

---

## ⚠️ Reported, NOT fixed — need Hope / the refactor's author

Restoring each of these means reworking code another agent just landed. Doing it unilaterally
risks reverting intentional work and collides with the `operator_handoff.md` protocol. They
are listed most-severe first.

### A. Repair-metadata route — **security + grounding regression** (~17 tests)
`app/api/tenders/[id]/repair-metadata/route.ts` dropped:
- `requireRole("ADMIN","PROPOSAL_MANAGER")` → **REVIEWER can now mutate metadata** (security).
- `CRITICAL_SOURCE_GROUNDED_FIELDS` / source-grounding for deadline, reference, title.
- placeholder rejection, `UNRESOLVED` first-class status, unconditional `page` column write,
  verbatim-quote evidence, the `DETERMINISTIC_SOURCE_EXTRACTOR` audit marker.
Tests: `metadata-contamination-and-repair-route`, `repair-deadline-source-grounding`,
`repair-deadline-reference-grounding`, `metadata-completeness-and-autofill`,
`recovery-command-center-repair-consumer`, `recovery-command-center-actions`,
`release-role-policy`, `confirmed-build-plan-fail-closed`, `durable-worker-grounding-guards`,
`release-blockers-integration`.

### B. Durable analysis finalizer — **promotion + transaction regression** (~15 tests)
`lib/ai-jobs/analysis-job-service.ts` `finalizeJob` dropped:
- `buildCanonicalAnalysisTenderUpdate(...)` → canonical tender-metadata promotion path.
- transaction discipline (uses bare `prisma.*` where `tx.*` is required), `STALE_JOB_SUPERSEDED`
  handling, structured logging, PARTIAL-status cap, provider-health persistence,
  `locateQuoteProvenPage` page grounding.
- the claim/re-arm query dropped `"FAILED"` from `status: { in: [...] }` → FAILED jobs are no
  longer re-armed for retry.
Tests: `durable-ai-analyze-workflow`, `ai-persistence-timeout-fix`,
`ai-persistence-transaction-regression`, `page-provenance-quote-location`,
`pr887-behavioral-gates`, `production-ai-analyze-crash-fix`, `provider-failover-and-single-chunk`,
`tender-analysis-content-parity`, `gap-closure-mutation-guards`.

### C. AI health route — **registry drift + auth** (~14 tests)
`app/api/ai/health/route.ts` hard-codes the fallback chain string and ranks 1-9 and dropped its
role gate, instead of deriving from the **still-present** canonical registry
(`lib/ai-provider-registry.ts` still exports `getCanonicalProviderEntries`,
`CANONICAL_AI_FALLBACK_CHAIN_DISPLAY`, `preferredConfiguredProviderName`, `getProviderModel`).
Low-risk to fix (re-wire to the existing registry) but it is another agent's route.
Tests: `groq-openrouter-fallback`, `ai-provider-health-order-alignment`, `ai-provider-registry`,
`ai-provider-chain-policy`, `deepseek-provider-visibility`, `zai-model-regression`,
`production-hardening-round10`.

### D. Generation-gate wiring drift (~6 tests)
`engine`, `generate-missing-plan-files`, `generate-docs-gate`, `export-readiness-route-policy`,
`quality-gaps-phase32`, `workflow-bad-extraction-chain`, `central-generation-gate-coverage`.

### E. Misc
- `bootstrap-schema-coverage` — `lib/prisma.ts` bootstrap missing a table added by a migration.
- `manual-tender-facts-flexibility` (12 subtests) + `grounding-and-buildplan-enforcement` —
  authority-model DB tests; need the same fixture/assertion reconciliation as before, or a
  real wiring check.

---

## 🚫 Irreconcilable spec contradiction — needs a ruling

Two contracts in `main` cannot both hold:

| Test | Requires |
|---|---|
| `candidate-pipeline.ts:146` + `metadata-field-state` | `isValidReferenceNumber("REFONLY") === false` |
| `metadata-validators.test.ts` | `isValidReferenceNumber("PROCUREMENT") === true` |

`REFONLY` and `PROCUREMENT` are both bare uppercase letter-only tokens with no distinguishing
feature. No single implementation of `isValidReferenceNumber` satisfies both. One "mission
spec" removed the digit requirement; the #793 / candidate-pipeline work assumes it. **Decision
needed:** does a valid reference require a digit (revert the "letter-only" mission) or not
(accept `REFONLY`)? This branch leaves the function on the "letter-only valid" side so nothing
already green regresses.
