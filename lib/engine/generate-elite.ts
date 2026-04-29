import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { prisma } from "../prisma";
import { generateTenderDocuments as generateBaseTenderDocuments } from "./generate";
import { buildProposalIntelligence, expertProofLine, projectProofLine, safeParseArr } from "./proposal-intelligence";

function p(text: string, bold = false): Paragraph {
  return new Paragraph({ children: [new TextRun({ text, bold })], spacing: { after: 100 } });
}
function h1(text: string): Paragraph { return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } }); }
function h2(text: string): Paragraph { return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 80 } }); }
function bullet(text: string): Paragraph { return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 60 } }); }
function lv(label: string, value?: string | null): Paragraph | null { return value ? p(`${label}: ${value}`) : null; }
function clean(text?: string | null): string { return (text ?? "").replace(/\s+/g, " ").trim(); }
function firstSentence(text?: string | null): string { const c = clean(text); return c.split(/(?<=[.!?])\s+/)[0]?.slice(0, 420) || ""; }

function money(value?: number | null, currency?: string | null): string | null {
  if (!value) return null;
  const label = currency || "ETB";
  if (value >= 1_000_000_000) return `${label} ${(value / 1_000_000_000).toFixed(1)} billion`;
  if (value >= 1_000_000) return `${label} ${(value / 1_000_000).toFixed(1)} million`;
  return `${label} ${value.toLocaleString()}`;
}

function findHealthcareProjectCount(projects: Array<{ name: string; sector?: string | null; summary?: string | null }>): number {
  return projects.filter((project) => /hospital|health|medical|clinic|pharmacy|laboratory|radiology/i.test(`${project.name} ${project.sector ?? ""} ${project.summary ?? ""}`)).length;
}

