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

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Invalid file" }, { status: 400 });
    }

    const saved = await saveUploadedFile(file);

    const doc = await prisma.document.create({
      data: {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        tenderId: tenderId || null,
        userId,
      },
    });

    return NextResponse.json({ success: true, file: saved, document: doc });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
