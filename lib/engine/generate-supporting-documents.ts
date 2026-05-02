import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { prisma } from "../prisma";

function clean(value?: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/=+\s*PAGE\s+\d+\s*=+/gi, " ")
    .replace(/<PARSED TEXT FOR PAGE:[^>]+>/gi, " ")
    .replace(/Senior-level requirement bundle consolidating/gi, "Requirement summary")
    .replace(/Key evidence interpreted:/gi, "")
    .replace(/ChatGPT|OpenAI|as an AI/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shortText(value?: string | null, max = 420): string {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function para(text: string, bold = false): Paragraph {
  return new Paragraph({ children: [new TextRun({ text, bold, size: 22, font: "Calibri" })], spacing: { after: 120, line: 276 } });
}

function heading(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 260, after: 140 } });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 80, line: 260 } });
}

async function makeDocx(title: string, sections: Array<{ title: string; lines: string[] }>): Promise<Buffer> {
  const children: Paragraph[] = [
    para(title, true),
    para("Generated as part of the tender submission package. Confirm attachments, signatures, stamps, file name, order and tender-specific forms before final submission."),
  ];
  for (const section of sections) {
    children.push(heading(section.title));
    const lines = section.lines.length ? section.lines : ["Confirm this section against the tender source documents and supporting evidence before final submission."];
    for (const line of lines) children.push(bullet(shortText(line, 520)));
  }
  return Packer.toBuffer(new Document({ sections: [{ properties: {}, children }], styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } } } }));
}

function supportingSections(params: {
  documentType: string;
  name: string;
  tenderTitle: string;
  clientName: string;
  companyName: string;
  requirements: string[];
  experts: string[];
  projects: string[];
  companyEvidence: string[];
  submissionRules: string[];
}) {
  const type = params.documentType.toUpperCase();
  const label = `${type} ${params.name}`;
  if (type === "EXPERT") {
    return [
      { title: "Expert / CV Package", lines: params.experts.slice(0, 18) },
      { title: "Role Mapping", lines: params.requirements.slice(0, 10) },
      { title: "Submission Control", lines: ["Attach reviewed CVs and professional credentials required by the tender.", "Confirm each named expert is mapped to a proposed role and responsibility."] },
    ];
  }
  if (type === "PROJECT_EXPERIENCE") {
    return [
      { title: "Relevant Experience Register", lines: params.projects.slice(0, 16) },
      { title: "Relevance to Tender", lines: params.requirements.slice(0, 10) },
      { title: "Evidence Attachments", lines: ["Attach project evidence such as client references, completion certificates, photos, drawings or testimony where required."] },
    ];
  }
  if (type === "COMPANY_PROFILE") {
    return [
      { title: "Company Profile", lines: [`Company: ${params.companyName}`, `Client: ${params.clientName}`, `Assignment: ${params.tenderTitle}`] },
      { title: "Company Evidence", lines: params.companyEvidence.slice(0, 16) },
      { title: "Tender Requirement Mapping", lines: params.requirements.slice(0, 8) },
    ];
  }
  if (type === "METHODOLOGY") {
    return [
      { title: "Understanding of Assignment", lines: params.requirements.slice(0, 12) },
      { title: "Work Plan and Technical Approach", lines: ["Confirm scope, deliverables, assumptions and constraints from the tender documents.", "Map each task to team responsibility, deliverables, quality checks and submission milestones.", "Apply document control, evidence verification and final compliance checks before submission."] },
      { title: "Submission Rules", lines: params.submissionRules.slice(0, 8) },
    ];
  }
  if (/FINANCIAL|CAPACITY|AUDITED/.test(label)) {
    return [
      { title: "Financial Capacity Evidence", lines: params.companyEvidence.slice(0, 14) },
      { title: "Tender Requirement Mapping", lines: params.requirements.slice(0, 8) },
      { title: "Submission Control", lines: ["Attach audited statements, tax clearance, bank/financial documents or other financial records required by the tender.", "Do not include a financial offer unless the tender explicitly requests it in this document."] },
    ];
  }
  if (/FORM|DECLARATION|ANNEX|SCHEDULE|TEMPLATE/.test(label)) {
    return [
      { title: "Tender Forms Register", lines: params.requirements.slice(0, 12) },
      { title: "Completion Control", lines: ["Complete tender-issued forms exactly as required.", "Confirm signature, stamp, date, file name, order and attachment requirements before submission."] },
      { title: "Submission Rules", lines: params.submissionRules.slice(0, 8) },
    ];
  }
  return [
    { title: "Requirement Response", lines: params.requirements.slice(0, 12) },
    { title: "Supporting Evidence", lines: [...params.companyEvidence, ...params.projects].slice(0, 12) },
    { title: "Submission Control", lines: params.submissionRules.slice(0, 8) },
  ];
}

