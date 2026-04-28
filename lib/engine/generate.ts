import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Header, Footer, ImageRun,
} from "docx";
import { prisma } from "../prisma";
import { humanize } from "./humanize";
import { forbidsBranding, forbidsCoverPage, requiresCoverPage, requiresSignatureOrStamp } from "./scope-policy";

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function finalSafeText(value: string | null | undefined): string | null {
  if (!value) return null;
  let text = value;
  text = text.replace(/\[(?:AI_DRAFT|REGEX_DRAFT)[^\]]*\]\s*/gi, "");
  text = text.replace(/REVIEW REQUIRED[^\n]*/gi, "");
  text = text.replace(/before use in proposals/gi, "");
  text = text.replace(/Deterministic safety import from[^.]*\.\s*/gi, "");
  text = text.replace(/Source snippet\s*:/gi, "");
  text = text.replace(/AI draft|Regex draft|draft source|internal trace/gi, "");
  text = text.replace(/\s+/g, " ").trim();
  return text || null;
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
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun({ text: value })],
    spacing: { after: 60 },
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 40 } });
}

const HOPE_LETTERHEAD_COMPANY = "HOPE URBAN PLANNING ARCHITECTURAL AND ENGINEERING CONSULTANCY";
const HOPE_LETTERHEAD_SERVICES = "Design | Interior Design | Water Drilling | Geotechnical Investigation | Contract Administration";
const HOPE_LETTERHEAD_ADDRESS = "Head Office: A.A, Sarbet – NOC Bldg,(Beside Tamegas)  |  Nigeria: Abuja – Wuse 2, Dar Es Salaam St 22, Elion House, 4th Flr  |  South Sudan: Juba – Kololo Rd, Next to US Embassy  |  Branch: A.A, Hayahulet – MAF Bldg  |  Branch: Kombolcha, Fikir Blg";
const HOPE_LETTERHEAD_CONTACT = "hopearchitectural.com    hopeengineering83@gmail.com    +251 911 169930 / +251 921 269277";

type BrandingAsset = { data: Buffer; mimeType: string };

function imageType(mimeType: string): "png" | "jpg" {
  return mimeType.includes("png") ? "png" : "jpg";
}

