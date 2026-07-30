# Open-PR Unique-Code Consolidation Ledger — 2026-07-28

Governing parent: draft PR #1175, branch `release/consolidated-recovery-20260717`  
Frozen starting SHA for this pass: `b8f15162595e5a984169d97719942cf6906599bd`  
Repair child: draft PR #1274, branch `fix/pr1175-final-open-pr-audit-consolidation`

## 2026-07-30 principal live-state refresh

GitHub and Vercel were refetched independently. PR #1175 is the only open pull
request and remains draft and unmerged at
`1e113fa529718b9052e762efd15fbf51144ccaca`. Closed #1274 head
`0611690b1486402df6fb5431b055b219390517e7` is exactly the merge base and an
ancestor of #1175, so its complete verified consolidation is present. No open
donor remains to classify or close. The fresh five-pass recheck, local
PostgreSQL/browser results, generated-byte hashes, preview identity, and
external holds are recorded in
`docs/audits/pr1175-principal-release-recheck-20260730.md`. No new product,
schema, migration, dependency, test, or workflow-authority change was required.

## 2026-07-29 dependency-security falsification and live-state refresh

GitHub was refetched again before this pass. PR #1175 remains open, draft and
unmerged at `d514027ca9dd46e904726f50e250c74586f507fa`; the complete closed
#1274 head remains its ancestor. The only other open PR is the
documentation/security child #1276; #1266, #1267 and #1270 have been closed
after their useful documentation was incorporated into #1175. No donor gained unique application,
schema or migration code. #1276 adds this exact-head evidence and the compatible
dependency repairs below; it does not change workflow authority or a database
contract.

A clean `npm ci` falsified the earlier security evidence by reporting newly
published high-severity advisories. The production-relevant compatible repairs
are Next.js `15.5.19` to `15.5.22` and the repository PostCSS override `8.5.10`
to `8.5.18`. This closes the disclosed Next.js Server Action, SSRF, cache and
PostCSS source-map/path traversal ranges without a framework major upgrade.
The lockfile now resolves those patched versions reproducibly.

`npm audit --omit=dev` still reports the Next.js dependency on Sharp 0.34.5
because the current advisory requires Sharp 0.35 or later, while the Next.js
15.5 line pins the older optional package. The audit tool offers only a
framework-major/downgrade-shaped remediation and adding a top-level Sharp does
not replace Next's nested package, so that ineffective change was rejected.
The remaining development-only minimatch/brace-expansion advisory likewise has
no non-major ESLint remediation offered by npm. Neither residual is represented
as fixed; both require a separately validated framework/toolchain upgrade or an
upstream compatible patch.

Local verification on the dependency-patched child passed clean installation,
install/build source-mutation guards, Prisma validation and generation,
release-integrity, workflow-consistency, typecheck, zero-warning lint and a
production build using a synthetic provider value. Falsification found the
release-integrity audit still hard-coded the superseded PostCSS 8.5.10 pin; the
audit now pins the actual patched 8.5.18 resolution and passes. The configured
Neon test endpoint was unreachable, so the full PostgreSQL run was stopped
after repeated setup failures and is not counted as a local pass. The parent exact-head GitHub
run remains the database evidence: 8,930/8,930 tests and 179 passed / 3 skipped
Playwright checks. #1276's pre-dependency documentation head also passed CI,
but the dependency commit requires its own exact-head CI before incorporation.

GitHub deployment records still show the intended #1175 exact-SHA preview as
successful and the duplicate `repo` project as failed. This environment still
has no Vercel token, retained-log access or approved synthetic preview account.
Provider-backed persisted preview acceptance, runtime-log certification,
external credential rotation/session revocation/secret replacement, owner UAT,
duplicate-project remediation and the two unresolved dependency advisory
families remain explicit release blockers. No completion or production-ready
claim is made, and no open PR is closed in this pass.

## 2026-07-29 final live-state and exact-head evidence refresh

GitHub was refetched after the prior audit-event repair. PR #1175 remains open,
draft and unmerged at `5796df77fd5d50489df8c28ee9cd22e54767c707`, based on
`b3c9db5de89a2a665e61a83facbff0f276f9983c`. The complete closed #1274 head
`0611690b1486402df6fb5431b055b219390517e7` is an ancestor. The only other
open PRs are #1266, #1267 and #1270, whose file- and commit-level dispositions
remain unchanged below; no new product, schema, migration or executable test
change appeared in any of them.

