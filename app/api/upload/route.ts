import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession } from "../../../lib/auth";
import { extractTextFromBuffer, detectCategoryFromFile, getFileTypeLabel } from "../../../lib/extract-text";
import { logAction } from "../../../lib/audit";

// File content stored as base64 in the database — no filesystem dependency.
// Max 10 MB enforced by Next.js serverActions bodySizeLimit.
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;

  try {
    const formData = await req.formData();

    // Support both single and multi-file upload
    const files = formData.getAll("file").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const tenderId = formData.get("tenderId") as string | null;
    const companyDocFlag = formData.get("companyDoc") as string | null;
    const classification = (formData.get("classification") as string | null) || null;

    // Validate: need a destination
    if (!tenderId && companyDocFlag !== "true") {
      return NextResponse.json({ error: "tenderId or companyDoc=true required" }, { status: 400 });
    }

    const results: unknown[] = [];

    for (const file of files) {
      if (file.size > MAX_BYTES) {
        results.push({ error: `${file.name}: exceeds 10 MB limit`, fileName: file.name });
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const base64Content = buffer.toString("base64");
      const mimeType = file.type || "application/octet-stream";
      const fileTypeLabel = getFileTypeLabel(mimeType, file.name);

      // Run text extraction (handles all supported types)
      const extractedText = await extractTextFromBuffer(buffer, mimeType, file.name);
      const hasText = extractedText.length > 0 && !extractedText.startsWith("[Scanned");

      if (tenderId) {
        const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
        if (!tender) {
          results.push({ error: "Tender not found", fileName: file.name });
          continue;
        }

        const fileRecord = await prisma.tenderFile.create({
          data: {
            tenderId,
            fileName: file.name,
            originalFileName: file.name,
            mimeType,
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
          description: `Uploaded ${fileTypeLabel} "${file.name}" to tender — ${hasText ? `${extractedText.length.toLocaleString()} chars extracted` : "no text extracted"}`,
          metadata: { tenderId, fileName: file.name, fileType: fileTypeLabel, extracted: hasText },
        });

        results.push({ success: true, scope: "tender", fileRecord });

      } else {
        const company = await prisma.company.findUnique({ where: { userId } });
        if (!company) {
          results.push({ error: "Company not found", fileName: file.name });
          continue;
        }

        // Auto-detect category if not explicitly provided
        const providedCategory = formData.get("category") as string | null;
        const category = (providedCategory && providedCategory !== "AUTO")
          ? providedCategory
          : detectCategoryFromFile(file.name, mimeType);

        const docRecord = await prisma.companyDocument.create({
          data: {
            companyId: company.id,
            fileName: file.name,
            originalFileName: file.name,
            mimeType,
            size: file.size,
            storagePath: "",
            fileContent: base64Content,
            category,
            extractedText: extractedText || null,
            metadata: JSON.stringify({ fileType: fileTypeLabel, autoDetected: !providedCategory || providedCategory === "AUTO" }),
          },
        });

        await logAction({
          userId,
          action: "COMPANY_DOCUMENT_UPLOAD",
          entityType: "CompanyDocument",
          entityId: docRecord.id,
          description: `Uploaded ${fileTypeLabel} "${file.name}" (${category}) — ${hasText ? `${extractedText.length.toLocaleString()} chars extracted` : "no text extracted"}`,
          metadata: { companyId: company.id, fileName: file.name, category, fileType: fileTypeLabel, extracted: hasText },
        });

        results.push({ success: true, scope: "company", docRecord });
      }
    }

    const successCount = results.filter((r) => (r as Record<string, unknown>).success).length;
    const errorCount = results.length - successCount;

    return NextResponse.json({
      success: successCount > 0,
      uploaded: successCount,
      errors: errorCount,
      results,
    }, { status: errorCount > 0 && successCount === 0 ? 422 : 200 });

  } catch (error) {
    console.error("[upload] error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
