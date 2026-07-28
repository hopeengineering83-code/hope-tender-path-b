# PR #1175 transitive coverage

This document maps changed authority boundaries to all known downstream
consumers. `PASS` means the listed local tests passed; it does not substitute
for supported-runtime CI, database integration, or exact-preview evidence.

## T001 — automatic source verification

Root:

- `lib/company-auto-verification.ts`
- `deriveAutomaticSourceVerification`

State transition:

```text
owned active source bytes + exact grounded fields
  -> SOURCE_VERIFIED
  -> reviewedBy = null
  -> reviewedAt = null
  -> serialized source provenance
```

Forbidden transition:

```text
automatic process -> REVIEWED / fabricated human reviewer
```

Known consumers:

- company-vault ingestion and repair;
- durable source-verification predicates;
- matching eligibility and generation evidence selection;
- expert/project audit logs;
- legacy `SYSTEM_AUTO_VERIFIED` repair query.

Coverage:

| Test | Consumer/claim | State |
|---|---|---|
| `company-knowledge-auto-review-negative.test.ts` | pure behavioral transition and no fabricated reviewer | PASS |
| `company-vault-engine-auto-repair.test.ts` | repair path retains source-verification semantics | PASS |
| `matching-eligibility-source-verified.test.ts` | source-verified evidence remains eligible without becoming human-reviewed | PASS |
| TypeScript | shared provenance types and Prisma payloads | PASS |
| Database integration | legacy row repair and concurrent updates | OPEN |

## T002 — signature/stamp legal approval boundary

Root:

- `app/api/tenders/[id]/generate/route.ts`
- `app/api/tenders/[id]/auto-finalize/route.ts`
- removed `lib/engine/apply-signature-stamp.ts`

Required invariant:

```text
uploaded asset != legal authorization to sign or stamp output
```

Known consumers:

- direct document generation;
- automatic finalization;
- PDF finalization/export readiness;
- output hygiene and format policy.

Coverage:

| Test | Consumer/claim | State |
|---|---|---|
| `signature-stamp-human-approval-gate.test.ts` | neither canonical generation owner invokes an automatic mutator; competing module absent | PASS |
| `auto-finalize-safety.test.ts` | existing finalize safety contract | PASS |
| `pdf-finalization-safety.test.ts` | PDF finalization remains gated | PASS |
| `export-format-policy.test.ts` | output format/export rules remain intact | PASS |
| Human-approved application workflow | explicit actor, scope, preview, approval, audit, revocation | DEFERRED |

The current remediation removes unsafe automatic mutation. It does not claim
that a complete human-approved electronic-signature workflow now exists.

## T003 — tender upload to durable extraction

Root candidates:

- `lib/tender-upload-first.ts`
- `lib/secure-upload-handler.ts`
- `lib/ai-jobs/tender-extraction-service.ts`
- `lib/ai-job-handlers.ts`
- legacy extraction block in `lib/ai-job-handlers-legacy.ts`

Required chain:

```text
request validation
  -> durable verified source bytes
  -> TenderFile/source row
  -> deterministic EXTRACT_TEXT job
  -> worker reads verified bytes
  -> optimistic extraction persistence
  -> all-active-file completion check
  -> canonical AI analysis queue
```

Implemented local chain:

```text
integrity-verified bytes + source/package rows
  -> exact hash-bound EXTRACT_TEXT job
  -> canonical worker extraction + optimistic persistence
  -> current-source metadata enrichment
  -> all-active-file/package readiness recheck
  -> canonical AI analysis continuation
```

Coverage:

| Area | Evidence | State |
|---|---|---|
| first/append/multi-file upload | background-wiring, upload-first, route, sequencing tests | PASS |
| partial package/final batch/replay | package-session, auto-pipeline, durable orchestration tests | PASS |
| duplicate enqueue and stale hash | deterministic enqueue and invalid-hash worker tests | PASS |
| extraction failure/truncation/retry state | extraction quality and worker tests | PASS |
| worker-to-analysis continuation | pipeline sequencing and contract tests | PASS |
| deletion/cancellation and concurrent package commits | isolated database integration | OPEN |
| exact preview worker/runtime | Vercel runtime proof | OPEN |

The legacy extraction implementation is removed. Production upload paths no
longer call `extractTextFromBuffer` or queue AI analysis directly.

State: **FIXED_LOCAL — database/runtime proof pending**

## T004 — company upload to durable Vault ingestion

Required chain:

```text
request validation
  -> durable verified company-document bytes
  -> retryable extraction
  -> source-hash-grounded knowledge ingestion
  -> SOURCE_VERIFIED records
  -> optional authenticated human REVIEWED transition
```

Implemented local chain:

- upload persists verified bytes with `aiExtractionStatus = PENDING` and no
  trusted request-time extracted text;
- `VAULT_INGEST` is queued with `reExtractAll: true`;
- revision-zero queued documents enter the canonical background extraction
  revision before grounded ingestion;
- automatic promotion remains `SOURCE_VERIFIED`, never a synthesized human
  review.

Coverage:

| Area | Evidence | State |
|---|---|---|
| upload-to-re-extraction ownership | upload background-wiring/source-contract tests | PASS |
| source-hash provenance and review semantics | source-verification and repair tests | PASS |
| legal/financial/compliance/expert/project persistence | isolated database integration | OPEN |
| replacement/deletion/concurrent retry | isolated database integration | OPEN |

State: **FIXED_LOCAL — database integration pending**

## T005 — lifecycle truth shared by UI and gates

Canonical data still needs to be traced across:

- source file/extraction quality;
- promoted analysis;
- mandatory requirement grounding;
- selected reviewed/source-verified evidence;
- current confirmed Build Plan;
- generated/official-original reconciliation;
- authority review;
- export/ZIP readiness;
- one primary next action.

The screenshots show conflicting projections of these states. Passes 4 and 5
must attach each panel to shared selectors and verify cross-panel equality with
route and browser tests.

State: **OPEN**
