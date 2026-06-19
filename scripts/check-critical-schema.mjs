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
  TenderFile: ["id", "tenderId", "storagePath", "fileContent", "extractedText", "deletionStatus", "lastDeletionError", "deletedAt"],
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
  const failures = [];

  const tableRows = await prisma.$queryRaw`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = current_schema()
  `;
  const tables = new Set(tableRows.map((row) => row.tableName));
  const missingTables = REQUIRED_TABLES.filter((name) => !tables.has(name));
  if (missingTables.length > 0) failures.push(`Missing required tables: ${missingTables.join(", ")}`);

  const columnRows = await prisma.$queryRaw`
    SELECT table_name AS "tableName", column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
  `;
  const columnsByTable = new Map();
  for (const row of columnRows) {
    const columns = columnsByTable.get(row.tableName) ?? new Set();
    columns.add(row.columnName);
    columnsByTable.set(row.tableName, columns);
  }
  for (const [tableName, expectedColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const actual = columnsByTable.get(tableName) ?? new Set();
    const missing = expectedColumns.filter((column) => !actual.has(column));
    if (missing.length > 0) failures.push(`Missing columns on ${tableName}: ${missing.join(", ")}`);
  }

  const functionRows = await prisma.$queryRaw`
    SELECT proname
    FROM pg_proc
    WHERE proname IN (
      'resolve_tender_requirement_source_file',
      'guard_canonical_requirement_set_delete',
      'refresh_submission_plan_state'
    )
  `;
  const functions = new Set(functionRows.map((row) => row.proname));
  const missingFunctions = REQUIRED_FUNCTIONS.filter((name) => !functions.has(name));
  if (missingFunctions.length > 0) failures.push(`Missing required functions: ${missingFunctions.join(", ")}`);

  if (migrationHistoryRequired()) {
    if (!tables.has("_prisma_migrations")) {
      failures.push("Prisma migration history table is missing");
    } else {
      const unfinished = await prisma.$queryRaw`
        SELECT migration_name AS "migrationName"
        FROM "_prisma_migrations"
        WHERE finished_at IS NULL AND rolled_back_at IS NULL
      `;
      if (unfinished.length > 0) {
        failures.push(`Unfinished migrations: ${unfinished.map((row) => row.migrationName).join(", ")}`);
      }
    }
  }

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
