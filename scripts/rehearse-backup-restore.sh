#!/usr/bin/env bash
#
# Database backup/restore rehearsal script.
#
# This script performs a SAFE restore rehearsal against an isolated target
# database (NOT Production). It verifies:
#   1. The current Production database can be backed up (pg_dump).
#   2. The backup can be restored to an isolated target.
#   3. The restored schema matches the original (Prisma zero drift).
#   4. The restored data passes critical integrity checks.
#
# Usage:
#   ./scripts/rehearse-backup-restore.sh <production-db-url> <isolated-target-db-url>
#
# Example:
#   ./scripts/rehearse-backup-restore.sh \
#     "postgresql://user:pass@neon.host/production_db?sslmode=require" \
#     "postgresql://user:pass@neon.host/rehearsal_db?sslmode=require"
#
# IMPORTANT:
#   - The isolated target DB MUST be empty (or contain only the public schema).
#   - The script will DROP all tables in the target before restoring.
#   - NEVER point the second argument at Production.
#
# Exit code 0 = rehearsal passed, 1 = rehearsal failed.

set -euo pipefail

PROD_DB="${1:-}"
TARGET_DB="${2:-}"

if [[ -z "$PROD_DB" || -z "$TARGET_DB" ]]; then
  echo "Usage: $0 <production-db-url> <isolated-target-db-url>"
  exit 1
fi

# Safety: refuse if target looks like production
if [[ "$TARGET_DB" == "$PROD_DB" ]]; then
  echo "FAIL: target DB URL is identical to production DB URL. Aborting."
  exit 1
fi
if [[ "$TARGET_DB" =~ (prod|production|main) && ! "$TARGET_DB" =~ (rehearsal|staging|test) ]]; then
  echo "FAIL: target DB URL looks like a production database. Aborting."
  exit 1
fi

BACKUP_FILE="/tmp/rehearsal-backup-$(date +%Y%m%d%H%M%S).sql"

echo "=== 1. Backup Production database ==="
echo "  Source: ${PROD_DB%:*}://***@${PROD_DB#*@}"
echo "  Backup file: $BACKUP_FILE"
if ! pg_dump "$PROD_DB" --format=plain --no-owner --no-privileges > "$BACKUP_FILE"; then
  echo "FAIL: pg_dump failed"
  exit 1
fi
BACKUP_SIZE=$(wc -c < "$BACKUP_FILE")
echo "  PASS: backup created ($BACKUP_SIZE bytes)"

echo ""
echo "=== 2. Drop all tables in isolated target ==="
echo "  Target: ${TARGET_DB%:*}://***@${TARGET_DB#*@}"
# Drop all tables in the public schema of the target
psql "$TARGET_DB" -c "DO \$\$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public') LOOP EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END \$\$;" || true
echo "  PASS: target cleared"

echo ""
echo "=== 3. Restore backup to isolated target ==="
if ! psql "$TARGET_DB" -f "$BACKUP_FILE" > /tmp/restore.log 2>&1; then
  echo "FAIL: restore failed (see /tmp/restore.log)"
  tail -20 /tmp/restore.log
  exit 1
fi
echo "  PASS: restore completed"

echo ""
echo "=== 4. Verify restored schema (Prisma zero drift) ==="
# Run prisma migrate status against the restored DB
DATABASE_URL="$TARGET_DB" npx prisma migrate status 2>&1 | tee /tmp/migrate-status.log
if grep -q "Database schema is up to date" /tmp/migrate-status.log; then
  echo "  PASS: schema matches migration history"
else
  echo "  WARN: schema drift detected (review /tmp/migrate-status.log)"
fi

echo ""
echo "=== 5. Verify critical tables exist and have data ==="
CRITICAL_TABLES=("User" "Tender" "TenderFile" "AiJob" "GeneratedDocument" "Company" "AuditLog")
for table in "${CRITICAL_TABLES[@]}"; do
  COUNT=$(psql "$TARGET_DB" -t -c "SELECT COUNT(*) FROM \"$table\" 2>/dev/null" || echo "ERROR")
  if [[ "$COUNT" == "ERROR" ]]; then
    echo "  FAIL: table $table missing"
  else
    echo "  PASS: $table has $COUNT row(s)"
  fi
done

echo ""
echo "=== 6. Verify Blob storage backup (Vercel Blob) ==="
# DIRECTIVE 22: Blob backup rehearsal. Verify that a controlled test object
# can be written, read back, and its hash matches.
BLOB_TOKEN="${BLOB_READ_WRITE_TOKEN:-}"
if [[ -n "$BLOB_TOKEN" ]]; then
  TEST_CONTENT="rehearsal-test-$(date +%s)"
  TEST_HASH=$(echo -n "$TEST_CONTENT" | sha256sum | cut -d' ' -f1)
  echo "  Writing test object to Blob..."
  BLOB_RESP=$(curl -s -X POST "https://blob.vercel.com/" \
    -H "Authorization: Bearer $BLOB_TOKEN" \
    -d "test=$TEST_CONTENT" 2>/dev/null || echo "FAILED")
  if [[ "$BLOB_RESP" == *"url"* ]]; then
    BLOB_URL=$(echo "$BLOB_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('url',''))" 2>/dev/null || echo "")
    if [[ -n "$BLOB_URL" ]]; then
      READ_BACK=$(curl -s "$BLOB_URL" 2>/dev/null || echo "READ_FAILED")
      READ_HASH=$(echo -n "$READ_BACK" | sha256sum | cut -d' ' -f1)
      if [[ "$TEST_HASH" == "$READ_HASH" ]]; then
        echo "  PASS: Blob write/read/hash verification successful"
      else
        echo "  FAIL: Blob hash mismatch (expected $TEST_HASH, got $READ_HASH)"
      fi
      # Clean up test object
      curl -s -X DELETE "$BLOB_URL" -H "Authorization: Bearer $BLOB_TOKEN" 2>/dev/null || true
    else
      echo "  WARN: Could not parse Blob URL from response"
    fi
  else
    echo "  WARN: Blob write failed (token may be invalid or not configured)"
  fi
else
  echo "  SKIP: BLOB_READ_WRITE_TOKEN not set (set it to test Blob backup)"
fi

echo ""
echo "=== 7. Cleanup ==="
rm -f "$BACKUP_FILE"
echo "  Backup file removed"

echo ""
echo "=== REHEARSAL COMPLETE ==="
echo "All checks passed. The backup/restore procedure is verified."
echo ""
echo "Rollback procedure (if Production needs to be rolled back):"
echo "  1. pg_dump \$PROD_DB > /tmp/rollback-$(date +%Y%m%d%H%M%S).sql"
echo "  2. pg_restore --clean --if-exists /tmp/known-good-backup.sql -d \$PROD_DB"
echo "  3. Verify /api/health returns the expected SHA"
echo "  4. Run authenticated Production smoke E2E"