Both exact-head CI runs and the exact-head route/screenshot workflow are now
green. The downloaded `exact-head-acceptance-5796df77...` artifact records all
43 migrations deployed, an idempotent second deployment, zero Prisma drift,
critical-schema and retroactive-init verification, release-integrity, clean
typecheck and lint, **8,930/8,930** unit/PostgreSQL tests, a production build,
and **179 passed / 3 skipped / 0 failed** Playwright checks. Install, build and
test source-mutation checks also passed. The separate route manifest covers
**111/111** route/viewport combinations with zero critical findings, warnings
or horizontal overflow.

The intended Git-triggered Vercel preview returned HTTP 200 from `/api/version`
and `/api/health` and reported the exact full release SHA. Storage was durable
and critical tables were present. The duplicate `repo` project still failed.
No `VERCEL_TOKEN`, retained-log access or approved synthetic preview credential
is available in this environment, so retained runtime-log certification and a
complete provider-backed persisted preview workflow remain external acceptance
holds. The real-account credential hold also remains in force. Consequently,
#1266, #1267 and #1270 are not closed and completion/release readiness is not
claimed.

The generated-byte artifact was independently reopened. DOCX, PDF and ZIP
lengths and SHA-256 values recomputed exactly; the DOCX is produced by the live
production renderer and contains Word heading styles, an updating TOC field,
header/footer relationships, page numbering and a synthetic embedded brand
asset; the PDF has genuine `%PDF` bytes; and ZIP entries are byte-identical to
the manifest in the recorded order. This is deterministic synthetic byte proof,
not a substitute for the still-blocked provider-backed preview acceptance.

Local clean-install, Prisma validation/generation, release-integrity,
workflow-consistency, typecheck, lint and non-database focused tests were also
rerun. The configured disposable Neon database endpoint was unreachable from
this container, so the local PostgreSQL persistence test was cancelled at its
setup hook; this is an environment limitation and is not represented as a
passing local database run. The exact-head GitHub PostgreSQL result above is the
current database-backed evidence.

## 2026-07-29 exact-head audit-event falsification

The successful exact-head CI artifact for
`28516828cd2e9e79f11892bdd2fadf6f2f41e8ab` was inspected below the aggregate
test result. Its PostgreSQL test log contained repeated `P2003` audit-write
warnings from `tests/production-workflow-engine.test.ts`: the workflow runner
used the injected Prisma client for workflow state but discarded it for audit
persistence, causing `logAction` to write through the global singleton. The
mock-based workflow assertions therefore passed without proving the required
audit event, while the shared test database rejected the fixture's nonexistent
actor foreign key.

`logAction` now accepts an optional narrowly typed audit client and retains the
global singleton as its default for all existing callers. The workflow runner
passes its own client explicitly, keeping workflow and audit persistence on the
same configured database boundary without moving the best-effort audit write
inside the business transaction. The production workflow test captures that
client's audit writes and asserts actor, tender, tenant, operation, output IDs,
success/failure status, blocker/warning counts and safe failure code. This is a
release-evidence repair discovered by falsification; no gate, schema, migration
or open-PR disposition changed. A new exact-head CI and preview are required
after incorporation before the prior green result can be treated as current.

## 2026-07-29 independent exact-head refresh and PR #1267 correction

GitHub and the Git-triggered Vercel deployment records were refetched at
`14350b494112d8710131bf4781b88e40e2d7bb2d`. PR #1175 remains open, draft and
unmerged; its complete #1274 head
`0611690b1486402df6fb5431b055b219390517e7` is an ancestor. Both exact-head CI
runs and the exact-head route/screenshot run are green. The intended preview
reports the exact release SHA from `/api/health` and the short SHA from
`/api/version`; the duplicate `repo` deployment still fails. No Vercel log
credential or approved synthetic preview credential is available, so retained
runtime-log certification and the provider-backed persisted preview workflow
remain external acceptance holds.

The current open list is #1175, #1270, #1267 and #1266. A commit-level review
corrects the earlier shorthand description of #1267. GitHub's current PR file
view exposes only its audit note after the target branch advanced, but its
unique commit `93f354be7e87f5c7b0fa5c7908f349c9ad9df254` was made from
`227669cf9092092745411644c60b71aca6bf0d40` and contains six paths. Every path
has the following explicit disposition:

