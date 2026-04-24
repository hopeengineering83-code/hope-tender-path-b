import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { extractTextFromBuffer } from "../../../../../lib/extract-text";
import { logAction } from "../../../../../lib/audit";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id: tenderId } = await params;

  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const files = await prisma.tenderFile.findMany({
    where: { tenderId },
    select: { id: true, fileContent: true, mimeType: true, originalFileName: true, extractedText: true },
  });

  let updated = 0;
  let failed = 0;
  const results: Array<{ fileName: string; chars: number | null; error?: string }> = [];

  for (const file of files) {
    if (!file.fileContent) {
      results.push({ fileName: file.originalFileName, chars: null, error: "No file content stored" });
      continue;
    }
    try {
      const buffer = Buffer.from(file.fileContent, "base64");
      const extractedText = await extractTextFromBuffer(buffer, file.mimeType, file.originalFileName);
      await prisma.tenderFile.update({
        where: { id: file.id },
        data: { extractedText: extractedText || null },
      });
      updated++;
      results.push({ fileName: file.originalFileName, chars: extractedText.length });
    } catch (err) {
      failed++;
      results.push({ fileName: file.originalFileName, chars: null, error: String(err) });
    }
  }

  await logAction({
    userId,
    action: "TENDER_FILE_UPLOAD",
    entityType: "Tender",
    entityId: tenderId,
    description: `Re-extracted text from ${updated}/${files.length} files for tender "${tender.title}"`,
  });

  return NextResponse.json({ success: true, total: files.length, updated, failed, results });
}
