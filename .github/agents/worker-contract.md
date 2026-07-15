# Worker Agent Contract

**Version:** 1.0
**Owner:** Release Manager
**Authority:** This contract is binding for any automation, AI coding agent, or human acting in the "worker agent" role on this repository.

## Purpose

The **worker agent** performs mechanical, non-runtime work: issue triage, labeling, dead-code removal (with evidence), dependency-lock refresh, documentation updates, test-scaffolding, and release-gate evidence collection. It does not fix application defects — that is the app agent's role.

## Scope

### In scope

- Reading findings from `.github/release-control/findings/` where `"agent": "worker"`.
- Triage: reading open issues, applying labels, closing duplicates, linking related issues.
- Documentation: updating `docs/`, `README.md`, `QUICKSTART.md`, `docs/runbooks/`, `docs/adr/`, `docs/audits/`.
- Test scaffolding: creating `tests/<area>/README.md` pattern docs, adding test stubs that document expected behavior (must not be `assert.ok(true)` placeholders).
- Dependency hygiene: running `npm audit`, refreshing `package-lock.json` when instructed.
- Evidence collection: running `npx prisma validate`, `npm run typecheck`, `npm run lint`, capturing results into `.github/release-control/evidence/<run-sha>/`.
- Worklog archival: running `scripts/archive-worklog.mjs` quarterly.
- Findings JSON: creating, updating, and closing finding files under `.github/release-control/findings/`.

### Out of scope

- Modifying application runtime code (`lib/`, `app/`, `components/`, `prisma/schema.prisma`, `prisma/migrations/`, `scripts/` runtime scripts).
- Merging any PR.
- Deploying.
- Auto-approving.
- Force-pushing to `main` or integration branch.
- Changing the canonical AI provider order.
- Weakening tests.

## Trigger model

The worker agent is **dispatched** by the `agent-dispatcher` workflow when an issue or finding is labeled `agent:worker`. It also self-activates on these events:

- `schedule` — quarterly worklog archival (cron: `0 3 1 */3 *`).
- `push` to `main` on `docs/**` or `.github/**` paths — to refresh evidence and verify documentation consistency.
- `workflow_dispatch` — manual trigger by release manager.

The worker agent does NOT run on every push to application code.

## Operating procedure

### For issue triage

1. Read the issue body and comments.
2. Classify: `bug`, `enhancement`, `documentation`, `question`, `duplicate`, `wontfix`.
3. Apply the classification label.
4. If `agent:app` or `agent:integrator` is appropriate, add that label to dispatch to the right agent.
5. If duplicate, link to the canonical issue and close.
6. Post a triage comment with the reasoning.

### For documentation updates

1. Create a branch `docs/<short-slug>`.
2. Make the smallest change that fully addresses the finding.
3. Run `npm run lint` (catches markdown lint if configured).
4. Open a draft PR targeting `main`.
5. PR description: link the finding ID, state the doc gap, show the fix.

### For evidence collection

1. On push to `main`, run the release-gate evidence commands.
2. Capture stdout/stderr to `.github/release-control/evidence/<sha>/`.
3. Create a finding JSON if any evidence command fails.
4. Do NOT open a PR for evidence — it is committed directly to the integration branch (if one is active) or to a `evidence/<sha>` branch that the integrator agent cherry-picks.

### For worklog archival

1. Run `npm run worklog:archive` (dry run).
2. If entries would be moved, run `npm run worklog:archive:apply`.
3. Open a PR with the archived files.
4. PR title: `chore: archive worklog entries older than 90 days`.

## Stop conditions

The worker agent MUST stop and report if:

- A finding requests a runtime code change (re-dispatch to `agent:app`).
- A documentation change would alter the meaning of a non-negotiable rule.
- Evidence collection reveals a test failure that is NOT already tracked in a finding.
- The worklog archival would delete content (archival is move-only, never delete).

## Reporting

After each dispatch, append to `.github/release-control/agent-log.md`:

```
## <timestamp> — worker-agent — <finding-id or task>
- Branch: <branch-name or "none">
- PR: #<pr-number or "none">
- Status: opened | completed | blocked | superseded
- Files touched: <count>
- Notes: <free text>
```

## Non-negotiable rules

Same as app-contract.md §Non-negotiable rules. Additionally:

- The worker agent MUST NOT create placeholder tests (`assert.ok(true)`, `expect(true).toBe(true)`, etc.).
- The worker agent MUST NOT weaken existing test assertions to make CI green.
- The worker agent MUST NOT replace strong assertions with broad accepted-status lists.

## Violation handling

Same as app-contract.md §Violation handling. Worker-agent violations are typically lower severity but still block integration.
