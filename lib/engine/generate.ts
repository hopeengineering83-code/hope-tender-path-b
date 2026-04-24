import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, Table, TableRow, TableCell, WidthType,
  BorderStyle, PageBreak, Header, Footer,
} from "docx";
import { prisma } from "../prisma";
import { humanize } from "./humanize";
import { isAIEnabled } from "../ai";

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function hr(): Paragraph {
  return new Paragraph({
    border: { bottom: { color: "999999", space: 1, style: BorderStyle.SINGLE, size: 6 } },
    spacing: { after: 120 },
  });
}

function heading1(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 120 } });
}

function heading2(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 } });
}

function body(text: string, opts?: { bold?: boolean; italic?: boolean; color?: string }): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: opts?.bold, italics: opts?.italic, color: opts?.color })],
    spacing: { after: 80 },
  });
}

function labelValue(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true }),
      new TextRun({ text: value }),
    ],
    spacing: { after: 60 },
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 40 } });
}

function buildLetterheadHeader(company: { name: string; address?: string | null; phone?: string | null; email?: string | null; website?: string | null }): Paragraph[] {
  return [
    new Paragraph({
      children: [new TextRun({ text: company.name, bold: true, size: 32, color: "1a1a2e" })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: [company.address, company.phone, company.email, company.website].filter(Boolean).join("  |  "), size: 18, color: "555555" }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { after: 60 },
    }),
    hr(),
  ];
}

function buildCoverSection(title: string, reference?: string | null, clientName?: string | null, companyName?: string): Paragraph[] {
  return [
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 56 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Technical Proposal`, size: 32, color: "555555" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    ...(reference ? [new Paragraph({
      children: [new TextRun({ text: `Reference: ${reference}`, size: 24, color: "777777" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
    })] : []),
    ...(clientName ? [new Paragraph({
      children: [new TextRun({ text: `Submitted to: ${clientName}`, size: 24, color: "777777" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
    })] : []),
    ...(companyName ? [new Paragraph({
      children: [new TextRun({ text: `Prepared by: ${companyName}`, size: 24, color: "777777" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
    })] : []),
    new Paragraph({
      children: [new TextRun({ text: `Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, size: 22, color: "777777" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 },
    }),
    hr(),
  ];
}

