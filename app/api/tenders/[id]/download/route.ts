import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType,
} from "docx";
import { logAction } from "../../../../../lib/audit";

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function mdToDocxParagraphs(text: string): Paragraph[] {
  return text.split("\n").filter((l) => l.trim()).map((line) => {
    if (line.startsWith("## ")) return new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } });
    if (line.startsWith("# ")) return new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 120 } });
    if (line.startsWith("- ") || line.startsWith("* ")) return new Paragraph({ text: line.slice(2), bullet: { level: 0 }, spacing: { after: 60 } });
    return new Paragraph({ children: [new TextRun({ text: line })], spacing: { after: 60 } });
  });
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
    include: { requirements: true, complianceGaps: true, generatedDocuments: true },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const company = await prisma.company.findUnique({ where: { userId } });

  // Download a specific generated document by ID
  if (docId) {
    const doc = tender.generatedDocuments.find((d) => d.id === docId);
    if (!doc || !doc.fileContent) {
      return NextResponse.json({ error: "Document not found or not yet generated" }, { status: 404 });
    }
    const buffer = Buffer.from(doc.fileContent, "base64");
    const filename = doc.exactFileName ?? `${doc.name.replace(/[^a-zA-Z0-9]/g, "-")}.docx`;

    await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "GeneratedDocument", entityId: docId, description: `Downloaded "${filename}"` });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // ZIP: bundle all generated documents
  if (type === "zip") {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    const generatedDocs = tender.generatedDocuments
      .filter((d) => d.generationStatus === "GENERATED" && d.fileContent)
      .sort((a, b) => (a.exactOrder ?? 99) - (b.exactOrder ?? 99));

    if (generatedDocs.length === 0) {
      return NextResponse.json({ error: "No generated documents to package. Run generation first." }, { status: 400 });
    }

    for (const doc of generatedDocs) {
      const buffer = Buffer.from(doc.fileContent!, "base64");
      const filename = doc.exactFileName ?? `${doc.name.replace(/[^a-zA-Z0-9]/g, "-")}.docx`;
      zip.file(filename, buffer);
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const zipName = `${tender.title.replace(/[^a-zA-Z0-9]/g, "-")}-submission-package.zip`;

    await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "Tender", entityId: id, description: `Downloaded ZIP package for "${tender.title}" (${generatedDocs.length} files)` });

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
      },
    });
  }

  // Legacy: on-the-fly report DOCX (proposal/compliance/requirements)
  const children: Paragraph[] = [];

  if (type === "proposal") {
    children.push(
      new Paragraph({ children: [new TextRun({ text: tender.title, bold: true, size: 56 })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
      new Paragraph({ children: [new TextRun({ text: `Prepared by: ${company?.name ?? ""}`, size: 24, color: "555555" })], alignment: AlignmentType.CENTER, spacing: { after: 480 } }),
      new Paragraph({ text: "Executive Summary", heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }),
      new Paragraph({ children: [new TextRun({ text: tender.analysisSummary ?? tender.description ?? "" })], spacing: { after: 240 } }),
    );
    if (tender.intakeSummary) {
      children.push(new Paragraph({ text: "Proposal Content", heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }));
      children.push(...mdToDocxParagraphs(tender.intakeSummary));
    }
    if (tender.requirements.length > 0) {
      children.push(new Paragraph({ text: "Requirements Response", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 120 } }));
      for (const req of tender.requirements.filter((r) => r.priority === "MANDATORY")) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: req.title, bold: true })], spacing: { before: 120, after: 60 } }),
          new Paragraph({ children: [new TextRun({ text: req.description, color: "333333" })], spacing: { after: 120 } }),
        );
      }
    }
    if (company) {
      children.push(
        new Paragraph({ text: "Company Profile", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 120 } }),
        new Paragraph({ children: [new TextRun({ text: company.description ?? "" })], spacing: { after: 120 } }),
      );
      const lines = safeParseArr(company.serviceLines);
      if (lines.length > 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: "Service Lines:", bold: true })], spacing: { after: 60 } }));
        for (const l of lines) children.push(new Paragraph({ text: l, bullet: { level: 0 }, spacing: { after: 40 } }));
      }
    }
  } else if (type === "compliance") {
    children.push(new Paragraph({ children: [new TextRun({ text: `Compliance Report: ${tender.title}`, bold: true, size: 48 })], spacing: { after: 300 } }));
    if (tender.complianceGaps.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: "No compliance gaps identified.", color: "22c55e" })] }));
    } else {
      for (const gap of tender.complianceGaps) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `[${gap.severity}] `, bold: true, color: gap.severity === "CRITICAL" ? "dc2626" : gap.severity === "HIGH" ? "ea580c" : "ca8a04" }),
              new TextRun({ text: gap.title, bold: true }),
            ],
            spacing: { before: 160, after: 60 },
          }),
          new Paragraph({ children: [new TextRun({ text: gap.description, color: "555555" })], spacing: { after: 60 } }),
          ...(gap.mitigationPlan ? [new Paragraph({ children: [new TextRun({ text: `Mitigation: ${gap.mitigationPlan}`, italics: true })] })] : []),
        );
      }
    }
  } else if (type === "requirements") {
    children.push(new Paragraph({ children: [new TextRun({ text: `Requirements: ${tender.title}`, bold: true, size: 48 })], spacing: { after: 300 } }));
    for (const req of tender.requirements) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `[${req.priority}] ${req.requirementType}  `, bold: true, color: req.priority === "MANDATORY" ? "dc2626" : "2563eb" }),
            new TextRun({ text: req.title, bold: true }),
          ],
          spacing: { before: 120, after: 60 },
        }),
        new Paragraph({ children: [new TextRun({ text: req.description })], spacing: { after: 120 } }),
      );
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
    styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } } },
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = `${tender.title.replace(/[^a-zA-Z0-9]/g, "-")}-${type}.docx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
