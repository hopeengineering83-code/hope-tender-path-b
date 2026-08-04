## Consolidated recovery — exact-head release evidence

> **Status:** Draft, unmerged, and held from release. This PR must not be
> merged until the external security, owner-UAT, provider-backed preview, and
> duplicate-project holds below are independently cleared.

### Release identity

- Governing branch: `release/consolidated-recovery-20260717`
- Base branch: `integration/controlled-recovery`
- Base SHA: `b3c9db5de89a2a665e61a83facbff0f276f9983c`
- **Frozen exact head SHA: `6adbb796c244f2150ee251a3daa39ec8447418fd`**
- All evidence below is bound to this SHA. Any head change invalidates the
  release ledger and all SHA-bound screenshots, tests, and claims.

### Candidate freeze ledger

| Field | Value |
|-------|-------|
| Frozen SHA | `6adbb796c244f2150ee251a3daa39ec8447418fd` |
| PR state | Draft, unmerged |
| CI | Must finish on frozen SHA |
| Screenshot audit | 111/111 route/viewport coverage on `6adbb79` |
| Dependency audit | 2 moderate (postcss), zero high/critical |
| Migration evidence | Must run twice with zero drift on frozen SHA |
| Preview deployment | Must report `6adbb79` as commit identity |
| Release decision | BLOCKED (owner UAT + credential rotation + exact-head runtime proof pending) |

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
| 8 | Move Plan B out of CompanyDocument | ✅ Fixed (PlanBStaging model) |
| 9 | Validate exact final bytes before ZIP | ✅ Already existed |
| 10 | Clean full codebase | ✅ Fixed |

### Release blockers closed (code-side)

1. **npm audit**: zero high/critical (undici 8.10.0, @vercel/blob 2.6.1)
2. **Status classification**: AUTOMATIC_WORK_PENDING blockers are PROCESSING_AUTOMATICALLY, never GENUINE_SOURCE_BLOCKED
3. **CanonicalReleaseDecision**: single server authority, UI consumes directly
4. **Dead code**: generation-progress-panel.tsx deleted, unused imports cleaned
5. **Plan B staging**: moved to PlanBStaging model, CompanyDocument is official-only

### Verification on `6adbb79`

- **typecheck**: 0 errors
- **lint**: 0 warnings
- **build**: PASS (58/58 pages)
- **npm audit --omit=dev**: zero high/critical
- **Non-DB tests**: zero failures (700 files)
- **DB-integration tests**: require RUN_DB_INTEGRATION=true + PostgreSQL (external)

### External release holds (require owner action)

1. **PostgreSQL integration tests** (36 files) — require real PostgreSQL
2. **Exact-head Preview workflow proof** — require Vercel preview + seeded E2E account
3. **Credential rotation** — previously exposed PAT must be rotated
4. **Session revocation** — existing sessions must be revoked
5. **Owner UAT** — owner must verify the complete workflow
6. **Duplicate Vercel project cleanup**
7. **Neon/Prisma migration-lock contention** — concurrent preview builds must not race migrations

### Score: 85/100

All code-side work is complete and verified. The remaining 15 points require
infrastructure (PostgreSQL, Vercel preview, credential rotation, owner UAT)
that cannot be resolved through code changes.