| #1267 path | Unique change | Production caller / product effect | Disposition |
|---|---|---|---|
| `docs/audits/pr1175-current-head-restart-20260727.md` | Historical restart note for an obsolete head | None | Not copied. Its still-relevant findings are represented in the current canonical ledgers and exact-head evidence. |
| `app/api/company/review-summary/route.ts` | Replaces durable provenance validation with raw `trustLevel === "REVIEWED"` counting | Company review-summary API; would overstate generation-ready evidence | Rejected as policy-unsafe. Current code retains `isDurablyReviewed` and revision/source/quote integrity. |
| `app/dashboard/company/page.tsx` | Removes the canonical ingestion-readiness fetch and derives reviewed totals from looser local rows | Company Vault summary; would contradict Engine eligibility | Rejected as a competing, weaker readiness authority. |
| `tests/company-review-summary-durable-review-count.test.ts` | Deletes API durable-review regression coverage | Guards the production review-summary consumer | Rejected; the load-bearing test remains in #1175. |
| `tests/company-vault-summary-durable-review-count.test.ts` | Deletes UI canonical-readiness regression coverage | Guards Company Vault/Engine count agreement | Rejected; the load-bearing test remains in #1175. |
| `tests/run-next-terminal-error-message.test.ts` | Reverts the extraction-job fixture to an obsolete missing-file contract and expected category | Durable worker safe-error persistence | Rejected as stale against the current hash/company-bound extraction handler. Current coverage exercises the live handler contract without leaking identifiers. |

PR #1270 remains an eleven-line handoff-only record of a now-false lack of
GitHub access, and #1266 remains one supplementary audit document frozen at an
obsolete SHA. Neither has a production importer, schema/migration effect or
executable product change. They are not closed in this pass because the user's
closure precondition still requires the unavailable retained-log and complete
persisted preview acceptance. No open-PR commit was merged or cherry-picked.

## 2026-07-29 generated-byte evidence falsification

GitHub, the open-PR list and deployment state were refetched after #1175
advanced to `cc1de672d4ba8a90f140333117d23a836ff3056d`. The complete #1274 head
`0611690b1486402df6fb5431b055b219390517e7` is an ancestor of that head;
`git cherry` reported no #1274-only patch. The remaining open PRs were #1266,
#1267 and #1270 plus governing #1175, and their changed-file manifests remained
documentation/handoff-only as classified below.

The credential-free exact-head CI artifact was downloaded and its claimed
DOCX/PDF/ZIP outputs were reopened independently. The recorded hashes and byte
lengths recomputed correctly, the PDF had genuine PDF bytes, and the Final ZIP
contained byte-identical copies in the recorded order. However, the DOCX
artifact had been created by an ad hoc minimal test builder rather than the
production renderer. It contained no heading styles, native TOC field,
header, footer or brand media, so it could not prove the required production
document characteristics despite being a valid Office ZIP.

`tests/generated-output-binary-inspection.test.ts` now constructs its synthetic
acceptance document through the production `buildProfessionalDocument` and
`markdownToDocx` functions. Before writing release evidence it requires Heading
1-3 styles, an updating native Word TOC, header/footer/image relationships, a
page-number footer and an embedded synthetic Company Vault brand asset. The
fixture explicitly labels every identity and fact synthetic; it does not invent
or imply real tender/company evidence.

This repairs the byte-proof harness, not the remaining preview acceptance hold.
The intended preview `/api/version` and `/api/health` both returned HTTP 200 and
identified the exact `cc1de672…` release, but no approved synthetic preview
credential or Vercel log token is available for the required persisted,
provider-backed workflow and retained-log inspection. The duplicate `repo`
Vercel project also still reports a failed deployment. Those items remain
external blockers and no completion or release-readiness claim is made.

## 2026-07-29 exact-head evidence falsification follow-up

