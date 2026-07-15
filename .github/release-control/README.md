# Release Control

This directory contains the Control Tower contracts, schemas, tests, and evidence conventions.

## Current phase

PR #1130 is a **bootstrap package**, not an active autonomous control plane. GitHub repository events and schedules use workflow definitions from the default branch. Until the reviewed Control Tower workflows are promoted to the default branch, they can be checked in PR CI and explicit simulations only.

## Durable authority

- One GitHub Issue per finding.
- Machine-readable finding JSON is embedded in the issue body.
- Issue labels and comments carry state.
- The linked draft PR carries branch, exact head SHA, changed files, and test evidence.
- Repository-generated finding files, mutable lock files, and `integration-branch.txt` are not authoritative.

## Branch model

### Bootstrap construction

- `fix/github-control-tower` contains the combined Control Tower changes.
- Specialist bootstrap PRs start from and target `fix/github-control-tower`.
- PR #1130 targets `automation/control-plane` and remains draft.

### Runtime repair after activation

- Worker PRs start from and target `integration/controlled-recovery`.
- Only the integrator writes the integration branch.
- The final PR from `integration/controlled-recovery` to `main` remains draft until explicit release authorization.

## Workflows

- `change-monitor.yml`: identifies changed runtime or control surfaces and creates durable issue-backed findings.
- `agent-dispatcher.yml`: validates authorized dispatch requests and records honest worker state.
- `repair-coordinator.yml`: enforces capacity, ownership, attempts, exact heads, and revision cycles.
- `integration-controller.yml`: validates and atomically incorporates accepted worker commits.
- `release-auditor.yml`: enforces freeze routing and invokes release validation for the integration candidate.
- `release-gate.yml`: executes the fail-closed release acceptance suite.
- `control-plane-bootstrap.yml`: creates controlled branches and one draft integration PR only after activation.

## Safety boundaries

The Control Tower never:

- merges or approves a PR;
- deploys production;
- runs production migrations;
- force-pushes;
- treats skipped tests as passing;
- accepts a moved PR head;
- permits more than one worker to own the same finding or function;
- weakens tender, evidence, generation, ownership, PDF, or ZIP gates.

## Validation before worker start

Before coding workers begin:

1. PR #1130 exact-head workflow syntax checks must pass.
2. Worker issues must name `fix/github-control-tower` as both starting point and PR target during bootstrap.
3. File ownership between workers must not overlap.
4. Each issue must define executable acceptance tests.
5. A harmless simulation must prove no merge or deployment path exists.

## Activation

After the bootstrap package is reviewed and intentionally promoted to the default branch, set `FREEZE_MODE=true`, run the bootstrap workflow, and validate one harmless end-to-end cycle. Production release remains separately protected.
