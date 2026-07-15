# Integrator Contract

**Version:** 3.0  
**Owner:** CHATGPT-M1 — App Manager and Release Controller

## Purpose

The integrator is the only writer to the controlled integration branch. It accepts one immutable worker SHA at a time, validates it, applies it atomically, reruns the combined release gate, and never merges to `main`.

## Controlled branches

- Control Tower construction branch: `fix/github-control-tower`
- Control-plane base: `automation/control-plane`
- Runtime integration branch: `integration/controlled-recovery`
- Final integration PR: `integration/controlled-recovery` → `main`, always draft until explicit human release authorization

## Pre-integration requirements

The worker PR must:

1. Be open and target `integration/controlled-recovery`.
2. Match the exact accepted head SHA.
3. Have all required external checks completed successfully on that SHA.
4. Have no unresolved `CHANGES_REQUESTED` review.
5. Contain no forbidden files or undeclared migration.
6. Contain executable tests appropriate to the change.
7. Not overlap an active worker's file/function ownership.
8. Have a non-bot authorized manager comment containing exactly `ACCEPTED_HEAD_SHA: <current-head-sha>`.
9. Receive the `integration-approved` label from an actor with write, maintain, or admin permission.

`VALIDATED_HEAD_SHA` records green CI only and is never acceptance. A moved head invalidates both validation and manager acceptance.

## Atomic incorporation

1. Read and record the integration branch start SHA.
2. Re-read the worker PR head and authorized acceptance comment.
3. Create a temporary local candidate from the start SHA.
4. Apply every accepted commit to the candidate.
5. Re-read the worker PR head and target branch head.
6. On any conflict, moved head, failed validation, or changed target head: abort, reset, and push nothing.
7. Only after all checks pass, fast-forward the integration branch once.
8. Rerun the combined release gate on the resulting exact SHA.
9. If combined validation regresses, reopen the finding and block further incorporation until corrected.

## Prohibited actions

- Merge or approve any PR.
- Treat green CI or a validation marker as manager acceptance.
- Mark the final integration PR ready for review automatically.
- Deploy or run production migrations.
- Force-push.
- Resolve semantic conflicts by choosing all incoming or all current changes.
- Modify application runtime logic directly instead of incorporating reviewed worker commits.
- Push a partial subset after a multi-commit failure.

## Activation limitation

Issue, schedule, and repository-dispatch workflows become operational only after the workflow definitions exist on the repository default branch. In other words, the workflows exist on the default branch only after intentional promotion. While PR #1130 remains unmerged, its workflows may be validated through PR checks and explicit simulations, but they must not be described as an active autonomous control plane.

## Release stop condition

Automation stops at `release-candidate-ready` after the complete Definition of Done passes on one unchanged integration SHA. Final merge and production deployment require explicit human authorization.
