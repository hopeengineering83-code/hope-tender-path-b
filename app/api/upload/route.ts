import { NextResponse } from "next/server";
import { CompanyDocumentType } from "@prisma/client";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession } from "../../../lib/auth";
import { saveUploadedFile } from "../../../lib/storage";
import { logAudit } from "../../../lib/audit";

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

      await logAudit({
        userId,
        action: "tender_file_uploaded",
        entityType: "TenderFile",
        entityId: fileRecord.id,
        metadata: { tenderId, originalFileName: saved.originalFileName },
      });

      return NextResponse.json({ success: true, scope: "tender", fileRecord });
    }

    const company = await prisma.company.findUnique({ where: { userId } });
    if (!company) {
      return NextResponse.json({ error: "Company profile required before upload" }, { status: 400 });
    }

    const saved = await saveUploadedFile(file, "company");
    const fileRecord = await prisma.companyDocument.create({
      data: {
        companyId: company.id,
        fileName: saved.fileName,
        originalFileName: saved.originalFileName,
        mimeType: saved.mimeType,
        size: saved.size,
        storagePath: saved.storagePath,
        classification,
        type: CompanyDocumentType.OTHER,
      },
    });

    await logAudit({
      userId,
      action: "company_document_uploaded",
      entityType: "CompanyDocument",
      entityId: fileRecord.id,
      metadata: { companyId: company.id, originalFileName: saved.originalFileName },
    });

    return NextResponse.json({ success: true, scope: "company", fileRecord });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
