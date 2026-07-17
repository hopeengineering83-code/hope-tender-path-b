# Open PR gap matrix

Audited base: `808ed4b8992647a3dec7bbd2a2a6a8aca149d800`.

Remote enumeration is **ENVIRONMENT_BLOCKER**: `gh` is not installed, no session PAT is present, the private GitHub API rejects unauthenticated requests, and shell GitHub access is blocked by the environment's CONNECT proxy. The rows below therefore use the operator-supplied open-PR set and local exact-main source; they are not represented as current remote verification.

| Finding | Disposition | Ownership / evidence |
|---|---|---|
| F-01 exact-main CI | ENVIRONMENT_BLOCKER | No credential/tool path to inspect or dispatch Actions. |
| F-02 company review bounds/privacy | CLAIMED_BUT_NOT_PROVEN | Operator assigns PR #1146; deliberately not duplicated. |
| F-03 matching pagination/provenance | CLAIMED_BUT_NOT_PROVEN | Operator assigns PR #1139 with #1146 dependency; deliberately not duplicated. |
| F-04 admin index | SOLVED_IN_MAIN_BY_1162 | Route exists locally; role checks remain present. Browser role evidence is blocked. |
| F-05 AI readiness mobile clipping | NOT_SOLVED_BY_ANY_OPEN_PR | Exact-main source used a clipped five-column table. Repaired here with grouped mobile disclosure cards and retained desktop table. |
| F-06 export action clipping | SOLVED_IN_MAIN_BY_1162 | Exact-main source contains wrapping constraints; interactive screenshot proof blocked. |
| F-07 snapshot truth populations/actions | PARTIALLY_SOLVED_BY_OPEN_PR | PR #1157 owns canonical final-package readiness; no competing resolver added. |
| F-08 documents heading/empty state | NOT_SOLVED_BY_ANY_OPEN_PR | Exact-main still called the mixed planned/generated workspace “Generated Documents.” Repaired here. |
| F-09 system operational blockers | ENVIRONMENT_BLOCKER | Environment configuration cannot be truthfully inferred from source. |
| F-10 AI readiness density | NOT_SOLVED_BY_ANY_OPEN_PR | Repaired together with F-05 using native keyboard-accessible grouped disclosures. |
| F-11 tender detail length | CLAIMED_BUT_NOT_PROVEN | Requires fresh authenticated evidence; no speculative content removal. |
| F-12 404 destination label | NOT_SOLVED_BY_ANY_OPEN_PR | Exact-main root links were mislabeled dashboard links. Repaired here. |
| F-13 screenshot workflow secret pattern | CLAIMED_BUT_NOT_PROVEN | PR #1128 remains unsafe by hypothesis; PR #1163 claims related preview-workflow work, but its remote diff and security boundary could not be verified. Neither workflow was copied or modified. |
| F-14 conditional/unscheduled authority | PRODUCT_DECISION_REQUIRED | No business rule guessed; final gates remain fail-closed. |
| F-15 integration divergence | ENVIRONMENT_BLOCKER | Supplied divergence is acknowledged; no integration PR or reconciliation mutation performed. |

## Supplied open PRs

| PR | Supplied scope | Audit action |
|---|---|---|
| #1163 | Preview workflow | Not copied; remote diff/CI unavailable. |
| #1157 | Canonical final-package readiness | F-07 deferred. |
| #1146 | Vault privacy/review provenance/bounded review | F-02 deferred. |
| #1139 | Matching pagination/eligibility/provenance | F-03 deferred. |
| #1130 | Draft control-plane bootstrap | No overlap claimed. |
| #1128 | Temporary screenshot workflow | Unsafe credential pattern not reused. |
