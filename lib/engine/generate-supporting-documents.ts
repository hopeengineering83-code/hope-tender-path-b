import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { prisma } from "../prisma";

export type SupportingDocumentGenerationInput = {
  tenderId: string;
  tenderTitle: string;
  clientName: string;
  companyName: string;
  primarySector: string;
  requirementLines: string[];
  expertLines: string[];
  projectLines: string[];
  companyEvidenceLines: string[];
  projectEvidenceLines: string[];
  complianceLines: string[];
  submissionRules: string[];
};

function clean(value?: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/=+\s*PAGE\s+\d+\s*=+/gi, " ")
    .replace(/<PARSED TEXT FOR PAGE:[^>]+>/gi, " ")
    .replace(/Senior-level requirement bundle consolidating/gi, "Requirement summary")
    .replace(/Key evidence interpreted:/gi, "")
    .replace(/Company evidence available:/gi, "")
    .replace(/Project evidence available:/gi, "")
    .replace(/ChatGPT|OpenAI|as an AI/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function take(lines: string[], count: number, maxLen = 420): string[] {
  return lines
    .map(clean)
    .filter(Boolean)
    .filter((line) => !/placeholder|sample text|lorem ipsum|parsed text for page/i.test(line))
    .slice(0, count)
    .map((line) => (line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line));
}

function para(text: string, bold = false): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold, size: 22, font: "Calibri" })],
    spacing: { after: 120, line: 276 },
  });
}

function heading(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 260, after: 140 },
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    text,
    bullet: { level: 0 },
    spacing: { after: 80, line: 260 },
  });
}

function makeDocx(title: string, sections: Array<{ title: string; lines: string[] }>): Promise<Buffer> {
  const children: Paragraph[] = [
    para(title, true),
    para("Generated as part of the tender submission package. Confirm attachments, signatures, stamps and tender-specific forms before final submission."),
  ];

  for (const section of sections) {
    children.push(heading(section.title));
    const lines = section.lines.length ? section.lines : ["To be confirmed against the tender source documents and supporting evidence before final submission."];
    for (const line of lines) children.push(bullet(line));
  }

  return Packer.toBuffer(new Document({
    sections: [{ properties: {}, children }],
    styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } } },
  }));
}

function sectionsForDocument(documentType: string, name: string, input: SupportingDocumentGenerationInput) {
  const type = documentType.toUpperCase();
  if (type === "EXPERT") {
    return [
      { title: "Proposed Expert / CV Register", lines: take(input.expertLines, 18, 520) },
      { title: "Role and Responsibility Mapping", lines: take(input.requirementLines, 10, 360) },
      { title: "Submission Control", lines: ["Attach reviewed CVs, credentials, licences and professional certificates required by the tender.", "Confirm that each named expert is reviewed and mapped to a proposed role before submission."] },
    ];
  }
  if (type === "PROJECT_EXPERIENCE") {
    return [
      { title: "Relevant Project Reference Register", lines: take(input.projectLines, 16, 560) },
      { title: "Project Evidence Attachments", lines: take(input.projectEvidenceLines, 14, 420) },
      { title: "Relevance to Tender", lines: take(input.requirementLines, 10, 360) },
    ];
  }
  if (type === "COMPANY_PROFILE") {
    return [
      { title: "Company Profile Evidence", lines: take(input.companyEvidenceLines, 16, 520) },
      { title: "Core Capability", lines: [`Company: ${input.companyName}`, `Client: ${input.clientName}`, `Assignment: ${input.tenderTitle}`, `Primary sector: ${input.primarySector}`] },
      { title: "Compliance Attachments", lines: take(input.complianceLines, 10, 360) },
    ];
  }
  if (type === "METHODOLOGY") {
    return [
      { title: "Understanding of the Assignment", lines: take(input.requirementLines, 12, 420) },
      { title: "Work Plan and Technical Approach", lines: ["Confirm scope, deliverables, assumptions and constraints from the tender documents.", "Map each technical task to the proposed team, deliverables, quality checks and submission milestones.", "Apply document control, senior review, evidence verification and final compliance checks before submission."] },
      { title: "Submission Requirements", lines: take(input.submissionRules, 8, 320) },
    ];
  }
  if (/FINANCIAL|CAPACITY|AUDITED/i.test(`${type} ${name}`)) {
    return [
      { title: "Financial Capacity Evidence Register", lines: take(input.companyEvidenceLines, 12, 420) },
      { title: "Tender Requirement Mapping", lines: take(input.requirementLines, 8, 360) },
      { title: "Submission Control", lines: ["Attach audited statements, financial records, tax clearance or other financial documents required by the tender.", "Do not include a financial offer in this document unless the tender explicitly requests it."] },
    ];
  }
  if (/FORM|DECLARATION|ANNEX|SCHEDULE|TEMPLATE/i.test(`${type} ${name}`)) {
    return [
      { title: "Tender Forms and Templates Register", lines: take(input.requirementLines, 12, 380) },
      { title: "Completion Control", lines: ["Complete tender-issued forms exactly as required.", "Confirm signature, stamp, date, file name, order and attachment requirements before submission."] },
      { title: "Submission Rules", lines: take(input.submissionRules, 8, 320) },
    ];
  }
  return [
    { title: "Requirement Response", lines: take(input.requirementLines, 12, 420) },
    { title: "Supporting Evidence", lines: take([...input.companyEvidenceLines, ...input.projectEvidenceLines], 12, 420) },
    { title: "Submission Control", lines: take(input.submissionRules, 8, 320) },
  ];
}

export async function generateSupportingTenderDocuments(input: SupportingDocumentGenerationInput): Promise<number> {
  const plannedDocs = await prisma.generatedDocument.findMany({
    where: {
      tenderId: input.tenderId,
      OR: [{ generationStatus: { not: "GENERATED" } }, { fileContent: null }],
    },
    orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
  });

  let count = 0;
  for (const doc of plannedDocs) {
    if (["TECHNICAL_PROPOSAL", "PROPOSAL"].includes(doc.documentType)) continue;
    const title = clean(doc.exactFileName || doc.name || doc.documentType);
    const sections = sectionsForDocument(doc.documentType, doc.name, input);
    const buffer = await makeDocx(title, sections);
    await prisma.generatedDocument.update({
      where: { id: doc.id },
      data: {
        fileContent: buffer.toString("base64"),
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        contentSummary: `Generated supporting tender package document: ${title}.`,
        updatedAt: new Date(),
      },
    });
    count += 1;
  }
  return count;
}