async function buildProposalContent(params: {
  tender: { title: string; reference?: string | null; clientName?: string | null; description?: string | null; analysisSummary?: string | null; intakeSummary?: string | null; evaluationMethodology?: string | null };
  company: { name: string; description?: string | null; profileSummary?: string | null; serviceLines: string; sectors: string };
  experts: Array<{ fullName: string; title?: string | null; yearsExperience?: number | null; disciplines: string; certifications: string; profile?: string | null }>;
  projects: Array<{ name: string; clientName?: string | null; country?: string | null; sector?: string | null; contractValue?: number | null; currency?: string | null; summary?: string | null; serviceAreas: string }>;
  requirements: Array<{ title: string; description: string; priority: string; requirementType: string }>;
}): Promise<Paragraph[]> {
  const { tender, company, experts, projects, requirements } = params;
  const paras: Paragraph[] = [];

  // Executive Summary
  paras.push(heading1("1. Executive Summary"));
  const summaryText = tender.analysisSummary || tender.description || `${company.name} is pleased to submit this technical proposal for ${tender.title}.`;
  const humanizedSummary = await humanize(summaryText);
  paras.push(body(humanizedSummary));

  // Understanding of Assignment
  paras.push(heading1("2. Understanding of the Assignment"));
  const understandingText = tender.intakeSummary || tender.description || "We have reviewed the terms of reference and have a thorough understanding of the scope and objectives.";
  const humanizedUnderstanding = await humanize(understandingText);
  paras.push(body(humanizedUnderstanding));

  // Proposed Methodology
  paras.push(heading1("3. Proposed Methodology"));
  if (tender.evaluationMethodology) {
    const humanizedMethodology = await humanize(tender.evaluationMethodology);
    paras.push(body(humanizedMethodology));
  } else {
    paras.push(body("Our approach is structured around the following phases: mobilisation and inception, detailed analysis and fieldwork, reporting and quality review, and final submission."));
    paras.push(bullet("Phase 1 — Mobilisation and Inception: Team deployment, inception meeting, and workplan confirmation."));
    paras.push(bullet("Phase 2 — Data Collection and Analysis: Stakeholder engagement, document review, and fieldwork."));
    paras.push(bullet("Phase 3 — Reporting: Preparation of draft and final deliverables."));
    paras.push(bullet("Phase 4 — Quality Assurance: Internal peer review and validation before submission."));
  }

  // Mandatory requirements response
  const mandatory = requirements.filter((r) => r.priority === "MANDATORY" && !["FORMAT", "SUBMISSION_RULE"].includes(r.requirementType));
  if (mandatory.length > 0) {
    paras.push(heading1("4. Compliance with Mandatory Requirements"));
    for (const req of mandatory) {
      paras.push(heading2(req.title));
      paras.push(body(req.description, { color: "333333" }));
    }
  }

  // Proposed Team
  if (experts.length > 0) {
    paras.push(heading1(`${mandatory.length > 0 ? 5 : 4}. Proposed Team`));
    for (const expert of experts) {
      paras.push(heading2(expert.fullName));
      paras.push(labelValue("Position", expert.title ?? "Senior Expert"));
      if (expert.yearsExperience) paras.push(labelValue("Years of Experience", String(expert.yearsExperience)));
      const disciplines = safeParseArr(expert.disciplines);
      if (disciplines.length > 0) paras.push(labelValue("Key Disciplines", disciplines.join(", ")));
      const certs = safeParseArr(expert.certifications);
      if (certs.length > 0) paras.push(labelValue("Certifications", certs.join(", ")));
      if (expert.profile) paras.push(body(expert.profile, { color: "333333" }));
    }
  }

  // Relevant Project Experience
  const sectionNum = (mandatory.length > 0 ? 5 : 4) + (experts.length > 0 ? 1 : 0) + 1;
  if (projects.length > 0) {
    paras.push(heading1(`${sectionNum}. Relevant Project Experience`));
    for (const project of projects) {
      paras.push(heading2(project.name));
      if (project.clientName) paras.push(labelValue("Client", project.clientName));
      if (project.country) paras.push(labelValue("Country", project.country));
      if (project.sector) paras.push(labelValue("Sector", project.sector));
      if (project.contractValue) {
        paras.push(labelValue("Contract Value", `${project.currency ?? "USD"} ${project.contractValue.toLocaleString()}`));
      }
      const areas = safeParseArr(project.serviceAreas);
      if (areas.length > 0) paras.push(labelValue("Service Areas", areas.join(", ")));
      if (project.summary) paras.push(body(project.summary, { color: "333333" }));
    }
  }

  // Company Profile
  paras.push(heading1(`${sectionNum + 1}. Company Profile`));
  paras.push(body(company.profileSummary ?? company.description ?? `${company.name} is a multidisciplinary consultancy firm with extensive experience in delivering high-quality professional services.`));
  const serviceLines = safeParseArr(company.serviceLines);
  if (serviceLines.length > 0) {
    paras.push(body("Core Service Lines:", { bold: true }));
    for (const line of serviceLines) paras.push(bullet(line));
  }

  return paras;
}

function buildCVContent(expert: {
  fullName: string; title?: string | null; email?: string | null; phone?: string | null;
  yearsExperience?: number | null; disciplines: string; sectors: string; certifications: string; profile?: string | null;
}): Paragraph[] {
  const paras: Paragraph[] = [];
  paras.push(heading1("Curriculum Vitae"));
  paras.push(heading2(expert.fullName));
  if (expert.title) paras.push(labelValue("Position", expert.title));
  if (expert.email) paras.push(labelValue("Email", expert.email));
  if (expert.phone) paras.push(labelValue("Phone", expert.phone));
  if (expert.yearsExperience) paras.push(labelValue("Years of Experience", String(expert.yearsExperience)));

  const disciplines = safeParseArr(expert.disciplines);
  if (disciplines.length > 0) {
    paras.push(body("Disciplines:", { bold: true }));
    for (const d of disciplines) paras.push(bullet(d));
  }

  const sectors = safeParseArr(expert.sectors);
  if (sectors.length > 0) {
    paras.push(body("Sectors:", { bold: true }));
    for (const s of sectors) paras.push(bullet(s));
  }

  const certs = safeParseArr(expert.certifications);
  if (certs.length > 0) {
    paras.push(body("Certifications:", { bold: true }));
    for (const c of certs) paras.push(bullet(c));
  }

  if (expert.profile) {
    paras.push(body("Professional Profile:", { bold: true }));
    paras.push(body(expert.profile));
  }

  return paras;
}

