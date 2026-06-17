import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REQUIRED_TABLES = [
  "User",
  "Company",
  "Tender",
  "TenderFile",
  "TenderRequirement",
  "GeneratedDocument",
  "DocumentReview",
  "DocumentComment",
  "AiJob",
  "AiJobStep",
  "RateLimitBucket",
  "PasswordResetToken",
  "SubmissionPlanState",
  "ExportPackage",
  "AuditLog",
];

const REQUIRED_COLUMNS = {
  Tender: ["id", "userId", "status", "stage", "analysisExtractionStatus"],
  TenderFile: ["id", "tenderId", "storagePath", "fileContent", "extractedText", "deletionStatus"],
  TenderRequirement: ["id", "tenderId", "sourceTenderFileId", "sourcePageNumber", "sourceExactQuote"],
  GeneratedDocument: ["id", "tenderId", "fileContent", "reviewStatus", "generationStatus"],
  DocumentReview: ["id", "documentId", "reviewerId", "action", "priorStatus", "newStatus"],
  AiJob: ["id", "userId", "tenderId", "jobType", "status", "input"],
  RateLimitBucket: ["keyHash", "count", "resetAt", "createdAt", "updatedAt"],
};

const REQUIRED_FUNCTIONS = [
  "resolve_tender_requirement_source_file",
  "guard_canonical_requirement_set_delete",
  "refresh_submission_plan_state",
];

function requireMigrationHistory() {
  const explicit = (process.env.REQUIRE_MIGRATION_HISTORY ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(explicit)) return true;
  if (["false", "0", "no", "off"].includes(explicit)) return false;
  return Boolean(process.env.VERCEL_ENV);
}

async function main() {
  const failures = [];

  const tableRows = await prisma.$queryRawUnsafe(
    `SELECT table_name AS "tableName"
       FROM information_schema.tables
      WHERE table_schema = current_schema()`,
  );
  const tables = new Set(tableRows.map((row) => row.tableName));
  const missingTables = REQUIRED_TABLES.filter((name) => !tables.has(name));
  if (missingTables.length > 0) failures.push(`Missing required tables: ${missingTables.join(", ")}`);

  const columnRows = await prisma.$queryRawUnsafe(
    `SELECT table_name AS "tableName", column_name AS "columnName"
       FROM information_schema.columns
      WHERE table_schema = current_schema()`,
  );
  const columnsByTable = new Map();
  for (const row of columnRows) {
    const current = columnsByTable.get(row.tableName) ?? new Set();
    current.add(row.columnName);
    columnsByTable.set(row.tableName, current);
  }

  for (const [tableName, expectedColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const actual = columnsByTable.get(tableName) ?? new Set();
    const missing = expectedColumns.filter((column) => !actual.has(column));
    if (missing.length > 0) failures.push(`Missing columns on ${tableName}: ${missing.join(", ")}`);
  }

  const functionRows = await prisma.$queryRawUnsafe(
    `SELECT proname
       FROM pg_proc
      WHERE proname IN (
        'resolve_tender_requirement_source_file',
        'guard_canonical_requirement_set_delete',
        'refresh_submission_plan_state'
      )`,
  );
  const functions = new Set(functionRows.map((row) => row.proname));
  const missingFunctions = REQUIRED_FUNCTIONS.filter((name) => !functions.has(name));
  if (missingFunctions.length > 0) failures.push(`Missing required database functions: ${missingFunctions.join(", ")}`);

  if (requireMigrationHistory()) {
    if (!tables.has("_prisma_migrations")) {
      failures.push("Prisma migration history table is missing");
    } else {
      const failedMigrations = await prisma.$queryRawUnsafe(
        `SELECT migration_name AS "migrationName"
           FROM "_prisma_migrations"
          WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
      );
      if (failedMigrations.length > 0) {
        failures.push(`Unfinished Prisma migrations: ${failedMigrations.map((row) => row.migrationName).join(", ")}`);
      }
    }
  }

  const summary = {
    ok: failures.length === 0,
    requiredTables: REQUIRED_TABLES.length,
    requiredColumnGroups: Object.keys(REQUIRED_COLUMNS).length,
    requiredFunctions: REQUIRED_FUNCTIONS.length,
    migrationHistoryRequired: requireMigrationHistory(),
    failures,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Critical schema check failed to execute", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
