# AI provider order

This document is the canonical operator-facing description of the app's current AI provider priority.

## Runtime provider chain

The app uses this canonical fallback order for AI analysis, extraction, proposal generation, validation, and fast provider use cases:

1. Gemini
2. OpenAI
3. Mistral
4. Together
5. DeepSeek
6. Groq
7. OpenRouter
8. Claude / Anthropic
9. Deterministic draft fallback, only when AI providers cannot produce an approved result

Claude is intentionally last so Anthropic rate limits do not block the app when earlier providers are configured and available.

## Preferred provider

The preferred provider is the first configured provider in the canonical chain. For example:

- if `GEMINI_API_KEY` is configured, preferred provider is `gemini`;
- else if `OPENAI_API_KEY` is configured, preferred provider is `openai`;
- else if `MISTRAL_API_KEY` is configured, preferred provider is `mistral`;
- Claude is selected only when no earlier configured provider is available and `ANTHROPIC_API_KEY` is configured.

## Configured is not the same as available

A provider card showing `Configured — not yet tested on this instance` means the key is present, but the current serverless instance has not recorded a successful runtime response yet.

The provider becomes runtime-verified only after AI Analyze, proposal generation, or the provider test action records a successful provider response.

## Documentation note

Older README text may say Claude is preferred. That is stale. The live AI Health panel and `/api/ai/health` route are the runtime source of truth: Gemini is first and Claude remains last.

Do not change provider fallback order unless there is an explicit product decision to reorder the AI chain.
