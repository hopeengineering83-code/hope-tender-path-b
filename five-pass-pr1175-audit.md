# PR #1175 five-pass forensic audit

Status: **WORKING — DO NOT MERGE**

This audit is being performed on the isolated branch
`audit/pr1175-complete-five-pass-forensic-audit`, based on the exact PR #1175
head `ec0eaa83af3d3616bf935b9a3f950af734bcc6ca`. It does not authorize a merge,
a production deployment, or real-account testing.

## Frozen baseline

| Item | Frozen value |
|---|---|
| Repository | `hopeengineering83-code/hope-tender-path-b` |
| Governing PR | `#1175` |
| Governing branch | `release/consolidated-recovery-20260717` |
| Governing head | `ec0eaa83af3d3616bf935b9a3f950af734bcc6ca` |
| Governing base | `b3c9db5de89a2a665e61a83facbff0f276f9983c` |
| Commits in comparison | 656 |
| Changed files in comparison | 656 |
| Diff size | +40,012 / -28,533 |
| Exact-head CI | run `30313507549`, successful |
| Exact-head screenshot run | run `30313507588`, successful |
| Exact-head Vercel deployment | `dpl_yYMggEEnQbJemQtmMHioee15eZnN`, READY |
| Vercel deployment SHA | `ec0eaa83af3d3616bf935b9a3f950af734bcc6ca` |
| Audit started | 2026-07-28 UTC |

The governing branch was re-read before the first edits and was still at the
frozen SHA. Any later head movement requires a new comparison before more code
is changed.

## Safety holds

- A real-account login credential was exposed in PR discussion/history.
- Rotate the application password, revoke active sessions, update the GitHub
  `REAL_APP_PASSWORD` secret, and sanitize retained artifacts before any further
  real-account test.
- No real-account login, production mutation, merge, or production deployment is
  part of this branch.
- `SOURCE_VERIFIED` means machine/source-byte verification. It is not evidence
  of an authenticated human review.
- Signature/stamp assets are legal-authority inputs and must never be inserted
  into output automatically.

## Pass protocol

Every pass uses the same sequence: observe the exact head, identify a
reproducible root cause, add a failing contract, fix one authority boundary,
run focused and transitive consumers, and record any unverified claim as open.

### Pass 1 — ancestry, incorporation, and change ownership

Status: **IN PROGRESS**

Completed:

- froze PR/base/head, CI, screenshot-run, and preview identities;
- enumerated the 656-commit / 656-file comparison;
- inspected the only other open donor audit PR, #1266, as evidence rather than
  treating its stale assertions as current truth;
- identified two late regressions introduced after the donor audit:
  fabricated automatic human review and automatic signature/stamp mutation.

Remaining:

- prove each still-open PR #1266 finding against the current head;
- produce current-head incorporation/overlap/dead-code disposition;
- re-check the remote head before the next fix.

### Pass 2 — identity, tenant, review, and legal authority

Status: **IN PROGRESS**

Closed locally:

1. Automatic ingestion now produces durable `SOURCE_VERIFIED` provenance with
   `reviewedBy = null` and `reviewedAt = null`. Legacy rows stamped with the
   fabricated `SYSTEM_AUTO_VERIFIED` identity are included in the repair query
   and are downgraded to the truthful source-verified state.
2. Canonical generation and auto-finalization no longer invoke a signature or
   stamp mutator. The competing mutator module was removed.

Verification:

- behavioral provenance transition test;
- negative authority-contract tests;
- typecheck plus 126 focused/transitive tests passing.

Remaining:

- verify all review-inbox record families and all role/tenant write boundaries;
- inspect retained signature/stamp settings for a human-approved, auditable
  application flow or explicitly defer that feature.

### Pass 3 — upload, extraction, queue, and persistence

Status: **IN PROGRESS**

Current root cause:

- the durable `EXTRACT_TEXT` service exists and is registered, but no production
  upload path calls `enqueueTenderFileExtractionJob`;
- `lib/tender-upload-first.ts` and `lib/secure-upload-handler.ts` still perform
  OCR/text extraction in the HTTP request and then queue analysis directly;
- the legacy job handler still contains a second extraction implementation.

Required outcome:

- request handlers validate/store bytes and persist source rows;
- one canonical worker owns extraction and continues analysis only after all
  active source files reach a durable terminal extraction state;
- partial-package and replay behavior is deterministic and cannot strand a
  tender between upload and analysis.

### Pass 4 — evidence, generation, approval, export, and ZIP authority

Status: **PENDING**

Planned checks:

- one generation authority and one Final ZIP authority;
- no generated rows before extraction, grounding, evidence, and Build Plan
  eligibility;
- final manifest exactly matches current confirmed plan and envelope rules;
- signature/stamp insertion requires explicit human authorization;
- PDF conversion/finalization produces verifiable bytes or blocks honestly.

### Pass 5 — runtime, UI truth, CI, and exact preview

Status: **PENDING**

The 20 supplied screenshots are evidence inputs, not proof of current behavior.
Known contradictions to reproduce include:

- analysis shown as usable while matching failed on a missing database column;
- 28 reviewed experts and 50 reviewed projects shown in the Vault while other
  panels report no reviewed evidence;
- mandatory rows manually confirmed as FULL while the compliance heatmap labels
  them UNKNOWN;
- a confirmed explicit Build Plan shown in one panel while another says no
  confirmed Build Plan;
- covered requirements displayed despite zero selected experts/projects and
  zero section evidence maps;
- competing repeated blocker panels and duplicate actions;
- strategy endpoint returning HTTP 500;
- generated-document and required-PDF state disagreeing across panels.

The exact audit-head CI, runtime logs, and preview must be re-established after
all code changes. A green historical run is not acceptance evidence for this
branch.

## Environment disclosure

The repository requires Node `>=22 <23`; this workspace provides Node `24.14`.
The focused TypeScript/tests run successfully with that mismatch, but final
acceptance must include CI on the repository-supported runtime. No local
PostgreSQL service is available, so database-integration evidence is still
outstanding.

## Acceptance state

The audit is deliberately not marked complete. Two authority regressions are
closed locally; background extraction wiring and the remaining pass matrix are
still open. See the findings, transitive-coverage, and dependency-proof
ledgers for claim-level status.
