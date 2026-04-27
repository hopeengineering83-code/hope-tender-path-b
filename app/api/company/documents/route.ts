import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { logAction } from "../../../../lib/audit";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../lib/extract-text";

function shouldRetryExtraction(extractedText: string | null): boolean {
  return (extractedText?.trim().length ?? 0) < 1000;
}

async function reextractMissingCompanyDocuments(companyId: string, userId: string) {
  const docs = await prisma.companyDocument.findMany({
    where: { companyId },
    select: {
      id: true,
      originalFileName: true,
      mimeType: true,
      fileContent: true,
      extractedText: true,
      metadata: true,
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  for (const doc of docs.filter((item) => item.fileContent && shouldRetryExtraction(item.extractedText))) {
    if (!doc.fileContent) continue;
    try {
      const buffer = Buffer.from(doc.fileContent, "base64");
      const extractedText = await extractTextFromBuffer(buffer, doc.mimeType, doc.originalFileName);
      const fileType = getFileTypeLabel(doc.mimeType, doc.originalFileName);
      const meaningful = isMeaningfulExtraction(extractedText);
      let metadata: Record<string, unknown> = {};
      try { metadata = JSON.parse(doc.metadata || "{}"); } catch { metadata = {}; }

      await prisma.companyDocument.update({
        where: { id: doc.id },
        data: {
          extractedText: extractedText || null,
          metadata: JSON.stringify({
            ...metadata,
            fileType,
            reExtractedAt: new Date().toISOString(),
            extracted: meaningful,
            extractedChars: meaningful ? extractedText.length : 0,
            extractionStatus: meaningful ? "EXTRACTED" : extractedText ? "WARNING" : "EMPTY",
            extractionMessage: meaningful ? null : extractedText || "No text extracted",
          }),
        },
      });

      await logAction({
        userId,
        action: "COMPANY_DOCUMENT_REEXTRACT",
        entityType: "CompanyDocument",
        entityId: doc.id,
        description: `Re-extracted company document "${doc.originalFileName}" — ${meaningful ? `${extractedText.length.toLocaleString()} chars extracted` : extractedText || "no text extracted"}`,
        metadata: { companyId, fileName: doc.originalFileName, fileType, extracted: meaningful },
      });
    } catch (error) {
      console.error(`[company-documents] re-extract failed for ${doc.originalFileName}:`, error);
    }
  }
}

export async function GET(_req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ documents: [] });

  const documents = await prisma.companyDocument.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, fileName: true, originalFileName: true, mimeType: true,
      size: true, category: true, createdAt: true,
      extractedText: true,
    },
  });

  return NextResponse.json({ documents });
}

export async function DELETE(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const doc = await prisma.companyDocument.findFirst({ where: { id, companyId: company.id } });
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  await prisma.companyDocument.delete({ where: { id } });

  await logAction({
    userId,
    action: "COMPANY_DOCUMENT_DELETE",
    entityType: "CompanyDocument",
    entityId: id,
    description: `Deleted company document "${doc.originalFileName}"`,
  });

  return NextResponse.json({ success: true });
}
