#!/usr/bin/env bash
# TEMPORARY — verified-baseline recovery tool for the new Preview database
# (fingerprint d74f2ac75c88). Deleted as part of cleanup once the recovery
# is complete.
#
# Prints a deterministic, ordered, plain-text structural snapshot of a
# PostgreSQL database (tables/columns/indexes/foreign keys/enums/functions/
# triggers/extensions) plus per-table row COUNTS. Never prints row content,
# never prints the connection string itself. Two snapshots taken this way can
# be diffed byte-for-byte to prove (or disprove) structural equivalence.
#
# Usage: SNAPSHOT_DATABASE_URL=postgresql://... ./tmp-schema-structural-snapshot.sh
set -euo pipefail

: "${SNAPSHOT_DATABASE_URL:?SNAPSHOT_DATABASE_URL is required}"

run() {
  psql "$SNAPSHOT_DATABASE_URL" -v ON_ERROR_STOP=1 -tA -F'|' -c "$1"
}

echo "=== TABLES ==="
run "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name;"

echo "=== COLUMNS ==="
run "select table_name, column_name, data_type, is_nullable, coalesce(column_default,''), coalesce(character_maximum_length::text,''), coalesce(numeric_precision::text,''), coalesce(numeric_scale::text,'') from information_schema.columns where table_schema='public' order by table_name, column_name;"

echo "=== PRIMARY_KEYS ==="
run "select tc.table_name, kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name and tc.table_schema=kcu.table_schema where tc.constraint_type='PRIMARY KEY' and tc.table_schema='public' order by tc.table_name, kcu.ordinal_position;"

echo "=== UNIQUE_CONSTRAINTS ==="
run "select tc.table_name, tc.constraint_name, kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name and tc.table_schema=kcu.table_schema where tc.constraint_type='UNIQUE' and tc.table_schema='public' order by tc.table_name, tc.constraint_name, kcu.ordinal_position;"

echo "=== FOREIGN_KEYS ==="
run "select tc.table_name, tc.constraint_name, kcu.column_name, ccu.table_name, ccu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name and tc.table_schema=kcu.table_schema join information_schema.constraint_column_usage ccu on tc.constraint_name=ccu.constraint_name and tc.table_schema=ccu.table_schema where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public' order by tc.table_name, tc.constraint_name;"

echo "=== INDEXES ==="
run "select indexname, indexdef from pg_indexes where schemaname='public' order by indexname;"

echo "=== ENUMS ==="
run "select t.typname, e.enumlabel from pg_type t join pg_enum e on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' order by t.typname, e.enumsortorder;"

echo "=== FUNCTIONS ==="
run "select r.routine_name, r.data_type, (select count(*) from information_schema.parameters p where p.specific_name=r.specific_name) from information_schema.routines r where routine_schema='public' and routine_type='FUNCTION' order by r.routine_name;"

echo "=== TRIGGERS ==="
run "select trigger_name, event_manipulation, event_object_table, action_timing from information_schema.triggers where trigger_schema='public' order by event_object_table, trigger_name, event_manipulation;"

echo "=== EXTENSIONS ==="
run "select extname from pg_extension order by extname;"

echo "=== ROW_COUNTS ==="
TABLES=$(run "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name;")
while IFS= read -r t; do
  [ -z "$t" ] && continue
  count=$(psql "$SNAPSHOT_DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c "select count(*) from \"$t\";")
  echo "${t}|${count}"
done <<< "$TABLES"
