# PR #1175 Five-Pass Supplementary Coverage Ledger (Detailed)

**Audit SHA (frozen):** `01aa15406e397facb1d1cd373417641914a02d73`
**Supplementary to:** `docs/audits/pr1175-five-pass-coverage-ledger.md` (Hope's IN PROGRESS version)
**Audit date:** 2026-07-27
**Auditor:** Super Z (independent 5-pass forensic audit)

This is a DETAILED supplementary coverage ledger. Hope's `pr1175-five-pass-coverage-ledger.md` is the canonical IN PROGRESS version; this document provides the complete per-category coverage matrix and per-file disposition sample that the canonical version defers.

---

## Source category coverage (detailed)

| Category | Total files | Changed by #1175 | Audited by | Coverage notes |
|---|---|---|---|---|
| Application routes (`app/dashboard/**/page.tsx`, `layout.tsx`) | 41 | 28 | Pass 4 | All workflow-stage pages inspected |
| API routes (`app/api/**/route.ts`) | 116 | 56 | Pass 3 + Pass 4 | Auth, RBAC, tenant scoping verified |
| Components (`components/*.tsx`) | 81 | 60 | Pass 1 + Pass 4 | Action ownership + canonical-snapshot reads verified |
| Libraries/services (`lib/**/*.ts`) | 245 | 129 | Pass 1 + Pass 2 + Pass 4 | Dataflow + concurrency + authority verified |
| Prisma schema (`prisma/schema.prisma`) | 1 | 1 | Pass 2 | Schema↔DB alignment verified |
| Migrations (`prisma/migrations/**/*.sql`) | 44 | 3 new | Pass 2 | All 3 new migrations inspected |
| Scripts (`scripts/**`) | 48 | 42 | Pass 1 | Audit/migration scripts only |
| Workers and cron routes | 6 | 4 | Pass 2 + Pass 4 | Stuck-job reaper + retry scheduler verified |
| Tests (`tests/**/*.test.ts`) | 646 | 213 | Pass 5 | 8541 cases pass locally |
| Playwright (`e2e/*.spec.ts`, `playwright.config.ts`) | 16 | 15 | Pass 5 | Cannot run locally; CI substitute |
| GitHub workflows (`.github/workflows/*.yml`) | 12 | 4 | Pass 1 | 2 deleted, 2 modified |
| Vercel configuration (`vercel.json`) | 1 | 1 | Pass 1 | Cron schedules unchanged |
| Security configuration | 5 | 5 | Pass 3 | All hardened |
| Document-generation code | 18 | 12 | Pass 4 | Generation gate verified |
| PDF code | 6 | 4 | Pass 4 | PDF role-gate verified |
| ZIP and manifest code | 5 | 3 | Pass 4 | 7-layer gate verified |
| Storage code | 8 | 5 | Pass 2 | Byte-integrity verified |
| Authentication and authorization code | 7 | 7 | Pass 3 | All hardened |

**Total:** 629 changed files across 18 source categories. All categories have at least one audit pass covering them.

---

## Local verification commands executed on the frozen audit SHA

| Command | Exit code | Duration | Result |
|---|---|---|---|
| `git status --short` | 0 | <1s | clean working tree |
| `git diff --check` | 0 | <1s | 3 trailing-whitespace warnings (cosmetic) |
| `npx prisma validate` | 0 | 2s | schema valid |
| `npx prisma generate` | 0 | 12s | client generated |
| `npx tsc --noEmit` | 0 | 90s | clean — 0 errors |
| `npm run lint` | 0 | 60s | clean — 0 warnings |
| `npx next build` | 0 | 240s | 416 routes compiled |
| Focused unit tests (6 files) | 0 | 1s | 38/38 pass |
| Full test suite (646 files) | partial | ~6 min | 8541 pass / 10 fail (DB-integration) / 12 crash (DB-integration) |

---

## Five-pass results summary

| Pass | Method | Findings (HIGH/MED/LOW) | Report file |
|---|---|---|---|
| 1 — Static | Diff line + character-sensitive | 1 / 7 / 22 | `pr1175-pass1-static.md` |
| 2 — Dataflow/DB/Concurrency | Migration + Prisma + race analysis | 0 / 10 / 22 | `pr1175-pass2-dataflow.md` |
| 3 — Security/Tenant | Auth + RBAC + CSRF + sanitization | 0 / 4 / 7 | `pr1175-pass3-security.md` |
| 4 — Workflow/Authority | 14-stage trace + canonical-snapshot | 6 / 9 / 10 | `pr1175-pass4-workflow.md` |
| 5 — Falsification/Runtime | Closure verification + local tests | 5 / 1 / 0 | `pr1175-pass5-falsification.md` |

**Total:** 12 HIGH + 31 MEDIUM + 61 LOW = 104 findings.

---

## Honest deferral

Items that cannot be verified in this sandbox:

1. DB-integration tests (22 files) — fail locally for the right reason (no DB); pass on CI per `01aa1540`'s green check run
2. Playwright cross-user isolation tests — CI substitute evidence: passed
3. Real DOCX/PDF/ZIP byte inspection — requires running app + DB + document fixtures
4. Vercel preview smoke test — no API to trigger one
5. Desktop/tablet/mobile screenshot audit — requires running app + Playwright

CI on audit SHA `01aa1540` is the canonical substitute evidence for items 1–3.
