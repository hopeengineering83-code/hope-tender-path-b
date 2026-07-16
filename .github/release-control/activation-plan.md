# Control Tower Activation and Live-Proof Plan

**Status:** PLAN ONLY. Nothing in this document authorizes activation, merge,
approval, deployment, or a production migration. Each step below requires an
explicit, separate manager (CHATGPT-M1) authorization before it may be performed.

## Why a plan is needed

The exact-head worker validation, independent-audit gate, and atomic integration
controls currently exist only inside the unmerged bootstrap PR #1130. Workflows do
not become repository authority for `issues`, `schedule`, `workflow_run`, or
worker-PR events until they exist on the default branch. Until then no real worker
head has completed the full cycle
(exact-head validation → independent audit → atomic zero-partial integration →
release gate) under default-branch authority. This plan describes how to prove the
cycle harmlessly, in order, without ever merging worker code or deploying.

## Preconditions (all must already be green)

1. PR #1130 Control Tower CI `validate-control-plane` is green (actionlint + all
   assertion steps + all `.github/release-control/tests/**` simulations).
2. `.github/release-control/independent-auditors.json` has at least one genuinely
   independent identity (a distinct human collaborator account, or an allow-listed
   trusted GitHub App) that is **not** any worker account and **not** the shared
   authoring account. While this list is empty the integration gate fails closed.
3. FREEZE_MODE routing remains in force; `main` stays frozen.

## Ordered live-proof steps (each needs explicit authorization)

1. **Promote read-only.** With manager authorization, land the reviewed workflow
   files on the default branch so `pull_request`, `workflow_run`, `issues`, and
   `schedule` events become authoritative. No worker code is incorporated by this
   step. Production release stays frozen.
2. **Trigger worker validation.** Open or synchronize one real draft worker PR
   against `integration/controlled-recovery`. Confirm `Worker Exact-Head Validation`
   runs, that untrusted execution holds `contents: read` only, and that the trusted
   publisher emits `worker-exact-head-validation` on the exact head.
3. **Prove fail-closed.** Confirm a missing database service is reported
   `NOT_CONFIGURED` and a skipped required suite is reported `SKIPPED_BLOCKER`, and
   that neither can PASS.
4. **Prove green-is-not-approval.** Confirm the Repair Coordinator moves the PR only
   to `awaiting-independent-audit` and records `VALIDATED_HEAD_SHA`, never an
   approval or integrator-ready marker.
5. **Prove independent audit.** Have the allow-listed independent identity post the
   exact-head `CONTROL_TOWER_AUDIT` acceptance. Confirm a same-account or author
   marker, or a stale `Reviewed-Head-SHA`, is rejected.
6. **Prove atomic integration.** Apply the accepted head with the Integration
   Controller and confirm the integration branch fast-forwards exactly once, and
   that a deliberately conflicting candidate leaves the integration branch unchanged
   with zero partial push.
7. **Prove no release side effects.** Confirm no merge to `main`, no production
   deployment, and no production migration occurred at any step.

## Lane labeling and mapping (manager-applied, fail-closed)

Worker validation requires exactly one recognized `lane:<NAME>` label. To prevent a
worker from selecting a different, weaker recognized lane, the label is applied by
the manager (CHATGPT-M1), derived from the immutable finding/issue → lane ownership
mapping in `.github/agents/worker-roster.md`, not chosen by the worker:

| Worker / Issue | Lane label |
| --- | --- |
| GLM-A1 — Issue #1134 | `lane:GLM-A1` |
| GLM-A2 — Issue #1135 | `lane:GLM-A2` |
| GLM-X1 — Issue #1136 | `lane:GLM-X1` |
| CHATGPT-C1 — Issue #1137 | `lane:CHATGPT-C1` |
| CHATGPT-C2 — Issue #1138 | `lane:CHATGPT-C2` |
| JULES-T1 — test expansion | `lane:JULES-T1` |
| JULES-U1 — UI/document workflow | `lane:JULES-U1` |
| JULES-S2 — security regression | `lane:JULES-S2` |

Rules:

- The manager applies exactly one lane label after confirming the PR's finding/branch
  matches the roster owner. A missing, unrecognized, or multiple lane labels are
  `NOT_CONFIGURED` and fail closed.
- The lane's focused required suites are in `.github/release-control/required-suites.json`
  and are appended to the default suite set; a worker head cannot pass while its
  assigned lane suites do not execute.
- CHATGPT-C2's responsive suite requires `e2e/responsive-viewport-matrix.spec.ts`
  (390/1024/1440). Until that reviewed spec exists it is `NOT_CONFIGURED` and blocks —
  it never passes without proving each viewport executed.

## Hard stops

- No worker SHA is incorporated until steps 1–6 pass for that exact head.
- No merge to `main`, deployment, or production migration without a separate,
  explicit human release authorization.
- Any head movement re-invalidates prior validation and audit and restarts the
  cycle for the new exact head.
