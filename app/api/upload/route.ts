import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession } from "../../../lib/auth";
import { saveUploadedFile } from "../../../lib/storage";
import { extractTextFromBuffer } from "../../../lib/extract-text";
import { logAction } from "../../../lib/audit";

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const tenderId = formData.get("tenderId") as string | null;
    const companyDocId = formData.get("companyDoc") as string | null;
    const classification = (formData.get("classification") as string | null) || null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Invalid file" }, { status: 400 });
    }

    // Extract text from the file buffer immediately at upload
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const extractedText = await extractTextFromBuffer(buffer, file.type, file.name);

    if (tenderId) {
      const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
      if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

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
          extractedText: extractedText || null,
        },
      });

      await logAction({
        userId,
        action: "TENDER_FILE_UPLOAD",
        entityType: "TenderFile",
        entityId: fileRecord.id,
        description: `Uploaded file "${file.name}" to tender ${tenderId}`,
        metadata: { tenderId, fileName: file.name, extracted: extractedText.length > 0 },
      });

      return NextResponse.json({ success: true, scope: "tender", fileRecord });
    }

    if (companyDocId === "true") {
      const company = await prisma.company.findUnique({ where: { userId } });
      if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

      const category = (formData.get("category") as string | null) || "OTHER";
      const saved = await saveUploadedFile(file, "company");
      const docRecord = await prisma.companyDocument.create({
        data: {
          companyId: company.id,
          fileName: saved.fileName,
          originalFileName: saved.originalFileName,
          mimeType: saved.mimeType,
          size: saved.size,
          storagePath: saved.storagePath,
          category,
          extractedText: extractedText || null,
        },
      });

      await logAction({
        userId,
        action: "COMPANY_DOCUMENT_UPLOAD",
        entityType: "CompanyDocument",
        entityId: docRecord.id,
        description: `Uploaded company document "${file.name}" (${category})`,
        metadata: { companyId: company.id, fileName: file.name, category, extracted: extractedText.length > 0 },
      });

      return NextResponse.json({ success: true, scope: "company", docRecord });
    }

    return NextResponse.json({ error: "tenderId or companyDoc is required" }, { status: 400 });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
