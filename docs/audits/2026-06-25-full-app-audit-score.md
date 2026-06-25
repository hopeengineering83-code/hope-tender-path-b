# Full App Audit and Score — 2026-06-25

## Executive score

**Overall score: 78 / 100 — strong internal product, not yet enterprise-grade production.**

Hope Tender has a much deeper safety and workflow architecture than a typical prototype: authenticated server-side routes, Prisma-backed sessions, CSRF/CSP middleware, AI provider fallback policy, tender-stage gates, source-traceability tests, and extensive regression coverage. The score is held back by operational complexity, duplicated/redundant surfaces, limited full-stack/e2e verification in this audit run, and remaining risks around route consistency, long-running AI jobs, storage scale, and maintainability.

## Scoring breakdown

| Area | Score | Weight | Weighted | Audit view |
|---|---:|---:|---:|---|
| Product completeness | 86 | 15% | 12.9 | End-to-end tender intake, analysis, matching, compliance, generation, review, export, admin, diagnostics, PWA, and Electron surfaces exist. |
| Architecture | 82 | 15% | 12.3 | Clear Next.js App Router + Prisma + engine-module separation, but the engine/API surface is broad and hard to reason about. |
| Security | 80 | 15% | 12.0 | Strong session HMAC, DB session revocation, production security headers, CSRF origin checks, route RBAC patterns, and secret redaction. Gaps remain in proving every route is consistently authorized and rate-limited. |
| Data integrity and tenant isolation | 79 | 12% | 9.5 | Trust-level model and source grounding are strong; multi-tenant isolation appears intentional. Needs stronger automated route-coverage proof across all 144 route handlers. |
| AI safety and proposal quality controls | 84 | 13% | 10.9 | Best area: reviewed-evidence gates, regex-fallback blockers, provider diagnostics, chunk resume, fallback redaction, and benchmark/proof-density controls. |
| Reliability and operations | 73 | 12% | 8.8 | Good health, cron, retry, readiness, and env checks. Risk remains in long-running AI workflows and production storage fallback. |
| Test confidence | 76 | 10% | 7.6 | Large unit/contract suite passed in progress during audit; full e2e/build was not completed in this audit window. |
| Maintainability | 67 | 8% | 5.4 | Many docs and guardrails, but there are many API routes/components and accumulated audit/fix docs; onboarding and change safety are harder than they should be. |

## What is genuinely strong

1. **Security foundations are not superficial.** Sessions are HMAC-signed, include expiry and nonce, are stored hashed in the database, and are revocable by user. Production middleware adds CSP, HSTS, frame denial, content-type protection, referrer policy, and permissions policy. CSRF protection is enforced for unsafe API methods in production through origin/referer validation.
2. **The app understands tender risk instead of blindly generating text.** The data model distinguishes `REGEX_DRAFT`, `AI_DRAFT`, and `REVIEWED`; README states only reviewed records are eligible for final generation. This is the right product-level control for proposal factuality.
3. **AI provider handling is unusually mature.** The codebase has a canonical provider chain, provider health status, retry/cooldown behavior, attempt budgeting, structured error contracts, and redaction tests.
4. **There is meaningful evidence of regression thinking.** The test output covers source traceability, fallback preservation, corrupted extraction gates, generation/export gate codes, metadata placeholder rejection, and AI-analysis resume behavior.
5. **Operational guardrails are present.** Environment validation requires DB/session secrets and at least one AI provider in production, storage readiness is explicit, and runbooks/audit docs exist.

## Major risks and gaps

### 1. Route surface is too large to trust by inspection alone

There are **144 `route.ts` handlers** under `app/api`. Many import `requireUser` or `requireRole`, but the audit did not establish a machine-checked authorization matrix for every route/method/resource combination. A product handling tender documents, company credentials, generated proposals, and share links needs a formal route inventory with expected auth, role, tenant scope, method, body schema, rate limit, and response-sensitive-fields classification.

**Impact:** One missed route can expose tender data or allow cross-company actions even if most routes are secure.

