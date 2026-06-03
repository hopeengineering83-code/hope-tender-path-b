#!/usr/bin/env tsx
/**
 * Migration script: DB fileContent → Vercel Blob
 *
 * Usage:
 *   DRY_RUN=true npx tsx scripts/migrate-db-files-to-blob.ts
 *   DRY_RUN=false npx tsx scripts/migrate-db-files-to-blob.ts
 *
 * Requirements:
 *   - DATABASE_URL must be set
 *   - BLOB_READ_WRITE_TOKEN must be set
 *   - Run with DRY_RUN=true first to see what would migrate
 *
 * Safety:
 *   - Never deletes fileContent — only updates storagePath to the blob URL
 *   - Can be run multiple times safely (skips rows where storagePath already
 *     starts with "https://", indicating a prior successful migration)
 *   - Logs every action to console
 *
 * Schema note:
 *   The schema does NOT have storageKey / storageProvider columns on
 *   TenderFile, CompanyDocument, or GeneratedDocument.  This script uses
 *   storagePath as the canonical "where is this file?" field: after
 *   migration storagePath will contain the Vercel Blob https:// URL.
 *   The existing BlobStorage.getFile() in lib/storage.ts already reads
 *   from storagePath when it detects an https:// prefix, so no further
 *   app-layer changes are needed.
 *
 *   If you later add storageKey / storageProvider columns (via a Prisma
 *   migration), update the updateFn calls below to also write those fields.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN !== "false";

type MigratableRow = {
  id: string;
  fileContent?: string | null;
  originalFileName?: string | null;
  name?: string | null;
  mimeType?: string | null;
  format?: string | null;
  storagePath?: string | null;
};

async function migrateModel(
  modelName: string,
  findFn: () => Promise<MigratableRow[]>,
  updateFn: (id: string, blobUrl: string) => Promise<void>,
) {
  const rows = await findFn();
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    // Already migrated: storagePath is a blob URL
    if (row.storagePath && /^https?:\/\//.test(row.storagePath)) {
      skipped++;
      continue;
    }
    // Nothing to migrate
    if (!row.fileContent) {
      skipped++;
      continue;
    }

    const displayName = row.originalFileName ?? row.name ?? row.id;
    const key = `migrated/${modelName.toLowerCase()}/${row.id}`;

    if (DRY_RUN) {
      console.log(
        `[DRY_RUN] Would migrate ${modelName}#${row.id} (${displayName}) → blob:${key}`,
      );
      migrated++;
      continue;
    }

    try {
      // Import put from @vercel/blob at runtime so the script still parses
      // (and gives a clear error) when the package is not installed.
      const { put } = await import("@vercel/blob");
      const buffer = Buffer.from(row.fileContent, "base64");
      // Determine content type: mimeType for TenderFile/CompanyDocument,
      // format-derived for GeneratedDocument.
      const contentType =
        row.mimeType != null
          ? row.mimeType
          : row.format === "PDF"
            ? "application/pdf"
            : row.format != null
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : "application/octet-stream";

      const blob = await put(key, buffer, {
        access: "private",
        contentType,
        addRandomSuffix: false,
      });

      await updateFn(row.id, blob.url);
      console.log(`Migrated ${modelName}#${row.id} (${displayName}) → ${blob.url}`);
      migrated++;
    } catch (err) {
      console.error(
        `Error migrating ${modelName}#${row.id}:`,
        err instanceof Error ? err.message : err,
      );
      errors++;
    }
  }

  console.log(
    `${modelName}: ${migrated} migrated, ${skipped} skipped, ${errors} errors`,
  );
  return { migrated, skipped, errors };
}

async function main() {
  console.log(`Migration mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log("");

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  if (!DRY_RUN && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN not set");
  }

  let totalErrors = 0;

  // ── TenderFile ────────────────────────────────────────────────────────────
  // Rows with storagePath = "" and fileContent populated are legacy db-base64
  // rows that need migrating. (TenderFile.storagePath is String @default(""),
  // so it cannot be null — we only filter on empty string here.)
  const tfResult = await migrateModel(
    "TenderFile",
    () =>
      prisma.tenderFile.findMany({
        where: {
          fileContent: { not: null },
          storagePath: "",
        },
        select: {
          id: true,
          fileContent: true,
          originalFileName: true,
          mimeType: true,
          storagePath: true,
        },
      }),
    (id, blobUrl) =>
      prisma.tenderFile
        .update({ where: { id }, data: { storagePath: blobUrl } })
        .then(() => undefined),
  );
  totalErrors += tfResult.errors;

  // ── CompanyDocument ───────────────────────────────────────────────────────
  const cdResult = await migrateModel(
    "CompanyDocument",
    () =>
      prisma.companyDocument.findMany({
        where: {
          fileContent: { not: null },
          storagePath: "",
        },
        select: {
          id: true,
          fileContent: true,
          originalFileName: true,
          mimeType: true,
          storagePath: true,
        },
      }),
    (id, blobUrl) =>
      prisma.companyDocument
        .update({ where: { id }, data: { storagePath: blobUrl } })
        .then(() => undefined),
  );
  totalErrors += cdResult.errors;

  // ── GeneratedDocument ─────────────────────────────────────────────────────
  // GeneratedDocument.storagePath is nullable. Legacy db-base64 rows may have
  // storagePath = null OR storagePath = "" (empty string written by the adapter).
  // Both must be included so those rows are eligible for blob migration and
  // the follow-up null-legacy-file-content script.
  const gdResult = await migrateModel(
    "GeneratedDocument",
    () =>
      prisma.generatedDocument.findMany({
        where: {
          fileContent: { not: null },
          OR: [{ storagePath: null }, { storagePath: "" }],
        },
        select: {
          id: true,
          fileContent: true,
          name: true,
          format: true,
          storagePath: true,
        },
      }),
    (id, blobUrl) =>
      prisma.generatedDocument
        .update({ where: { id }, data: { storagePath: blobUrl } })
        .then(() => undefined),
  );

  totalErrors += gdResult.errors;
  await prisma.$disconnect();
  return { errors: totalErrors };
}

main()
  .then((totals) => {
    if (totals && totals.errors > 0) {
      console.error(`\nMigration completed with ${totals.errors} error(s). Review logs above.`);
      process.exit(1);
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
