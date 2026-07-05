# Neon Database Switch Checklist

## When to use this
When the current Neon project hits transfer/compute limits and a new project must be created.

> **⚠️ Audit DOC-001 (2026-06-20):** This checklist previously stated the Vercel build runs `prisma db push --accept-data-loss=false`. That was **incorrect** — the actual build (`package.json` → `vercel-build`) runs `node scripts/migrate-deploy-safe.mjs && next build`, which executes `prisma migrate deploy` (NOT `prisma db push`). An operator following the old checklist might manually run `npm run db:push` to "force" the schema — `db push` would DROP the `SubmissionPlanState` table (which Prisma doesn't know about — see audit DB-005) and lose all submission-plan state. The corrected procedure below uses `prisma migrate deploy` exclusively.

> **⚠️ Audit DOC-003 (2026-06-20):** The backup file referenced below (`hope-tender-safe-no-aijob-20260604-001438.dump` from 2026-06-04) is stale. Before starting a Neon switch, generate a FRESH backup from the current production database using `pg_dump` against the current `DATABASE_URL`.

## Steps

### 1. Generate a FRESH backup from the current database
- Run from a machine with access to the current `DATABASE_URL`:
  ```bash
  pg_dump --format=custom --no-owner --no-privileges \
    --file="hope-tender-$(date +%Y%m%d-%H%M%S).dump" \
    "$DATABASE_URL"
  ```
- Verify the dump file is non-empty and the timestamp is current.
- Compute and record the SHA-256 checksum:
  ```bash
  sha256sum hope-tender-*.dump
  ```

### 2. Restore from backup into the NEW Neon project
- Create a new Neon project (free or paid tier).
- Get the new `DATABASE_URL` (use the **pooled** connection string — it ends in `-pooler.postgres.vercel-storage.com` or similar — for serverless compatibility).
- Restore the backup into the new project:
  ```bash
  pg_restore --no-owner --no-privileges \
    -d "$NEW_DATABASE_URL" \
    hope-tender-YYYYMMDD-HHMMSS.dump
  ```
- If `pg_restore` reports pre-existing-object warnings, that is expected (the new Neon project may have a default `public` schema). Errors about missing tables or permission denied are NOT expected — investigate before continuing.

### 3. Update Vercel environment
- Go to Vercel dashboard → Project → Settings → Environment Variables.
- Update `DATABASE_URL` to the new Neon pooled connection string (for all environments: Production, Preview, Development).
- Trigger a new deployment (push an empty commit or click "Redeploy" in Vercel).

### 4. Verify schema (CORRECTED — uses `prisma migrate deploy`, NOT `db push`)
The Vercel build command (`vercel-build` in `package.json`) runs:
```
node scripts/check-env.mjs && prisma generate && node scripts/migrate-deploy-safe.mjs && next build
```
`migrate-deploy-safe.mjs` executes `prisma migrate deploy`, which applies any pending migrations from `prisma/migrations/` that were not already in the backup. This is **safe** — `migrate deploy` only applies additive migrations (all migrations in this repo use `IF NOT EXISTS` / `ADD COLUMN` and are backward-compatible).

**DO NOT run `npm run db:push`** (`prisma db push`). `db push` reconciles the database against `schema.prisma` by DROP-and-recreate, which would:
- DROP the `SubmissionPlanState` table (exists in the database and runtime code but has no Prisma model — see audit DB-005),
- lose all submission-plan state for every tender,
- potentially drop other tables that exist in the DB but not in `schema.prisma`.

If you need to verify schema integrity after the switch, run:
```bash
node scripts/check-critical-schema.mjs   # verifies 15 required tables + 7 column groups + 3 PG functions
node scripts/verify-retroactive-init.mjs # validates init migration checksum
```

### 5. Smoke test
- `GET /api/health` → should return `{ ok: true, status: "healthy", tables: { ... all true ... } }`
- Login and verify tenders load.
- Check that file uploads work.
- Check that AI Analyze works (verify `/api/ai/health` returns a 200 with provider status).
- Check that the dashboard provider-health panel renders without errors.

### 6. After verification
- Run: `DRY_RUN=true npx tsx scripts/migrate-db-files-to-blob.ts`
  (To check if any files need blob migration — dry-run first, then run without `DRY_RUN` if the report shows files to migrate.)
- Update this checklist's "last used" date below.

## No hardcoded connection strings
The app reads `DATABASE_URL` only from environment variables. No Neon project IDs are hardcoded in the codebase.

## Last used
- **Last successful switch:** (none recorded — update this line when you complete a switch using this checklist)
- **Last checklist revision:** 2026-06-20 (audit DOC-001/DOC-003 — corrected `db push` → `migrate deploy`, added fresh-backup step)
