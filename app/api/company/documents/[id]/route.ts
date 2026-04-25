import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../../lib/extract-text";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await prisma.companyDocument.findFirst({
    where: { id, companyId: company.id },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!doc.fileContent) {
    return NextResponse.json({ error: "File content not available" }, { status: 404 });
  }

  const buffer = Buffer.from(doc.fileContent, "base64");
  const safeFileName = doc.originalFileName.replace(/[^a-zA-Z0-9._\- ()]/g, "_");

  return new Response(buffer, {
    headers: {
      "Content-Type": doc.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFileName}"`,
      "Content-Length": buffer.length.toString(),
    },
  });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await prisma.companyDocument.findFirst({ where: { id, companyId: company.id } });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!doc.fileContent) return NextResponse.json({ error: "File content not stored" }, { status: 400 });

  const buffer = Buffer.from(doc.fileContent, "base64");
  const extractedText = await extractTextFromBuffer(buffer, doc.mimeType, doc.originalFileName);
  const fileType = getFileTypeLabel(doc.mimeType, doc.originalFileName);
  const meaningful = isMeaningfulExtraction(extractedText);
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(doc.metadata || "{}"); } catch { metadata = {}; }

  await prisma.companyDocument.update({
    where: { id },
    data: {
      extractedText: extractedText || null,
      metadata: JSON.stringify({
        ...metadata,
        fileType,
        reExtractedAt: new Date().toISOString(),
        extracted: meaningful,
        extractedChars: meaningful ? extractedText.length : 0,
        extractionStatus: meaningful ? "EXTRACTED" : extractedText ? "WARNING" : "EMPTY",
      }),
    },
  });

  await logAction({
    userId,
    action: "COMPANY_DOCUMENT_REEXTRACT",
    entityType: "CompanyDocument",
    entityId: id,
    description: `Re-extracted "${doc.originalFileName}" — ${meaningful ? `${extractedText.length.toLocaleString()} chars` : "no text extracted"}`,
    metadata: { companyId: company.id, fileName: doc.originalFileName, fileType, extracted: meaningful },
  });

  return NextResponse.json({ success: true, extractedChars: meaningful ? extractedText.length : 0, extracted: meaningful });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await prisma.companyDocument.findFirst({
    where: { id, companyId: company.id },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.companyDocument.delete({ where: { id } });

  await logAction({
    userId,
    action: "COMPANY_DOCUMENT_DELETE",
    entityType: "CompanyDocument",
    entityId: id,
    description: `Deleted company document "${doc.originalFileName}" (${doc.category})`,
  });

  return NextResponse.json({ success: true });
}
