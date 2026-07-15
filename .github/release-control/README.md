# Release Control

This directory contains Control Tower contracts, simulations, and evidence conventions.

## Current phase

PR #1130 is a **bootstrap package, not an active autonomous control plane**. GitHub repository events and schedules use workflow definitions from the default branch. Until the reviewed workflows are intentionally promoted, they can be checked through PR CI and explicit simulations only.

Application workers may create isolated draft PRs against the frozen integration branch during bootstrap. No worker SHA may be incorporated, merged to `main`, or deployed until Control Tower exact-head and atomic-integration acceptance passes.

## Durable authority

- One GitHub Issue per finding.
- Machine-readable finding data may be embedded in the issue body.
- Issue labels and comments carry task and review state.
- The linked draft PR carries branch, exact head SHA, changed files, and test evidence.
- Repository-generated finding files and mutable repository lock files are not authoritative.

## Branch model

### Control Tower bootstrap

- `fix/github-control-tower` contains the combined Control Tower changes.
- PR #1130 targets `automation/control-plane` and remains draft.
- Control Tower infrastructure changes stay inside PR #1130.

### Isolated application repair during bootstrap

- Worker branches start from the manager-authorized exact SHA of `integration/controlled-recovery`.
- Worker PRs target `integration/controlled-recovery` and remain draft.
- Workers do not push directly to the integration branch.
- No worker result is incorporated until Control Tower bootstrap acceptance passes.

### Controlled integration after activation

- Only the integrator writes `integration/controlled-recovery`.
- The final PR from `integration/controlled-recovery` to `main` remains draft until explicit release authorization.

## Current coding lanes

- Issue #1134 — GLM-A1, state truth and AI runtime.
- Issue #1135 — GLM-A2, matching and evidence selection.
- Issue #1136 — GLM-X1, report/document/export gates.
- Issue #1137 — CHATGPT-C1, Vault privacy and provenance.
- Issue #1138 — CHATGPT-C2, responsive navigation and API/UI contracts.

The provider registry, worker roster, and exact start prompts live under `.github/agents/`.

## Workflows

- `change-monitor.yml`: creates durable issue-backed findings.
- `agent-dispatcher.yml`: validates authorized dispatch requests and records honest waiting state.
- `repair-coordinator.yml`: enforces capacity, attempts, exact-head validation, and revision cycles without approving PRs.
- `integration-controller.yml`: requires an authorized exact-head acceptance comment and atomically incorporates accepted worker commits.
- `release-auditor.yml`: enforces freeze routing and invokes release validation for the integration candidate.
- `release-gate.yml`: executes the fail-closed release acceptance suite.
- `control-plane-bootstrap.yml`: creates controlled branches and one draft integration PR after activation.

## Safety boundaries

The Control Tower never:

- merges or approves a PR;
- deploys production;
- runs production migrations;
- force-pushes;
- treats skipped tests as passing;
- accepts a moved PR head;
- treats green CI as manager acceptance;
- permits overlapping worker ownership;
- weakens tender, evidence, generation, ownership, PDF, or ZIP gates.

## Validation before incorporation

Before any coding-worker SHA is incorporated:

1. PR #1130 exact-head syntax and simulation checks pass.
2. The worker issue and PR use the authorized integration SHA.
3. File and function ownership do not overlap.
4. Executable tests prove the assigned behavior.
5. Green CI records `VALIDATED_HEAD_SHA` only.
6. CHATGPT-M1 posts `ACCEPTED_HEAD_SHA: <sha>` after reviewing the actual diff and tests.
7. Atomic integration and the release gate pass without merge or deployment.

## Activation

After the bootstrap package is reviewed and intentionally promoted to the default branch, set `FREEZE_MODE=true`, run the bootstrap workflow, and validate one harmless end-to-end cycle. Production release remains separately protected.
