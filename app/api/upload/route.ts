import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession } from "../../../lib/auth";
import { saveUploadedFile } from "../../../lib/storage";

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const tenderId = formData.get("tenderId") as string | null;
    const classification = (formData.get("classification") as string | null) || null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Invalid file" }, { status: 400 });
    }

    if (tenderId) {
      const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
      if (!tender) {
        return NextResponse.json({ error: "Tender not found" }, { status: 404 });
      }

      const saved = await saveUploadedFile(file, "tender");
      const fileRecord = await prisma.tenderFile.create({
        data: {
          tenderId,
          fileName: saved.fileName,
          originalFileName: saved.originalFileName,
          mimeType: saved.mimeType,
          size: saved.size,
          storagePath: saved.storagePath,
          classification,
        },
      });

      return NextResponse.json({ success: true, scope: "tender", fileRecord });
    }

    return NextResponse.json({ error: "tenderId is required" }, { status: 400 });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
