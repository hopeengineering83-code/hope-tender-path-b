import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REQUIRED_COLUMNS,
  REQUIRED_FUNCTIONS,
  REQUIRED_TABLES,
  findCriticalSchemaGaps,
} from "../scripts/critical-schema-contract.mjs";

function completeSchemaRows() {
  const tableRows = [...REQUIRED_TABLES, "_prisma_migrations"].map((tableName) => ({ tableName }));
  const columnRows = Object.entries(REQUIRED_COLUMNS).flatMap(([tableName, columns]) =>
    columns.map((columnName) => ({ tableName, columnName })),
  );
  const functionRows = REQUIRED_FUNCTIONS.map((proname) => ({ proname }));
  return { tableRows, columnRows, functionRows };
}

describe("critical database schema review-provenance contract", () => {
  it("fails closed when one authority-bearing review column is missing", () => {
    const schema = completeSchemaRows();
    schema.columnRows = schema.columnRows.filter(
      (row) => !(row.tableName === "LegalRecord" && row.columnName === "trustLevel"),
    );

    const failures = findCriticalSchemaGaps({
      ...schema,
      migrationHistoryRequired: true,
      unfinishedMigrations: [],
    });

    assert.deepEqual(failures, ["Missing columns on LegalRecord: trustLevel"]);
  });

  it("requires every review-provenance field on all three support-record families", () => {
    for (const tableName of ["LegalRecord", "FinancialRecord", "CompanyComplianceRecord"] as const) {
      assert.ok(REQUIRED_TABLES.includes(tableName), `${tableName} must be a critical table`);
      assert.deepEqual(
        REQUIRED_COLUMNS[tableName],
        ["id", "companyId", "trustLevel", "reviewedBy", "reviewedAt", "reviewNotes", "sourceDocumentId"],
      );
    }
  });

  it("accepts a complete critical schema with clean migration history", () => {
    assert.deepEqual(
      findCriticalSchemaGaps({
        ...completeSchemaRows(),
        migrationHistoryRequired: true,
        unfinishedMigrations: [],
      }),
      [],
    );
  });
});
