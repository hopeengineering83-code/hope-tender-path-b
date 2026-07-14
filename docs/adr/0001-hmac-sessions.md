# ADR 0001: HMAC-signed sessions stored in DB, not JWT

**Status:** Accepted
**Date:** 2025-08-28
**Deciders:** Hope Engineering, initial codebase authors

## Context

The Hope Tender Engine requires user authentication. The two industry-standard
approaches are:

1. **JWT (JSON Web Tokens)** — stateless, signed tokens containing user ID +
   expiry. Server validates signature without DB lookup.
2. **HMAC-signed session tokens + DB-backed Session table** — opaque random
   tokens; server stores SHA-256 hash in DB; every request requires DB lookup.

Forces at play:

- **Tender system sensitivity:** Hope handles confidential tender documents
  and financial data. Stolen credentials must be revocable immediately.
- **Vercel serverless constraints:** no shared in-memory state across
  instances; cold starts must be fast.
- **Single-tenant deployment:** lower scale than multi-tenant SaaS; DB lookup
  per request is acceptable.
- **Compliance posture:** procurement platforms often require "session
  revocation on password change" and "logout invalidates all sessions" — both
  harder with JWT.

## Decision

Use **HMAC-signed session tokens stored in a PostgreSQL `Session` table**.

Implementation in `lib/auth.ts`:

- Token format: `base64url(payload).base64url(hmac_sha256_signature)`.
- Payload: `{ userId, exp, nonce }`.
- Server stores `sha256(token)` in `Session` table (not the raw token).
- Every authenticated request: verify HMAC signature → look up hash in DB →
  confirm `userId` matches → confirm `expiresAt` not passed.
- On logout: delete `Session` row.
- On password change: `destroyAllSessions(userId)` deletes all rows for that
  user.

## Alternatives considered

### Alternative 1: JWT (stateless)

- **Pros:**
  - No DB lookup per request → faster.
  - Smaller payload than DB row.
  - Industry standard.
- **Cons:**
  - Cannot revoke before `exp` without a denylist (which reintroduces DB
    lookup).
  - `exp` is hardcoded at signing time; cannot extend session without
    re-issuing.
  - Token theft = full access until `exp`. For 14-day TTL, this is
    unacceptable for a tender system.

### Alternative 2: Refresh-token rotation (JWT access + opaque refresh)

- **Pros:**
  - Short access-token TTL (15 min) limits theft window.
  - Refresh-token rotation detects theft (reused refresh token invalidates
    both).
- **Cons:**
  - More complex than DB-backed sessions.
  - Requires a `RefreshToken` table anyway.
  - For single-tenant scale, the complexity is not justified.

## Consequences

### Positive

- Immediate revocation on logout, password change, or admin action.
- Audit trail: `Session` table records who logged in when.
- Simple to reason about: no JWT parsing libraries, no key rotation concerns.
- Aligns with non-negotiable rule #9 ("Roles and ownership fail closed").

### Negative

- DB lookup on every authenticated request (latency + load).
- Session table grows; needs periodic cleanup (Vercel cron handles this).
- Cannot scale horizontally without shared DB (already a constraint).

### Neutral

- 14-day TTL is documented in `lib/auth.ts` as `SESSION_TTL_DAYS`.
- Cookie config: `httpOnly`, `sameSite: 'lax'`, `secure: production`.

## Compliance

- **Rule #9 (roles and ownership fail closed):** ✓ — DB lookup per request
  enforces current role state.
- **Rule #16 (public errors never expose internal technical details):** ✓ —
  auth failures return generic "Unauthorized" / "Forbidden".

## Future considerations

- **MFA (GAP-SEC-03):** when added, the session should record `mfaVerifiedAt`
  timestamp. Step-up auth checks `now - mfaVerifiedAt < 15 min` for ADMIN
  actions.
- **Refresh-token migration (GAP-SEC-02):** if session TTL is reduced to 4h,
  this ADR is superseded by a new ADR for refresh-token rotation.

## References

- `lib/auth.ts` — implementation
- `prisma/schema.prisma` — `Session` model
- `lib/security/rbac.ts` — RBAC permission matrix
