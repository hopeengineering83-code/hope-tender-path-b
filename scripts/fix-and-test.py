#!/usr/bin/env python3
"""Fix migration files and test on the target branch atomically."""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path("/home/z/my-project")
ENV = {**os.environ, "DATABASE_URL": "postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public"}

def run(cmd, check=True, env=None):
    e = env or ENV
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, env=e, shell=True)
    if check and result.returncode != 0:
        print(f"FAILED: {cmd[:80]}")
        print(result.stderr[-500:] if result.stderr else result.stdout[-500:])
        return result
    return result

# 1. Checkout target branch
print("1. Checking out target branch...")
run("git checkout hotfix/release-safety-consolidation")
branch = run("git branch --show-current").stdout.strip()
print(f"   On branch: {branch}")
if branch != "hotfix/release-safety-consolidation":
    print("ERROR: Could not switch to target branch!")
    sys.exit(1)

# 2. Remove duplicate migration
print("2. Removing duplicate migration 20260630120000...")
dup_path = ROOT / "prisma/migrations/20260630120000_add_build_plan"
if dup_path.exists():
    import shutil
    shutil.rmtree(dup_path)
    run("git add -A")
    print("   Removed.")
else:
    print("   Already removed.")

# 3. Fix the backfill migration
print("3. Fixing migration 20260701000000 backfills...")
migration_path = ROOT / "prisma/migrations/20260701000000_add_build_plan_confirmation_fields/migration.sql"
migration_content = migration_path.read_text()

# Replace the unguarded UPDATE with a DO block
old_backfill = '''UPDATE "BuildPlan" SET "builtById" = "createdBy" WHERE "builtById" IS NULL AND "createdBy" IS NOT NULL;'''
new_backfill = '''DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'BuildPlan' AND column_name = 'createdBy'
  ) THEN
    UPDATE "BuildPlan" SET "builtById" = "createdBy"
    WHERE "builtById" IS NULL AND "createdBy" IS NOT NULL;
  END IF;
END $$;'''

old_backfill2 = '''UPDATE "BuildPlan" SET "confirmedById" = "confirmedBy" WHERE "confirmedById" IS NULL AND "confirmedBy" IS NOT NULL;'''
new_backfill2 = '''DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'BuildPlan' AND column_name = 'confirmedBy'
  ) THEN
    UPDATE "BuildPlan" SET "confirmedById" = "confirmedBy"
    WHERE "confirmedById" IS NULL AND "confirmedBy" IS NOT NULL;
  END IF;
END $$;'''

if old_backfill in migration_content:
    migration_content = migration_content.replace(old_backfill, new_backfill)
    print("   Fixed builtById backfill.")
if old_backfill2 in migration_content:
    migration_content = migration_content.replace(old_backfill2, new_backfill2)
    print("   Fixed confirmedById backfill.")
else:
    print("   confirmedById backfill already fixed or not found.")

migration_path.write_text(migration_content)
run("git add -A")

# 4. Drop and recreate DB schema
print("4. Dropping and recreating database schema...")
run("""node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\\$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE').then(() => p.\\$executeRawUnsafe('CREATE SCHEMA public')).then(() => { console.log('Schema dropped and recreated'); return p.\\$disconnect(); }).catch(e => { console.error(e.message); process.exit(1); });
" """)

# 5. Apply migrations
print("5. Applying migrations...")
result = run("npx prisma migrate deploy", check=False)
print(result.stdout[-500:])
if result.returncode != 0:
    print("MIGRATION FAILED!")
    print(result.stderr[-500:])
    sys.exit(1)

# 6. Generate Prisma client
print("6. Generating Prisma client...")
run("npx prisma generate")

# 7. Run typecheck
print("7. Running typecheck...")
result = run("npx tsc --noEmit", check=False)
if result.returncode != 0:
    print("TYPECHECK FAILED!")
    print(result.stderr[-500:])
    sys.exit(1)
print("   Typecheck passed.")

# 8. Run tests
print("8. Running tests...")
test_env = {**ENV, "RUN_DB_INTEGRATION": "true"}
result = run("node scripts/run-tests.mjs", check=False, env=test_env)
# Extract test summary
for line in result.stdout.split('\n'):
    if line.startswith('ℹ tests') or line.startswith('ℹ pass') or line.startswith('ℹ fail'):
        print(f"   {line}")
if 'ℹ fail 0' not in result.stdout:
    print("TESTS FAILED!")
    # Show failures
    for line in result.stdout.split('\n'):
        if line.startswith('✖'):
            print(f"   {line}")
    sys.exit(1)

print("\n✓ All checks passed!")
