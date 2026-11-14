# Read-only service access grant (first client: HOPE ONE AGENT)

A **revocable, tenant-bound, read-only** way for HOPE ONE AGENT to read the status of
one account's tenders. It never touches a browser session, the cron/worker secrets or any
database credential. It cannot run AI Analyze or Run Engine, or change anything.

## What the owner does (once, on the tablet)

1. In the Tender App, open **Dashboard → Settings → Service access (read-only)**.
2. Choose how long the grant is valid (7, 30, 60 or 90 days) and tap **Issue read-only grant**.
3. Copy the token. It is shown **once** and cannot be recovered.
4. Paste it into **HOPE ONE AGENT → Setup**.

To stop access, tap **Revoke**. It takes effect on the agent's next request.

## What a grant allows

| | |
| --- | --- |
| Tenant | Exactly one user: the one who issued it. The request carries no user or tender id, so a grant cannot be pointed at anyone else's data. |
| Audience | `hope-one-agent` (also enforced by a database CHECK) |
| Scope | `tenders:status:read` (also enforced by a database CHECK) |
| Route | `GET /api/service/v1/tender-status` with `Authorization: Bearer hsa_…` |
| Returns | Up to 50 tenders, soonest deadline first: `id, title (≤160), reference (≤80), status, stage, deadline, updatedAt` and the latest job's `type, status, updatedAt`. Also counts by status, the total, and whether the list was truncated. |
| Never returns | `readinessScore` (not a valid progress metric, Issue #1134), client names or contacts, budget, currency, pricing, notes, descriptions, analysis text, files, documents, or job input, output or error text. The field list is pinned by a unit test (`TENDER_STATUS_SELECT`). |
| Lifetime | Required expiry, at most 90 days (also a database CHECK). Revocation is immediate. At most 5 active grants per user. |
| Storage | Only `SHA-256(token)`; the token has 256 bits of entropy, like `TenderShare` and password-reset tokens. |
| Limits | 30 reads per minute per token. Refused attempts are limited to 20 per 10 minutes per client address. Both are durable (`RateLimitBucket`) and fail closed in production. |
| Audit | Issuing, revoking and any out-of-scope use are written to `AuditLog`. Use is recorded on the grant at most once a minute (`lastUsedAt`, `useCount`). |
| Errors | Missing, malformed, unknown, revoked or expired tokens and deleted tenants all get the same `401`, so the response can't be used to probe tokens. |

Issuing and revoking need a signed-in **ADMIN** or **PROPOSAL_MANAGER**, the middleware's CSRF
origin check, and a durable mutation rate limit. Another user's grant id behaves exactly like a
missing one.

## Files

- `prisma/schema.prisma`: `ServiceAccessGrant`, plus the `User.serviceAccessGrants` back-relation.
- `prisma/migrations/20261113180000_service_access_grants/`: additive (new table, indexes,
  foreign key and CHECK constraints). No existing table changes.
- `lib/service-access.ts`: tokens, input parsing, authentication, and the minimal read.
- `app/api/service/v1/tender-status/route.ts`: the read.
- `app/api/settings/service-grants/route.ts` (list, issue) and `[id]/route.ts` (revoke).
- `app/dashboard/settings/service-access-panel.tsx`: the owner's Settings section.
- Tests:
  - `tests/service-access-grant.test.ts` (unit);
  - `tests/service-access-grant-route-postgres.test.ts` (real PostgreSQL through the route handlers).

## Rollback

The migration only adds a table. Reverting the code leaves the table unused; no existing behaviour
depends on it. To withdraw access without a deploy, revoke the grants on the Settings page.
