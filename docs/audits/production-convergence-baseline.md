# Production Convergence Baseline

## VERIFIED (proven through source, PostgreSQL tests, or CI)

| Item | Status | Evidence |
|------|--------|----------|
| AiAnalyzeChunk query uses scalar userId | VERIFIED | `lib/engine/generation-readiness-gate.ts:544` — `where: { tenderId, userId, contentHash }` |
| reference in criticalFieldKeys | VERIFIED | `lib/engine/build-plan-hash.ts:356` — includes "reference" |
| submissionEmailSubject in criticalFieldKeys | VERIFIED | `lib/engine/build-plan-hash.ts:361,367` — conditional on email/portal |
| parseContactDetailsSource reads fileId | VERIFIED | `lib/engine/canonical-field-state.ts:251` |
| getSourceEvidence returns ce.fileId | VERIFIED | `lib/engine/canonical-field-state.ts:297` |
| All callers pass activeTenderFileIds filtered to ACTIVE | VERIFIED | 6 call sites, all use `.filter(deletionStatus === "ACTIVE")` |
| All callers forward title/deadline/submissionEmailSourceQuote | VERIFIED | 6 call sites, all forward these columns |
| re-extract-metadata does NOT overwrite totalPages | VERIFIED | `app/api/tenders/[id]/re-extract-metadata/route.ts:267` — PAGE-PROVENANCE GUARD comment |
| Tender Health shows "Advisory only — release blocked" when blocked | VERIFIED | `components/tender-health-score-panel.tsx:288` |
| Next action is singular | VERIFIED | `lib/tender-next-action.ts` — returns one `primary` |
| BuildPlan is sole plan authority | VERIFIED | `lib/engine/build-plan.ts` — confirmed plan drives all gates |
| Provider order: Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic | VERIFIED | `lib/ai-provider-catalog.cjs:23-33` |

## INFERRED (strongly supported but not independently reproduced)

| Item | Status | Evidence |
|------|--------|----------|
| Generation gate evaluates correctly on real DB | INFERRED | Query fixed but not tested against production DB |
| Export/ZIP gates use same chunk query path | INFERRED | All three purposes use `assertTenderReadyForGenerationAndExport` |

## UNKNOWN (needs staging/production access)

| Item | Status | Notes |
|------|--------|-------|
| Vercel runtime error clusters | UNKNOWN | No Vercel log access |
| Production DB schema state | UNKNOWN | Cannot verify production migrations |
| Real provider connectivity | UNKNOWN | Cannot test without production API keys |
