# Specialist Worker Contract

**Version:** 3.0  
**Owner:** CHATGPT-M1 — App Manager and Release Controller

## Purpose

Specialist workers implement one isolated GitHub Issue using one branch and one draft PR. GLM and ChatGPT are the current coding pools. Jules, Codex, and Claude Code remain standby or escalation workers.

## Source of truth

- The assigned GitHub Issue and linked PR comments are authoritative.
- The permanent worker roster is `.github/agents/worker-roster.md`.
- `.github/agents/providers.json` defines capacity and specialization.
- `.github/agents/current-worker-prompts.md` contains the current start prompts.
- Generated repository finding files and mutable lock files are not task authority.

## Branch rules

### Control Tower infrastructure

- Control Tower changes stay on `fix/github-control-tower` and PR #1130.
- Application workers do not edit `.github/**`.

### Isolated application repair during bootstrap

- Start from the exact manager-authorized SHA of `integration/controlled-recovery`.
- Open one draft PR against `integration/controlled-recovery`.
- Do not push directly to the integration branch.
- Worker PRs may be developed and tested while PR #1130 remains draft, but no worker SHA may be incorporated until Control Tower acceptance passes.

## Required behavior

1. Post `WORKING` with the starting SHA, evidence inspected, proposed files, and overlap check.
2. Respect the issue's permitted and forbidden file list.
3. Search for overlapping active branches and PRs.
4. Add executable tests; persistence-sensitive work requires PostgreSQL assertions against the protected rows.
5. Keep the PR draft.
6. Report the exact head SHA after every push.
7. Read all issue and PR updates before each new action and whenever the session resumes.
8. While the browser session is active, recheck the issue, PR, branch SHA, and CI every five minutes.
9. Apply revisions to the same branch and PR.
10. Stop only at `ACCEPTED`, `SUPERSEDED`, or `BLOCKED`.

## Prohibited actions

- Merge, approve, auto-merge, or deploy.
- Push directly to protected control or integration branches.
- Run production migrations.
- Create a replacement PR for revision work.
- Modify files owned by another active worker.
- Hide skipped tests or missing configuration behind a green result.
- Interpret `VALIDATED_HEAD_SHA` as approval; only an authorized `ACCEPTED_HEAD_SHA` manager comment permits integration preflight.

## Capacity and escalation

- Maximum active workers: eight.
- One active worker per finding.
- Maximum repair attempts: three.
- GLM handles normal implementation and the current state/matching/export lanes.
- ChatGPT coding workers handle the current privacy/provenance and responsive-contract lanes.
- Jules handles broad tests and slower repository scans.
- Codex handles complex backend, transaction, and race-condition work.
- Claude Code handles semantic conflicts and cross-file integration.

## Current five-lane non-overlap

1. GLM-A1 — Issue #1134.
2. GLM-A2 — Issue #1135.
3. GLM-X1 — Issue #1136.
4. CHATGPT-C1 — Issue #1137.
5. CHATGPT-C2 — Issue #1138.

The issue body is authoritative for exact files and functions.

## Status protocol

`QUEUED`, `WAITING_FOR_TOOL`, `WORKING`, `PR_OPENED`, `REVISION_REQUIRED`, `CI_FAILED`, `APPROVAL_INVALIDATED`, `ACCEPTED`, `INCORPORATED`, `BLOCKED`.
