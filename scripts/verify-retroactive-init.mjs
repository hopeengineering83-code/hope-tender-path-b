import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const INIT_MIGRATION = "20260601000000_init";
const expectFailedInit = process.argv.includes("--expect-failed-init");
const prisma = new PrismaClient();

function redact(value) {
  let text = String(value ?? "");
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) text = text.split(databaseUrl).join("[REDACTED_DATABASE_URL]");
  return text.replace(/DATABASE_URL\s*[:=]\s*\S+/gi, "DATABASE_URL=[REDACTED]");
}

function parseInitMigration(sql) {
  const tables = new Map();
  const constraints = new Set();

  for (const match of sql.matchAll(/CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g)) {
    const [, tableName, body] = match;
    const columns = new Set(Array.from(body.matchAll(/^\s+"([^"]+)"\s+/gm), (item) => item[1]));
    tables.set(tableName, columns);
    for (const item of body.matchAll(/CONSTRAINT "([^"]+)"/g)) constraints.add(item[1]);
  }

  const indexes = new Set(
    Array.from(sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g), (item) => item[1]),
  );
  for (const item of sql.matchAll(/ALTER TABLE "[^"]+" ADD CONSTRAINT "([^"]+)"/g)) {
    constraints.add(item[1]);
  }

  if (tables.size === 0) throw new Error("Initialization migration contains no CREATE TABLE statements");
  return { tables, indexes, constraints };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const migrationPath = join(process.cwd(), "prisma", "migrations", INIT_MIGRATION, "migration.sql");
  const migrationBytes = readFileSync(migrationPath);
  const migrationSql = migrationBytes.toString("utf8");
  const checksum = createHash("sha256").update(migrationBytes).digest("hex");
  const expected = parseInitMigration(migrationSql);
  const failures = [];

  let tableRows;
  try {
    tableRows = await prisma.$queryRaw`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = current_schema()
    `;
  } catch (error) {
    throw new Error(
      `Failed to query database tables during ${expectFailedInit ? "expect-failed-init" : "applied"} verification. ` +
      `Database may be initializing. Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const actualTables = new Set(tableRows.map((row) => row.tableName));

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

  const indexRows = await prisma.$queryRaw`
    SELECT indexname AS "indexName"
    FROM pg_indexes
    WHERE schemaname = current_schema()
  `;
  const actualIndexes = new Set(indexRows.map((row) => row.indexName));

  const constraintRows = await prisma.$queryRaw`
    SELECT constraint_name AS "constraintName"
    FROM information_schema.table_constraints
    WHERE constraint_schema = current_schema()
  `;
  const actualConstraints = new Set(constraintRows.map((row) => row.constraintName));

  // Only validate actual database schema when NOT expecting a failed init.
  // If init migration failed, the schema from that migration won't exist yet.
  if (!expectFailedInit) {
    for (const [tableName, expectedColumns] of expected.tables) {
      if (!actualTables.has(tableName)) {
        failures.push(`Missing initialization table: ${tableName}`);
        continue;
      }
      const actualColumns = columnsByTable.get(tableName) ?? new Set();
      for (const columnName of expectedColumns) {
        if (!actualColumns.has(columnName)) failures.push(`Missing initialization column: ${tableName}.${columnName}`);
      }
    }
    for (const name of expected.indexes) {
      if (!actualIndexes.has(name)) failures.push(`Missing initialization index: ${name}`);
    }
    for (const name of expected.constraints) {
      if (!actualConstraints.has(name)) failures.push(`Missing initialization constraint: ${name}`);
    }
  }

  if (!actualTables.has("_prisma_migrations")) {
    failures.push("Prisma migration history table is missing");
  } else {
    const rows = await prisma.$queryRaw`
      SELECT migration_name AS "migrationName", checksum,
             finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt"
      FROM "_prisma_migrations"
      ORDER BY started_at ASC
    `;
    const unfinished = rows.filter((row) => row.finishedAt === null && row.rolledBackAt === null);
    const activeInit = rows.filter(
      (row) => row.migrationName === INIT_MIGRATION && row.rolledBackAt === null,
    );

    if (expectFailedInit) {
      if (unfinished.length !== 1 || unfinished[0]?.migrationName !== INIT_MIGRATION) {
        failures.push(`Expected exactly one unfinished migration named ${INIT_MIGRATION}`);
      } else if (unfinished[0].checksum !== checksum) {
        failures.push(`Checksum mismatch for unfinished ${INIT_MIGRATION}`);
      }
    } else {
      if (unfinished.length > 0) {
        failures.push(`Unfinished migrations: ${unfinished.map((row) => row.migrationName).join(", ")}`);
      }
      const appliedInit = activeInit.find((row) => row.finishedAt !== null && row.checksum === checksum);
      if (!appliedInit) failures.push(`No completed, checksum-matching ${INIT_MIGRATION} record was found`);
    }
  }

  const summary = {
    ok: failures.length === 0,
    migration: INIT_MIGRATION,
    mode: expectFailedInit ? "expect-failed-init" : "applied",
    expectedTables: expected.tables.size,
    expectedColumns: Array.from(expected.tables.values()).reduce((total, columns) => total + columns.size, 0),
    expectedIndexes: expected.indexes.size,
    expectedConstraints: expected.constraints.size,
    failures,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Retroactive initialization verification failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      message: redact(error instanceof Error ? error.message : String(error)),
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