async function buildEliteProposalDocx(tenderId: string, userId: string): Promise<{ buffer: Buffer; summary: string } | null> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: true,
      files: { select: { originalFileName: true, extractedText: true } },
      expertMatches: { where: { isSelected: true }, include: { expert: true }, orderBy: { score: "desc" } },
      projectMatches: { where: { isSelected: true }, include: { project: true }, orderBy: { score: "desc" } },
    },
  });
  if (!tender) return null;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return null;

  const selectedExperts = tender.expertMatches.map((m) => m.expert).filter((expert) => expert.trustLevel === "REVIEWED");
  const selectedProjects = tender.projectMatches.map((m) => m.project).filter((project) => project.trustLevel === "REVIEWED");

  const intelligence = buildProposalIntelligence({
    tender: {
      title: tender.title,
      reference: tender.reference,
      clientName: tender.clientName,
      country: tender.country,
      description: tender.description,
      intakeSummary: tender.intakeSummary,
      analysisSummary: tender.analysisSummary,
      evaluationMethodology: tender.evaluationMethodology,
      deadline: tender.deadline,
      submissionMethod: tender.submissionMethod,
      submissionAddress: tender.submissionAddress,
    },
    company,
    requirements: tender.requirements,
    experts: selectedExperts,
    projects: selectedProjects,
  });

  const technicalText = [tender.title, tender.description, tender.intakeSummary, tender.analysisSummary, ...tender.requirements.map((r) => `${r.title} ${r.description}`)].join("\n");
  const healthcareProjects = findHealthcareProjectCount(selectedProjects);
  const projectTotalValue = selectedProjects.reduce((sum, project) => sum + (project.contractValue ?? 0), 0);
  const serviceLines = safeParseArr(company.serviceLines).slice(0, 12);
  const sectors = safeParseArr(company.sectors).slice(0, 12);

  const coverLetter = [
    h1("Cover Letter"),
    p(`To: ${intelligence.clientName}`),
    p(`Subject: Technical Proposal for ${tender.title}`, true),
    p(`We are pleased to submit this technical proposal for ${tender.title}. The proposal is prepared around the tender's actual evaluation logic, required sections, technical scope, submission rules, and evidence expectations.`),
    p(`This submission is positioned around ${company.name}'s most relevant proof: ${healthcareProjects || selectedProjects.length} reviewed project reference(s), ${selectedExperts.length} reviewed expert profile(s), multidisciplinary engineering capacity, and documented company systems.`),
    ...intelligence.submissionRules.map((rule) => bullet(rule)),
  ];

  const coverPage = [
    h1("Technical Proposal"),
    p(tender.title, true),
    ...[lv("Client", intelligence.clientName), lv("Reference", tender.reference), lv("Primary sector", intelligence.primarySector), lv("Prepared by", company.legalName || company.name)].filter(Boolean) as Paragraph[],
    p(`Prepared on ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`),
  ];

  const executiveSummary = [
    h1("Executive Summary"),
    p(`${company.name} understands this assignment as a ${intelligence.primarySector.toLowerCase()} consultancy requiring more than generic proposal writing: it requires evidence of comparable delivery, a credible professional team, regulatory understanding, and a technical methodology mapped directly to the client's scope.`),
    p(selectedProjects.length > 0 ? `The strongest evidence base selected for this tender includes ${selectedProjects.slice(0, 3).map((project) => project.name).join(", ")}. ${projectTotalValue > 0 ? `The selected reference portfolio includes work with a combined recorded value of approximately ${money(projectTotalValue, "ETB")}.` : ""}` : "The proposal should be strengthened by selecting reviewed project references before final submission."),
    p(selectedExperts.length > 0 ? `The proposed team is built from ${selectedExperts.length} reviewed experts, including ${selectedExperts.slice(0, 6).map((expert) => expert.fullName).join(", ")}.` : "The expert team section requires reviewed CV records before final submission."),
    ...intelligence.differentiators.map((item) => bullet(item)),
  ];

  const toc = [
    h1("Table of Contents"),
    ...intelligence.requiredSections.map((section, index) => bullet(`${index + 1}. ${section}`)),
    bullet("Appendices: registration, testimony letters/contracts, CVs and credentials, photos/drawings, manuals and audited documents as required by the tender."),
  ];

  const companyProfile = [
    h1("SECTION A: COMPANY PROFILE"),
    h2("A.1 Company Background"),
    p(company.profileSummary || company.description || `${company.name} is a multidisciplinary consultancy firm.`),
    ...[lv("Legal name", company.legalName), lv("Address", company.address), lv("Email", company.email), lv("Phone", company.phone), lv("Website", company.website)].filter(Boolean) as Paragraph[],
    h2("A.2 Core Areas of Expertise"),
    ...(serviceLines.length ? serviceLines.map((line) => bullet(line)) : [bullet("Architectural, engineering, MEP, geotechnical, environmental, supervision and contract administration services.")]),
    ...(sectors.length ? [h2("A.3 Sectors Served"), ...sectors.map((sector) => bullet(sector))] : []),
  ];

  const team = [
    h2("A.4 Proposed Project Team"),
    p("The proposed team is selected for relevance to the tender scope, not as a generic staff list. Each member is mapped to the technical risks and evaluation criteria detected in the tender."),
    ...intelligence.topExperts.map((expert) => bullet(expertProofLine(expert))),
  ];

  const experience = [
    h1("SECTION B: RELEVANT EXPERIENCE"),
    p("The portfolio below prioritizes similarity to the tender's sector, technical systems, service scope, regulatory environment, and implementation risk."),
    ...intelligence.topProjects.flatMap((project, index) => [h2(`B.${index + 1} ${project.name}`), p(projectProofLine(project)), ...(firstSentence(project.summary) ? [p(`Relevance to this assignment: ${firstSentence(project.summary)}`)] : [])]),
  ];

  const methodology = [
    h1("SECTION C: TECHNICAL APPROACH"),
    h2("C.1 Understanding of the Assignment"),
    p(tender.description || tender.intakeSummary || `The assignment requires a coordinated technical proposal for ${tender.title}.`),
    h2("C.2 Evaluation Criteria Response"),
    ...(intelligence.evaluationCriteria.length ? intelligence.evaluationCriteria.map((criterion) => bullet(`${criterion}: addressed through selected evidence, team composition, methodology, and appendix proof.`)) : [bullet("Evaluation criteria were not explicitly detected; the proposal is structured around experience, technical approach, team and compliance.")]),
    ...intelligence.themes.flatMap((theme, index) => [h2(`C.${index + 3} ${theme.label}`), ...theme.methodologyBullets.map((item) => bullet(item))]),
    h2("C. Quality Assurance and Reporting"),
    bullet("Project-specific quality plan, document control, design review milestones, interdisciplinary coordination and client review cycles."),
    bullet("Progress reporting aligned to the tender's required deliverables, submission format and approval workflow."),
  ];

  const additional = [
    h1("SECTION D: ADDITIONAL INFORMATION"),
    h2("D.1 Value to the Client"),
    ...intelligence.differentiators.map((item) => bullet(item)),
    h2("D.2 Compliance and Submission Rules"),
    ...(intelligence.submissionRules.length ? intelligence.submissionRules.map((rule) => bullet(rule)) : [bullet("Final submission rules should be checked against the original tender before export.")]),
    h2("D.3 Narrative Gaps to Verify Before Final Export"),
    ...(intelligence.gapsToAddressInNarrative.length ? intelligence.gapsToAddressInNarrative.map((gap) => bullet(gap)) : [bullet("No major narrative gap detected from the selected reviewed evidence.")]),
    h2("D.4 Declaration"),
    p(`We confirm that this proposal has been prepared for ${tender.title} using reviewed company evidence and the tender requirements extracted from the uploaded tender documents.`),
  ];

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1200, bottom: 900, left: 900, right: 900 } } },
      children: [...coverLetter, ...coverPage, ...toc, ...executiveSummary, ...companyProfile, ...team, ...experience, ...methodology, ...additional],
    }],
    styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } } },
  });

  const summary = `Benchmark-quality technical proposal generated using ${intelligence.requiredSections.length} required section group(s), ${intelligence.themes.length} tender theme(s), ${intelligence.topExperts.length} expert proof line(s), and ${intelligence.topProjects.length} project proof line(s).`;
  return { buffer: await Packer.toBuffer(doc), summary };
}

export async function generateTenderDocuments(tenderId: string, userId: string): Promise<void> {
  await generateBaseTenderDocuments(tenderId, userId);
  const elite = await buildEliteProposalDocx(tenderId, userId);
  if (!elite) return;

  const target = await prisma.generatedDocument.findFirst({
    where: { tenderId, documentType: { in: ["TECHNICAL_PROPOSAL", "PROPOSAL", "METHODOLOGY"] } },
    orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
  });

  const fileContent = elite.buffer.toString("base64");
  if (target) {
    await prisma.generatedDocument.update({
      where: { id: target.id },
      data: {
        name: "Benchmark Technical Proposal",
        documentType: "TECHNICAL_PROPOSAL",
        exactFileName: target.exactFileName || "Technical-Proposal.docx",
        fileContent,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        contentSummary: elite.summary,
        updatedAt: new Date(),
      },
    });
  } else {
    await prisma.generatedDocument.create({
      data: {
        tenderId,
        name: "Benchmark Technical Proposal",
        documentType: "TECHNICAL_PROPOSAL",
        format: "DOCX",
        exactFileName: "Technical-Proposal.docx",
        exactOrder: 1,
        fileContent,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        contentSummary: elite.summary,
      },
    });
  }
}
