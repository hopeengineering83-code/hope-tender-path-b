import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession } from "../../../lib/auth";
import { extractTextFromBuffer } from "../../../lib/extract-text";
import { logAction } from "../../../lib/audit";

// Max 10 MB enforced by Next.js serverActions bodySizeLimit.
// File content is stored as base64 in the DB — no filesystem dependency.

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const tenderId = formData.get("tenderId") as string | null;
    const companyDocFlag = formData.get("companyDoc") as string | null;
    const classification = (formData.get("classification") as string | null) || null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Invalid file" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Content = buffer.toString("base64");
    const extractedText = await extractTextFromBuffer(buffer, file.type, file.name);

    if (tenderId) {
      const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
      if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

      const fileRecord = await prisma.tenderFile.create({
        data: {
          tenderId,
          fileName: file.name,
          originalFileName: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          storagePath: "",
          fileContent: base64Content,
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

    if (companyDocFlag === "true") {
      const company = await prisma.company.findUnique({ where: { userId } });
      if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

      const category = (formData.get("category") as string | null) || "OTHER";
      const docRecord = await prisma.companyDocument.create({
        data: {
          companyId: company.id,
          fileName: file.name,
          originalFileName: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          storagePath: "",
          fileContent: base64Content,
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

    return NextResponse.json({ error: "tenderId or companyDoc=true required" }, { status: 400 });
  } catch (error) {
    console.error("[upload] error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
