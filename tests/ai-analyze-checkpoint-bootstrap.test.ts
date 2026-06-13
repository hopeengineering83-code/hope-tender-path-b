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
    ];
    for (const col of requiredColumns) {
      assert.ok(prisma.includes(col), `lib/prisma.ts AiAnalyzeChunk bootstrap must include column ${col}`);
    }
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
