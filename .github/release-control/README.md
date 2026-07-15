# Release Control

This directory contains the GitHub Control Tower automation infrastructure.

## Structure

```
.github/release-control/
├── README.md                    # This file
├── findings.schema.json         # JSON schema for all finding files
├── integration-branch.txt       # Declares the active integration branch (empty = no active integration)
├── integration.lock             # Lock file for single-writer discipline (auto-managed)
├── agent-log.md                 # Chronological log of agent dispatches
├── findings/                    # One JSON file per finding (conforms to findings.schema.json)
└── evidence/                    # Release-gate evidence per run SHA
    └── <sha>/
        ├── typecheck.log
        ├── lint.log
        ├── test.log
        └── ...
```

## Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `change-monitor.yml` | push to main, PR events, 5-min schedule (backup) | Detects changes, classifies them, creates findings |
| `release-auditor.yml` | push to main, PR events, 5-min schedule (backup) | Audits release-readiness, runs release-gate suite on main |
| `agent-dispatcher.yml` | issue/PR labels, `/dispatch` comments, 5-min schedule (backup) | Routes work to the appropriate agent |
| `integration-controller.yml` | PR labeled `integration-approved`, integration PR updates | Cherry-picks approved PRs into integration branch, runs release-gate |
| `release-gate.yml` | `workflow_call` only | The authoritative release-acceptance suite |

## Agent Contracts

- [`.github/agents/app-contract.md`](../agents/app-contract.md) — fixes application defects
- [`.github/agents/worker-contract.md`](../agents/worker-contract.md) — mechanical/cleanup work
- [`.github/agents/integrator-contract.md`](../agents/integrator-contract.md) — owns the integration PR

## What This Automation Does NOT Do

- **Merge to main** — only the release manager (a human) merges.
- **Deploy to production** — no Vercel deploy commands in any workflow.
- **Modify application runtime code** — the automation itself only touches `.github/`, `docs/`, findings, and evidence.
- **Auto-approve a PR** — no `gh pr review --approve` anywhere.
- **Allow multiple agents to write to the integration branch** — enforced by concurrency group + lock file.
- **Treat green CI as sufficient** — the release-gate suite is required in addition to CI.

## Findings Lifecycle

1. `change-monitor` or `release-auditor` creates a finding JSON in `findings/`.
2. `agent-dispatcher` picks up the finding, posts a dispatch comment on the issue, and updates the finding's `dispatch_history`.
3. The dispatched agent (app/worker/integrator) reads the finding, does the work, and reports back in `agent-log.md`.
4. When the work is resolved, the finding's `status` is updated to `resolved` and `github_pr` is recorded.

## Integration Branch

To activate an integration cycle:

1. Create the integration branch: `git checkout -b integration/<name> main`
2. Write the branch name to `integration-branch.txt`: `echo "integration/<name>" > .github/release-control/integration-branch.txt`
3. Open a draft PR from `integration/<name>` → `main`.
4. Label PRs that should be cherry-picked with `integration-approved`.
5. The `integration-controller` will cherry-pick them and run the release-gate suite.
6. When the release-gate suite passes, the release manager reviews and merges.

## 5-Minute Schedule (Backup Only)

All workflows have a 5-minute `schedule` trigger as backup. The primary triggers are event-driven (push, pull_request, issues, issue_comment). The schedule catches:

- Findings created by a cancelled event-driven run.
- PRs whose CI went green but whose release-gate suite hasn't run.
- Stale integration locks older than 30 minutes.
- Issues labeled `agent-dispatch-needed` that haven't been dispatched.

The schedule does NOT perform any write operations itself — it only creates findings or issues that the event-driven workflows then process.