**Recommended fix:** Add a generated `docs/audits/api-route-security-matrix.md` plus a test that fails when a new route is added without an entry.

### 2. AI workflow complexity is high

The app has chunked analysis, provider fallback, cooldowns, resume jobs, retry cron, partial success handling, fallback preservation, and multiple UI paths. That is powerful, but it creates many state combinations. Tests cover many of them, yet production incidents will likely cluster around job state, stale partial outputs, provider downtime, and user confusion.

**Impact:** Users may see contradictory statuses or retry loops when AI providers degrade.

**Recommended fix:** Create a single canonical state diagram for `AiJob`, `AiAnalyzeChunk`, tender analysis source, extraction status, and generation/export readiness. Add invariant tests that compare UI labels to backend gate states.

### 3. Production storage is acceptable but not ideal for scale

The storage policy prefers Blob, falls back to local in development, and uses bounded DB base64 in production when Blob is unavailable. This keeps the app functional but can stress the database and complicate backup/retention if operators lean on DB storage for real proposal evidence.

**Impact:** Cost, DB bloat, slow backups, and file-size limitations under heavier use.

**Recommended fix:** Treat Blob/object storage as mandatory for production beyond pilot use; make DB fallback an explicit emergency mode with dashboard warnings and metrics.

### 4. Maintainability is the biggest non-security weakness

The repository contains a large number of components, API routes, historical audit documents, fix scripts, and overlapping diagnostics. This shows heavy work, but it also increases cognitive load. Without stronger ownership boundaries, future changes are likely to create regressions in gates, readiness scores, or UI status language.

**Impact:** Slower development and higher risk of contradictory features.

**Recommended fix:** Consolidate docs into active/current vs archive; add route/module owners; reduce duplicate panels/status components; create architecture decision records for major workflows.

### 5. E2E and build confidence were not fully established in this audit pass

Typecheck, lint, and the unit/contract test suite passed in this audit run. This audit did not complete a clean `npm run build` or Playwright e2e run, so browser-flow and production-build confidence remain below release-grade. For a Next.js + Prisma + AI workflow app, a clean build and at least smoke e2e are essential release gates.

**Impact:** A green unit suite may still miss runtime build, routing, hydration, or browser-flow failures.

**Recommended fix:** Make release readiness depend on `npm run release:verify` in CI and publish the latest run result next to this audit.

## Priority remediation plan

### P0 — before production expansion

- Build and enforce an API route security matrix for all 144 route handlers.
- Require object/blob storage for production-scale deployments; keep DB base64 as emergency-only.
- Run and record a clean `npm run release:verify` on the deployment branch.
- Add generated checks for sensitive response fields (`fileContent`, proposal body, raw provider bodies, secrets) across all list/detail endpoints.

### P1 — next hardening sprint

- Create canonical AI job/readiness state diagram and invariant tests.
- Add end-to-end tests for: upload tender → AI analyze → approve/review → generate → export; failed AI provider → fallback blocked; cross-user isolation; share-link expiry/revocation.
- Consolidate duplicate readiness/status UI panels so users never see conflicting readiness messages.
- Add observability dashboards for provider failure rate, stuck jobs, retries, storage provider, DB fallback usage, and export failures.

### P2 — maintainability cleanup

- Archive stale audit/fix documents and keep only current runbooks in the primary docs index.
- Split the engine into documented bounded contexts: intake, extraction, analysis, matching, compliance, generation, export.
- Introduce module-level ownership and route naming conventions.
- Add architecture decision records for AI provider order, trust-level policy, storage policy, and generation/export gating.

## Final judgment

This is **not a toy app**. It has serious product scope and many correct safety instincts. The strongest parts are the AI trust boundary, provider-fallback discipline, and proposal-generation gates. The weakest parts are operational complexity and proof coverage across a very large route surface.

**Recommended status: controlled pilot / internal production only.** It is suitable for a limited team with monitored usage and strong operator access. It is not yet ready for broad enterprise rollout until route authorization coverage, full release verification, production storage policy, and AI job observability are tightened.
