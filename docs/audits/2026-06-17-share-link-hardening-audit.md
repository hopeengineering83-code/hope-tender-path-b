# Tender Share-Link Security Audit

Date: 2026-06-17  
Base: `integration/production-engine-2026-06` at `12c85e93c98a81581eae3489346558adf829896f`

This branch is isolated from the Jules release-proof lane and from the company-asset/Blob hardening branch.

## Confirmed gaps

- Any authenticated role could create or delete share links.
- Share labels and expiry values were not validated or bounded.
- The API ignored the existing `maxDownloads` capability during creation.
- Tokens relied only on the schema default rather than an explicit bearer-token policy.
- Share deletion removed the audit record rather than revoking it.
- The owner management API used process-local behavior and lacked explicit no-store responses.
- The public page checked expiry/revocation/access limits and incremented the counter in separate queries, allowing concurrent requests to exceed the configured limit.
- The public page did not validate token shape before querying and did not explicitly disable caching.

## Corrections in this branch

- ADMIN/PROPOSAL_MANAGER authorization for share management.
- Persistent mutation rate limiting.
- Cryptographically random 32-byte base64url bearer tokens.
- Bounded label, expiry, and access-limit validation.
- Maximum one-year share lifetime and maximum 10,000 accesses.
- Revocation instead of destructive deletion.
- Owner management responses marked private and no-store.
- Public token syntax validation.
- Dynamic/no-store page rendering.
- One atomic SQL update that verifies revocation, expiry, and remaining access count while incrementing the counter.
- Focused unit and source-policy regression tests.

## Explicit exclusions

This branch does not change authentication/session implementation, migrations, AI behavior, document generation, file storage, or Jules's full two-user/golden-workflow tests.

## Merge status

Draft only. CI and independent review are required before controlled integration.
