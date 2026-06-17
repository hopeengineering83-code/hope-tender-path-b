import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const INIT_MIGRATION = "20260601000000_init";
const INIT_PATH = `prisma/migrations/${INIT_MIGRATION}/migration.sql`;
const expectFailedInit = process.argv.includes("--expect-failed-init");
const allowNoHistory = process.argv.includes("--allow-no-history");
const prisma = new PrismaClient();

function redactSensitive(value) {
  let text = String(value ?? "");
  const configuredDatabaseUrl = process.env.DATABASE_URL;
  if (configuredDatabaseUrl) {
    text = text.split(configuredDatabaseUrl).join("[REDACTED_DATABASE_URL]");
  }
  return text.replace(/DATABASE_URL\s*[:=]\s*\S+/gi, "DATABASE_URL=[REDACTED]");
}

function parseInitMigration(sql) {
  const tables = new Map();
  const constraints = new Set();

  for (const match of sql.matchAll(/CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g)) {
    const [, tableName, body] = match;
    const columns = new Set(
      Array.from(body.matchAll(/^\s+"([^"]+)"\s+/gm), (columnMatch) => columnMatch[1]),
    );
    tables.set(tableName, columns);

    for (const constraintMatch of body.matchAll(/CONSTRAINT "([^"]+)"/g)) {
      constraints.add(constraintMatch[1]);
    }
  }

  const indexes = new Set(
    Array.from(sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g), (match) => match[1]),
  );

  for (const match of sql.matchAll(/ALTER TABLE "[^"]+" ADD CONSTRAINT "([^"]+)"/g)) {
    constraints.add(match[1]);
  }

  if (tables.size === 0) throw new Error("Retroactive init migration contains no CREATE TABLE statements");

  return { tables, indexes, constraints };
}

async function tableExists(name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 AS present
       FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = $1
      LIMIT 1`,
    name,
  );
  return rows.length > 0;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for retroactive init verification");

  const sql = readFileSync(INIT_PATH, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const expected = parseInitMigration(sql);
  const failures = [];

  const tableRows = await prisma.$queryRawUnsafe(
    `SELECT table_name AS "tableName"
       FROM information_schema.tables
      WHERE table_schema = current_schema()`,
  );
  const actualTables = new Set(tableRows.map((row) => row.tableName));

  const columnRows = await prisma.$queryRawUnsafe(
    `SELECT table_name AS "tableName", column_name AS "columnName"
       FROM information_schema.columns
      WHERE table_schema = current_schema()`,
  );
  const actualColumns = new Map();
  for (const row of columnRows) {
    const set = actualColumns.get(row.tableName) ?? new Set();
    set.add(row.columnName);
    actualColumns.set(row.tableName, set);
  }

  const indexRows = await prisma.$queryRawUnsafe(
    `SELECT indexname AS "indexName"
       FROM pg_indexes
      WHERE schemaname = current_schema()`,
  );
  const actualIndexes = new Set(indexRows.map((row) => row.indexName));

  const constraintRows = await prisma.$queryRawUnsafe(
    `SELECT constraint_name AS "constraintName"
       FROM information_schema.table_constraints
      WHERE constraint_schema = current_schema()`,
  );
  const actualConstraints = new Set(constraintRows.map((row) => row.constraintName));

  for (const [tableName, columns] of expected.tables) {
    if (!actualTables.has(tableName)) {
      failures.push(`Missing init table: ${tableName}`);
      continue;
    }
    const presentColumns = actualColumns.get(tableName) ?? new Set();
    for (const column of columns) {
      if (!presentColumns.has(column)) failures.push(`Missing init column: ${tableName}.${column}`);
    }
  }

  for (const indexName of expected.indexes) {
    if (!actualIndexes.has(indexName)) failures.push(`Missing init index: ${indexName}`);
  }

  for (const constraintName of expected.constraints) {
    if (!actualConstraints.has(constraintName)) failures.push(`Missing init constraint: ${constraintName}`);
  }

  const hasHistory = await tableExists("_prisma_migrations");
  let unfinished = [];

  if (!hasHistory) {
    if (!allowNoHistory) failures.push("Prisma migration history table is missing");
  } else {
    unfinished = await prisma.$queryRawUnsafe(
      `SELECT migration_name AS "migrationName", checksum,
              finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt"
         FROM "_prisma_migrations"
        WHERE finished_at IS NULL
          AND rolled_back_at IS NULL
        ORDER BY started_at ASC`,
    );

    if (expectFailedInit) {
      if (unfinished.length !== 1 || unfinished[0]?.migrationName !== INIT_MIGRATION) {
        failures.push(`Expected exactly one unfinished migration named ${INIT_MIGRATION}`);
      } else if (unfinished[0].checksum !== checksum) {
        failures.push(`Checksum mismatch for failed migration ${INIT_MIGRATION}`);
      }
    } else if (unfinished.length > 0) {
      failures.push(`Unfinished migrations: ${unfinished.map((row) => row.migrationName).join(", ")}`);
    }
  }

  if (expectFailedInit && !hasHistory) {
    failures.push(`Cannot verify failed ${INIT_MIGRATION}: migration history table is missing`);
  }

  const summary = {
    ok: failures.length === 0,
    migration: INIT_MIGRATION,
    expectedTables: expected.tables.size,
    expectedColumns: Array.from(expected.tables.values()).reduce((sum, columns) => sum + columns.size, 0),
    expectedIndexes: expected.indexes.size,
    expectedConstraints: expected.constraints.size,
    historyPresent: hasHistory,
    unfinishedMigrations: unfinished.map((row) => row.migrationName),
    mode: expectFailedInit ? "expect-failed-init" : allowNoHistory ? "allow-no-history" : "normal",
    failures,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Retroactive init verification failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      message: redactSensitive(error instanceof Error ? error.message : String(error)),
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
