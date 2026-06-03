# Neon Database Switch Checklist

## When to use this
When the current Neon project hits transfer/compute limits and a new project must be created.

## Steps

### 1. Restore from backup
- Verify backup file: hope-tender-safe-no-aijob-20260604-001438.dump
- Verify checksum: hope-tender-safe-no-aijob-20260604-001438.dump.sha256
- Create new Neon project (free or paid tier)
- Get new DATABASE_URL from Neon dashboard
- Restore: pg_restore --no-owner -d $NEW_DATABASE_URL hope-tender-safe-no-aijob-20260604-001438.dump

### 2. Update Vercel environment
- Go to Vercel dashboard → Project → Settings → Environment Variables
- Update DATABASE_URL to new Neon connection string
- Trigger a new deployment (push an empty commit or redeploy)

### 3. Verify schema
The Vercel buildCommand runs: prisma db push --accept-data-loss=false
This will apply any schema changes that weren't in the backup.

### 4. Smoke test
- GET /api/health → should return { ok: true, databaseReachable: true }
- Login and verify tenders load
- Check that file uploads work
- Check that AI Analyze works

### 5. After verification
- Run: DRY_RUN=true npx tsx scripts/migrate-db-files-to-blob.ts
  (To check if any files need blob migration)

## No hardcoded connection strings
The app reads DATABASE_URL only from environment variables.
No Neon project IDs are hardcoded in the codebase.
