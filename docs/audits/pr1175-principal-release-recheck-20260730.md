# PR #1175 Principal Release Recheck — 2026-07-30

## Frozen authority

- Governing PR: #1175, open, draft, and unmerged.
- Frozen head: `1e113fa529718b9052e762efd15fbf51144ccaca`.
- Frozen base: `b3c9db5de89a2a665e61a83facbff0f276f9983c` on
  `integration/controlled-recovery`.
- Recovery branch: `release/consolidated-recovery-20260717`.
- Closed consolidation PR #1274 head:
  `0611690b1486402df6fb5431b055b219390517e7`.
- Git ancestry proves the complete #1274 head is an ancestor of the frozen
  #1175 head. The merge base is exactly the #1274 head.
- A fresh GitHub API query returned #1175 as the only open pull request. There
  is therefore no remaining open donor with unclassified application code.

This recheck did not merge, approve, retarget, close, or deploy #1175 and did
not run a production migration.

## Five-pass disposition

### 1. PR authority and unique-code ledger

The live state supersedes the prepared snapshot: #1274 was already closed and
incorporated before this pass. The canonical file/commit ledger remains
`docs/audits/open-pr-unique-code-ledger-20260728.md`. Every previously open
donor has a file-level disposition there. No new open donor exists. The 14
commits after #1274 were reviewed through the frozen tree and their affected
tests: they contain release-evidence repairs, production DOCX proof, injected
audit persistence, compatible dependency patches, redirect compatibility, and
the single Review Inbox presentation repair. No second Final ZIP, Build Plan,
generation, matching, PDF, review, or Company Vault mutation authority was
introduced.

### 2. Transitive schema, security, and concurrency audit

An isolated PostgreSQL 16 database accepted all 43 migrations. Critical-schema
verification required 30 tables, 10 column groups, and 3 functions. The
retroactive initializer verified 41 tables, 555 columns, 61 indexes, and 87
constraints. A second migration deployment was idempotent and Prisma reported
zero drift. Release-integrity checked 418 routes and 1,390 files; safe-error,
public-metadata, storage, tenant, mutation-rate-limit, and route-ownership
guards passed.

The complete unit/PostgreSQL suite exercised revision-bound optimistic writes,
tenant denial, role denial, advisory-lock/idempotency behavior, job recovery,
durable deletion, Build Plan concurrency, review provenance, real export ZIP
assembly, and exact byte persistence. It passed 8,930/8,930 assertions with no
skips or failures.

### 3. Canonical product workflow audit

The passing production and browser suites exercised Company Vault upload and
durable ingestion, extraction and retry checkpoints, source-grounded review,
tender intake, analysis/fail-closed fallback, requirements, confirmed Build
Plan, Engine/matching, explicit evidence eligibility, generation, validation,
Authority Review, PDF, and Final ZIP contracts. The action registry and live
route audit confirm one presented Review Inbox and one owner for each release
mutation. The compatibility Review Board URL redirects to the Review Inbox and
does not render a competing control.

The prepared two obsolete export-test failures no longer exist. Behavioral and
database-backed tests now preserve POST export as readiness preflight and GET
ZIP download as the sole byte owner. A blocked readiness result creates no
package; real archive persistence owns supersession and manifest/hash/length
claims.

### 4. Current failures and product gaps

No reproducible application, schema, migration, ownership, security, responsive
layout, or generated-byte failure was found on the frozen head. Typecheck,
zero-warning lint, production build, 8,930 tests, and 179 Playwright tests
passed. Four Playwright checks self-skipped under their documented fixture or
CI-identity conditions. Desktop, tablet, and mobile overflow checks passed.

The first local Playwright launch was rejected before application execution
because all provider variables had deliberately been set empty while the
production server requires one configured provider. Rerunning with a synthetic,
nonfunctional provider-shaped placeholder reproduced the CI setup and passed
179 tests. This is an environment-setup correction, not an application defect
or a hidden test reduction.

`npm audit --omit=dev` continues to report two high-severity production
findings: Next.js inherits the current Sharp/libvips advisory. This was already
classified in the canonical ledger. The available npm remediation is not a
compatible, independently verified patch, so no unsafe framework change was
made merely to make the audit green.

### 5. Falsification and exact-head proof

Fresh local evidence was generated from the frozen head:

- DOCX `Technical-Proposal.docx`: 12,095 bytes,
  SHA-256 `d15451f320d1059717b5258debc679970721954ed899c4fde8ada79dadcf192a`.
  The Office archive opens; Word XML is present; Heading 1, updating TOC field,
  header/footer relationships, page numbering, and a synthetic PNG brand asset
  are present.
- PDF `Technical-Proposal.pdf`: 984 bytes,
  SHA-256 `7da1e0f61a9033e92ab012fc80efd4ec8c592582643c4d58087fd2f69847cc2f`.
  It begins with `%PDF-1.7`, opens under `pdfinfo`, contains one A4 page, and has
  no JavaScript or encryption.
- ZIP `Final-Submission-Package.zip`: 10,422 bytes,
  SHA-256 `46710b7118913392dbf55beccffc72f3315c435ec99e7896e08e3b0f5f5e19ae`.
  It opens cleanly and contains exactly the DOCX then PDF in manifest order.
  Entry bytes, filenames, lengths, hashes, order, and technical envelopes match
  the generated manifest.

The normal Git-triggered Vercel preview
`dpl_4UUnQvdQeoNaJK8tqewsp5mprg65` is READY and identifies the exact full SHA
through `/api/health`; `/api/version` reports its short SHA. Both endpoints
returned HTTP 200, health reported required critical tables and durable private
Blob storage, and a fresh 100-event deployment query contained no P2022, P2002,
unhandled 500, timeout, stuck-job, duplicate-job, database URL, or PostgreSQL
credential finding. The apparent `Prisma` text matches were normal build-time
client generation/migration messages, not runtime Prisma errors.

## Completion boundary and external holds

The code and exact frozen head are independently green, but release completion
and production readiness are **not** claimed. The following conditions require
external owner/account action or credentials that were not available to this
session:

1. approved synthetic preview credentials for a complete provider-backed,
   persisted preview workflow followed by post-workflow log inspection;
2. rotation of the previously exposed real application password;
3. revocation of existing sessions;
4. replacement of the affected automation secret;
5. sanitation of retained credential-bearing artifacts;
6. owner UAT;
7. removal or correct configuration of the duplicate Vercel project named
   `repo`, which still creates an ERROR deployment for the same exact SHA; and
8. a compatible, separately tested Sharp/libvips dependency remediation.

Real-account testing remains prohibited until the credential hold is cleared.
PR #1175 must remain draft and unmerged.
