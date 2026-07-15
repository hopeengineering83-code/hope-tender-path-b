# Integrator Contract

**Version:** 2.0  
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

1. Be open and draft.
2. Target the branch named by its issue contract.
3. Match the exact accepted head SHA.
4. Have all required checks completed successfully on that SHA.
5. Have no unresolved `CHANGES_REQUESTED` review.
6. Contain no forbidden files or undeclared migration.
7. Contain executable tests appropriate to the change.
8. Not overlap an active worker's file/function ownership.

A moved head invalidates prior acceptance.

## Atomic incorporation

1. Read and record the target branch start SHA.
2. Create a temporary local candidate from that SHA.
3. Apply every accepted commit to the candidate.
4. Re-read the worker PR head and target branch head.
5. On any conflict, moved head, failed validation, or changed target head: abort, reset, and push nothing.
6. Only after all checks pass, fast-forward the target branch once.
7. Rerun the combined release gate on the resulting exact SHA.
8. If combined validation regresses, reopen the finding and block further incorporation until corrected.

## Prohibited actions

- Merge or approve any PR.
- Mark the final integration PR ready for review automatically.
- Deploy or run production migrations.
- Force-push.
- Resolve semantic conflicts by choosing all incoming or all current changes.
- Modify application runtime logic directly instead of incorporating reviewed worker commits.
- Push a partial subset after a multi-commit failure.

## Activation limitation

Issue, schedule, and repository-dispatch workflows become operational only after the workflow definitions exist on the repository default branch. While PR #1130 remains unmerged, its workflows may be validated through PR checks and explicit simulations, but they must not be described as an active autonomous control plane.

## Release stop condition

Automation stops at `release-candidate-ready` after the complete Definition of Done passes on one unchanged integration SHA. Final merge and production deployment require explicit human authorization.
