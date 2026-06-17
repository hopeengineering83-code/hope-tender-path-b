# Migration alignment note

The controlled integration branch includes the existing retroactive initialization migration from `main`. Four later historical migrations are therefore aligned byte-for-byte with the current `main` versions that use `IF NOT EXISTS` and guarded foreign-key creation. This preserves the repository's existing migration history and allows a clean database to apply the full sequence without recreating objects already created by the initialization migration.

No migration was regenerated and no production database was modified by this alignment.
