import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { prisma } from "../prisma";
import { humanize } from "./humanize";
import { forbidsBranding, normalizeSubmissionFileName, requiresCoverPage, requiresSignatureOrStamp } from "./scope-policy";

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function heading(text: string, level: HeadingLevel = HeadingLevel.HEADING_1): Paragraph {
  return new Paragraph({ text, heading: level, spacing: { before: 240, after: 100 } });
}

function body(text: string, opts?: { bold?: boolean; italic?: boolean }): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: opts?.bold, italics: opts?.italic })],
    spacing: { after: 80 },
  });
}

function labelValue(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun({ text: value })],
    spacing: { after: 60 },
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 40 } });
}

function rule(): Paragraph {
  return new Paragraph({
    border: { bottom: { color: "999999", space: 1, style: BorderStyle.SINGLE, size: 6 } },
    spacing: { after: 120 },
  });
}

function letterhead(company: { name: string; address?: string | null; phone?: string | null; email?: string | null; website?: string | null }): Paragraph[] {
  return [
    new Paragraph({
      children: [new TextRun({ text: company.name, bold: true, size: 32, color: "1a1a2e" })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: [company.address, company.phone, company.email, company.website].filter(Boolean).join("  |  "), size: 18, color: "555555" })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 60 },
    }),
    rule(),
  ];
}

function coverPage(tender: { title: string; reference?: string | null; clientName?: string | null }, companyName: string): Paragraph[] {
  return [
    new Paragraph({ children: [new TextRun({ text: tender.title, bold: true, size: 48 })], alignment: AlignmentType.CENTER, spacing: { after: 160 } }),
    ...(tender.reference ? [new Paragraph({ children: [new TextRun({ text: `Reference: ${tender.reference}`, size: 24 })], alignment: AlignmentType.CENTER, spacing: { after: 80 } })] : []),
    ...(tender.clientName ? [new Paragraph({ children: [new TextRun({ text: `Submitted to: ${tender.clientName}`, size: 24 })], alignment: AlignmentType.CENTER, spacing: { after: 80 } })] : []),
    new Paragraph({ children: [new TextRun({ text: `Prepared by: ${companyName}`, size: 24 })], alignment: AlignmentType.CENTER, spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), size: 22 })], alignment: AlignmentType.CENTER, spacing: { after: 360 } }),
    rule(),
  ];
}

function signatureBlock(companyName: string): Paragraph[] {
  return [
    new Paragraph({ spacing: { before: 360, after: 80 } }),
    body(`For and on behalf of ${companyName}`, { bold: true }),
    body("Authorized signatory"),
    body("Signature and stamp to be applied only where permitted by the tender instructions."),
  ];
}

function docFromParagraphs(paragraphs: Paragraph[], companyName: string, title: string): Document {
  return new Document({
    sections: [{
      properties: {},
      children: paragraphs,
      headers: {
        default: new Header({
          children: [new Paragraph({ children: [new TextRun({ text: companyName, size: 18, color: "777777" })], alignment: AlignmentType.RIGHT })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({ children: [new TextRun({ text: title, size: 16, color: "999999" })], alignment: AlignmentType.CENTER })],
        }),
      },
    }],
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } },
    },
  });
}

function expertContent(expert: {
  fullName: string; title?: string | null; email?: string | null; phone?: string | null;
  yearsExperience?: number | null; disciplines: string; sectors: string; certifications: string; profile?: string | null;
}): Paragraph[] {
  const paragraphs = [heading("Curriculum Vitae"), heading(expert.fullName, HeadingLevel.HEADING_2)];
  if (expert.title) paragraphs.push(labelValue("Position", expert.title));
  if (expert.email) paragraphs.push(labelValue("Email", expert.email));
  if (expert.phone) paragraphs.push(labelValue("Phone", expert.phone));
  if (expert.yearsExperience) paragraphs.push(labelValue("Years of Experience", String(expert.yearsExperience)));

  const disciplines = safeParseArr(expert.disciplines);
  if (disciplines.length > 0) {
    paragraphs.push(body("Disciplines", { bold: true }));
    disciplines.forEach((value) => paragraphs.push(bullet(value)));
  }

  const sectors = safeParseArr(expert.sectors);
  if (sectors.length > 0) {
    paragraphs.push(body("Relevant Sectors", { bold: true }));
    sectors.forEach((value) => paragraphs.push(bullet(value)));
  }

  const certifications = safeParseArr(expert.certifications);
  if (certifications.length > 0) {
    paragraphs.push(body("Certifications", { bold: true }));
    certifications.forEach((value) => paragraphs.push(bullet(value)));
  }

  if (expert.profile) paragraphs.push(body(expert.profile));
  return paragraphs;
}