function buildProjectReferenceContent(project: {
  name: string; clientName?: string | null; country?: string | null; sector?: string | null;
  contractValue?: number | null; currency?: string | null; summary?: string | null;
  serviceAreas: string; startDate?: Date | null; endDate?: Date | null;
}): Paragraph[] {
  const paras: Paragraph[] = [];
  paras.push(heading1("Project Reference Sheet"));
  paras.push(heading2(project.name));
  if (project.clientName) paras.push(labelValue("Client", project.clientName));
  if (project.country) paras.push(labelValue("Country", project.country));
  if (project.sector) paras.push(labelValue("Sector", project.sector));
  if (project.contractValue) paras.push(labelValue("Contract Value", `${project.currency ?? "USD"} ${project.contractValue.toLocaleString()}`));
  if (project.startDate) paras.push(labelValue("Start Date", new Date(project.startDate).toLocaleDateString("en-US")));
  if (project.endDate) paras.push(labelValue("Completion Date", new Date(project.endDate).toLocaleDateString("en-US")));

  const areas = safeParseArr(project.serviceAreas);
  if (areas.length > 0) {
    paras.push(body("Scope of Services:", { bold: true }));
    for (const a of areas) paras.push(bullet(a));
  }

  if (project.summary) {
    paras.push(body("Project Summary:", { bold: true }));
    paras.push(body(project.summary));
  }

  return paras;
}

function buildDeclarationContent(companyName: string, tenderTitle: string): Paragraph[] {
  return [
    heading1("Declaration"),
    body(`We, the undersigned, being duly authorized representatives of ${companyName}, hereby declare the following:`, { bold: true }),
    body(`1. We confirm that all information provided in this proposal for "${tenderTitle}" is accurate and complete to the best of our knowledge.`),
    body("2. We confirm that our organization is not debarred, suspended, or otherwise ineligible to participate in the tendering process."),
    body("3. We confirm that we have read and understood all terms, conditions, and requirements of this tender."),
    body("4. We confirm that we have no conflict of interest in relation to this assignment."),
    body("5. We commit to maintaining the confidentiality of all information received in connection with this tender."),
    new Paragraph({ spacing: { before: 480, after: 60 } }),
    body("Authorized Signatory:", { bold: true }),
    body("Name: _______________________________"),
    body("Title: _______________________________"),
    body("Signature: ___________________________"),
    body("Date: ________________________________"),
    body("Company Seal / Stamp:"),
  ];
}

function buildCompanyProfileContent(company: {
  name: string; legalName?: string | null; description?: string | null;
  profileSummary?: string | null; address?: string | null; phone?: string | null;
  email?: string | null; website?: string | null; serviceLines: string; sectors: string;
}): Paragraph[] {
  const paras: Paragraph[] = [];
  paras.push(heading1("Company Profile"));
  paras.push(heading2(company.name));
  if (company.legalName) paras.push(labelValue("Legal Name", company.legalName));
  if (company.address) paras.push(labelValue("Address", company.address));
  if (company.phone) paras.push(labelValue("Phone", company.phone));
  if (company.email) paras.push(labelValue("Email", company.email));
  if (company.website) paras.push(labelValue("Website", company.website));

  const desc = company.profileSummary ?? company.description;
  if (desc) {
    paras.push(body("About Us:", { bold: true }));
    paras.push(body(desc));
  }

  const serviceLines = safeParseArr(company.serviceLines);
  if (serviceLines.length > 0) {
    paras.push(body("Core Services:", { bold: true }));
    for (const s of serviceLines) paras.push(bullet(s));
  }

  const sectors = safeParseArr(company.sectors);
  if (sectors.length > 0) {
    paras.push(body("Sectors of Expertise:", { bold: true }));
    for (const s of sectors) paras.push(bullet(s));
  }

  return paras;
}

function buildDocxFromParagraphs(
  paragraphs: Paragraph[],
  companyName: string,
  docTitle: string,
): Document {
  return new Document({
    sections: [{
      properties: {},
      children: paragraphs,
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [new TextRun({ text: companyName, size: 18, color: "777777" })],
              alignment: AlignmentType.RIGHT,
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [new TextRun({ text: `${docTitle} — Confidential`, size: 16, color: "999999" })],
              alignment: AlignmentType.CENTER,
            }),
          ],
        }),
      },
    }],
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } },
      },
    },
  });
}