The successful `d9b87fe4…` CI artifact was downloaded and inspected rather
than treating its green conclusion as sufficient proof. Its Playwright log
reported **one flaky first-attempt failure**: the all-routes audit reused one
page for consecutive hard navigations, interrupted streamed React hydration,
and recorded React error 418 plus repeated `parentNode` errors against the AI
readiness checkpoint. The retry passed, which made the command exit zero, but
the first-attempt runtime errors violate the zero-runtime-error acceptance
standard. The audit now uses a fresh authenticated page per route, isolating
runtime evidence and preventing the next route from interrupting the prior
route's hydration.

The same artifact also showed anonymous probes of the System Safety Center
logging an `Unauthorized` server exception. Next may render the page and its
parent layout concurrently, so the page's throwing API-style `requireRole`
guard could lose the race to the layout redirect. The page now performs its
own session and ADMIN lookup and uses explicit page redirects before running
release diagnostics. These changes require a new exact-head CI and preview;
the prior green artifact is no longer the final release proof.

## 2026-07-29 12:30 UTC live-state refresh

GitHub was refetched after the controlled consolidation completed. PR #1175
was still open, draft and unmerged at `0611690b1486402df6fb5431b055b219390517e7`;
PR #1274 was closed and reported that same head SHA, so its complete verified
tree was incorporated into #1175. The only other open PRs were #1266, #1267
and #1270. Their live commit and changed-file manifests remained exactly the
documentation/handoff-only dispositions recorded below; none had gained a
schema, migration, production importer, executable test or unique application
change.

The exact `0611690b…` GitHub CI and screenshot checks were green. GitHub's
deployment API reported a successful exact-head preview for the intended
`hope-tender-path-b` project and a second failed deployment for the duplicate
`repo` project. The latter remains an external configuration blocker. The
remaining documentation-only PRs were deliberately left open: the governing
instruction permits closure only after complete exact-preview persisted
workflow and runtime-log acceptance, and those checks still require an
approved synthetic preview credential and Vercel log access. This is a closure
precondition, not unique donor code.

Live refetch: **2026-07-29 12:00 UTC**. GitHub reported five open PRs:
`#1175`, `#1266`, `#1267`, `#1270`, and `#1274` (the earlier donor
`#1273` had already been closed after incorporation into `#1274`).
The frozen heads were #1175 `b8f15162595e5a984169d97719942cf6906599bd`
(base `integration/controlled-recovery` at `b3c9db5de89a2a665e61a83facbff0f276f9983c`)
and #1274 `04886d157bd159dce8caf67cfc6748bead73951c` (base exactly the
frozen #1175 head). #1274 therefore required no parent reconciliation before
repair. GitHub reported both draft and mergeable. Exact-head #1274 CI run
`30448924162` completed successfully: all 43 migrations deployed, the second
deploy was idempotent, Prisma reported zero drift, critical-schema and
retroactive-init checks passed, release-integrity checked 418 routes and 1,390
files, all 8,930 unit/PostgreSQL tests passed, the production build passed, and
Playwright passed 179 tests with three documented skips. Install-, build-, and
test-time source-mutation checks all passed. The credential-free evidence
artifact is `exact-head-acceptance-04886d157bd159dce8caf67cfc6748bead73951c`.

This ledger distinguishes ancestry, unique safe code, conflicting policy, stale audit evidence, and non-product changes. No donor is incorporated wholesale merely because it is open.

| PR | Relationship to frozen #1175 | Unique-code disposition |
|---|---|---|
| #1175 | Governing draft | Remains the only consolidation target. Keep draft; do not merge or deploy production. |
| #1271 | Its head `ff4f78d2…` is already an ancestor of frozen #1175 | Incorporated. Durable extraction, truthful source verification, Review Inbox support families, Final ZIP authority, Build Plan authority, CI evidence, requirement coverage and related tests are already present. |
| #1273 | Direct donor from frozen `b8f15162…` | Incorporated into #1274 with ancestry recorded at merge commit `7e4cb201…`: ten unreachable/competing modules and the source-only legacy reconciliation test were removed; affected tests now target the live workflow runner, live job claim/classifier and live extraction modules; a recurrence guard rejects phantom source-asserted modules. |
| #1269 | Diverged one-commit donor | The safe Analytics `deletedAt: null` relation-count correction is already present. Automatic machine evidence must remain `SOURCE_VERIFIED`; the donor's machine-to-human `REVIEWED` policy is intentionally rejected. |
| #1268 | Stale, unmergeable, based on `736c7178…` | Current #1175 already contains the useful password-reset transaction repair, metadata-revision invalidation, source remapping, durable extraction and purpose-aware evidence eligibility. Its broader EXPORT-policy changes are not blindly replayed. |
| #1267 | Obsolete restart note with failed historical CI | Superseded by #1271 and this pass. No unique product code. |
| #1266 | Documentation-only supplementary audit | Findings were revalidated individually. Closed findings are not replayed; remaining valid findings are repaired in #1274 or recorded as external acceptance work. |
| #1270 | Handoff-only PR against `main` | No application/schema/test feature code. Not an eligible donor for #1175. |
| #1274 | Current repair child | Adds revalidated gaps not already safely incorporated: live route/action ownership, migration-first development startup, production support-record eligibility tests, one real atomic Final ZIP persistence owner, truthful Authority Review availability, and #1273 dead-authority cleanup. |

