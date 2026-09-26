import { PrismaClient } from "@prisma/client";
import {
  REQUIRED_COLUMNS,
  REQUIRED_FUNCTIONS,
  REQUIRED_TABLES,
  findCriticalSchemaGaps,
} from "./critical-schema-contract.mjs";

const prisma = new PrismaClient();

function migrationHistoryRequired() {
  const explicit = String(process.env.REQUIRE_MIGRATION_HISTORY ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(explicit)) return true;
  if (["false", "0", "no", "off"].includes(explicit)) return false;
  return Boolean(process.env.VERCEL_ENV || process.env.CI);
}

function redact(value) {
  let text = String(value ?? "");
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) text = text.split(databaseUrl).join("[REDACTED_DATABASE_URL]");
  return text.replace(/DATABASE_URL\s*[:=]\s*\S+/gi, "DATABASE_URL=[REDACTED]");
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const tableRows = await prisma.$queryRaw`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = current_schema()
  `;
  const columnRows = await prisma.$queryRaw`
    SELECT table_name AS "tableName", column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
  `;
  const functionRows = await prisma.$queryRaw`
    SELECT proname
    FROM pg_proc
    WHERE proname IN (
      'resolve_tender_requirement_source_file',
      'guard_canonical_requirement_set_delete',
      'refresh_submission_plan_state'
    )
  `;
  let unfinishedMigrations = [];
  if (migrationHistoryRequired()) {
    if (tableRows.some((row) => row.tableName === "_prisma_migrations")) {
      unfinishedMigrations = await prisma.$queryRaw`
        SELECT migration_name AS "migrationName"
        FROM "_prisma_migrations"
        WHERE finished_at IS NULL AND rolled_back_at IS NULL
      `;
    }
  }
  const failures = findCriticalSchemaGaps({
    tableRows,
    columnRows,
    functionRows,
    migrationHistoryRequired: migrationHistoryRequired(),
    unfinishedMigrations,
  });

  const summary = {
    ok: failures.length === 0,
    requiredTables: REQUIRED_TABLES.length,
    requiredColumnGroups: Object.keys(REQUIRED_COLUMNS).length,
    requiredFunctions: REQUIRED_FUNCTIONS.length,
    migrationHistoryRequired: migrationHistoryRequired(),
    failures,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Critical schema verification failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      message: redact(error instanceof Error ? error.message : String(error)),
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