export async function generateTenderDocuments(tenderId: string, userId: string): Promise<void> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: true,
      expertMatches: { where: { isSelected: true }, include: { expert: true } },
      projectMatches: { where: { isSelected: true }, include: { project: true } },
      generatedDocuments: {
        select: { id: true, name: true, documentType: true, exactFileName: true, exactOrder: true, generationStatus: true, contentSummary: true },
      },
    },
  });

  if (!tender) throw new Error("Tender not found");

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) throw new Error("Company not found");

  const selectedExperts = tender.expertMatches.map((m) => m.expert);
  const selectedProjects = tender.projectMatches.map((m) => m.project);

  // Determine what documents to generate based on requirements
  const plannedDocs = tender.generatedDocuments.filter((d) => d.generationStatus === "PLANNED");

  // Always ensure a main proposal document exists
  const hasProposal = plannedDocs.some((d) =>
    ["PROPOSAL", "TECHNICAL_PROPOSAL", "METHODOLOGY"].includes(d.documentType),
  );

  const docsToGenerate = hasProposal
    ? plannedDocs
    : [
        {
          id: null,
          name: `${tender.title} — Technical Proposal`,
          documentType: "TECHNICAL_PROPOSAL",
          exactFileName: `${tender.title.replace(/[^a-zA-Z0-9]/g, "-")}-Technical-Proposal.docx`,
          exactOrder: 1,
          contentSummary: null,
        },
        ...plannedDocs,
      ];

  const letterheadParas = buildLetterheadHeader(company);
  const coverParas = buildCoverSection(tender.title, tender.reference, tender.clientName, company.name);

  for (const doc of docsToGenerate) {
    let contentParagraphs: Paragraph[] = [];
    let docTitle = doc.name;

    try {
      if (["TECHNICAL_PROPOSAL", "PROPOSAL", "METHODOLOGY"].includes(doc.documentType)) {
        const proposalContent = await buildProposalContent({
          tender,
          company,
          experts: selectedExperts,
          projects: selectedProjects,
          requirements: tender.requirements,
        });
        contentParagraphs = [...letterheadParas, ...coverParas, ...proposalContent];
        docTitle = doc.name;

      } else if (doc.documentType === "EXPERT" || doc.name.toLowerCase().includes("cv")) {
        const expert = selectedExperts[0];
        if (expert) {
          contentParagraphs = [...letterheadParas, ...buildCVContent(expert)];
          docTitle = `CV — ${expert.fullName}`;
        }

      } else if (doc.documentType === "PROJECT_EXPERIENCE") {
        const project = selectedProjects[0];
        if (project) {
          contentParagraphs = [...letterheadParas, ...buildProjectReferenceContent(project)];
          docTitle = `Project Reference — ${project.name}`;
        }

      } else if (doc.documentType === "DECLARATION") {
        contentParagraphs = [...letterheadParas, ...buildDeclarationContent(company.name, tender.title)];
        docTitle = "Declaration";

      } else if (doc.documentType === "COMPANY_PROFILE") {
        contentParagraphs = [...letterheadParas, ...buildCompanyProfileContent(company)];
        docTitle = "Company Profile";

      } else {
        // Generic document with letterhead and basic content
        contentParagraphs = [
          ...letterheadParas,
          heading1(doc.name),
          body(`This document forms part of the proposal package for ${tender.title}.`),
          body(`Prepared by: ${company.name}`),
          body(`Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`),
        ];
      }

      if (contentParagraphs.length === 0) continue;

      const document = buildDocxFromParagraphs(contentParagraphs, company.name, docTitle);
      const buffer = await Packer.toBuffer(document);
      const fileContent = buffer.toString("base64");

      const exactFileName =
        doc.exactFileName ??
        `${docTitle.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "-")}.docx`;

      if (doc.id) {
        await prisma.generatedDocument.update({
          where: { id: doc.id },
          data: {
            fileContent,
            exactFileName,
            generationStatus: "GENERATED",
            validationStatus: "PENDING",
            contentSummary: `Generated ${new Date().toLocaleDateString()} — ${contentParagraphs.length} sections`,
          },
        });
      } else {
        await prisma.generatedDocument.create({
          data: {
            tenderId,
            name: docTitle,
            documentType: doc.documentType,
            format: "DOCX",
            exactFileName,
            exactOrder: doc.exactOrder ?? 1,
            fileContent,
            generationStatus: "GENERATED",
            validationStatus: "PENDING",
            contentSummary: `Generated ${new Date().toLocaleDateString()} — ${contentParagraphs.length} sections`,
          },
        });
      }
    } catch (err) {
      console.error(`[generate] failed for doc "${doc.name}":`, err);
    }
  }

  // Update tender status
  await prisma.tender.update({
    where: { id: tenderId },
    data: { status: "GENERATED", stage: "GENERATION", updatedAt: new Date() },
  });
}
