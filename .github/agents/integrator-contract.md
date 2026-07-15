# Integrator Agent Contract

**Version:** 1.0
**Owner:** Release Manager
**Authority:** This contract is binding for any automation, AI coding agent, or human acting in the "integrator agent" role on this repository.

## Purpose

The **integrator agent** owns the single draft integration PR. It cherry-picks approved fixes from app-agent and worker-agent PRs into the integration branch, resolves conflicts, runs the release-gate suite, and maintains integration readiness. It does not merge to `main`.

## Scope

### In scope

- Maintaining exactly ONE draft integration PR at any time.
- Cherry-picking commits from PRs labeled `integration-approved` by the release manager.
- Resolving mechanical conflicts (whitespace, import order, lockfile).
- Running the release-gate suite against the integration branch.
- Updating the integration PR description with the list of included fixes.
- Creating a finding JSON when integration reveals a conflict that requires human decision.

### Out of scope

- Merging the integration PR to `main`.
- Deploying.
- Auto-approving.
- Modifying application runtime code directly (only cherry-picks from approved PRs).
- Opening more than one integration PR.
- Force-pushing to `main`.
- Changing the canonical AI provider order.

## Single-writer discipline

**Only one integrator agent may write to the integration branch at a time.** This is enforced by:

1. **Concurrency group:** The `integration-controller` workflow uses `concurrency: { group: integration-writer, cancel-in-progress: false }`. A second dispatch queues; it does not run concurrently.
2. **Branch check:** Before any write, the integrator verifies the integration branch head matches the SHA it read at the start of the operation. If the head moved (another writer pushed), the integrator aborts and re-reads.
3. **Lock file:** `.github/release-control/integration.lock` contains the current writer's run ID and timestamp. The integrator writes this before pushing and deletes it after. A stale lock (>30 minutes) is treated as released.
4. **No force-push:** The integrator never uses `--force`. If a push is rejected (non-fast-forward), the integrator re-reads, re-applies, and retries.

## Integration branch

The active integration branch is declared in `.github/release-control/integration-branch.txt`. If the file does not exist or is empty, there is no active integration and the integrator agent is idle.

When active, the branch is `integration/<name>` (e.g., `integration/production-engine-2026-07`). The integration PR targets `main` and is always **draft**.

## Trigger model

The integrator agent is **dispatched** by:

- `agent-dispatcher` when a PR is labeled `integration-approved`.
- `pull_request` events on the integration PR itself (to re-run the release-gate suite on updates).
- `workflow_dispatch` by the release manager.

It does NOT run on a schedule. The 5-minute reconciliation in `change-monitor` only checks for stale state; it does not dispatch the integrator.

## Operating procedure

### When a PR is labeled `integration-approved`

1. **Read the integration branch** from `.github/release-control/integration-branch.txt`. If empty, abort with a comment: "No active integration branch."
2. **Acquire the lock** in `.github/release-control/integration.lock`. If a non-stale lock exists, abort.
3. **Read the PR's commits** and the files they touch.
4. **Cherry-pick** each commit onto the integration branch. If a cherry-pick conflicts:
   - If the conflict is mechanical (lockfile, import order), resolve it.
   - If the conflict is semantic (same file, same function, different logic), abort, remove the `integration-approved` label, and create a finding with `"agent": "none"` and `"status": "open"` describing the conflict.
5. **Push** the integration branch (non-force).
6. **Run the release-gate suite** via `workflow_call` to `release-gate.yml`.
7. **Update the integration PR description** with the newly included PR number.
8. **Release the lock.**
9. **Comment on the source PR:** "Cherry-picked into integration PR #<N>. Awaiting release-gate suite."

### When the release-gate suite fails on integration

1. Do NOT remove the cherry-picked commits (the failure may be a cumulative interaction).
2. Create a finding JSON with `"category": "integration"`, `"agent": "app"`, describing the failure.
3. Comment on the integration PR with the failure details and the finding ID.
4. Do NOT mark the integration PR ready for review.

### When the integration PR is ready for release

Only the release manager (a human) may:
1. Mark the integration PR ready for review.
2. Approve it.
3. Merge it to `main`.

The integrator agent's final action is to comment "Release-gate suite passed. Ready for release-manager review." The agent then goes idle.

## Stop conditions

The integrator agent MUST stop and report if:

- The integration branch head moved between read and push (another writer).
- A cherry-pick conflict is semantic, not mechanical.
- The release-gate suite fails after a cherry-pick.
- The lock file cannot be acquired (non-stale lock exists).
- The integration PR was marked ready or merged by a human (the agent's job is done).
- The integration branch was deleted or renamed.

## Reporting

After each dispatch, append to `.github/release-control/agent-log.md`:

```
## <timestamp> — integrator-agent — <dispatch-id>
- Integration branch: <branch-name>
- Lock acquired: <run-id>
- Cherry-picks: <count> (<pr-list>)
- Conflicts: <count> (<list, or "none">)
- Release-gate suite: passed | failed | not-run
- Integration PR: #<pr-number>
- Notes: <free text>
```

## Non-negotiable rules

Same as app-contract.md §Non-negotiable rules. Additionally:

- The integrator agent MUST NOT merge the integration PR.
- The integrator agent MUST NOT mark the integration PR ready for review.
- The integrator agent MUST NOT approve any PR.
- The integrator agent MUST NOT allow more than one writer on the integration branch.

## Violation handling

Integrator-agent violations are the most severe because they can corrupt the integration branch. If violated:

1. The `integration-controller` workflow immediately fails any in-progress run.
2. The integration PR is labeled `contract-violation`.
3. The release manager is notified via issue.
4. The integration branch is frozen until the release manager manually verifies integrity.
