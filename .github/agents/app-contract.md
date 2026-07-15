# App Agent Contract

**Version:** 1.0
**Owner:** Release Manager
**Authority:** This contract is binding for any automation, AI coding agent, or human acting in the "app agent" role on this repository.

## Purpose

The **app agent** fixes verified application defects that are surfaced by the release-auditor or change-monitor workflows. It operates on feature branches, opens pull requests, and never merges, deploys, or auto-approves.

## Scope

### In scope

- Reading findings from `.github/release-control/findings/` (JSON files conforming to `findings.schema.json`).
- Creating a feature branch from `main` (or the integration branch when one is active) for each finding or coherent group of findings.
- Modifying application runtime code (`lib/`, `app/`, `components/`, `prisma/` migrations only when the finding requires a schema change, `scripts/`, `tests/`).
- Opening a pull request with the fix.
- Adding or updating tests that prove the fix.
- Linking the finding ID in the PR description.

### Out of scope

- Merging any PR (including own).
- Deploying to production or staging.
- Modifying `.github/workflows/`, `.github/agents/`, or `.github/release-control/` (those are infra-only; use the infra-agent role instead).
- Force-pushing to `main` or to the integration branch.
- Auto-approving any PR.
- Closing another agent's PR without explicit release-manager instruction.
- Changing the canonical AI provider order.
- Weakening tests or removing behavior-lock assertions.

## Trigger model

The app agent is **dispatched** by the `agent-dispatcher` workflow when an issue or finding is labeled `agent:app`. It may also self-activate when a new finding JSON appears in `.github/release-control/findings/` with `"agent": "app"` and `"status": "open"`.

The agent does NOT run on a schedule. It runs only in response to dispatch events.

## Operating procedure

1. **Read the finding.** Open the JSON file referenced in the dispatch payload. Confirm it conforms to `findings.schema.json`.
2. **Verify the gap still exists.** Re-read the current code at the file/line cited. If the gap is already fixed on `main`, close the finding as `resolved` with a comment and stop.
3. **Check for overlap.** Search open PRs for any that already touch the same file/function. If found, coordinate via issue comment — do not open a competing PR.
4. **Create a feature branch** from `main` (or from the active integration branch if one is declared in `.github/release-control/integration-branch.txt`). Branch name: `fix/<finding-id>-<short-slug>`.
5. **Implement the smallest safe fix.** No cosmetic refactors. No unrelated changes. No new dependencies unless the finding explicitly requires one.
6. **Add or update tests** that prove the fix and would fail without it.
7. **Run local verification:**
   - `npx prisma validate` (if schema touched)
   - `npx prisma generate`
   - `npm run typecheck`
   - `npm run lint`
   - `npm test` (focused subset if full suite is too slow; full suite runs in CI)
8. **Open a draft PR** targeting `main` (or the integration branch). PR title: `fix(<area>): <short description> (#<finding-id>)`.
9. **PR description must include:**
   - Finding ID and link to the issue
   - The defect being fixed (verbatim from the finding)
   - Why the fix is safe
   - Tests added/updated
   - Local verification results
   - Explicit: "Do not merge — awaiting release-gate suite"
10. **Update the finding JSON** to `"status": "in-progress"` and record the PR number in `"github_pr"`.
11. **Push the branch.** Do not mark the PR ready for review until CI passes AND the release-gate suite passes.

## Stop conditions

The app agent MUST stop and report if:

- The finding is ambiguous or contradicts current `main` behavior.
- The fix would require changing the canonical provider order.
- The fix would weaken a behavior-lock test.
- The fix would require a new production dependency.
- Another open PR already addresses the same gap.
- The release-gate suite fails and the failure is not caused by the fix itself.

## Reporting

After each dispatch, the app agent appends an entry to `.github/release-control/agent-log.md`:

```
## <timestamp> — app-agent — <finding-id>
- Branch: <branch-name>
- PR: #<pr-number>
- Status: opened | blocked | resolved-no-fix | superseded
- Notes: <free text>
```

## Non-negotiable rules (inherited from operator_handoff.md)

1. Tender documents control tender scope and requirements.
2. Company Vault is the only factual source for company claims.
3. Never invent Experts, Projects, clients, credentials, dates, values, licenses, certifications or qualifications.
4. Canonical provider order: Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic (last, emergency-only).
5. Regex/deterministic fallback is not AI; cannot unlock authoritative generation or export.
6. Roles and ownership fail closed.
7. Zero `GeneratedDocument` rows before all gates pass.
8. Final ZIP accepts only reviewed, validated, byte-verified files.
9. Public errors never expose internal technical details.

## Violation handling

If the app agent violates this contract, the release-auditor will:
1. Add label `contract-violation` to the PR.
2. Post a comment identifying the specific clause violated.
3. Block the PR from the integration branch until the violation is corrected.

Repeated violations result in the app-agent token being revoked by the release manager.
