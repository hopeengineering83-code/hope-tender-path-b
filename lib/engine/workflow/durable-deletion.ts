import { PrismaClient } from "@prisma/client";
import { getStorageAdapter } from "../../storage";

export async function durableDeleteTenderFile(
  prisma: PrismaClient,
  fileId: string,
  tenderId: string,
  userId: string
) {
  const file = await prisma.tenderFile.findFirst({
    where: { id: fileId, tenderId, tender: { userId } },
  });

  if (!file) throw new Error("File not found or unauthorized");

  try {
    await getStorageAdapter().deleteFile({
      storagePath: file.storagePath,
      fileContent: file.fileContent,
      fileName: file.originalFileName,
    });
  } catch (err) {
    throw new Error(`Storage deletion failed: ${String(err)}`);
  }

  await prisma.tenderFile.delete({ where: { id: fileId } });
  return { success: true };
}
