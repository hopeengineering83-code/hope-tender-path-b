# Open-PR Unique-Code Consolidation Ledger — 2026-07-28

Governing parent: draft PR #1175, branch `release/consolidated-recovery-20260717`  
Frozen starting SHA for this pass: `b8f15162595e5a984169d97719942cf6906599bd`  
Repair child: draft PR #1274, branch `fix/pr1175-final-open-pr-audit-consolidation`

Live refetch: **2026-07-29 11:42 UTC**. GitHub still reported six open PRs.
The frozen heads were #1175 `b8f15162595e5a984169d97719942cf6906599bd`
(base `integration/controlled-recovery` at `b3c9db5de89a2a665e61a83facbff0f276f9983c`)
and #1274 `130f1c130aa63c2d17a5b5758f43ee0a9e991082` (base exactly the
frozen #1175 head). #1274 therefore required no parent reconciliation before
repair. GitHub reported both draft and mergeable; #1175's required CI was green,
while #1274 had one failed job containing exactly two obsolete assertions.

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
