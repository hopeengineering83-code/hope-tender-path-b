import type { PrismaClient } from "@prisma/client";

export type VerifiedExportPackageSnapshot = {
  tenderId: string;
  userId: string;
  fileListJson: string;
  manifestJson: string;
  packageSha256: string;
  packageByteLength: number;
  verifiedAt?: Date;
};

/**
 * Persist one immutable, byte-verified final-package snapshot and the tender's
 * EXPORTED lifecycle transition atomically.
 *
 * The tender row lock serializes concurrent downloads for one tender. An exact
 * repeat of the same archive hash increments the existing snapshot's download
 * count; a different hash (including a separately scoped envelope archive)
 * creates a new snapshot, so one envelope can never overwrite another.
 */
export async function persistVerifiedExportPackageDownload(
  prisma: PrismaClient,
  input: VerifiedExportPackageSnapshot,
) {
  if (!/^[a-f0-9]{64}$/i.test(input.packageSha256)) {
    throw new Error("INVALID_EXPORT_PACKAGE_SHA256");
  }
  if (!Number.isSafeInteger(input.packageByteLength) || input.packageByteLength <= 0) {
    throw new Error("INVALID_EXPORT_PACKAGE_BYTE_LENGTH");
  }

  return prisma.$transaction(async (tx) => {
    const ownedTender = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Tender"
      WHERE "id" = ${input.tenderId} AND "userId" = ${input.userId}
      FOR UPDATE
    `;
    if (ownedTender.length !== 1) throw new Error("TENDER_NOT_FOUND_OR_NOT_OWNED");

    const existing = await tx.exportPackage.findFirst({
      where: {
        tenderId: input.tenderId,
        packageSha256: input.packageSha256,
        integrityStatus: "VERIFIED",
      },
      orderBy: { createdAt: "desc" },
    });

    const verifiedAt = input.verifiedAt ?? new Date();
    if (!existing) {
      await tx.exportPackage.updateMany({
        where: {
          tenderId: input.tenderId,
          status: "READY",
        },
        data: { status: "SUPERSEDED" },
      });
    }

    const exportPackage = existing
      ? await tx.exportPackage.update({
          where: { id: existing.id },
          data: {
            status: "READY",
            fileList: input.fileListJson,
            manifestJson: input.manifestJson,
            packageByteLength: input.packageByteLength,
            integrityStatus: "VERIFIED",
            integrityVerifiedAt: verifiedAt,
            downloadCount: { increment: 1 },
          },
        })
      : await tx.exportPackage.create({
          data: {
            tenderId: input.tenderId,
            status: "READY",
            fileList: input.fileListJson,
            manifestJson: input.manifestJson,
            packageSha256: input.packageSha256,
            packageByteLength: input.packageByteLength,
            integrityStatus: "VERIFIED",
            integrityVerifiedAt: verifiedAt,
            downloadCount: 1,
          },
        });

    await tx.tender.update({
      where: { id: input.tenderId, userId: input.userId },
      data: { status: "EXPORTED", stage: "EXPORT" },
    });

    return exportPackage;
  }, { timeout: 30_000 });
}
