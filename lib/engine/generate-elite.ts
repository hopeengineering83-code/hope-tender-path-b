import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { prisma } from "../prisma";
import { generateBenchmarkProposalWithAI, isAIEnabled } from "../ai";
import { buildProposalIntelligence, expertProofLine, projectProofLine, safeParseArr } from "./proposal-intelligence";
import { exactSelectionLimit } from "./scope-policy";
import { enforceBenchmarkProposalMarkdown } from "./proposal-benchmark-guard";

function para(text: string, bold = false): Paragraph {
  return new Paragraph({ children: [new TextRun({ text, bold })], spacing: { after: 100 } });
}

function heading(text: string, level: 1 | 2 = 1): Paragraph {
  return new Paragraph({ text, heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, spacing: { before: 260, after: 100 } });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 60 } });
}

function clean(text?: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function markdownToDocx(markdown: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const raw of markdown.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("### ")) out.push(heading(line.slice(4).replace(/\*\*/g, ""), 2));
    else if (line.startsWith("## ")) out.push(heading(line.slice(3).replace(/\*\*/g, ""), 1));
    else if (line.startsWith("# ")) out.push(heading(line.slice(2).replace(/\*\*/g, ""), 1));
    else if (/^[-*•]\s+/.test(line)) out.push(bullet(line.replace(/^[-*•]\s+/, "").replace(/\*\*/g, "")));
    else if (/^\d+[.)]\s+/.test(line)) out.push(bullet(line.replace(/^\d+[.)]\s+/, "").replace(/\*\*/g, "")));
    else out.push(para(line.replace(/\*\*/g, "")));
  }
  return out.length > 0 ? out : [para("No proposal content was generated.")];
}

function fallbackProposal(params: {
  tenderTitle: string;
  clientName: string;
  companyName: string;
  primarySector: string;
  requirements: string[];
  differentiators: string[];
  submissionRules: string[];
  expertLines: string[];
  projectLines: string[];
  complianceLines: string[];
  expertRequired: number;
  projectRequired: number;
}): Paragraph[] {
  const expertSelected = params.expertLines.length;
  const projectSelected = params.projectLines.length;
  return [
    heading("Cover Letter"),
    para(`To: ${params.clientName}`),
    para(`Subject: Technical Proposal for ${params.tenderTitle}`, true),
    para(`${params.companyName} is pleased to submit this technical proposal. The response is structured around the tender requirements, selected evidence, evaluation criteria, and senior bid-review actions.`),
    ...params.submissionRules.map(bullet),
    heading("Technical Proposal"),
    para(params.tenderTitle, true),
    para(`Client: ${params.clientName}`),
    para(`Primary sector: ${params.primarySector}`),
    heading("Table of Contents"),
    ...["Cover Letter", "Technical Proposal", "Executive Summary", "Company Profile", "Proposed Team", "Relevant Experience", "Technical Approach", "Compliance and Bid Review Strategy", "Appendix Register", "Declaration"].map((item, i) => bullet(`${i + 1}. ${item}`)),
    heading("Executive Summary"),
    para(`${params.companyName} understands this opportunity as a ${params.primarySector.toLowerCase()} assignment requiring a persuasive, evidence-led response rather than a generic company profile. The proposal maps the strongest reviewed company evidence to the client's scope, risks, evaluation criteria, and submission requirements.`),
    ...params.differentiators.map(bullet),
    heading("Compliance and Bid Review Strategy", 2),
    para("The proposal proceeds with the strongest reviewed evidence and surfaces any remaining evidence balance as a senior bid-review item instead of hiding or inventing missing information."),
    ...(params.expertRequired > expertSelected ? [bullet(`Tender appears to request ${params.expertRequired} expert(s); ${expertSelected} reviewed expert(s) are selected. Add/confirm ${params.expertRequired - expertSelected} expert(s) before final submission if the number is mandatory.`)] : []),
    ...(params.projectRequired > projectSelected ? [bullet(`Tender appears to request ${params.projectRequired} project reference(s); ${projectSelected} reviewed reference(s) are selected. Add/confirm ${params.projectRequired - projectSelected} reference(s) before final submission if mandatory.`)] : []),
    heading("Company Profile"),
    para(`${params.companyName} is presented through the company evidence and service lines uploaded to the application.`),
    heading("Proposed Team"),
    ...(params.expertLines.length ? params.expertLines.map(bullet) : [bullet("No reviewed expert record selected yet; review and select CVs before final submission.")]),
    heading("Relevant Experience"),
    ...(params.projectLines.length ? params.projectLines.map(bullet) : [bullet("No reviewed project reference selected yet; review and select project references before final submission.")]),
    heading("Technical Approach"),
    ...params.requirements.slice(0, 10).map((r) => bullet(`Response strategy: ${r}`)),
    heading("Compliance Matrix and Review Items"),
    ...params.complianceLines.slice(0, 18).map(bullet),
    heading("Appendix Register"),
    bullet("Appendices should include registration, support documents, CVs, project evidence, photos/drawings, certificates, and declarations required by the tender."),
    heading("Declaration"),
    para(`We confirm this proposal has been prepared for ${params.tenderTitle} using reviewed evidence and senior bid-review controls.`),
  ];
}

