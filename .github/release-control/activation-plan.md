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

## Hard stops

- No worker SHA is incorporated until steps 1–6 pass for that exact head.
- No merge to `main`, deployment, or production migration without a separate,
  explicit human release authorization.
- Any head movement re-invalidates prior validation and audit and restarts the
  cycle for the new exact head.
