export const REQUIRED_TABLES = Object.freeze([
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
  "Session",
  "BuildPlan",
  "TenderMetadataOverride",
  "FallbackApprovalRecord",
  "TenderWorkflowRun",
  "TenderFactsLedger",
  "AiAnalyzeChunk",
  "AiAnalyzeRetryState",
  "ExtractionQualityOverride",
  "AiUsageRecord",
  "TenderShare",
  "ProviderHealthSnapshot",
  // These authority-bearing support records must remain schema-compatible
  // with canUseVaultRecord before the application serves traffic.
  "LegalRecord",
  "FinancialRecord",
  "CompanyComplianceRecord",
]);

export const REQUIRED_COLUMNS = Object.freeze({
  Tender: ["id", "userId", "status", "stage", "analysisExtractionStatus"],
  TenderFile: ["id", "tenderId", "storagePath", "fileContent", "extractedText", "deletionStatus", "lastDeletionError", "deletedAt"],
  TenderRequirement: ["id", "tenderId", "sourceTenderFileId", "sourcePageNumber", "sourceExactQuote"],
  GeneratedDocument: ["id", "tenderId", "fileContent", "reviewStatus", "generationStatus"],
  DocumentReview: ["id", "documentId", "reviewerId", "action", "priorStatus", "newStatus"],
  AiJob: ["id", "userId", "tenderId", "jobType", "status", "input"],
  RateLimitBucket: ["keyHash", "count", "resetAt", "createdAt", "updatedAt"],
  LegalRecord: ["id", "companyId", "trustLevel", "reviewedBy", "reviewedAt", "reviewNotes", "sourceDocumentId"],
  FinancialRecord: ["id", "companyId", "trustLevel", "reviewedBy", "reviewedAt", "reviewNotes", "sourceDocumentId"],
  CompanyComplianceRecord: ["id", "companyId", "trustLevel", "reviewedBy", "reviewedAt", "reviewNotes", "sourceDocumentId"],
});

export const REQUIRED_FUNCTIONS = Object.freeze([
  "resolve_tender_requirement_source_file",
  "guard_canonical_requirement_set_delete",
  "refresh_submission_plan_state",
]);

/**
 * Pure evaluator shared by the deploy-time database probe and behavioral
 * tests. Inputs deliberately use the exact row shapes returned by the
 * information_schema and pg_proc queries in check-critical-schema.mjs.
 */
export function findCriticalSchemaGaps({
  tableRows,
  columnRows,
  functionRows,
  migrationHistoryRequired,
  unfinishedMigrations = [],
}) {
  const failures = [];
  const tables = new Set(tableRows.map((row) => row.tableName));
  const missingTables = REQUIRED_TABLES.filter((name) => !tables.has(name));
  if (missingTables.length > 0) failures.push(`Missing required tables: ${missingTables.join(", ")}`);

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

  const functions = new Set(functionRows.map((row) => row.proname));
  const missingFunctions = REQUIRED_FUNCTIONS.filter((name) => !functions.has(name));
  if (missingFunctions.length > 0) failures.push(`Missing required functions: ${missingFunctions.join(", ")}`);

  if (migrationHistoryRequired) {
    if (!tables.has("_prisma_migrations")) {
      failures.push("Prisma migration history table is missing");
    } else if (unfinishedMigrations.length > 0) {
      failures.push(`Unfinished migrations: ${unfinishedMigrations.map((row) => row.migrationName).join(", ")}`);
    }
  }

  return failures;
}
