import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType,
} from "docx";

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function mdToDocxParagraphs(text: string): Paragraph[] {
  return text.split("\n").filter((l) => l.trim()).map((line) => {
    if (line.startsWith("## ")) {
      return new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } });
    }
    if (line.startsWith("# ")) {
      return new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 120 } });
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      return new Paragraph({ text: line.slice(2), bullet: { level: 0 }, spacing: { after: 60 } });
    }
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

  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    include: { requirements: true, complianceGaps: true, generatedDocuments: true },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const company = await prisma.company.findUnique({ where: { userId } });

  const children: Paragraph[] = [];

  if (type === "proposal") {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: tender.title, bold: true, size: 56 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }),
      new Paragraph({
        children: [new TextRun({ text: `Prepared by: ${company?.name ?? ""}`, size: 24, color: "555555" })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 480 },
      }),
    );

    children.push(
      new Paragraph({ text: "Executive Summary", heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }),
      new Paragraph({ children: [new TextRun({ text: tender.analysisSummary ?? tender.description ?? "" })], spacing: { after: 240 } }),
    );

    if (tender.intakeSummary) {
      children.push(
        new Paragraph({ text: "Proposal Content", heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }),
        ...mdToDocxParagraphs(tender.intakeSummary),
      );
    }

    if (tender.requirements.length > 0) {
      children.push(
        new Paragraph({ text: "Requirements Response", heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 120 } }),
      );
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
        for (const l of lines) {
          children.push(new Paragraph({ text: l, bullet: { level: 0 }, spacing: { after: 40 } }));
        }
      }
    }
  } else if (type === "compliance") {
    children.push(
      new Paragraph({ children: [new TextRun({ text: `Compliance Report: ${tender.title}`, bold: true, size: 48 })], spacing: { after: 300 } }),
    );

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
    children.push(
      new Paragraph({ children: [new TextRun({ text: `Requirements: ${tender.title}`, bold: true, size: 48 })], spacing: { after: 300 } }),
    );
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
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22 },
          paragraph: { spacing: { line: 276 } },
        },
      },
    },
  });

  const buffer = await Packer.toBuffer(doc);
  const uint8 = new Uint8Array(buffer);
  const filename = `${tender.title.replace(/[^a-zA-Z0-9]/g, "-")}-${type}.docx`;

  return new NextResponse(uint8, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