function projectContent(project: {
  name: string; clientName?: string | null; country?: string | null; sector?: string | null;
  contractValue?: number | null; currency?: string | null; summary?: string | null; serviceAreas: string;
  startDate?: Date | null; endDate?: Date | null;
}): Paragraph[] {
  const paragraphs = [heading("Project Reference"), heading(project.name, HeadingLevel.HEADING_2)];
  if (project.clientName) paragraphs.push(labelValue("Client", project.clientName));
  if (project.country) paragraphs.push(labelValue("Country", project.country));
  if (project.sector) paragraphs.push(labelValue("Sector", project.sector));
  if (project.startDate) paragraphs.push(labelValue("Start Date", new Date(project.startDate).toLocaleDateString("en-US")));
  if (project.endDate) paragraphs.push(labelValue("Completion Date", new Date(project.endDate).toLocaleDateString("en-US")));
  if (project.contractValue) paragraphs.push(labelValue("Contract Value", `${project.currency ?? "USD"} ${project.contractValue.toLocaleString()}`));

  const areas = safeParseArr(project.serviceAreas);
  if (areas.length > 0) {
    paragraphs.push(body("Scope of Services", { bold: true }));
    areas.forEach((value) => paragraphs.push(bullet(value)));
  }

  if (project.summary) paragraphs.push(body(project.summary));
  return paragraphs;
}

function companyProfileContent(company: {
  name: string; legalName?: string | null; description?: string | null; profileSummary?: string | null;
  address?: string | null; phone?: string | null; email?: string | null; website?: string | null;
  serviceLines: string; sectors: string;
}): Paragraph[] {
  const paragraphs = [heading("Company Profile"), heading(company.name, HeadingLevel.HEADING_2)];
  if (company.legalName) paragraphs.push(labelValue("Legal Name", company.legalName));
  if (company.address) paragraphs.push(labelValue("Address", company.address));
  if (company.phone) paragraphs.push(labelValue("Phone", company.phone));
  if (company.email) paragraphs.push(labelValue("Email", company.email));
  if (company.website) paragraphs.push(labelValue("Website", company.website));
  if (company.profileSummary ?? company.description) paragraphs.push(body(company.profileSummary ?? company.description ?? ""));

  const services = safeParseArr(company.serviceLines);
  if (services.length > 0) {
    paragraphs.push(body("Core Services", { bold: true }));
    services.forEach((value) => paragraphs.push(bullet(value)));
  }

  const sectors = safeParseArr(company.sectors);
  if (sectors.length > 0) {
    paragraphs.push(body("Sectors of Experience", { bold: true }));
    sectors.forEach((value) => paragraphs.push(bullet(value)));
  }

  return paragraphs;
}

async function proposalContent(params: {
  tender: { title: string; description?: string | null; analysisSummary?: string | null; intakeSummary?: string | null; evaluationMethodology?: string | null };
  company: { name: string; description?: string | null; profileSummary?: string | null };
  requirements: Array<{ title: string; description: string; priority: string; requirementType: string }>;
  experts: Array<{ fullName: string; title?: string | null; yearsExperience?: number | null }>;
  projects: Array<{ name: string; clientName?: string | null; sector?: string | null }>;
}): Promise<Paragraph[]> {
  const paragraphs = [heading("Technical Submission")];
  const base = params.tender.analysisSummary || params.tender.description || params.tender.intakeSummary || `${params.company.name} submits this response for ${params.tender.title}.`;
  paragraphs.push(body(await humanize(base)));

  const methodology = params.requirements.filter((r) => r.requirementType === "METHODOLOGY" || /methodology|approach|work plan/i.test(`${r.title} ${r.description}`));
  if (methodology.length > 0) {
    paragraphs.push(heading("Methodology and Work Plan", HeadingLevel.HEADING_2));
    for (const req of methodology) paragraphs.push(body(await humanize(req.description)));
  }

  const mandatory = params.requirements.filter((r) => r.priority === "MANDATORY" && !["FORMAT", "SUBMISSION_RULE"].includes(r.requirementType));
  if (mandatory.length > 0) {
    paragraphs.push(heading("Mandatory Requirements Response", HeadingLevel.HEADING_2));
    mandatory.forEach((req) => paragraphs.push(bullet(req.description)));
  }

  if (params.experts.length > 0) {
    paragraphs.push(heading("Selected Key Personnel", HeadingLevel.HEADING_2));
    params.experts.forEach((expert) => paragraphs.push(bullet([expert.fullName, expert.title, expert.yearsExperience ? `${expert.yearsExperience} years` : ""].filter(Boolean).join(" — "))));
  }

  if (params.projects.length > 0) {
    paragraphs.push(heading("Selected Relevant Project References", HeadingLevel.HEADING_2));
    params.projects.forEach((project) => paragraphs.push(bullet([project.name, project.clientName, project.sector].filter(Boolean).join(" — "))));
  }

  return paragraphs;
}

