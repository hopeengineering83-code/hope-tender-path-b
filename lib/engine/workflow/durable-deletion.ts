import { PrismaClient } from "@prisma/client";
import { getStorageAdapter } from "../../storage";

export async function durableDeleteTenderFile(
  prisma: PrismaClient,
  fileId: string,
  tenderId: string,
  userId: string
) {
  // 1. Validate ownership and authorization
  const file = await prisma.tenderFile.findFirst({
    where: { id: fileId, tenderId, tender: { userId } },
  });

  if (!file) throw new Error("File not found or unauthorized");

  // 2. Mark record PENDING_DELETE
  await prisma.tenderFile.update({
    where: { id: fileId },
    data: { deletionStatus: "PENDING_DELETE" as any }
  });

  // 3. Attempt physical deletion
  try {
    await getStorageAdapter().deleteFile({
      storagePath: file.storagePath,
      fileContent: file.fileContent,
      fileName: file.originalFileName,
    });

    // 4. On success, delete database record
    await prisma.tenderFile.delete({ where: { id: fileId } });
    return { success: true };
  } catch (err) {
    // 5. On failure, update retry info
    await prisma.tenderFile.update({
      where: { id: fileId },
      data: {
        deletionAttempts: { increment: 1 },
        lastDeletionError: String(err),
      }
    });
    throw err;
  }
}
