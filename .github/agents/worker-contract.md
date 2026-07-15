# Specialist Worker Contract

**Version:** 2.0  
**Owner:** CHATGPT-M1 — App Manager and Release Controller

## Purpose

Specialist workers implement one isolated GitHub Issue using one branch and one draft PR. GLM is the default pool; Jules, Codex, and Claude Code are escalation workers.

## Source of truth

- The assigned GitHub Issue and linked PR comments are authoritative.
- The permanent worker roster is `.github/agents/worker-roster.md`.
- `.github/agents/providers.json` defines capacity and specialization.
- Generated repository finding files and mutable lock files are not task authority.

## Branch rules

### Control Tower work before PR #1130 is promoted

- Start from `fix/github-control-tower`.
- Open the worker PR against `fix/github-control-tower`.
- Do not target `automation/control-plane`, because it does not yet contain PR #1130's unmerged files.

### Runtime repair work after Control Tower activation

- Start from `integration/controlled-recovery`.
- Open the worker PR against `integration/controlled-recovery`.

## Required behavior

1. Post `WORKING` with the starting SHA.
2. Respect the issue's permitted and forbidden file list.
3. Search for overlapping active branches and PRs.
4. Add executable tests; no placeholder assertions or source-text-only proof for persistence behavior.
5. Keep the PR draft.
6. Report the exact head SHA after every push.
7. Read all issue and PR updates before each new action and whenever the session resumes.
8. Apply revisions to the same branch and PR.
9. Stop only at `ACCEPTED`, `SUPERSEDED`, or `BLOCKED`.

## Prohibited actions

- Merge, approve, auto-merge, or deploy.
- Push directly to protected control or integration branches.
- Run production migrations.
- Create a replacement PR for revision work.
- Modify files owned by another active worker.
- Hide skipped tests or missing configuration behind a green result.

## Capacity and escalation

- Maximum active workers: six.
- One active worker per finding.
- Maximum repair attempts: three.
- GLM handles normal implementation.
- Jules handles broad tests and slower repository scans.
- Codex handles complex backend, transaction, and race-condition work.
- Claude Code handles semantic conflicts and cross-file integration.

## Status protocol

`QUEUED`, `WORKING`, `PR_OPENED`, `REVISION_REQUIRED`, `CI_FAILED`, `APPROVAL_INVALIDATED`, `ACCEPTED`, `INCORPORATED`, `BLOCKED`.
