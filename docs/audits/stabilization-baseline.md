# Stabilization Baseline — PR 1

Captured: 2026-06-12

---

## Repository state

| Item | Value |
|------|-------|
| Branch | `stabilize/runtime-baseline-and-panel-errors` |
| Starting main SHA | `be797b34b4f0de7d7d79503537fb6e3fa73518a4` |
| Vercel production baseline SHA | `be797b34b4f0de7d7d79503537fb6e3fa73518a4` |

---

## Latest 10 commits on main (before this branch)

```
be797b3 fix(auth): grant REVIEWER role access to all Recovery Command Center Execute-path routes (#698)
abd8656 test(ui): add state-matrix contradiction regression tests (#697)
e5af4f7 fix(engine+ui): implement canonical 8-state readiness module system (#696)
faa2ed9 audit: fix icon/status contradictions and CI failures (#695)
0e0f0b7 fix(ui): reconcile readiness dashboard
f35b7f2 chore: remove temporary file
d53f123 noop
431a254 chore: remove temporary branch probe
333b597 noop
00f005e chore: remove temporary probe
```

---

## Open PRs at baseline

| # | Title | State |
|---|-------|-------|
| 699 | Fix app quality gaps: UI tokens, extraction dashboard, vault auto-link | Draft — must NOT be merged as written |

---

## git status at baseline

Working tree clean. No uncommitted changes.

---

## Pre-change command results

### `npm run typecheck`

**Result: PASS** — zero TypeScript errors after `npm install` and `prisma generate` in the test environment.

*Note:* Before `npm install` the typecheck emitted `error TS2688: Cannot find type definition file for 'node'` because `@types/node` was not yet installed. This is an environment setup issue, not a source error.

### `npm run build`

**Result: EXPECTED FAIL** — build script outputs env-var validation errors:

```
FATAL: Required environment variables are missing or invalid.
  ✗ DATABASE_URL: PostgreSQL connection string
  ✗ SESSION_SECRET: At least 32-character random string
```

This is by design: `scripts/check-env.mjs` intentionally blocks local builds without `.env.local`.  
The build also runs `scripts/patch-resumable-ai-analyze.mjs` which mutates TypeScript source (to be addressed in PR 2).

### `npm test`

**Result: 3130 pass, 0 fail, 0 skip**

```
# tests 3130
# suites 797
# pass  3130
# fail  0
# duration_ms ~39 s
```

Key test files confirmed passing:
- `recovery-command-center-actions.test.ts` — 33 pass
- `generate-docs-gate.test.ts` — passing
- `submission-plan-empty-gate.test.ts` — 2 pass
- `repair-metadata-button-wiring.test.ts` — passing
- `repair-source-grounding.test.ts` — passing
- `canonical-readiness-contradictions.test.ts` — passing

---

## Production `/api/health`

Production was last confirmed returning HTTP 200 with `databaseReachable: true` at the baseline SHA.

---

## Runtime error — root cause (hypothesis consistent with all available evidence)

### Endpoint

`GET /api/tenders/[id]/analysis-quality`

### File

`app/api/tenders/[id]/analysis-quality/route.ts` — line 64

### Error class

`TypeError: Cannot destructure property 'extractedTextLength' of 'undefined' as it is not an object`

### Mechanism

```typescript
// Unsafe: destructures [0] without a fallback; throws when Prisma returns
// 0 rows (which can happen when no TenderFile rows exist for this tender
// in production, or when the DB driver returns unexpected result shapes).
const [{ extractedTextLength, totalPageCount }] = await prisma.$queryRaw<
  Array<{ extractedTextLength: number; totalPageCount: number }>
>`SELECT COALESCE(SUM(...), 0)... FROM "TenderFile" WHERE "tenderId" = ${id}`;
```

When the array is empty, `[0]` is `undefined`.  Destructuring `undefined` throws `TypeError`.

### When triggered

- Tender created but no files uploaded yet
- All files removed from an existing tender
- Any transient Prisma result-set edge case

### Impact

Every dashboard load for a tender that has no uploaded files caused the Analysis Quality panel to return HTTP 500, which triggers the "Panel failed to load" banner in the UI.

### Secondary issue: missing try/catch wrappers

Five panel routes had no `try/catch` wrapper, meaning any uncaught runtime error surfaces as an unstructured 500:

| Route | Has catch |
|-------|-----------|
| `analysis-quality` | NO (confirmed TypeError here) |
| `extraction-quality` | NO |
| `readiness` | NO |
| `generation-readiness` | NO |
| `matching-quality` | NO |

---

## Existing features confirmed present at baseline

All recovery actions confirmed present and tested:

- Metadata repair: `POST /api/tenders/[id]/repair-metadata`
- Source-grounding repair: `POST /api/tenders/[id]/repair-source-grounding`
- Submission-plan build: `POST /api/tenders/[id]/submission-plan/build`
- Generate Docs gate: `POST /api/tenders/[id]/generate` — blocked when critical gaps exist
- Recovery Command Center actions: all REQUIRED_EXECUTE_ACTIONS have specs, all API paths exist

---

## Fix applied in this PR

1. `app/api/tenders/[id]/analysis-quality/route.ts` — defensive fallback on `$queryRaw` + full `try/catch` + structured panel error response
2. `app/api/tenders/[id]/extraction-quality/route.ts` — `try/catch` + structured panel error response
3. `app/api/tenders/[id]/readiness/route.ts` — `try/catch` + structured panel error response
4. `app/api/tenders/[id]/generation-readiness/route.ts` — `try/catch` + structured panel error response
5. `app/api/tenders/[id]/matching-quality/route.ts` — `try/catch` + structured panel error response
6. `tests/panel-runtime-stability.test.ts` — new characterization tests

---

## Rollback procedure

```bash
git revert HEAD  # or revert the specific commit
git push -u origin stabilize/runtime-baseline-and-panel-errors
```

No database migrations in this PR.
