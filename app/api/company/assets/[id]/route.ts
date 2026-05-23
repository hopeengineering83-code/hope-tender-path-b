import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getStorageAdapter } from "../../../../../lib/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  await prismaReady;
  const { id } = await params;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return new Response("Not found", { status: 404 });

  const asset = await prisma.companyAsset.findFirst({
    where: { id, companyId: company.id },
    select: { fileContent: true, storagePath: true, mimeType: true, originalFileName: true },
  });
  if (!asset?.fileContent && !asset?.storagePath) return new Response("Not found", { status: 404 });

  let buffer: Buffer;
  try {
    if (asset.fileContent) {
      buffer = Buffer.from(asset.fileContent, "base64");
    } else {
      buffer = await getStorageAdapter().getFile({ storagePath: asset.storagePath!, fileContent: null, fileName: asset.originalFileName });
    }
  } catch {
    return new Response("File content could not be retrieved from storage", { status: 502 });
  }
  const safeFileName = asset.originalFileName.replace(/[^a-zA-Z0-9._\- ()]/g, "_");

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": asset.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeFileName}"`,
      "Content-Length": buffer.length.toString(),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
