#!/usr/bin/env tsx
/**
 * Backfill SHA-256 digests and size bytes for legacy file rows.
 *
 * Reads actual bytes from storage, computes SHA-256 + size, stores them.
 * Reports repaired/skipped/error counts.
 * Never exposes raw paths/tokens — uses safe filenames in output.
 *
 * Usage: npx tsx scripts/backfill-file-digests.ts [--dry-run]
 */

import { prisma, prismaReady } from "../lib/prisma";
import { getStorageAdapter } from "../lib/storage";
import { computeDigestAndSize, type BackfillResult } from "../lib/engine/file-byte-integrity";

async function backfillTenderFiles(dryRun: boolean): Promise<BackfillResult> {
  const result: BackfillResult = { repaired: 0, skipped: 0, errors: 0, details: [] };
  const files = await prisma.tenderFile.findMany({
    where: { sha256: null, deletionStatus: "ACTIVE" },
    select: { id: true, originalFileName: true, storagePath: true, fileContent: true },
    take: 500,
  });

  for (const file of files) {
    try {
      const adapter = getStorageAdapter();
      const bytes = await adapter.getFile({
        storagePath: file.storagePath || null,
        fileContent: file.fileContent || null,
        fileName: file.originalFileName,
      });
      const { sha256, sizeBytes } = computeDigestAndSize(bytes);
      if (!dryRun) {
        await prisma.tenderFile.update({
          where: { id: file.id },
          data: { sha256, sizeBytes },
        });
      }
      result.repaired++;
    } catch (err) {
      result.errors++;
      result.details.push(`TenderFile ${file.id}: ${err instanceof Error ? err.constructor.name : "unknown error"}`);
    }
  }
  return result;
}

async function backfillGeneratedDocuments(dryRun: boolean): Promise<BackfillResult> {
  const result: BackfillResult = { repaired: 0, skipped: 0, errors: 0, details: [] };
  const docs = await prisma.generatedDocument.findMany({
    where: { sha256: null, generationStatus: "GENERATED" },
    select: { id: true, name: true, exactFileName: true, storagePath: true, fileContent: true },
    take: 500,
  });

  for (const doc of docs) {
    try {
      const adapter = getStorageAdapter();
      const bytes = await adapter.getFile({
        storagePath: doc.storagePath || null,
        fileContent: doc.fileContent || null,
        fileName: doc.exactFileName || doc.name,
      });
      const { sha256, sizeBytes } = computeDigestAndSize(bytes);
      if (!dryRun) {
        await prisma.generatedDocument.update({
          where: { id: doc.id },
          data: { sha256, sizeBytes },
        });
      }
      result.repaired++;
    } catch (err) {
      result.errors++;
      result.details.push(`GeneratedDocument ${doc.id}: ${err instanceof Error ? err.constructor.name : "unknown error"}`);
    }
  }
  return result;
}

async function backfillCompanyAssets(dryRun: boolean): Promise<BackfillResult> {
  const result: BackfillResult = { repaired: 0, skipped: 0, errors: 0, details: [] };
  const assets = await prisma.companyAsset.findMany({
    where: { sha256: null, isActive: true },
    select: { id: true, originalFileName: true, storagePath: true, fileContent: true },
    take: 500,
  });

  for (const asset of assets) {
    try {
      const adapter = getStorageAdapter();
      const bytes = await adapter.getFile({
        storagePath: asset.storagePath || null,
        fileContent: asset.fileContent || null,
        fileName: asset.originalFileName,
      });
      const { sha256, sizeBytes } = computeDigestAndSize(bytes);
      if (!dryRun) {
        await prisma.companyAsset.update({
          where: { id: asset.id },
          data: { sha256, sizeBytes },
        });
      }
      result.repaired++;
    } catch (err) {
      result.errors++;
      result.details.push(`CompanyAsset ${asset.id}: ${err instanceof Error ? err.constructor.name : "unknown error"}`);
    }
  }
  return result;
}

async function main() {
  await prismaReady;
  const dryRun = process.argv.includes("--dry-run");
  console.log(`File digest backfill ${dryRun ? "(DRY RUN)" : ""}`);
  console.log("---");

  const tenderResult = await backfillTenderFiles(dryRun);
  console.log(`TenderFile: ${tenderResult.repaired} repaired, ${tenderResult.errors} errors`);
  if (tenderResult.details.length > 0) console.log(tenderResult.details.slice(0, 5).join("\n"));

  const docResult = await backfillGeneratedDocuments(dryRun);
  console.log(`GeneratedDocument: ${docResult.repaired} repaired, ${docResult.errors} errors`);
  if (docResult.details.length > 0) console.log(docResult.details.slice(0, 5).join("\n"));

  const assetResult = await backfillCompanyAssets(dryRun);
  console.log(`CompanyAsset: ${assetResult.repaired} repaired, ${assetResult.errors} errors`);
  if (assetResult.details.length > 0) console.log(assetResult.details.slice(0, 5).join("\n"));

  const totalRepaired = tenderResult.repaired + docResult.repaired + assetResult.repaired;
  const totalErrors = tenderResult.errors + docResult.errors + assetResult.errors;
  console.log(`\nTotal: ${totalRepaired} repaired, ${totalErrors} errors`);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Backfill failed:", err instanceof Error ? err.constructor.name : "unknown");
  process.exit(1);
});
