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

Current gaps:

- request-time extraction still owns the critical path;
- canonical enqueue helper has no production caller;
- request handlers directly queue analysis;
- partial package completion can race job continuation unless one authority
  rechecks the completed package;
- a duplicate legacy extraction implementation remains.

Required coverage before closure:

- first tender upload;
- append upload;
- multi-file upload;
- partial package and final batch;
- duplicate/replay;
- stale source hash;
- extraction failure and retry;
- tender deletion/cancellation;
- exactly-once analysis continuation after all files complete.

State: **OPEN**

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

Current gap:

- normal company upload relies on request-time extracted text and queues
  `VAULT_INGEST` without proving that a background extraction step completed.

Required coverage:

- legal, financial, compliance, expert CV, and project-reference document types;
- extraction retry and hash change;
- no stale knowledge after replacement/deletion;
- review identity cannot be synthesized.

State: **OPEN**

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