function buildHopeLogoBlock(logoAsset?: BrandingAsset): Paragraph {
  if (logoAsset) {
    try {
      return new Paragraph({
        children: [new ImageRun({ data: logoAsset.data, transformation: { width: 78, height: 66 }, type: imageType(logoAsset.mimeType) })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 10 },
      });
    } catch {
      // Fall through to text logo if the uploaded image is malformed.
    }
  }

  return new Paragraph({
    children: [
      new TextRun({ text: "⬢", bold: true, size: 38, color: "0F172A" }),
      new TextRun({ text: "  HOPE", bold: true, size: 26, color: "0F172A" }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 10 },
  });
}

function buildHopeLetterheadHeader(logoAsset?: BrandingAsset): Header {
  return new Header({
    children: [
      buildHopeLogoBlock(logoAsset),
      new Paragraph({
        children: [new TextRun({ text: HOPE_LETTERHEAD_COMPANY, bold: true, size: 21, color: "0F172A", font: "Times New Roman" })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 10 },
      }),
      new Paragraph({
        children: [new TextRun({ text: HOPE_LETTERHEAD_SERVICES, size: 16, color: "606060", font: "Times New Roman", italics: true })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 55 },
        border: { bottom: { color: "000000", space: 3, style: BorderStyle.SINGLE, size: 8 } },
      }),
    ],
  });
}

function buildHopeLetterheadFooter(docTitle: string): Footer {
  return new Footer({
    children: [
      new Paragraph({
        children: [new TextRun({ text: HOPE_LETTERHEAD_ADDRESS, bold: true, size: 12, color: "111827", font: "Times New Roman" })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 30, after: 8 },
        border: { top: { color: "000000", space: 4, style: BorderStyle.SINGLE, size: 8 } },
      }),
      new Paragraph({
        children: [new TextRun({ text: HOPE_LETTERHEAD_CONTACT, bold: true, size: 13, color: "111827", font: "Times New Roman" })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 8 },
      }),
      new Paragraph({
        children: [new TextRun({ text: `${docTitle} — Confidential`, size: 10, color: "999999" })],
        alignment: AlignmentType.CENTER,
      }),
    ],
  });
}

function buildCoverSection(title: string, reference?: string | null, clientName?: string | null, companyName?: string): Paragraph[] {
  return [
    new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 56 })], alignment: AlignmentType.CENTER, spacing: { after: 120 } }),
    new Paragraph({ children: [new TextRun({ text: `Technical Proposal`, size: 32, color: "555555" })], alignment: AlignmentType.CENTER, spacing: { after: 80 } }),
    ...(reference ? [new Paragraph({ children: [new TextRun({ text: `Reference: ${reference}`, size: 24, color: "777777" })], alignment: AlignmentType.CENTER, spacing: { after: 60 } })] : []),
    ...(clientName ? [new Paragraph({ children: [new TextRun({ text: `Submitted to: ${clientName}`, size: 24, color: "777777" })], alignment: AlignmentType.CENTER, spacing: { after: 60 } })] : []),
    ...(companyName ? [new Paragraph({ children: [new TextRun({ text: `Prepared by: ${companyName}`, size: 24, color: "777777" })], alignment: AlignmentType.CENTER, spacing: { after: 60 } })] : []),
    new Paragraph({ children: [new TextRun({ text: `Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, size: 22, color: "777777" })], alignment: AlignmentType.CENTER, spacing: { after: 480 } }),
    hr(),
  ];
}

async function buildProposalContent(params: {
  tender: { title: string; description?: string | null; analysisSummary?: string | null; intakeSummary?: string | null; evaluationMethodology?: string | null };
  company: { name: string; description?: string | null; profileSummary?: string | null; serviceLines: string; sectors: string };
  experts: Array<{ fullName: string; title?: string | null; yearsExperience?: number | null; disciplines: string; certifications: string; profile?: string | null }>;
  projects: Array<{ name: string; clientName?: string | null; country?: string | null; sector?: string | null; contractValue?: number | null; currency?: string | null; summary?: string | null; serviceAreas: string }>;
  requirements: Array<{ title: string; description: string; priority: string; requirementType: string }>;
}): Promise<Paragraph[]> {
  const { tender, company, experts, projects, requirements } = params;
  const paras: Paragraph[] = [];

  paras.push(heading1("1. Executive Summary"));
  const summaryText = tender.analysisSummary || tender.description || `${company.name} submits this technical proposal for ${tender.title}.`;
  paras.push(body(await humanize(summaryText)));

  paras.push(heading1("2. Understanding of the Assignment"));
  const understandingText = tender.intakeSummary || tender.description || "We have reviewed the terms of reference and understand the scope and objectives.";
  paras.push(body(await humanize(understandingText)));

  paras.push(heading1("3. Proposed Methodology"));
  if (tender.evaluationMethodology) {
    paras.push(body(await humanize(tender.evaluationMethodology)));
  } else {
    paras.push(body("Our approach is structured around mobilisation and inception, detailed analysis and fieldwork, reporting and quality review, and final submission."));
    paras.push(bullet("Mobilisation and inception: team deployment, inception meeting, and workplan confirmation."));
    paras.push(bullet("Data collection and analysis: stakeholder engagement, document review, and fieldwork."));
    paras.push(bullet("Reporting: preparation of draft and final deliverables."));
    paras.push(bullet("Quality assurance: internal peer review and validation before submission."));
  }

  const mandatory = requirements.filter((r) => r.priority === "MANDATORY" && !["FORMAT", "SUBMISSION_RULE"].includes(r.requirementType));
  if (mandatory.length > 0) {
    paras.push(heading1("4. Compliance with Mandatory Requirements"));
    for (const req of mandatory) {
      paras.push(heading2(req.title));
      paras.push(body(req.description, { color: "333333" }));
    }
  }

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
      const profile = finalSafeText(expert.profile);
      if (profile) paras.push(body(profile, { color: "333333" }));
    }
  }

  const sectionNum = (mandatory.length > 0 ? 5 : 4) + (experts.length > 0 ? 1 : 0) + 1;
  if (projects.length > 0) {
    paras.push(heading1(`${sectionNum}. Relevant Project Experience`));
    for (const project of projects) {
      paras.push(heading2(project.name));
      if (project.clientName) paras.push(labelValue("Client", project.clientName));
      if (project.country) paras.push(labelValue("Country", project.country));
      if (project.sector) paras.push(labelValue("Sector", project.sector));
      if (project.contractValue) paras.push(labelValue("Contract Value", `${project.currency ?? "USD"} ${project.contractValue.toLocaleString()}`));
      const areas = safeParseArr(project.serviceAreas);
      if (areas.length > 0) paras.push(labelValue("Service Areas", areas.join(", ")));
      const summary = finalSafeText(project.summary);
      if (summary) paras.push(body(summary, { color: "333333" }));
    }
  }

  paras.push(heading1(`${sectionNum + 1}. Company Profile`));
  paras.push(body(company.profileSummary ?? company.description ?? `${company.name} is a multidisciplinary consultancy firm.`));
  const serviceLines = safeParseArr(company.serviceLines);
  if (serviceLines.length > 0) {
    paras.push(body("Core Service Lines:", { bold: true }));
    for (const line of serviceLines) paras.push(bullet(line));
  }

  return paras;
}

function buildCVContent(expert: { fullName: string; title?: string | null; email?: string | null; phone?: string | null; yearsExperience?: number | null; disciplines: string; sectors: string; certifications: string; profile?: string | null; }): Paragraph[] {
  const paras: Paragraph[] = [heading1("Curriculum Vitae"), heading2(expert.fullName)];
  if (expert.title) paras.push(labelValue("Position", expert.title));
  if (expert.email) paras.push(labelValue("Email", expert.email));
  if (expert.phone) paras.push(labelValue("Phone", expert.phone));
  if (expert.yearsExperience) paras.push(labelValue("Years of Experience", String(expert.yearsExperience)));
  const disciplines = safeParseArr(expert.disciplines);
  if (disciplines.length > 0) { paras.push(body("Disciplines:", { bold: true })); for (const d of disciplines) paras.push(bullet(d)); }
  const sectors = safeParseArr(expert.sectors);
  if (sectors.length > 0) { paras.push(body("Sectors:", { bold: true })); for (const s of sectors) paras.push(bullet(s)); }
  const certs = safeParseArr(expert.certifications);
  if (certs.length > 0) { paras.push(body("Certifications:", { bold: true })); for (const c of certs) paras.push(bullet(c)); }
  const profile = finalSafeText(expert.profile);
  if (profile) { paras.push(body("Professional Profile:", { bold: true })); paras.push(body(profile)); }
  return paras;
}

function buildProjectReferenceContent(project: { name: string; clientName?: string | null; country?: string | null; sector?: string | null; contractValue?: number | null; currency?: string | null; summary?: string | null; serviceAreas: string; startDate?: Date | null; endDate?: Date | null; }): Paragraph[] {
  const paras: Paragraph[] = [heading1("Project Reference Sheet"), heading2(project.name)];
  if (project.clientName) paras.push(labelValue("Client", project.clientName));
  if (project.country) paras.push(labelValue("Country", project.country));
  if (project.sector) paras.push(labelValue("Sector", project.sector));
  if (project.contractValue) paras.push(labelValue("Contract Value", `${project.currency ?? "USD"} ${project.contractValue.toLocaleString()}`));
  if (project.startDate) paras.push(labelValue("Start Date", new Date(project.startDate).toLocaleDateString("en-US")));
  if (project.endDate) paras.push(labelValue("Completion Date", new Date(project.endDate).toLocaleDateString("en-US")));
  const areas = safeParseArr(project.serviceAreas);
  if (areas.length > 0) { paras.push(body("Scope of Services:", { bold: true })); for (const a of areas) paras.push(bullet(a)); }
  const summary = finalSafeText(project.summary);
  if (summary) { paras.push(body("Project Summary:", { bold: true })); paras.push(body(summary)); }
  return paras;
}

function buildDeclarationContent(
  companyName: string,
  tenderTitle: string,
  includeSignatureAndStamp: boolean,
  signatureAsset?: BrandingAsset,
  stampAsset?: BrandingAsset,
): Paragraph[] {
  const paragraphs = [
    heading1("Declaration"),
    body(`We, the undersigned, being duly authorized representatives of ${companyName}, hereby declare the following:`, { bold: true }),
    body(`1. We confirm that all information provided in this proposal for "${tenderTitle}" is accurate and complete to the best of our knowledge.`),
    body("2. We confirm that our organization is not debarred, suspended, or otherwise ineligible to participate in the tendering process."),
    body("3. We confirm that we have read and understood all terms, conditions, and requirements of this tender."),
    body("4. We confirm that we have no conflict of interest in relation to this assignment."),
    body("5. We commit to maintaining the confidentiality of all information received in connection with this tender."),
  ];
  if (includeSignatureAndStamp) {
    paragraphs.push(
      new Paragraph({ spacing: { before: 480, after: 60 } }),
      body("Authorized Signatory:", { bold: true }),
      body("Name: _______________________________"),
      body("Title: _______________________________"),
    );
    if (signatureAsset) {
      try {
        paragraphs.push(new Paragraph({ children: [new ImageRun({ data: signatureAsset.data, transformation: { width: 120, height: 50 }, type: imageType(signatureAsset.mimeType) })], spacing: { before: 40, after: 40 } }));
      } catch { paragraphs.push(body("Signature: ___________________________")); }
    } else {
      paragraphs.push(body("Signature: ___________________________"));
    }
    paragraphs.push(body("Date: ________________________________"));
    if (stampAsset) {
      try {
        paragraphs.push(body("Company Seal / Stamp:", { bold: true }));
        paragraphs.push(new Paragraph({ children: [new ImageRun({ data: stampAsset.data, transformation: { width: 90, height: 90 }, type: imageType(stampAsset.mimeType) })], spacing: { before: 20, after: 40 } }));
      } catch { paragraphs.push(body("Company Seal / Stamp: ________________")); }
    } else {
      paragraphs.push(body("Company Seal / Stamp: ________________"));
    }
  }
  return paragraphs;
}

function buildCompanyProfileContent(company: { name: string; legalName?: string | null; description?: string | null; profileSummary?: string | null; address?: string | null; phone?: string | null; email?: string | null; website?: string | null; serviceLines: string; sectors: string; }): Paragraph[] {
  const paras: Paragraph[] = [heading1("Company Profile"), heading2(company.name)];
  if (company.legalName) paras.push(labelValue("Legal Name", company.legalName));
  if (company.address) paras.push(labelValue("Address", company.address));
  if (company.phone) paras.push(labelValue("Phone", company.phone));
  if (company.email) paras.push(labelValue("Email", company.email));
  if (company.website) paras.push(labelValue("Website", company.website));
  const desc = company.profileSummary ?? company.description;
  if (desc) { paras.push(body("About Us:", { bold: true })); paras.push(body(desc)); }
  const serviceLines = safeParseArr(company.serviceLines);
  if (serviceLines.length > 0) { paras.push(body("Core Services:", { bold: true })); for (const s of serviceLines) paras.push(bullet(s)); }
  const sectors = safeParseArr(company.sectors);
  if (sectors.length > 0) { paras.push(body("Sectors of Expertise:", { bold: true })); for (const s of sectors) paras.push(bullet(s)); }
  return paras;
}

function buildDocxFromParagraphs(paragraphs: Paragraph[], companyName: string, docTitle: string, brandingAllowed: boolean, logoAsset?: BrandingAsset): Document {
  return new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: brandingAllowed ? 1700 : 1000,
            bottom: brandingAllowed ? 1200 : 1000,
            left: 1000,
            right: 1000,
            header: 360,
            footer: 300,
          },
        },
      },
      children: paragraphs,
      ...(brandingAllowed ? { headers: { default: buildHopeLetterheadHeader(logoAsset) } } : {}),
      footers: { default: brandingAllowed ? buildHopeLetterheadFooter(docTitle) : new Footer({ children: [new Paragraph({ children: [new TextRun({ text: `${docTitle} — Confidential`, size: 16, color: "999999" })], alignment: AlignmentType.CENTER })] }) },
    }],
    styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } } },
  });
}

export async function generateTenderDocuments(tenderId: string, userId: string): Promise<void> {
  const blockingGaps = await prisma.complianceGap.findMany({
    where: { tenderId, isResolved: false, severity: { in: ["CRITICAL", "HIGH"] } },
    select: { title: true, severity: true },
  });
  if (blockingGaps.length > 0) {
    throw new Error(`Generation blocked: ${blockingGaps.length} unresolved CRITICAL/HIGH compliance gap(s) must be addressed before documents can be generated. Resolve these in the Compliance tab first: ${blockingGaps.map((g) => g.title).join("; ")}.`);
  }

  const rawExpertMatches = await prisma.tenderExpertMatch.findMany({
    where: { tenderId, isSelected: true },
    include: { expert: { select: { id: true, fullName: true, title: true, email: true, phone: true, yearsExperience: true, disciplines: true, sectors: true, certifications: true, profile: true, trustLevel: true } } },
  });
  const rawProjectMatches = await prisma.tenderProjectMatch.findMany({
    where: { tenderId, isSelected: true },
    include: { project: { select: { id: true, name: true, clientName: true, country: true, sector: true, serviceAreas: true, contractValue: true, currency: true, summary: true, startDate: true, endDate: true, trustLevel: true } } },
  });

  const unreviewedExperts = rawExpertMatches.filter((m) => m.expert.trustLevel !== "REVIEWED");
  if (unreviewedExperts.length > 0) {
    throw new Error(`Generation blocked: ${unreviewedExperts.length} selected expert(s) are not REVIEWED. Open Company Knowledge Review and verify: ${unreviewedExperts.map((m) => m.expert.fullName).join(", ")}.`);
  }
  const unreviewedProjects = rawProjectMatches.filter((m) => m.project.trustLevel !== "REVIEWED");
  if (unreviewedProjects.length > 0) {
    throw new Error(`Generation blocked: ${unreviewedProjects.length} selected project(s) are not REVIEWED. Open Company Knowledge Review and verify: ${unreviewedProjects.map((m) => m.project.name).join(", ")}.`);
  }

  const selectedExperts = rawExpertMatches.map((m) => m.expert);
  const selectedProjects = rawProjectMatches.map((m) => m.project);

  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId }, include: { requirements: true, generatedDocuments: { select: { id: true, name: true, documentType: true, exactFileName: true, exactOrder: true, generationStatus: true, contentSummary: true } } } });
  if (!tender) throw new Error("Tender not found");

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) throw new Error("Company not found");

  const activeAssets = await prisma.companyAsset.findMany({
    where: { companyId: company.id, isActive: true, assetType: { in: ["LOGO", "SIGNATURE", "STAMP"] } },
    select: { assetType: true, fileContent: true, mimeType: true },
  });
  const assetMap = Object.fromEntries(
    activeAssets
      .filter((a) => a.fileContent)
      .map((a) => [a.assetType, { data: Buffer.from(a.fileContent!, "base64"), mimeType: a.mimeType }]),
  ) as Record<string, BrandingAsset | undefined>;

  const docsToGenerate = tender.generatedDocuments.filter((d) =>
    ["PLANNED", "GENERATED", "FAILED"].includes(d.generationStatus),
  );
  if (docsToGenerate.length === 0) {
    throw new Error("Generation blocked: no output documents are defined for this tender. Run tender analysis first to detect required files.");
  }

  const brandingAllowed = !forbidsBranding(tender.requirements);
  const coverAllowed = !forbidsCoverPage(tender.requirements);
  const coverRequired = coverAllowed && requiresCoverPage(tender.requirements);
  const signatureOrStampRequired = requiresSignatureOrStamp(tender.requirements);
  const coverParas = coverRequired ? buildCoverSection(tender.title, tender.reference, tender.clientName, brandingAllowed ? company.name : undefined) : [];

  let expertIdx = 0;
  let projectIdx = 0;
  const failures: string[] = [];
  let generatedCount = 0;

  for (const doc of docsToGenerate) {
    let contentParagraphs: Paragraph[] = [];
    let docTitle = doc.name;

    try {
      if (["TECHNICAL_PROPOSAL", "PROPOSAL", "METHODOLOGY"].includes(doc.documentType)) {
        const proposalContent = await buildProposalContent({ tender, company, experts: selectedExperts, projects: selectedProjects, requirements: tender.requirements });
        contentParagraphs = [...coverParas, ...proposalContent];
        docTitle = doc.name;
      } else if (doc.documentType === "EXPERT" || doc.name.toLowerCase().includes("cv")) {
        const expert = selectedExperts[expertIdx];
        if (!expert) throw new Error(`No reviewed selected expert available for required expert document ${expertIdx + 1}.`);
        contentParagraphs = buildCVContent(expert);
        docTitle = `CV — ${expert.fullName}`;
        expertIdx++;
      } else if (doc.documentType === "PROJECT_EXPERIENCE") {
        const project = selectedProjects[projectIdx];
        if (!project) throw new Error(`No reviewed selected project available for required project document ${projectIdx + 1}.`);
        contentParagraphs = buildProjectReferenceContent(project);
        docTitle = `Project Reference — ${project.name}`;
        projectIdx++;
      } else if (doc.documentType === "DECLARATION") {
        contentParagraphs = buildDeclarationContent(company.name, tender.title, signatureOrStampRequired, assetMap["SIGNATURE"], assetMap["STAMP"]);
        docTitle = "Declaration";
      } else if (doc.documentType === "COMPANY_PROFILE") {
        contentParagraphs = buildCompanyProfileContent(company);
        docTitle = "Company Profile";
      } else {
        contentParagraphs = [
          heading1(doc.name),
          body(`This document forms part of the proposal package for ${tender.title}.`),
          ...(brandingAllowed ? [body(`Prepared by: ${company.name}`)] : []),
          body(`Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`),
        ];
      }

      if (contentParagraphs.length === 0) throw new Error("No content paragraphs were created.");

      const document = buildDocxFromParagraphs(contentParagraphs, company.name, docTitle, brandingAllowed, assetMap["LOGO"]);
      const buffer = await Packer.toBuffer(document);
      const fileContent = buffer.toString("base64");
      const exactFileName = doc.exactFileName ?? `${docTitle.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "-")}.docx`;

      if (doc.id) {
        await prisma.generatedDocument.update({ where: { id: doc.id }, data: { fileContent, exactFileName, generationStatus: "GENERATED", validationStatus: "PENDING", reviewedExpertCount: selectedExperts.length, draftExpertCount: 0, reviewedProjectCount: selectedProjects.length, draftProjectCount: 0, contentSummary: `Generated ${new Date().toLocaleDateString()} — ${contentParagraphs.length} sections | ✓ All selected sources REVIEWED | letterhead ${brandingAllowed ? "Hope header/footer applied" : "disabled by tender rules"} | cover ${coverRequired ? "included" : "not included"}` } });
      } else {
        await prisma.generatedDocument.create({ data: { tenderId, name: docTitle, documentType: doc.documentType, format: "DOCX", exactFileName, exactOrder: doc.exactOrder ?? 1, fileContent, generationStatus: "GENERATED", validationStatus: "PENDING", reviewedExpertCount: selectedExperts.length, draftExpertCount: 0, reviewedProjectCount: selectedProjects.length, draftProjectCount: 0, contentSummary: `Generated ${new Date().toLocaleDateString()} — ${contentParagraphs.length} sections | ✓ All selected sources REVIEWED | letterhead ${brandingAllowed ? "Hope header/footer applied" : "disabled by tender rules"} | cover ${coverRequired ? "included" : "not included"}` } });
      }
      generatedCount++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${doc.name}: ${message}`);
      console.error(`[generate] failed for doc "${doc.name}":`, err);
    }
  }

  if (generatedCount === 0 || failures.length > 0) {
    throw new Error(`Generation incomplete. Generated ${generatedCount}/${docsToGenerate.length} document(s). ${failures.join(" | ")}`);
  }

  await prisma.tender.update({ where: { id: tenderId }, data: { status: "GENERATED", stage: "GENERATION", updatedAt: new Date() } });
}
