import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getSession } from "../../../lib/auth";
import { extractTextFromBuffer, detectCategoryFromFile, getFileTypeLabel, isMeaningfulExtraction } from "../../../lib/extract-text";
import { logAction } from "../../../lib/audit";
import { ensureCompanyForUser } from "../../../lib/company-workspace";
import { importCompanyKnowledgeFromDocuments } from "../../../lib/company-knowledge-import-safe";
import { runTenderEngine } from "../../../lib/engine/run-tender-engine";
import { runCompanyKnowledgeSafetyImport } from "../../../lib/company-knowledge-safety-import";

const MAX_BYTES = 10 * 1024 * 1024;

function extractionMetadata(fileTypeLabel: string, extractedText: string) {
  const meaningful = isMeaningfulExtraction(extractedText);
  return {
    fileType: fileTypeLabel,
    extracted: meaningful,
    extractedChars: meaningful ? extractedText.length : 0,
    extractionStatus: meaningful ? "EXTRACTED" : extractedText ? "WARNING" : "EMPTY",
    extractionMessage: meaningful ? null : extractedText || "No text extracted",
  };
}

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;

  try {
    const formData = await req.formData();
    const files = formData.getAll("file").filter((f): f is File => f instanceof File);
    if (files.length === 0) return NextResponse.json({ error: "No files provided" }, { status: 400 });

    const tenderId = formData.get("tenderId") as string | null;
    const companyDocFlag = formData.get("companyDoc") as string | null;
    const classification = (formData.get("classification") as string | null) || null;

    if (!tenderId && companyDocFlag !== "true") {
      return NextResponse.json({ error: "tenderId or companyDoc=true required" }, { status: 400 });
    }

    const results: unknown[] = [];
    let uploadedCompanyId: string | null = null;
    let companyDocsUploaded = 0;
    let companyDocsWithUsableText = 0;
    let tenderFilesUploaded = 0;
    let tenderFilesWithUsableText = 0;

    const ALLOWED_MIME = new Set([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "text/csv",
    ]);

    for (const file of files) {
      if (file.size > MAX_BYTES) {
        results.push({ error: `${file.name}: exceeds 10 MB limit`, fileName: file.name });
        continue;
      }

      const mime = file.type || "application/octet-stream";
      if (!ALLOWED_MIME.has(mime)) {
        results.push({ error: `${file.name}: unsupported file type "${mime}". Allowed: PDF, DOCX, DOC, XLSX, XLS, TXT, CSV`, fileName: file.name });
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const base64Content = buffer.toString("base64");
      const mimeType = file.type || "application/octet-stream";
      const fileTypeLabel = getFileTypeLabel(mimeType, file.name);
      const extractedText = await extractTextFromBuffer(buffer, mimeType, file.name);
      const extraction = extractionMetadata(fileTypeLabel, extractedText);

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
          select: {
            id: true, tenderId: true, fileName: true, originalFileName: true,
            mimeType: true, size: true, classification: true, extractedText: true, createdAt: true,
          },
        });

        await logAction({
          userId,
          action: "TENDER_FILE_UPLOAD",
          entityType: "TenderFile",
          entityId: fileRecord.id,
          description: `Uploaded ${fileTypeLabel} "${file.name}" to tender — ${extraction.extracted ? `${extraction.extractedChars.toLocaleString()} chars extracted` : extraction.extractionMessage}`,
          metadata: { tenderId, fileName: file.name, ...extraction },
        });

        tenderFilesUploaded += 1;
        if (extraction.extracted) tenderFilesWithUsableText += 1;
        results.push({ success: true, scope: "tender", fileRecord, extraction });
      } else {
        const company = await ensureCompanyForUser(prisma, userId);
        uploadedCompanyId = company.id;

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
            metadata: JSON.stringify({ category, autoDetected: !providedCategory || providedCategory === "AUTO", ...extraction }),
          },
          select: {
            id: true, companyId: true, fileName: true, originalFileName: true,
            mimeType: true, size: true, category: true, extractedText: true, createdAt: true,
          },
        });

        await logAction({
          userId,
          action: "COMPANY_DOCUMENT_UPLOAD",
          entityType: "CompanyDocument",
          entityId: docRecord.id,
          description: `Uploaded ${fileTypeLabel} "${file.name}" (${category}) — ${extraction.extracted ? `${extraction.extractedChars.toLocaleString()} chars extracted` : extraction.extractionMessage}`,
          metadata: { companyId: company.id, fileName: file.name, category, ...extraction },
        });

        companyDocsUploaded += 1;
        if (extraction.extracted) companyDocsWithUsableText += 1;
        results.push({ success: true, scope: "company", docRecord, extraction });
      }
    }

    let knowledgeImport: (Awaited<ReturnType<typeof importCompanyKnowledgeFromDocuments>> & { safetyImport?: Awaited<ReturnType<typeof runCompanyKnowledgeSafetyImport>> }) | null = null;
    let knowledgeImportError: string | null = null;
    let tenderEngine: { success: boolean; tenderId: string; status?: string | null; stage?: string | null; readinessScore?: number | null } | null = null;
    let tenderEngineError: string | null = null;

    if (uploadedCompanyId && companyDocsUploaded > 0 && companyDocsWithUsableText > 0) {
      try {
        const primaryImport = await importCompanyKnowledgeFromDocuments(uploadedCompanyId);
        const safetyImport = await runCompanyKnowledgeSafetyImport(prisma, uploadedCompanyId);
        knowledgeImport = { ...primaryImport, safetyImport };
        await logAction({
          userId,
          action: "COMPANY_KNOWLEDGE_REPAIR",
          entityType: "Company",
          entityId: uploadedCompanyId,
          description: `Auto-imported company knowledge after upload: ${primaryImport.expertsCreated + safetyImport.expertsCreated} experts and ${primaryImport.projectsCreated + safetyImport.projectsCreated} projects created`,
          metadata: knowledgeImport,
        });
      } catch (err) {
        knowledgeImportError = err instanceof Error ? err.message : String(err);
        console.error("[upload] company knowledge auto-import failed:", err);
        await logAction({
          userId,
          action: "COMPANY_KNOWLEDGE_REPAIR",
          entityType: "Company",
          entityId: uploadedCompanyId,
          description: `Company knowledge auto-import failed after upload: ${knowledgeImportError}`,
          metadata: { error: knowledgeImportError },
        });
      }
    }

    if (tenderId && tenderFilesUploaded > 0 && tenderFilesWithUsableText > 0) {
      try {
        const tender = await runTenderEngine(tenderId, userId);
        tenderEngine = {
          success: true,
          tenderId,
          status: tender?.status ?? null,
          stage: tender?.stage ?? null,
          readinessScore: tender?.readinessScore ?? null,
        };
        await logAction({
          userId,
          action: "TENDER_ANALYSIS_RUN",
          entityType: "Tender",
          entityId: tenderId,
          description: `Auto-ran tender analysis/matching/compliance after ${tenderFilesUploaded} tender file upload(s)`,
          metadata: tenderEngine,
        });
      } catch (err) {
        tenderEngineError = err instanceof Error ? err.message : String(err);
        console.error("[upload] tender engine auto-run failed:", err);
        await logAction({
          userId,
          action: "TENDER_ANALYSIS_RUN",
          entityType: "Tender",
          entityId: tenderId,
          description: `Tender engine auto-run failed after upload: ${tenderEngineError}`,
          metadata: { error: tenderEngineError },
        });
      }
    }

    const successCount = results.filter((r) => (r as Record<string, unknown>).success).length;
    const errorCount = results.length - successCount;

    return NextResponse.json({
      success: successCount > 0,
      uploaded: successCount,
      errors: errorCount,
      results,
      knowledgeImport,
      knowledgeImportError,
      tenderEngine,
      tenderEngineError,
    }, { status: errorCount > 0 && successCount === 0 ? 422 : 200 });
  } catch (error) {
    console.error("[upload] error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
