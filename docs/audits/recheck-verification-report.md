# Consolidated Verification Report - Hope Engineering

## Pass 1 & 2: PR Status & Main Comparison
| PR # | State | Impact | Recommendation |
| :--- | :--- | :--- | :--- |
| **876** | Open | **CRITICAL DANGER:** Deletes 200,000+ lines and most files. | **CLOSE IMMEDIATELY** |
| **875** | **Draft** | **UNIQUE ASSETS:** Integrates Security Matrix, Guardian logic, and Storage checks. | **MERGE** |
| **871** | Draft | **BLOCKER:** Writes non-schema fields (`envelopeMode`, `clientType`) to DB. | Close (Superseded) |
| **870** | Open | **BLOCKER:** Identical field-drift bug as 871 in `analysis-job-service.ts`. | Close (Superseded) |
| **869** | Open | **BLOCKER:** Massive logic deletion (`lib/ai.ts` removed). | Close (Superseded) |
| **865** | Open | UI fixes (broken anchors). | Merge into 875 then Close. |

## Pass 3: Main Commit History
- **Current Main SHA:** `40b7aee37d16abdfb9219be652ea950cdb9e2cb9`
- **Direct Commits:** `main` is a single-commit root containing the full v1.1.0 application. It includes a critical direct fix for Z.ai Coding Plan users (`glm-4-coding` allowlist) and the durable AI Job system.

## Pass 4: Deployment & Log Audit
- **AI_ANALYSIS_PERSISTENCE_FAILED:** `main` successfully contains the UUID-correlated recovery block in `lib/ai-jobs/analysis-job-service.ts` to prevent transaction crashes.
- **Migration Integrity:** `main` is healthy. PR 871 attempts to regress database indexes (removing `userId_createdAt` from `PasswordResetToken`), which would cause runtime performance degradation.

## Pass 5: Release Safety Verification
- **Tender Scope:** ✅ Enforced via `userId` in all resolver and readiness calls.
- **Vault Factuality:** ✅ `computeAnalysisContentHash` binds analysis to the company vault state.
- **No Invention:** ✅ `MIN_MEANINGFUL_QUOTE_CHARS` (30+) enforced for mandatory requirements.
- **Anthropic Fallback:** ✅ Enforced as 10th (last) provider in `lib/ai-provider-catalog.cjs`.
- **Regex Discipline:** ✅ `HUMAN_APPROVED_FALLBACK` state blocks generation until explicit manual note is added.
- **Zero-Row Gate:** ✅ `assertTenderReadyForGenerationAndExport` is called before any `GeneratedDocument` creation.

## Consolidated Summary
- **Missing from main:** `docs/audits/api-route-security-matrix.md` and `lib/release-guardian.ts`.
- **Added directly to main:** Full durable engine + Coding Plan Z.ai model support.
- **AI Analyze Impact:** `main` is stable with success preservation (failed jobs never hide prior promoted successes).
- **Release Blockers:** The code in PR 871/870 is unsafe; it will cause 500 errors in production by attempting to save `envelopeMode` to a schema that doesn't have it.
- **Exact Gaps:** `lib/ai-jobs/analysis-job-service.ts` (PR 871) vs `schema.prisma` (Main).

## One Next Action
**Merge PR 875** into `main` to restore security audit assets, then **Close PR 876** and **Close PR 871/870** to prevent schema-drift regressions.

## CI Regression Analysis (Post-Pass 5)
The initial submission failed CI due to two unit test regressions:
1. **Registry Chain Mismatch**: `tests/mistral-together-providers.test.ts` was using a stale hardcoded array that didn't match the new 10-provider canonical order.
2. **Environment Pollution**: In CI, `GEMINI_API_KEY` is present as a placeholder, causing `isProviderConfigured('gemini')` to return true, which broke the "all providers unconfigured" assertion in `tests/ai-provider-registry.test.ts`.

**Fixes Applied:**
- Updated `tests/mistral-together-providers.test.ts` to use dynamic import and the authoritative `CANONICAL_PROVIDER_CHAIN`.
- Hardened `tests/ai-provider-registry.test.ts` to snapshot and clear all AI keys during the configuration test.
- Verified 100% pass rate in the local sandbox with simulated CI pollution.
