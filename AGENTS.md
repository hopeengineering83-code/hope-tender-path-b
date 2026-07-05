# Universal Agent Instructions

This repository is operated by more than one coding tool. Before any work, read:

1. `operator_handoff.md`
2. `CLAUDE.md`
3. the latest target branch, open pull requests, CI, and current working tree

## Required behavior

- State exact task, branch, files expected to change, and test plan before editing.
- Check `operator_handoff.md` Active Workboard and do not overlap an active agent's scope without coordination.
- Use one isolated branch; never write directly to `main`.
- Do not merge, approve, deploy, rebase another agent's work, or create unnecessary Vercel previews without Hope's explicit approval.
- Do not copy code from another pull request without reviewing its actual diff, dependencies, and tests.
- Preserve the non-negotiable application rules in `operator_handoff.md`.
- At the end of a session, update `operator_handoff.md` in the same commit with timestamp, tool name, scope, files changed, tests, risks, next action, and merge status.

## Shared-truth rule

Private model memory is never the shared authority. Current repository code, GitHub state, `operator_handoff.md`, and `CLAUDE.md` override any private chat memory or prior claim.
