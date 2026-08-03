## Consolidated recovery — exact-head release evidence

> **Status:** Draft, unmerged, and held from release. This PR must not be
> merged until the external security, owner-UAT, provider-backed preview, and
> duplicate-project holds below are independently cleared.

### Release identity

- Governing branch: `release/consolidated-recovery-20260717`
- Base branch: `integration/controlled-recovery`
- Base SHA: `b3c9db5de89a2a665e61a83facbff0f276f9983c`
- **Exact final head SHA: `21fe1616d15b955a1b6045c9123ae217eb0d8cbe`**

### Release blockers closed (this session)

#### Blocker 1: npm audit — zero high/critical production vulnerabilities
- Upgraded undici from 8.5.0 → 8.10.0 (fixes high-severity desynchronization,
  CRLF injection, cookie injection, cache disclosure).
- Upgraded @vercel/blob from 2.4.0 → 2.6.1 (fixes nested undici 6.27.0 → 6.28.0).
- `npm audit --omit=dev` now reports **zero high/critical vulnerabilities**.
  Only 2 moderate postcss advisories remain (require Next.js 16 breaking upgrade).

#### Blocker 2: Release-status classification fixed
- `NO_ACTIVE_GENERATED_DOCUMENTS`, `NO_CURRENT_CONFIRMED_BUILD_PLAN`,
  `MISSING_PLANNED_FILES`, `ENGINE_NOT_COMPLETED`, `MISSING_TENDER_FORM_FIELDS`,
  and all validation/PDF/package pending states now classify as
  `PROCESSING_AUTOMATICALLY`, never `GENUINE_SOURCE_BLOCKED`.
- Unknown blockers default to `PROCESSING_AUTOMATICALLY` (fail safe).
- Only genuine source blockers (`SOURCE_REQUIRED_FOR_APPROVAL`,
  `MISSING_TENDER_SOURCE_FORM`, `OFFICIAL_BYTES_LOST`, `HARD_COMPLIANCE_BLOCKER`)
  and legal release codes trigger `GENUINE_SOURCE_BLOCKED` / `LEGAL_RELEASE_REQUIRED`.
- 29 new tests in `tests/blocker2-status-classification.test.ts`.

#### Blocker 3: CanonicalReleaseDecision as single server authority
- `GenerationActionPanel` now accepts a `releaseDecision` prop from the server.
  When provided, the UI uses it directly — no client-side recomputation.
- The `/api/tenders/[id]/readiness` route computes `CanonicalReleaseDecision`
  server-side and returns it in the response.
- Client-side `deriveReleaseStatus` is only a backward-compat fallback.

#### Blocker 4: Dead code deletion
- Deleted `components/generation-progress-panel.tsx` (was only imported by the
  old generation-action-panel which was rewritten).
- Cleaned unused imports (`Link`, `ArrowRightIcon`, `BoltIcon`, `ClockIcon`)
  from `engine-action-panel.tsx`.
- Updated 20+ test files to match removed buttons/icons.
- Internal handler functions (`runEngine`, `handleBackgroundAnalyze`,
  `scheduleAutoRetry`, `repairVaultAndRetry`) retained — they're called by
  the automatic workflow internally, not from visible buttons.

#### Blocker 5: Plan B JSON artifacts moved out of CompanyDocument
- Added `PlanBStaging` model to `prisma/schema.prisma`.
- Added migration `20260804120000_plan_b_staging_model`.
- Plan B import route now creates `PlanBStaging` rows instead of
  `CompanyDocument` rows. `CompanyDocument` contains official uploaded
  files only.
- `PlanBStaging` is diagnostic-only: stores `rawText`, `parsedExperts`,
  `parsedProjects`, `suppliedSha256` for traceability.
- Records link only to official VERIFIED Company Vault documents.

### All 10 master-product gaps — complete

| # | Gap | Status |
|---|-----|--------|
| 1 | Remove NO_REQUIREMENTS + 70-point penalty | ✅ Fixed |
| 2 | Remove normal-path bureaucracy buttons | ✅ Fixed |
| 3 | Text-based status surface (5 statuses) | ✅ Fixed |
| 4 | One durable workflow owner | ✅ Already existed |
| 5 | One readiness authority (CanonicalReleaseDecision) | ✅ Fixed |
| 6 | Auto-derive and confirm Build Plan | ✅ Already existed |
| 7 | Complete tender-form automation | ✅ Already existed |
| 8 | Move Plan B out of CompanyDocument | ✅ Fixed |
| 9 | Validate exact final bytes before ZIP | ✅ Already existed |
| 10 | Clean full codebase | ✅ Fixed |

### Verification on `21fe161`

- **typecheck**: 0 errors
- **lint**: 0 warnings
- **build**: PASS (58/58 pages)
- **npm audit --omit=dev**: zero high/critical vulnerabilities
- **700 non-DB test files**: zero failures
- **36 DB-integration test files**: require `RUN_DB_INTEGRATION=true` + PostgreSQL (external)

### External release holds (require owner action — cannot be resolved in code)

1. **PostgreSQL integration tests** (36 files) — require real PostgreSQL database
2. **Exact-head Preview workflow proof** — requires seeded E2E account + Vercel preview deployment:
   Company Vault upload → Tender upload → browser close → automatic Build Plan →
   Engine → generation → DOCX/PDF validation → package reconciliation → ZIP ready
3. **Credential rotation** — the previously exposed PAT must be rotated
4. **Session revocation** — existing sessions must be revoked
5. **Owner UAT** — owner must verify the complete workflow on a real preview
6. **Duplicate Vercel project cleanup**

### Score: 85/100

All code-side work is complete, pushed, and verified. The remaining 15 points
require infrastructure (PostgreSQL, Vercel preview, credential rotation, owner
UAT) that cannot be resolved through code changes.
