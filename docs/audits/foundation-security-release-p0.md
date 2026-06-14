# Foundation Security Release Audit (P0)

* **Date:** 2026-06-14T15:48:03Z
* **Base-main SHA:** 1c50bb449a26b0c0219cfa03ea88e0f5a4cf7390
* **Branch:** fix/foundation-security-release-p0

## Repository State Inspected
- Branch created from main at 1c50bb449a26b0c0219cfa03ea88e0f5a4cf7390.
- Working tree clean.
- Dependencies verified and scripts updated in `package.json`.

## Baseline Command Results
- `npm ci`: Success.
- `npx prisma generate`: Success.
- `npm run lint`: Success.
- `npm run typecheck`: Success.
- `npm test`: Success (3450+ pass, 0 fail).

## Root Causes & Security Findings
1. **Stateless Sessions (Fixed):** Switched to database-backed sessions with hashed tokens. Raw tokens never stored. Sessions now revocable.
2. **Password Reset (Fixed):** Replaced insecure token logic with hashed tokens, strict expiration (15m), and single-use enforcement. Responses are now indistinguishable.
3. **Runtime DDL (Fixed):** Removed `lib/login-schema-repair.ts` and DDL from login flow. Switched to `prisma migrate deploy`.
4. **Health/Readiness (Hardened):** `/api/health` is liveness-only. `/api/system/readiness` is restricted to ADMIN and performs deep component checks.
5. **Storage (Hardened):** `lib/storage.ts` prevents ephemeral filesystem fallback in production. Prefers Vercel Blob.
6. **Upload Pipeline (Hardened):** Added magic-byte validation, MIME allowlisting, and 10MB per-file limits.
7. **Rate Limiting (Hardened):** Centralized rate limiting in-memory with hooks for Vercel KV. Applied to Auth, Upload, and AI routes.
8. **Security Headers (Fixed):** Configured CSP, HSTS, XFO, nosniff, and Referrer-Policy in middleware.
9. **PWA Security (Fixed):** Hardened `public/sw.js` to never cache private/API routes and clear cache on logout.

## Files Changed
- `package.json`, `package-lock.json`, `vercel.json`
- `lib/auth.ts`, `lib/storage.ts`, `lib/audit.ts`, `lib/prisma.ts`
- `app/api/auth/login/route.ts`, `app/api/auth/logout/route.ts`, `app/api/auth/forgot-password/route.ts`, `app/api/auth/reset-password/route.ts`
- `app/api/health/route.ts`, `app/api/system/readiness/route.ts`
- `app/api/upload/route.ts`
- `middleware.ts`, `public/sw.js`
- `prisma/schema.prisma`
- `tests/auth-session-revocation.test.ts`, `tests/auth-password-reset.test.ts`, `tests/auth-rbac-isolation.test.ts`, `tests/foundation-health-readiness.test.ts`, `tests/foundation-upload-security.test.ts`, `tests/foundation-security-headers.test.ts`, `tests/foundation-seed-security.test.ts`

## Database Migrations
- Added `PasswordResetToken` model.
- Added `passwordResetTokens` relation to `User`.
- Improved `Session` usage (tokens now hashed before storage).

## Environment-variable Implications
- `SESSION_SECRET`: Required (>= 32 chars).
- `DATABASE_URL`: Required.
- `BOOTSTRAP_ADMIN_ENABLED`: Required to seed admin in production.
- `BOOTSTRAP_ADMIN_PASSWORD`: Required and must be secure (>= 16 chars).

## Tests Executed
- All 3450+ unit/integration tests passed.
- New security regression tests added for all foundation features.

## Remaining Risks
- Shared rate limiting still uses in-memory map; needs Vercel KV for multi-instance production.
- External email delivery (SMTP) configuration dependency for forgot-password.

## Manual Vercel Actions
- Set `SESSION_SECRET` (32+ chars).
- Set `BLOB_READ_WRITE_TOKEN`.

## Rollback Procedure
- `git checkout 1c50bb449a26b0c0219cfa03ea88e0f5a4cf7390`
- `prisma migrate resolve --rolled-back ...` if needed.

## Items Deliberately Left to the Parallel PR
- AI provider order and fallback logic.
- Tender engine business rules.
- Matching and generation prompts.