### Current open-PR changed-file disposition

- **#1266:** `docs/audits/pr1175-supplementary-coverage-ledger.md` is
  documentation-only. Its findings were revalidated; it has no production
  importer, schema change, migration, tenant boundary, or executable product
  code to incorporate.
- **#1267:** `docs/audits/pr1175-current-head-restart-20260727.md` is a stale
  audit restart marker. It has no production importer, schema change,
  migration, test, or unique product behavior.
- **#1270:** its two commits modify only `operator_handoff.md` on a branch
  based on `main` and record that GitHub access was unavailable. That historical
  precondition is false in this controlled session and contributes no product
  code, test, schema, or migration.
- **#1274:** the complete 41-file manifest is the Git diff from frozen #1175
  `b8f15162…` to exact green head `04886d15…`. Production changes are limited
  to the Authority Review route/panel and shared availability policy, Final ZIP
  download/preflight/persistence ownership, audit event, live action registry,
  migration-first development command, and removal of ten unreachable
  duplicates. The remaining changed files are the executable regression tests,
  this ledger, and `operator_handoff.md`. No Prisma schema or migration is
  changed by #1274. Each deleted module had zero production importers at the
  frozen base; `tests/no-phantom-source-asserted-modules.test.ts` prevents those
  source-only authorities from recurring. Exact dispositions and incorporation
  commits are recorded in the commit list and policy sections above.

## 2026-07-29 exact failure disposition

The two failures in `runtime-idempotency-route-security.test.ts` inspected the
source of POST `/api/tenders/:id/export` and demanded that it create a READY
package and supersede older packages. They contradicted the live owner model:
POST export is readiness preflight; GET download constructs the real ZIP and
calls `persistVerifiedExportPackageDownload`. The obsolete assertions were
removed rather than forcing a second package creator into production.

The executable PostgreSQL suite remains the load-bearing replacement. It now
proves that the download persistence owner serializes identical requests,
rejects a foreign tenant, rejects invalid integrity metadata without mutating a
READY row, supersedes an older different-hash READY snapshot in the same
transaction, persists the exact ZIP hash/length/manifest, and transitions the
owned tender to EXPORTED. The incorporation SHA is the commit containing this
ledger update on #1274; it must not be described as part of #1175 until that
commit is actually incorporated there.

## Policy conflicts resolved

1. **Machine verification is not human review.** Automatic source proof creates `SOURCE_VERIFIED` with no human reviewer identity. It may be used only according to the canonical purpose-aware eligibility policy.
2. **Signature/stamp behavior follows the current owner-approved branch policy.** This pass does not silently replace the current policy with an older donor's conflicting interpretation.
3. **No stale donor route registry is retained.** Registry mutations must match a live route and actual HTTP method; read-only surfaces remain navigation actions.
4. **No donor is accepted because its tests are green.** Unique code must also be current, reachable, tenant-safe, policy-compatible and non-duplicative.
5. **Source-string assertions are supplemental only.** Load-bearing claims must point to a live production owner and have executable service, PostgreSQL, route or browser proof.

## Remaining non-code acceptance items

- exact matching Vercel preview and retained runtime-log proof for the final incorporated SHA;
- a controlled, realistic provider-backed success workflow through generated DOCX, required PDF and final ZIP;
- real-account testing remains prohibited until password rotation, session revocation, secret replacement and artifact sanitization are complete;
- duplicate/misconfigured Vercel project `repo` requires dashboard-level cleanup.