export async function generateTenderDocuments(tenderId: string, userId: string): Promise<void> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: true,
      files: { select: { originalFileName: true, extractedText: true } },
      expertMatches: { where: { isSelected: true }, include: { expert: true }, orderBy: { score: "desc" } },
      projectMatches: { where: { isSelected: true }, include: { project: true }, orderBy: { score: "desc" } },
      complianceGaps: { where: { isResolved: false }, orderBy: { severity: "asc" } },
      complianceMatrix: { include: { requirement: { select: { title: true, description: true } } } },
    },
  });
  if (!tender) throw new Error("Tender not found");

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) throw new Error("Company not found");

  const experts = tender.expertMatches.map((m) => m.expert).filter((e) => e.trustLevel === "REVIEWED");
  const projects = tender.projectMatches.map((m) => m.project).filter((p) => p.trustLevel === "REVIEWED");
  const expertRequired = exactSelectionLimit(tender.requirements, "EXPERT");
  const projectRequired = exactSelectionLimit(tender.requirements, "PROJECT_EXPERIENCE");

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
    experts,
    projects,
  });

  const tenderText = [
    tender.title,
    tender.reference,
    tender.clientName,
    tender.description,
    tender.intakeSummary,
    tender.analysisSummary,
    tender.evaluationMethodology,
    ...tender.files.map((f) => `${f.originalFileName}\n${f.extractedText ?? ""}`),
  ].filter(Boolean).join("\n\n");

  const requirementLines = tender.requirements.map((r) => `${r.priority} ${r.requirementType}: ${r.title} — ${r.description}`);
  const expertLines = experts.map(expertProofLine);
  const projectLines = projects.map(projectProofLine);
  const submissionNotes = [tender.submissionMethod, tender.submissionAddress, ...intelligence.submissionRules].filter(Boolean).join("\n");
  const complianceLines = [
    ...tender.complianceMatrix.map((m) => {
      const req = m.requirement?.title ?? m.requirement?.description ?? "Requirement evidence row";
      return `${m.supportLevel}: ${req} | ${m.evidenceType} from ${m.evidenceSource}${m.evidenceReference ? ` | ref: ${m.evidenceReference}` : ""}${m.notes ? ` — ${m.notes}` : ""}`;
    }),
    ...tender.complianceGaps.map((g) => `${g.severity}: ${g.title} — ${g.mitigationPlan || g.description}`),
    ...(expertRequired > expertLines.length ? [`Senior review: add/confirm ${expertRequired - expertLines.length} expert(s) if the tender quantity is mandatory.`] : []),
    ...(projectRequired > projectLines.length ? [`Senior review: add/confirm ${projectRequired - projectLines.length} project reference(s) if the tender quantity is mandatory.`] : []),
  ];

  let children: Paragraph[] = [];
  let mode = "deterministic benchmark";

  if (isAIEnabled()) {
    try {
      const markdown = await generateBenchmarkProposalWithAI({
        tenderTitle: tender.title,
        clientName: intelligence.clientName,
        tenderText,
        analysisSummary: clean(tender.analysisSummary) || intelligence.tenderText.slice(0, 2000),
        evaluationMethodology: clean(tender.evaluationMethodology) || intelligence.evaluationCriteria.join("; "),
        submissionNotes,
        requirements: requirementLines.join("\n"),
        companyProfile: `${company.name}\n${company.legalName ?? ""}\n${company.profileSummary ?? company.description ?? ""}\nServices: ${safeParseArr(company.serviceLines).join(", ")}\nSectors: ${safeParseArr(company.sectors).join(", ")}`,
        experts: expertLines.join("\n"),
        projects: projectLines.join("\n"),
        compliance: complianceLines.join("\n"),
        differentiators: intelligence.differentiators.join("\n"),
      });
      const guardedMarkdown = enforceBenchmarkProposalMarkdown(markdown, {
        tenderTitle: tender.title,
        clientName: intelligence.clientName,
        companyName: company.name,
        submissionNotes,
        expertCount: expertLines.length,
        projectCount: projectLines.length,
        complianceLines,
      });
      children = markdownToDocx(guardedMarkdown);
      mode = "AI bid-writer + benchmark guard";
    } catch (error) {
      children = fallbackProposal({
        tenderTitle: tender.title,
        clientName: intelligence.clientName,
        companyName: company.name,
        primarySector: intelligence.primarySector,
        requirements: requirementLines,
        differentiators: intelligence.differentiators,
        submissionRules: intelligence.submissionRules,
        expertLines,
        projectLines,
        complianceLines,
        expertRequired,
        projectRequired,
      });
      children.push(heading("AI Bid Writer Fallback Note"), para(`AI bid writer unavailable: ${error instanceof Error ? error.message : String(error)}. Deterministic benchmark generator used.`));
    }
  } else {
    children = fallbackProposal({
      tenderTitle: tender.title,
      clientName: intelligence.clientName,
      companyName: company.name,
      primarySector: intelligence.primarySector,
      requirements: requirementLines,
      differentiators: intelligence.differentiators,
      submissionRules: intelligence.submissionRules,
      expertLines,
      projectLines,
      complianceLines,
      expertRequired,
      projectRequired,
    });
  }

  const doc = new Document({
    sections: [{ properties: { page: { margin: { top: 1200, bottom: 900, left: 900, right: 900 } } }, children }],
    styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } } },
  });

  const fileContent = (await Packer.toBuffer(doc)).toString("base64");
  const summary = `${mode} technical proposal generated using ${intelligence.requiredSections.length} required section group(s), ${intelligence.themes.length} tender theme(s), ${experts.length} reviewed expert(s), ${projects.length} reviewed project(s), compliance narrative, and benchmark review actions.`;

  const target = await prisma.generatedDocument.findFirst({
    where: { tenderId, documentType: { in: ["TECHNICAL_PROPOSAL", "PROPOSAL", "METHODOLOGY"] } },
    orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
  });

  if (target) {
    await prisma.generatedDocument.update({
      where: { id: target.id },
      data: { name: "AI Benchmark Technical Proposal", documentType: "TECHNICAL_PROPOSAL", exactFileName: target.exactFileName || "Technical-Proposal.docx", fileContent, generationStatus: "GENERATED", validationStatus: "PENDING", contentSummary: summary, updatedAt: new Date() },
    });
  } else {
    await prisma.generatedDocument.create({
      data: { tenderId, name: "AI Benchmark Technical Proposal", documentType: "TECHNICAL_PROPOSAL", format: "DOCX", exactFileName: "Technical-Proposal.docx", exactOrder: 1, fileContent, generationStatus: "GENERATED", validationStatus: "PENDING", contentSummary: summary },
    });
  }

  await prisma.tender.update({ where: { id: tenderId }, data: { status: "GENERATED", stage: "GENERATION", updatedAt: new Date() } });
}
