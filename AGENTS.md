# Universal Agent Instructions

This repository is operated by more than one coding tool. Before any work, read:

1. `operator_handoff.md`
2. `CLAUDE.md`
3. `CLAUDE_TASKS.md`
4. the latest target branch, open pull requests, CI, and current working tree

## Current Main State (SHA: 80607254)

- **tsc:** PASS (run `npx prisma generate` first)
- **lint:** PASS
- **build:** PASS
- **Tests:** 844+ critical tests PASS
- **Main is stable.** All 5 clusters (A-E) from DECISIONS_NEEDED.md are resolved.

## Canonical Provider Order (NEVER change)

```
Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic
```

Defined in `lib/ai-provider-catalog.cjs` `CANONICAL_AI_PROVIDER_ORDER`.
OCR is separate from normal AI routing.

## Frozen / Quarantined PRs

- **PR #937** — FROZEN. Never touch, merge, revive, rebase, or reuse.
- **PR #957** — QUARANTINED. Never touch.

## Required behavior

- State exact task, branch, files expected to change, and test plan before editing.
- Check `operator_handoff.md` Active Workboard and do not overlap an active agent's scope without coordination.
- Use one isolated branch; never write directly to `main`.
- Do not merge, approve, deploy, rebase another agent's work, or create unnecessary Vercel previews without Hope's explicit approval.
- Do not copy code from another pull request without reviewing its actual diff, dependencies, and tests.
- Preserve the non-negotiable application rules in `operator_handoff.md`.
- At the end of a session, update `operator_handoff.md` in the same commit with timestamp, tool name, scope, files changed, tests, risks, next action, and merge status.

## Shared-truth rule

Private model memory is never the shared authority. Current repository code, GitHub state, `operator_handoff.md`, `CLAUDE.md`, and `CLAUDE_TASKS.md` override any private chat memory or prior claim.
