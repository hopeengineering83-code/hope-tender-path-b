# Universal Agent Instructions

This repository is operated by more than one coding tool. Before any work, read:

1. `OWNER_AUTOMATION_CONTRACT.md`
2. `operator_handoff.md`
3. `CLAUDE.md`
4. `CLAUDE_TASKS.md`
5. the latest target branch, open pull requests, CI, and current working tree

`OWNER_AUTOMATION_CONTRACT.md` is the current owner-directed workflow authority and supersedes older documentation that describes AI Analyze or Run Engine as mandatory normal-path manual gates.

## Current Main State (SHA: 63369f03)

- **tsc:** PASS (run `npx prisma generate` first)
- **lint:** PASS
- **build:** PASS
- **Tests:** 464 test files, 6000+ tests PASS
- **Main is stable.** All 5 clusters (A-E) from DECISIONS_NEEDED.md are resolved.
- **Recent merges:** #1029 (action icons), #1028 (screenshot contradictions), #1027 (generation/buildplan/export truth), #1026 (lifecycle truth), #1025 (canonical readiness counts).

## AI provider policy — STRICT ZERO-PAID

Automatic chain (the only providers the app may contact):

```
Gemini → Groq → Mistral → Z.ai → [OpenRouter, only with a verified ":free" model]
       → deterministic draft fallback
```

Paid-access providers — enumerated and reported on, never contacted:
`Cerebras · OpenAI · Together · DeepSeek · Anthropic`. They show as
`BILLING_BLOCKED` so an operator can see the key is recognised and deliberately
unused.

Full canonical enumeration (fixes each provider's rank):

```
Gemini → Groq → Mistral → Z.ai → OpenRouter → Cerebras → OpenAI → Together → DeepSeek → Anthropic
```

Defined in `lib/ai-provider-catalog.cjs`. `AI_ZERO_PAID_MODE` defaults ON — a
missing value fails closed to spending nothing. OCR is separate from normal AI
routing.

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
- Preserve the server-owned durable normal path: verified upload/extraction → AI Analyze → Engine → proposal generation → validation/finalization. The browser must not be required to remain open or click Analyze/Run Engine.
- At the end of a session, update `operator_handoff.md` in the same commit with timestamp, tool name, scope, files changed, tests, risks, next action, and merge status.

## Shared-truth rule

Private model memory is never the shared authority. Current repository code, GitHub state, `OWNER_AUTOMATION_CONTRACT.md`, `operator_handoff.md`, `CLAUDE.md`, and `CLAUDE_TASKS.md` override any private chat memory or prior claim.
