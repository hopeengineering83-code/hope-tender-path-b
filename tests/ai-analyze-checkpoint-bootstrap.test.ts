// Source-read tests for the AiAnalyzeChunk bootstrap SQL contract in lib/prisma.ts.
// Verifies that runtime-bootstrapped databases get the same schema as the Prisma migration.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf-8");

describe("AiAnalyzeChunk runtime bootstrap (lib/prisma.ts)", () => {
  it("contains CREATE TABLE IF NOT EXISTS AiAnalyzeChunk", () => {
    const prisma = read("lib/prisma.ts");
    assert.ok(
      prisma.includes('CREATE TABLE IF NOT EXISTS "AiAnalyzeChunk"'),
      'lib/prisma.ts must contain CREATE TABLE IF NOT EXISTS "AiAnalyzeChunk"',
    );
  });

  it("contains all required columns in the bootstrap block", () => {
    const prisma = read("lib/prisma.ts");
    const requiredColumns = [
      '"id"',
      '"tenderId"',
      '"userId"',
      '"contentHash"',
      '"chunkIndex"',
      '"totalChunks"',
      '"status"',
      '"provider"',
      '"resultJson"',
      '"errorMessage"',
      '"startedAt"',
      '"finishedAt"',
      '"createdAt"',
      '"updatedAt"',
      // Regression guard: these two columns exist in schema.prisma but were never
      // added by a migration. When the bootstrap omitted them, the generated
      // Prisma client still SELECTed them on findMany, so getAnalyzeCheckpoints
      // threw P2022 and hard-blocked AI Analyze. They must stay in the bootstrap.
      '"failureCategory"',
      '"jobId"',
    ];
    for (const col of requiredColumns) {
      assert.ok(prisma.includes(col), `lib/prisma.ts AiAnalyzeChunk bootstrap must include column ${col}`);
    }
  });

  it("backfills failureCategory and jobId on pre-existing tables via ensureColumn", () => {
    const prisma = read("lib/prisma.ts");
    // CREATE TABLE IF NOT EXISTS does not add columns to a table that already
    // exists, so existing production databases need ensureColumn (ADD COLUMN IF
    // NOT EXISTS) to gain the two drifted columns.
    assert.ok(
      prisma.includes('ensureColumn(client, "AiAnalyzeChunk", "failureCategory"'),
      "lib/prisma.ts must ensureColumn AiAnalyzeChunk.failureCategory for pre-existing tables",
    );
    assert.ok(
      prisma.includes('ensureColumn(client, "AiAnalyzeChunk", "jobId"'),
      "lib/prisma.ts must ensureColumn AiAnalyzeChunk.jobId for pre-existing tables",
    );
  });

  it("creates the jobId index", () => {
    const prisma = read("lib/prisma.ts");
    assert.ok(
      prisma.includes('"AiAnalyzeChunk_jobId_idx"'),
      "lib/prisma.ts must create the index AiAnalyzeChunk_jobId_idx",
    );
  });

  it("creates the unique composite index on tenderId/userId/contentHash/chunkIndex", () => {
    const prisma = read("lib/prisma.ts");
    assert.ok(
      prisma.includes('"AiAnalyzeChunk_tenderId_userId_contentHash_chunkIndex_key"'),
      "lib/prisma.ts must create the unique composite index AiAnalyzeChunk_tenderId_userId_contentHash_chunkIndex_key",
    );
  });

  it("creates the lookup index on tenderId/userId/contentHash", () => {
    const prisma = read("lib/prisma.ts");
    assert.ok(
      prisma.includes('"AiAnalyzeChunk_tenderId_userId_contentHash_idx"'),
      "lib/prisma.ts must create the index AiAnalyzeChunk_tenderId_userId_contentHash_idx",
    );
  });

  it("creates the status index", () => {
    const prisma = read("lib/prisma.ts");
    assert.ok(
      prisma.includes('"AiAnalyzeChunk_status_idx"'),
      'lib/prisma.ts must create the index AiAnalyzeChunk_status_idx',
    );
  });

  it("AiJobStep bootstrap is still present (regression guard)", () => {
    const prisma = read("lib/prisma.ts");
    assert.ok(
      prisma.includes('CREATE TABLE IF NOT EXISTS "AiJobStep"'),
      'lib/prisma.ts must still contain CREATE TABLE IF NOT EXISTS "AiJobStep" (regression guard)',
    );
  });

  it("AiJob bootstrap is still present (regression guard)", () => {
    const prisma = read("lib/prisma.ts");
    assert.ok(
      prisma.includes('CREATE TABLE IF NOT EXISTS "AiJob"'),
      'lib/prisma.ts must still contain CREATE TABLE IF NOT EXISTS "AiJob" (regression guard)',
    );
  });
});
