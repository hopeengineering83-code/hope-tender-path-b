# Critical release recovery

## Incident

The current main branch cannot deploy to production because the production database contains a failed Prisma migration record for `20260601000000_init`. The migration was added retroactively after the production schema already existed. Prisma reports P3009 and blocks later migrations.

## Recovery policy

The recovery script may resolve this one known migration only when a full Prisma schema diff reports no drift between the target database and `prisma/schema.prisma`.

The sequence is:

1. Run `prisma migrate deploy`.
2. Detect P3009 only when it names `20260601000000_init`.
3. Run `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code`. The database URL remains in the environment and is not passed as a command-line argument.
4. Stop without changing migration history when drift exists.
5. Resolve the failed migration as rolled back.
6. Mark the same verified retroactive migration as applied.
7. Run `prisma migrate deploy` again.
8. Run the critical-schema verifier with migration history required.

No migration is deleted. No production data is deleted. No arbitrary failed migration is automatically resolved.

## Preview safety

Vercel previews do not run database migrations unless an isolated preview database is configured and `ALLOW_PREVIEW_DB_MIGRATIONS=true` is explicitly set. A preview that skips migrations is build-only and must not be reported as database-verified.

## CI policy

CI builds its only test schema through `prisma migrate deploy`. It does not use `prisma db push` or manually reapply migration SQL. A second deployment checks idempotency. Installation, build and tests must leave tracked files unchanged.

## Production deployment gate

Do not merge or deploy this recovery until:

- CI passes on the exact PR head;
- the migration recovery logic receives independent review;
- a current database backup is confirmed;
- the operator confirms the failed migration is exactly `20260601000000_init`;
- the schema diff succeeds without drift;
- the previous working Vercel deployment remains available for rollback.
