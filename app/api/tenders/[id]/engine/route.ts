import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { runTenderEngine } from "../../../../../lib/engine/run-tender-engine";
import { extractTextFromBuffer } from "../../../../../lib/extract-text";

async function reExtractMissingText(tenderId: string) {
  // Re-extract any files where extractedText is null but fileContent is present.
  // This heals files uploaded before the pdf-parse v2 fix.
  const files = await prisma.tenderFile.findMany({
    where: { tenderId, extractedText: null },
    select: { id: true, fileContent: true, mimeType: true, originalFileName: true },
  });

  for (const file of files) {
    if (!file.fileContent) continue;
    try {
      const buffer = Buffer.from(file.fileContent, "base64");
      const extractedText = await extractTextFromBuffer(buffer, file.mimeType, file.originalFileName);
      if (extractedText) {
        await prisma.tenderFile.update({
          where: { id: file.id },
          data: { extractedText },
        });
      }
    } catch (err) {
      console.error(`[engine/reextract] failed for file ${file.id}:`, err);
    }
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;

  try {
    const { id } = await params;

    // Heal any files with missing extractedText before running the engine
    await reExtractMissingText(id);

    const result = await runTenderEngine(id, userId);
    return NextResponse.json({ success: true, tender: result });
  } catch (error) {
    console.error("Engine run failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Engine failed" }, { status: 500 });
  }
}
