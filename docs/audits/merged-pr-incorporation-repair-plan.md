# Merged PR incorporation repair plan

This branch repairs the verified gaps where merged pull-request work was present but disconnected, contradictory, or rewritten during install/build/test.

## Scope

1. Wire the centralized RBAC permission matrix into a reusable authorization helper and high-risk routes.
2. Establish one canonical AI provider policy: Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Claude/Anthropic.
3. Align runtime, health, readiness, UI, documentation, and tests with that policy.
4. Remove source-mutating reconciliation from package scripts and delete the reconciliation script.
5. Add deterministic-build and policy-wiring regression tests.

## Guardrails

- Implementation is isolated to this repair branch and pull request.
- No weakening of resource ownership or role checks.
- Mistral and Together adapters may remain available for explicit future use, but they are not part of the canonical fallback chain.
- Builds, installs, lint, typecheck, and tests must not rewrite tracked source files.
