#!/usr/bin/env tsx
/**
 * DANGEROUS: Nulls fileContent after verified migration to object storage.
 *
 * NEVER RUN AUTOMATICALLY.
 * REQUIRES explicit --confirmed flag AND MIGRATION_VERIFIED=true env var.
 *
 * Usage:
 *   MIGRATION_VERIFIED=true npx tsx scripts/null-legacy-file-content.ts --confirmed
 *
 * Schema note:
 *   The schema does NOT have storageProvider columns. "Migrated" is detected
 *   by storagePath starting with https:// (i.e. a Vercel Blob URL written by
 *   migrate-db-files-to-blob.ts). Only rows where storagePath is an https://
 *   URL will have their fileContent nulled — rows still pointing to a local
 *   filesystem path are left untouched.
 */

const args = process.argv.slice(2);
if (!args.includes("--confirmed") || process.env.MIGRATION_VERIFIED !== "true") {
  console.error(
    "ABORTED: This script requires --confirmed flag AND MIGRATION_VERIFIED=true env var.",
  );
  console.error(
    "Run the migration script first and verify all files are accessible via blob URLs.",
  );
  process.exit(1);
}

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log(
    "WARNING: This will null fileContent for all blob-migrated rows. This cannot be undone.",
  );
  console.log("Starting in 10 seconds... Ctrl+C to abort.");
  await new Promise((r) => setTimeout(r, 10_000));

  // Only null rows where storagePath is a blob https:// URL, confirming the
  // file was successfully migrated.  Rows with storagePath="" or a local
  // filesystem path are intentionally left untouched.
  const [tfResult, cdResult, gdResult] = await Promise.all([
    // TenderFile — storagePath is String @default("")
    prisma.$executeRaw`
      UPDATE "TenderFile"
      SET "fileContent" = NULL
      WHERE "storagePath" LIKE 'https://%'
        AND "fileContent" IS NOT NULL
    `,
    // CompanyDocument — storagePath is String @default("")
    prisma.$executeRaw`
      UPDATE "CompanyDocument"
      SET "fileContent" = NULL
      WHERE "storagePath" LIKE 'https://%'
        AND "fileContent" IS NOT NULL
    `,
    // GeneratedDocument — storagePath is nullable String
    prisma.$executeRaw`
      UPDATE "GeneratedDocument"
      SET "fileContent" = NULL
      WHERE "storagePath" LIKE 'https://%'
        AND "fileContent" IS NOT NULL
    `,
  ]);

  console.log(
    `Nulled: TenderFile=${tfResult}, CompanyDocument=${cdResult}, GeneratedDocument=${gdResult}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
