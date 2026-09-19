# PR #1175 exact-head release recheck — 2026-07-30

## Frozen live authority

- GitHub and Vercel were refetched before verification.
- PR #1175 was the only open pull request, remained draft and unmerged, and
  pointed to `c3c2f834a438d9848fd383fdec1cddef6e82b382` on
  `release/consolidated-recovery-20260717`.
- Its base was `b3c9db5de89a2a665e61a83facbff0f276f9983c` on
  `integration/controlled-recovery`.
- Closed PR #1274's final head
  `0611690b1486402df6fb5431b055b219390517e7` was an ancestor. The earlier
  observed #1274 heads `130f1c130aa63c2d17a5b5758f43ee0a9e991082`
  and `b8f15162595e5a984169d97719942cf6906599bd` were also ancestors.
- The intended preview `dpl_CyLnTGypAQTq5Q59sMiFHP6xpv2V` was `READY`
  at the exact SHA. The duplicate `repo` project still produced an `ERROR`
  deployment at that SHA.

## Independent repository and PostgreSQL proof

A disposable local PostgreSQL 16 database, not the configured remote database,
accepted all 43 ordered migrations. Critical-schema verification,
retroactive-bootstrap verification, a second idempotent migration deployment,
and Prisma zero-drift comparison passed. Prisma validation and generation,
release-integrity (418 routes and 1,390 files), TypeScript, zero-warning ESLint,
and the production build passed. The locally repeated complete unit/PostgreSQL
suite passed 8,928/8,928 assertions with normal test concurrency. The exact-head
GitHub push artifact independently reports 8,930/8,930 assertions; the two-test
difference is environment-conditional coverage, not a failure in either run.

The first clean-install attempt encountered npm's `ENOTEMPTY` cleanup race
against a pre-existing `node_modules/@prisma/engines` directory. After removing
`node_modules`, the locked dependency installation completed with 627 packages.
Tracked-source hashes and `git diff --exit-code` proved that installation,
tests, and the build did not mutate tracked source. `npm audit` continues to
report the already-documented three high-severity advisories; no unsafe forced
major-version remediation was applied.

## Exact-head CI, browser, and visual evidence

Exact-head GitHub runs `30498185202`, `30498188486`, and `30498188073` were all
successful. Their retained command ledgers bind every result to
`c3c2f834a438d9848fd383fdec1cddef6e82b382`. The push run reports 8,930 unit and
PostgreSQL assertions passing, followed by 179 Playwright assertions passing,
four environment-conditional skips, and zero failures. The parallel pull
request run reports 180 passing and three environment-conditional skips; both
runs exited cleanly. The screenshot artifact covers 111/111 expected
route/viewport combinations and retains 237 images with zero critical,
warning, uncovered-route, or horizontal-overflow finding.

The retained desktop dashboard, tablet Review Inbox, and mobile tender images
were visually inspected. The tablet image exposes exactly one Review Inbox
control and no obsolete Review Board or Diagnostics control. No critical
overlap, clipping, contradictory owner, or horizontal overflow was found in the
three inspected captures.

## Generated-byte falsification

The exact-head push artifact was downloaded and independently reopened. Its
recorded sizes and hashes recomputed exactly:

- `Technical-Proposal.docx`: 12,092 bytes,
  SHA-256 `8f15044642e22a2b21d247424cfe2ba4cbd568dd5178074fad6453ccfc9d2eb0`;
- `Technical-Proposal.pdf`: 985 bytes,
  SHA-256 `b4cb843088fa24f2a346940b515b34d8311e827d629d92bddf1d0244df476d64`;
- `Final-Submission-Package.zip`: 10,419 bytes,
  SHA-256 `34250e59e9de50a2c9f2ce26ab07913fca276ee1fa12948a2be175dd15f1691f`.

The parallel pull-request artifact was also reopened rather than assumed
identical. Its timestamp-bearing containers have different expected hashes and
sizes, but its own manifest recomputes exactly. The DOCX Office container and
all XML/relationship documents parse, and Heading 1–3 styles, an updating TOC
field, header/footer relationships, a page-number field, and embedded synthetic
brand media are present. No Markdown fence, raw HTML, forbidden placeholder,
or `Bid-Team to confirm` text was found. The PDF begins `%PDF-1.7`, opens under
`pdfinfo`, contains one non-encrypted A4 page, and has no JavaScript. The Final
ZIP opens, contains only the two manifest-ordered technical-envelope files,
and each reopened entry is byte-identical to its source artifact.

## Exact preview and runtime evidence

The intended preview returned HTTP 200 from `/api/version` and `/api/health`.
Both endpoints identified the exact release SHA; health reported the five
critical tables, eight configured providers, and durable private Blob storage
ready. A fresh deployment-scoped Vercel query returned 100 events with no
`P2022`, `P2002`, Prisma, unhandled 500, timeout, stuck-job, duplicate-job,
database URL, or PostgreSQL credential match. Post-test value-based scans found
neither the GitHub nor Vercel token in tracked files or retained local evidence.

## Release disposition

No new application, schema, migration, workflow-authority, security, tenant,
concurrency, or generated-byte defect was found in this pass. No gate was
weakened and no production code was changed. Completion and production
readiness are still not claimed because approved synthetic preview credentials
were unavailable for a fresh provider-backed persisted preview workflow, and
the existing external holds remain: rotate the exposed real password, revoke
sessions, replace the affected automation secret, sanitize retained
credential-bearing artifacts, complete owner UAT, fix or remove the duplicate
Vercel project, and validate a compatible remediation for the residual npm
advisories. PR #1175 must remain draft and unmerged.
