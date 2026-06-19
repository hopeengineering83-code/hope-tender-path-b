# Security and Data-Handling Audit — Parallel Lane

Date: 2026-06-17  
Base: `integration/production-engine-2026-06` at `12c85e93c98a81581eae3489346558adf829896f`

This lane intentionally excludes the migration, authenticated golden workflow, AI resume, cron, icon, and deployment-proof work assigned to Jules.

## Confirmed and fixed in this branch

### Company brand-asset ingestion

The previous route accepted arbitrary file types and sizes, stored every upload directly as database Base64, allowed every authenticated role to mutate company assets, deactivated prior assets outside a transaction, and did not remove superseded stored bytes.

The replacement now:

- permits macro-free DOCX only for letterhead templates;
- permits PNG or JPEG only for logo, header, footer, signature, and stamp assets;
- validates file signatures and Office ZIP structure;
- rejects macros, ActiveX controls, embedded objects, unsafe archive paths, empty files, and files over 5 MiB;
- restricts mutations to ADMIN and PROPOSAL_MANAGER roles;
- applies persistent mutation rate limiting;
- stores assets through the configured storage adapter;
- compensates storage when the database transaction fails;
- cleans superseded stored bytes on a best-effort basis;
- returns private, no-store responses;
- revalidates stored legacy assets before serving them.

### Private Vercel Blob trust boundary

The previous Blob reader attached `BLOB_READ_WRITE_TOKEN` to any HTTPS URL stored in a database row. A corrupted or malicious `storagePath` could therefore forward the Blob bearer token to an unrelated host.

The replacement now:

- accepts only HTTPS hosts under `*.blob.vercel-storage.com`;
- rejects arbitrary, malformed, non-HTTPS, and suffix-spoofed URLs;
- reads private objects with the official `@vercel/blob` `get()` API;
- validates provider-returned Blob URLs;
- enforces the same trust boundary for deletion.

## Tests added

- company asset filename sanitization;
- valid and disguised PNG handling;
- valid JPEG handling;
- rejection of PDF and SVG image assets;
- valid DOCX letterhead handling;
- rejection of legacy DOC, macro-enabled DOCX, embedded objects, malformed archives, empty files, and oversized assets;
- trusted and untrusted Vercel Blob URL cases, including suffix spoofing.

## Additional confirmed gaps reserved for separate branches

These are not changed here to keep this PR atomic:

1. Login currently performs schema repair during authentication, uses an in-memory rate limiter, trusts forwarded headers through a route-local helper, and returns internal diagnostic detail to clients.
2. Share-link access checks `maxDownloads` and then increments in separate operations, so concurrent requests can exceed the limit. A page view is also counted as a download.
3. Share creation accepts unbounded labels and loosely parsed dates, and the list response exposes raw share tokens to any permitted account owner session.
4. Some generated-document and PDF responses omit `private, no-store` and `X-Content-Type-Options: nosniff`.
5. Generic unauthorized and forbidden JSON responses omit explicit no-store headers.
6. Some route-level catch blocks return internal exception messages to authenticated clients.
7. The repository still has broad direct-to-main PRs whose changes must be selectively reconstructed into controlled feature lanes rather than merged wholesale.

## Merge status

This branch requires CI and independent review. It must remain a draft and must not be merged directly to `main`.
