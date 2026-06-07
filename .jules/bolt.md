# Performance & Safety Learnings - Post-617 Audit

## Safety: JSON Parsing
- **Problem**: Bare `JSON.parse` on database text fields can crash routes if the data is malformed or exceeds expected structures.
- **Solution**: Use `safeParseJsonArray` and `safeParseJsonObject` from `lib/safe-json.ts`. These return fallbacks instead of throwing.
- **Action**: Migrated `lib/engine/final-zip-scope.ts` to use safe parsing.

## Performance: List Views
- **Anti-pattern**: Selecting large text/binary fields like `fileContent` or `extractedText` in list or summary views leads to massive database overhead and slow API responses.
- **Pattern**: Always use `select` to exclude these fields in `findMany` calls. Verified in `app/api/tenders/route.ts`.

## Regression Testing: Synthetic Fixtures
- **Pattern**: Use synthetic fixtures (markdown + metadata JSON) to define expected engine behavior across diverse tender types (Road, Hospital, Pharma, etc.) without exposing sensitive client data.
- **Matrix**: Maintaining a `docs/audits/post-617-regression-test-matrix.md` allows for clear verification of safety gates and blocker logic.

## AI Provider Chain
- **Policy**: Anthropic (Claude) must remain the last provider in the `CANONICAL_PROVIDER_CHAIN` to prevent rate limit blocks from affecting other tiers and to serve as a final validation gate. Verified by static test.
