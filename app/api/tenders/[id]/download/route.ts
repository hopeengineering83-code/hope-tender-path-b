import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { logAction } from "../../../../../lib/audit";

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function generatedFileName(name: string): string {
  return `${name.replace(/[^a-zA-Z0-9]/g, "-")}.docx`;
}

function visibleXmlText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function validateGeneratedDocx(doc: {
  id: string;
  name: string;
  exactFileName: string | null;
  generationStatus: string;
  validationStatus: string;
  fileContent: string | null;
  draftExpertCount: number | null;
  draftProjectCount: number | null;
  reviewedExpertCount: number | null;
  reviewedProjectCount: number | null;
}) {
  const errors: string[] = [];
  const filename = doc.exactFileName ?? generatedFileName(doc.name);

  if (doc.generationStatus !== "GENERATED") errors.push("Document is not generated.");
  if (!doc.fileContent) errors.push("Document file content is missing.");
  if (!filename.toLowerCase().endsWith(".docx")) errors.push("Generated document is not DOCX.");
  if ((doc.draftExpertCount ?? 0) > 0 || (doc.draftProjectCount ?? 0) > 0) errors.push("Document references draft/unreviewed sources.");

  let text = "";
  if (doc.fileContent) {
    try {
      const buffer = Buffer.from(doc.fileContent, "base64");
      if (buffer.length < 500) errors.push("DOCX file is unexpectedly small.");
      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) errors.push("DOCX package signature is invalid.");

      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const documentXml = await zip.file("word/document.xml")?.async("string");
      if (!documentXml) {
        errors.push("DOCX word/document.xml is missing.");
      } else {
        text = visibleXmlText(documentXml);
        if (text.length < 100) errors.push("Document text is too short for final submission.");
      }
    } catch (error) {
      errors.push(`DOCX validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const forbiddenPatterns = [
    /AI_DRAFT/i,
    /REGEX_DRAFT/i,
    /REVIEW REQUIRED/i,
    /remove before submission/i,
    /placeholder/i,
    /sample text/i,
    /lorem ipsum/i,
    /as an AI/i,
    /AI-generated/i,
    /ChatGPT/i,
    /OpenAI/i,
    /source snippet/i,
    /deterministic safety import/i,
  ];
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(text) || pattern.test(doc.name) || pattern.test(filename)) {
      errors.push(`Forbidden final-output trace detected: ${pattern.source}`);
    }
  }

  const status = errors.length === 0 ? "VALIDATED" : "FAILED";
  if (doc.validationStatus !== status) {
    await prisma.generatedDocument.update({
      where: { id: doc.id },
      data: {
        validationStatus: status,
        reviewNotes: errors.length > 0 ? errors.join("\n") : "Passed deterministic final export validation.",
      },
    });
  }

  return { ok: errors.length === 0, errors, filename };
}

async function validateDocsForExport(docs: Array<{
  id: string;
  name: string;
  exactFileName: string | null;
  generationStatus: string;
  validationStatus: string;
  fileContent: string | null;
  draftExpertCount: number | null;
  draftProjectCount: number | null;
  reviewedExpertCount: number | null;
  reviewedProjectCount: number | null;
}>) {
  const failures: Array<{ id: string; name: string; errors: string[] }> = [];
  for (const doc of docs) {
    const result = await validateGeneratedDocx(doc);
    if (!result.ok) failures.push({ id: doc.id, name: doc.name, errors: result.errors });
  }
  return failures;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "proposal";
  const docId = searchParams.get("docId");

  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    include: { requirements: true, complianceGaps: true, generatedDocuments: true, exportPackages: true },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const blockingGaps = tender.complianceGaps.filter((g) => !g.isResolved && g.severity === "CRITICAL");
  if ((docId || type === "zip") && blockingGaps.length > 0) {
    return NextResponse.json({ error: "Final export blocked by unresolved CRITICAL compliance gaps", reasons: blockingGaps.map((g) => g.title) }, { status: 409 });
  }

  if (type === "proposal" && !docId) {
    return NextResponse.json({
      error: "Direct proposal export is disabled",
      detail: "Run the tender engine and generate the required documents first. Then download a generated document or the ZIP package. This prevents unvalidated proposal files from bypassing compliance and review guardrails.",
    }, { status: 409 });
  }

  if (docId) {
    const doc = tender.generatedDocuments.find((d) => d.id === docId);
    if (!doc || !doc.fileContent || doc.generationStatus !== "GENERATED") {
      return NextResponse.json({ error: "Document not found or not yet generated" }, { status: 404 });
    }

    const validation = await validateGeneratedDocx(doc);
    if (!validation.ok) {
      return NextResponse.json({ error: "Document export blocked by final validation", reasons: validation.errors }, { status: 409 });
    }

    const buffer = Buffer.from(doc.fileContent, "base64");
    await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "GeneratedDocument", entityId: docId, description: `Downloaded validated generated document "${validation.filename}"` });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${validation.filename}"`,
      },
    });
  }

  if (type === "zip") {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    const generatedDocs = tender.generatedDocuments
      .filter((d) => d.generationStatus === "GENERATED" && d.fileContent)
      .sort((a, b) => (a.exactOrder ?? 99) - (b.exactOrder ?? 99));

    if (generatedDocs.length === 0) {
      return NextResponse.json({ error: "No generated documents to package. Run generation first." }, { status: 400 });
    }

    const validationFailures = await validateDocsForExport(generatedDocs);
    if (validationFailures.length > 0) {
      return NextResponse.json({ error: "ZIP export blocked by final validation", failures: validationFailures }, { status: 409 });
    }

    const requiredNames = safeParseArr(tender.exactFileNaming).map(normalizeName);
    const requiredOrder = safeParseArr(tender.exactFileOrder).map(normalizeName);
    const generatedNames = generatedDocs.map((d) => normalizeName(d.exactFileName ?? generatedFileName(d.name)));

    if (requiredNames.length > 0) {
      const missing = requiredNames.filter((name) => !generatedNames.includes(name));
      const extras = generatedNames.filter((name) => !requiredNames.includes(name));
      if (missing.length > 0 || extras.length > 0 || generatedDocs.length !== requiredNames.length) {
        return NextResponse.json(
          { error: "Generated package does not match tender-required file naming scope.", missing, extras, requiredCount: requiredNames.length, generatedCount: generatedDocs.length },
          { status: 400 },
        );
      }
    }

    if (requiredOrder.length > 0) {
      const outOfOrder = requiredOrder.some((name, index) => generatedNames[index] !== name);
      if (outOfOrder) {
        return NextResponse.json({ error: "Generated package order does not match tender-required file order.", requiredOrder, generatedOrder: generatedNames }, { status: 400 });
      }
    }

    for (const doc of generatedDocs) {
      const buffer = Buffer.from(doc.fileContent!, "base64");
      const filename = doc.exactFileName ?? generatedFileName(doc.name);
      zip.file(filename, buffer);
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const zipName = `${tender.title.replace(/[^a-zA-Z0-9]/g, "-")}-submission-package.zip`;
    const fileList = generatedDocs.map((doc) => doc.exactFileName ?? generatedFileName(doc.name));

    const existingPackage = tender.exportPackages[0];
    if (existingPackage) {
      await prisma.exportPackage.update({ where: { id: existingPackage.id }, data: { status: "READY", fileList: JSON.stringify(fileList), downloadCount: { increment: 1 } } });
    } else {
      await prisma.exportPackage.create({ data: { tenderId: id, status: "READY", fileList: JSON.stringify(fileList), downloadCount: 1 } });
    }

    await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "Tender", entityId: id, description: `Downloaded validated ZIP package for "${tender.title}" (${generatedDocs.length} files)` });

    return new NextResponse(new Uint8Array(zipBuffer), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${zipName}"` } });
  }

  const children: Paragraph[] = [];

  if (type === "compliance") {
    children.push(new Paragraph({ children: [new TextRun({ text: `Internal Compliance Report: ${tender.title}`, bold: true, size: 48 })], spacing: { after: 300 } }));
    if (tender.complianceGaps.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: "No compliance gaps identified.", color: "22c55e" })] }));
    } else {
      for (const gap of tender.complianceGaps) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: `[${gap.severity}] `, bold: true, color: gap.severity === "CRITICAL" ? "dc2626" : gap.severity === "HIGH" ? "ea580c" : "ca8a04" }), new TextRun({ text: gap.title, bold: true })], spacing: { before: 160, after: 60 } }),
          new Paragraph({ children: [new TextRun({ text: gap.description, color: "555555" })], spacing: { after: 60 } }),
          ...(gap.mitigationPlan ? [new Paragraph({ children: [new TextRun({ text: `Mitigation: ${gap.mitigationPlan}`, italics: true })] })] : []),
        );
      }
    }
  } else if (type === "requirements") {
    children.push(new Paragraph({ children: [new TextRun({ text: `Internal Requirements Review: ${tender.title}`, bold: true, size: 48 })], spacing: { after: 300 } }));
    for (const req of tender.requirements) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: `[${req.priority}] ${req.requirementType}  `, bold: true, color: req.priority === "MANDATORY" ? "dc2626" : "2563eb" }), new TextRun({ text: req.title, bold: true })], spacing: { before: 120, after: 60 } }),
        new Paragraph({ children: [new TextRun({ text: req.description })], spacing: { after: 120 } }),
      );
    }
  } else {
    return NextResponse.json({ error: "Unsupported download type" }, { status: 400 });
  }

  const doc = new Document({ sections: [{ properties: {}, children }], styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } } } });
  const buffer = await Packer.toBuffer(doc);
  const filename = `${tender.title.replace(/[^a-zA-Z0-9]/g, "-")}-${type}-internal.docx`;

  await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "Tender", entityId: id, description: `Downloaded internal ${type} report for "${tender.title}"` });
  return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${filename}"` } });
}
