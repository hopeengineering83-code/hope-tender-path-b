## Consolidated recovery — exact-head release evidence

> **Status:** Draft, unmerged, and held from release. This PR must not be
> merged until the external security, owner-UAT, provider-backed preview, and
> duplicate-project holds below are independently cleared.

### Release identity

- Governing branch: `release/consolidated-recovery-20260717`
- Base branch: `integration/controlled-recovery`
- Base SHA: `b3c9db5de89a2a665e61a83facbff0f276f9983c`
- The live PR description records the exact final documentation head after
  this file is committed; evidence below is bound to verified application head
  `274989d1da43c8b366b8135b766938a11e92ac52`.
- Controlled consolidation PR #1274 head
  `0611690b1486402df6fb5431b055b219390517e7` is incorporated ancestrally.

### Consolidation and open-PR disposition

The file- and commit-level authority ledger is
`docs/audits/open-pr-unique-code-ledger-20260728.md`. It records each donor's
unique behavior, production caller, policy effect, tests, and incorporation or
rejection reason. PRs #1273 and #1274 were incorporated through the controlled
consolidation. Documentation-only PRs #1266 and #1270 were preserved where
useful. PR #1267's weaker readiness changes were rejected while its useful
audit history was retained. PR #1287's relevant compliance evidence matching
was already independently incorporated with stronger coverage; its competing
synchronous/client-controlled Engine path was rejected. These redundant PRs
are closed with evidence. PR #1175 is the sole open PR and remains draft.

### Canonical retained workflow

The retained workflow has one revision-bound authority from durable Company
Vault ingestion and automatic source verification through tender extraction,
analysis, requirements, automatic verified Build Plan, deterministic durable
Engine/matching, explicit revision-bound evidence selection, generation,
validation, Authority Review, required-PDF finalization, approval, and verified
Final ZIP. `POST /api/tenders/:id/export` is a non-mutating fail-closed
preflight. `GET /api/tenders/:id/download?type=zip` is the only archive-byte
owner and persists the actual manifest, length, digest, and package revision
atomically after successful construction. No source, provenance, review,
validation, PDF, byte-integrity, or ZIP gate was weakened.

### Schema and migrations

All 44 ordered Prisma migrations deploy on disposable PostgreSQL. Critical
schema verification, retroactive bootstrap parity, a second idempotent deploy,
and Prisma zero drift pass. The latest migration,
`20260731183000_automatic_requirement_coverage_invalidation`, revision-binds
automatic evidence coverage and invalidates stale dependent state.

### Exact application-head verification

GitHub runs `30707024137`, `30707022343`, and `30707024138` passed on
`274989d1da43c8b366b8135b766938a11e92ac52`:

- clean locked install and install/test/build tracked-source mutation guards;
- Prisma validation and client generation;
- all migrations, critical schema, bootstrap parity, idempotency, and zero
  drift on disposable PostgreSQL;
- release-integrity, secret/public-DTO, storage-path/safe-error, and live route
  ownership audits;
- typecheck and ESLint with zero warnings;
- **8,916/8,916** unit and PostgreSQL assertions;
- production build;
- **180 passed / 3 documented conditional skips / 0 failed** Playwright cases;
- **111/111** route/viewport capture cases with zero critical, warning,
  uncovered-route, or horizontal-overflow findings.

`npm audit --omit=dev` currently reports zero vulnerabilities.

### Generated-byte proof

The retained exact-head artifact was downloaded and independently reopened:

| File | Bytes | SHA-256 |
|---|---:|---|
| `Technical-Proposal.docx` | 12,094 | `04a07b2933f376c310f9db70360002b50df4a2961125e6e2c53e9b99a26ffa27` |
| `Technical-Proposal.pdf` | 985 | `3aff6bd59d92ec54d70139c8af791ea853c2897988300480d1ab9757545e7867` |
| `Final-Submission-Package.zip` | 10,419 | `90aa748020ea1acf3f274f090cdb6e647f8e43f7af390ccf71143d35048ca317` |

The DOCX is a valid Office ZIP with parseable XML, heading styles, updating TOC
field, header/footer relationships, page numbering, and synthetic brand media;
it contains no Markdown fence, raw HTML, or forbidden placeholder. The PDF is
genuine `%PDF-1.7`, opens as a non-encrypted A4 page, and contains no
JavaScript. The Final ZIP opens and contains only the manifest-ordered DOCX and
PDF technical-envelope entries; lengths and hashes recompute exactly.

### Preview identity and runtime evidence

Git-triggered Vercel deployment `dpl_3o2HfYVb9VaLktAXzLo5mbJ1TKNR` is `READY`
and `/api/version` plus `/api/health` identify exact application SHA
`274989d1da43c8b366b8135b766938a11e92ac52`. Health reports all five critical
tables, durable private Blob storage, and eight configured providers. The
exact-head desktop (1440×1000), tablet (800×1280), and mobile (390×844)
captures have matching document/viewport widths and no recorded console, page,
request, or server errors.

### Intentionally rejected code

- competing synchronous or client-policy-controlled Engine execution;
- request-bound extraction/OCR in place of durable jobs;
- late Engine-worker Vault mutations that conflate extraction with evidence
  authority;
- machine-created human `REVIEWED` state or reviewer identity;
- weaker raw-status readiness counts and duplicated readiness/action owners;
- obsolete export tests that expected preflight to manufacture READY packages;
- unreachable duplicate workers, locks, extractors, policy helpers, and
  source-string-only tests for deleted authorities.

Exact reasons and affected files/commits are in the consolidation ledger.

### External release holds and remaining risks

These are not represented as code fixes or completed acceptance:

1. rotate the previously exposed real application password;
2. revoke existing sessions;
3. replace the affected automation secret;
4. sanitize retained credential-bearing artifacts;
5. complete owner UAT;
6. remove or correctly configure the duplicate failing Vercel project;
7. run a fresh complete provider-backed persisted preview workflow with an
   approved synthetic account and inspect post-workflow retained runtime logs.

Only synthetic accounts may be used while the credential hold remains. No
production deployment or production migration is authorized by this PR.
