# Release Guardrails

## 1. Master product language rule

The app must not expose **metadata** as a user-facing product concept. Use: Tender Details, Source-Grounded Tender Facts, Submission Facts, Client / Procuring Entity Facts, Deadline and Submission Instructions, Required Documents, Final Package Facts, and Export Readiness.

## 2. Draft vs final-output safety

Draft generation may proceed with optional Tender Detail gaps. Final export, Final ZIP, auto-finalize, and final package readiness must fail closed when required Tender Facts, Submission Facts, or Final Package Facts are unsafe.

## 3. Raw error exposure

API responses must never return raw Prisma errors, stack traces, `err.message`, `error.message`, or `String(err)`. Log details server-side and return a safe message plus `diagnosticId` where possible.

## 4. Required document counts

Required document counts must come from the tender-controlled Build Plan/submission scope. Generated and export-ready counts must count only final-export candidate documents that are generated, validated, approved, and have content.

## 5. Workflow source of truth

Workflow/readiness UI must consume canonical runtime, generation, and export readiness helpers. Do not compute separate readiness verdicts in panels or routes just to improve copy.

## 6. Parallel PR rule

Backend/runtime PRs should land first. UI PRs rebase after backend changes. Avoid editing the same files in parallel; if overlap is unavoidable, add an audit/TODO and implement after the active PR merges.

## 7. Vercel rule

Do not trigger manual preview or production deploys unless explicitly requested. Avoid unnecessary preview churn; local checks and CI are the release authority.

## Local guardrail commands

```bash
node scripts/audit-no-user-facing-metadata.mjs
node scripts/audit-safe-api-errors.mjs
node scripts/audit-workflow-state-consistency.mjs
npx tsx --test tests/final-export-safety-invariants.test.ts tests/api-contract-public-safety.test.ts
```