function declarationContent(companyName: string, tenderTitle: string): Paragraph[] {
  return [
    heading("Declaration"),
    body(`We confirm that the information submitted by ${companyName} for ${tenderTitle} is based on company records and supporting evidence available in the company knowledge base.`),
    body("We confirm that the submission has been prepared for the stated tender requirements and must be reviewed by an authorized representative before release."),
  ];
}

function genericRequiredDocumentContent(name: string, contentSummary?: string | null): Paragraph[] {
  return [
    heading(name),
    body(contentSummary || "This document has been prepared as a tender-required submission attachment."),
  ];
}

export async function generateStrictTenderDocuments(tenderId: string, userId: string): Promise<void> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: true,
      expertMatches: { where: { isSelected: true }, include: { expert: true }, orderBy: { score: "desc" } },
      projectMatches: { where: { isSelected: true }, include: { project: true }, orderBy: { score: "desc" } },
      generatedDocuments: {
        where: { generationStatus: "PLANNED" },
        select: { id: true, name: true, documentType: true, exactFileName: true, exactOrder: true, contentSummary: true },
        orderBy: { exactOrder: "asc" },
      },
    },
  });

  if (!tender) throw new Error("Tender not found");
  if (tender.generatedDocuments.length === 0) {
    throw new Error("NO_TENDER_REQUIRED_DOCUMENTS");
  }

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) throw new Error("Company not found");

  const selectedExperts = tender.expertMatches.map((match) => match.expert);
  const selectedProjects = tender.projectMatches.map((match) => match.project);
  const allowBranding = !forbidsBranding(tender.requirements);
  const includeCoverPage = requiresCoverPage(tender.requirements);
  const includeSignature = requiresSignatureOrStamp(tender.requirements);

  let expertIdx = 0;
  let projectIdx = 0;

  for (const planned of tender.generatedDocuments) {
    const title = planned.exactFileName ?? planned.name;
    let paragraphs: Paragraph[] = [];

    if (allowBranding) paragraphs.push(...letterhead(company));
    if (includeCoverPage) paragraphs.push(...coverPage(tender, company.name));

    if (["TECHNICAL_PROPOSAL", "PROPOSAL", "METHODOLOGY"].includes(planned.documentType)) {
      paragraphs.push(...await proposalContent({
        tender,
        company,
        requirements: tender.requirements,
        experts: selectedExperts,
        projects: selectedProjects,
      }));
    } else if (planned.documentType === "EXPERT") {
      const expert = selectedExperts[expertIdx];
      if (!expert) throw new Error(`Missing selected expert for ${title}`);
      paragraphs.push(...expertContent(expert));
      expertIdx += 1;
    } else if (planned.documentType === "PROJECT_EXPERIENCE") {
      const project = selectedProjects[projectIdx];
      if (!project) throw new Error(`Missing selected project for ${title}`);
      paragraphs.push(...projectContent(project));
      projectIdx += 1;
    } else if (planned.documentType === "COMPANY_PROFILE") {
      paragraphs.push(...companyProfileContent(company));
    } else if (planned.documentType === "DECLARATION") {
      paragraphs.push(...declarationContent(company.name, tender.title));
    } else {
      paragraphs.push(...genericRequiredDocumentContent(planned.name, planned.contentSummary));
    }

    if (includeSignature) paragraphs.push(...signatureBlock(company.name));

    const document = docFromParagraphs(paragraphs, company.name, title);
    const buffer = await Packer.toBuffer(document);
    const exactFileName = normalizeSubmissionFileName(planned.exactFileName ?? planned.name);

    await prisma.generatedDocument.update({
      where: { id: planned.id },
      data: {
        fileContent: buffer.toString("base64"),
        exactFileName,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        contentSummary: `Generated ${new Date().toISOString()} from tender-required plan; ${paragraphs.length} paragraphs.`,
      },
    });
  }

  await prisma.tender.update({
    where: { id: tenderId },
    data: { status: "GENERATED", stage: "GENERATION", updatedAt: new Date() },
  });
}