export async function generateRemainingSupportingTenderDocuments(tenderId: string, userId: string): Promise<number> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: true,
      expertMatches: { where: { isSelected: true }, include: { expert: true }, orderBy: { score: "desc" } },
      projectMatches: { where: { isSelected: true }, include: { project: true }, orderBy: { score: "desc" } },
    },
  });
  if (!tender) return 0;

  const company = await prisma.company.findUnique({
    where: { userId },
    include: {
      documents: { orderBy: { updatedAt: "desc" }, take: 18 },
      legalRecords: { orderBy: { updatedAt: "desc" }, take: 8 },
      financialRecords: { orderBy: { fiscalYear: "desc" }, take: 8 },
      complianceRecords: { orderBy: { updatedAt: "desc" }, take: 8 },
    },
  });
  if (!company) return 0;

  const plannedDocs = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: { not: "GENERATED" } },
    orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
  });

  const requirements = tender.requirements.map((r) => `${r.priority} ${r.requirementType}: ${r.title} — ${shortText(r.description, 360)}`);
  const experts = tender.expertMatches
    .filter((m) => m.expert.trustLevel === "REVIEWED")
    .map((m) => `${m.expert.fullName}${m.expert.title ? ` — ${m.expert.title}` : ""}${m.expert.yearsExperience ? ` | ${m.expert.yearsExperience}+ years` : ""}${m.expert.profile ? ` | ${shortText(m.expert.profile, 240)}` : ""}`);
  const projects = tender.projectMatches
    .filter((m) => m.project.trustLevel === "REVIEWED")
    .map((m) => `${m.project.name}${m.project.clientName ? ` — ${m.project.clientName}` : ""}${m.project.country ? ` | ${m.project.country}` : ""}${m.project.summary ? ` | ${shortText(m.project.summary, 280)}` : ""}`);
  const companyEvidence = [
    ...company.documents.map((d) => `Company document: ${d.originalFileName}${d.category ? ` | ${d.category}` : ""}${d.extractedText ? ` | ${shortText(d.extractedText, 320)}` : ""}`),
    ...company.legalRecords.map((r) => `Legal evidence: ${r.title}${r.referenceNumber ? ` | ref: ${r.referenceNumber}` : ""}${r.status ? ` | ${r.status}` : ""}`),
    ...company.financialRecords.map((r) => `Financial evidence: ${r.recordType} ${r.fiscalYear}${r.amount ? ` | ${r.currency ?? ""} ${r.amount}` : ""}`),
    ...company.complianceRecords.map((r) => `Compliance evidence: ${r.title}${r.status ? ` | ${r.status}` : ""}${r.evidenceSummary ? ` | ${shortText(r.evidenceSummary, 240)}` : ""}`),
  ];
  const submissionRules = [tender.submissionMethod, tender.submissionAddress].filter(Boolean).map(String);

  let count = 0;
  for (const doc of plannedDocs) {
    if (["TECHNICAL_PROPOSAL", "PROPOSAL"].includes(doc.documentType)) continue;
    const title = clean(doc.exactFileName || doc.name || doc.documentType);
    const sections = supportingSections({
      documentType: doc.documentType,
      name: doc.name,
      tenderTitle: tender.title,
      clientName: tender.clientName || "Client",
      companyName: company.name,
      requirements,
      experts,
      projects,
      companyEvidence,
      submissionRules,
    });
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
