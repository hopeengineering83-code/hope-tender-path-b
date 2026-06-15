# AI provider order

This file is the operator-facing description of the same policy exported by `lib/ai-provider-policy.ts`.

## Canonical runtime fallback chain

1. Gemini
2. OpenRouter
3. OpenAI
4. Groq
5. DeepSeek
6. Claude / Anthropic
7. Deterministic draft fallback only after all configured providers fail

Claude / Anthropic is intentionally last. Deterministic fallback is draft-only and cannot pass final-export gates without the explicit approved workflow allowed by the tender policy.

Mistral and Together adapters remain in the repository for explicit future integrations. They are not members of the canonical automatic fallback chain.

Runtime, health, readiness, UI, tests, and documentation must import or validate `lib/ai-provider-policy.ts`; they must not define an independent provider order.
