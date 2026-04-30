import { AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageNumber, Paragraph, TextRun } from "docx";
import { prisma } from "../prisma";
import { generateBenchmarkProposalWithAI, isAIEnabled } from "../ai";
import { buildProposalIntelligence, expertProofLine, projectProofLine, safeParseArr } from "./proposal-intelligence";
import { exactSelectionLimit } from "./scope-policy";
import { finalizeClientReadyProposalMarkdown } from "./proposal-benchmark-guard";
import { appendEvaluatorResponseMatrix } from "./proposal-evaluator-matrix";

const BRAND_BLUE = "1F4E79";
const BRAND_GRAY = "595959";
const LIGHT_BLUE = "D9EAF7";

function para(text: string, bold = false): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold, color: bold ? BRAND_BLUE : "222222", size: 22, font: "Calibri" })],
    spacing: { after: 120, line: 276 },
  });
}

function heading(text: string, level: 1 | 2 = 1): Paragraph {
  return new Paragraph({
    text,
    heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    spacing: { before: level === 1 ? 360 : 240, after: 140 },
    border: level === 1 ? { bottom: { color: LIGHT_BLUE, space: 1, style: BorderStyle.SINGLE, size: 8 } } : undefined,
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    text,
    bullet: { level: 0 },
    spacing: { after: 80, line: 260 },
  });
}

function clean(text?: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function shortText(text?: string | null, max = 700): string {
  const value = clean(text);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
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

function fallbackProposalMarkdown(params: {
  tenderTitle: string;
  clientName: string;
  companyName: string;
  primarySector: string;
  requirements: string[];
  differentiators: string[];
  submissionRules: string[];
  expertLines: string[];
  projectLines: string[];
  companyEvidenceLines: string[];
  projectEvidenceLines: string[];
  complianceLines: string[];
  expertRequired: number;
  projectRequired: number;
}): string {
  const expertSelected = params.expertLines.length;
  const projectSelected = params.projectLines.length;
  const lines: string[] = [];
  lines.push("# Cover Letter", `To: ${params.clientName}`, `Subject: Technical Proposal for ${params.tenderTitle}`, `${params.companyName} is pleased to submit this technical proposal. The response is structured around the tender requirements, selected evidence, evaluation criteria, and senior bid-review actions.`);
  lines.push(...params.submissionRules.map((x) => `- ${x}`));
  lines.push("# Technical Proposal", params.tenderTitle, `Client: ${params.clientName}`, `Prepared by: ${params.companyName}`, `Primary sector: ${params.primarySector}`);
  lines.push("# Table of Contents", ...["Cover Letter", "Technical Proposal", "Executive Summary", "Company Profile", "Proposed Team", "Relevant Experience", "Technical Approach", "Compliance and Bid Review Strategy", "Appendix Register", "Declaration"].map((item, i) => `${i + 1}. ${item}`));
  lines.push("# Executive Summary", `${params.companyName} understands this opportunity as a ${params.primarySector.toLowerCase()} assignment requiring a persuasive, evidence-led response rather than a generic company profile. The proposal maps the strongest reviewed company evidence to the client's scope, risks, evaluation criteria, and submission requirements.`);
  lines.push(...params.differentiators.map((x) => `- ${x}`));
  lines.push("## Company Evidence Base", ...(params.companyEvidenceLines.length ? params.companyEvidenceLines.slice(0, 12).map((x) => `- ${x}`) : ["- Wider company evidence documents should be confirmed before final submission."]));
  lines.push("# Company Profile", `${params.companyName} is presented through the company evidence and service lines uploaded to the application.`);
  lines.push("# Proposed Team", ...(params.expertLines.length ? params.expertLines.map((x) => `- ${x}`) : ["- No reviewed expert record selected yet; review and select CVs before final submission."]));
  lines.push("# Relevant Experience", ...(params.projectLines.length ? params.projectLines.map((x) => `- ${x}`) : ["- No reviewed project reference selected yet; review and select project references before final submission."]));
  if (params.projectEvidenceLines.length) lines.push("## Project Evidence Attachments", ...params.projectEvidenceLines.slice(0, 12).map((x) => `- ${x}`));
  lines.push("# Technical Approach", ...params.requirements.slice(0, 10).map((r) => `- Response strategy: ${r}`));
  lines.push("# Compliance and Bid Review Strategy", "The proposal proceeds with the strongest reviewed evidence and surfaces any remaining evidence balance as a senior bid-review item instead of hiding or inventing missing information.");
  if (params.expertRequired > expertSelected) lines.push(`- Tender appears to request ${params.expertRequired} expert(s); ${expertSelected} reviewed expert(s) are selected. Add/confirm ${params.expertRequired - expertSelected} expert(s) before final submission if the number is mandatory.`);
  if (params.projectRequired > projectSelected) lines.push(`- Tender appears to request ${params.projectRequired} project reference(s); ${projectSelected} reviewed reference(s) are selected. Add/confirm ${params.projectRequired - projectSelected} reference(s) before final submission if mandatory.`);
  lines.push(...params.complianceLines.slice(0, 20).map((x) => `- ${x}`));
  lines.push("# Appendix Register", "- Appendices should include registration, support documents, CVs, project evidence, photos/drawings, certificates, and declarations required by the tender.");
  lines.push("# Declaration", `We confirm this proposal has been prepared for ${params.tenderTitle} using reviewed evidence and senior bid-review controls.`);
  return lines.join("\n\n");
}

function buildCompanyEvidenceLines(company: any): string[] {
  const documentLines = (company.documents ?? []).filter((doc: any) => clean(doc.extractedText).length > 20 || clean(doc.originalFileName).length > 0).slice(0, 18).map((doc: any) => `Company document: ${doc.originalFileName} | category: ${doc.category} | evidence: ${shortText(doc.extractedText, 850)}`);
  const legalLines = (company.legalRecords ?? []).slice(0, 8).map((record: any) => `Legal evidence: ${record.title} | type: ${record.recordType}${record.authority ? ` | authority: ${record.authority}` : ""}${record.referenceNumber ? ` | ref: ${record.referenceNumber}` : ""}${record.status ? ` | status: ${record.status}` : ""}`);
  const financialLines = (company.financialRecords ?? []).slice(0, 8).map((record: any) => `Financial evidence: ${record.recordType} ${record.fiscalYear}${record.amount ? ` | amount: ${record.currency ?? ""} ${record.amount}` : ""}${record.notes ? ` | notes: ${shortText(record.notes, 240)}` : ""}`);
  const complianceLines = (company.complianceRecords ?? []).slice(0, 10).map((record: any) => `Compliance evidence: ${record.title} | type: ${record.complianceType}${record.status ? ` | status: ${record.status}` : ""}${record.referenceNumber ? ` | ref: ${record.referenceNumber}` : ""}${record.evidenceSummary ? ` | ${shortText(record.evidenceSummary, 360)}` : ""}`);
  return [...documentLines, ...legalLines, ...financialLines, ...complianceLines].filter(Boolean);
}

function buildProjectEvidenceLines(projects: any[]): string[] {
  return projects.flatMap((project: any) => (project.evidences ?? []).slice(0, 5).map((evidence: any) => `Project evidence for ${project.name}: ${evidence.title} | type: ${evidence.evidenceType}${evidence.fileName ? ` | file: ${evidence.fileName}` : ""}${evidence.description ? ` | ${shortText(evidence.description, 280)}` : ""}${evidence.extractedText ? ` | text: ${shortText(evidence.extractedText, 520)}` : ""}`)).slice(0, 30);
}

function buildCoverBlock(params: { tenderTitle: string; clientName: string; companyName: string; reference?: string | null }): Paragraph[] {
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 260 }, children: [new TextRun({ text: "TECHNICAL PROPOSAL", bold: true, size: 44, color: BRAND_BLUE, font: "Calibri" })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: params.tenderTitle, bold: true, size: 32, color: "222222", font: "Calibri" })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: `Client: ${params.clientName}`, size: 24, color: BRAND_GRAY, font: "Calibri" })] }),
    ...(params.reference ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: `Reference: ${params.reference}`, size: 22, color: BRAND_GRAY, font: "Calibri" })] })] : []),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: [new TextRun({ text: `Prepared by ${params.companyName}`, size: 24, bold: true, color: BRAND_BLUE, font: "Calibri" })] }),
    new Paragraph({ border: { bottom: { color: BRAND_BLUE, style: BorderStyle.SINGLE, size: 12, space: 1 } }, spacing: { after: 300 }, children: [new TextRun("")] }),
  ];
}

function buildProfessionalDocument(params: { tenderTitle: string; clientName: string; companyName: string; reference?: string | null; children: Paragraph[] }): Document {
  const header = new Header({
    children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: params.companyName, bold: true, color: BRAND_BLUE, size: 18 }), new TextRun({ text: " | Technical Proposal", color: BRAND_GRAY, size: 18 })] })],
  });
  const footer = new Footer({
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Confidential bid document | Page ", size: 16, color: BRAND_GRAY }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: BRAND_GRAY })] })],
  });
  return new Document({
    creator: params.companyName,
    title: params.tenderTitle,
    description: "Client-ready technical proposal generated by Hope Tender Engine",
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 850, left: 900, right: 900 } } },
      headers: { default: header },
      footers: { default: footer },
      children: [...buildCoverBlock(params), ...params.children],
    }],
    styles: {
      default: { document: { run: { font: "Calibri", size: 22, color: "222222" }, paragraph: { spacing: { line: 276, after: 100 } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, color: BRAND_BLUE, font: "Calibri" }, paragraph: { spacing: { before: 360, after: 160 }, border: { bottom: { color: LIGHT_BLUE, style: BorderStyle.SINGLE, size: 8, space: 1 } } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 26, bold: true, color: BRAND_BLUE, font: "Calibri" }, paragraph: { spacing: { before: 260, after: 120 } } },
      ],
    },
  });
}

const BENCHMARK_CONTEXT_LINES = [
  "MANDATORY BENCHMARK STRUCTURE: Cover Letter; Technical Proposal; Table of Contents; Executive Summary; Company Profile; Proposed Team; Relevant Experience; Technical Approach; Compliance and Bid Review Strategy; Additional Information; Appendix Register; Declaration.",
  "FIRST-DRAFT QUALITY RULE: The first AI draft must contain the benchmark structure, evaluator-facing narrative, evidence mapping, methodology depth, compliance strategy, appendix register, and final declaration.",
  "EVIDENCE RULE: Use only provided experts, projects, company documents, legal records, financial records, compliance records, project evidence, compliance rows, and tender text. If evidence is missing, state it as a bid-team confirmation item, not as a fake claim.",
  "CLIENT-READY RULE: Do not write internal benchmark review, auto-repair, debug, AI fallback, or quality-score sections inside the client proposal document.",
];

export async function generateTenderDocuments(tenderId: string, userId: string): Promise<void> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: true,
      files: { select: { originalFileName: true, extractedText: true } },
      expertMatches: { where: { isSelected: true }, include: { expert: true }, orderBy: { score: "desc" } },
      projectMatches: { where: { isSelected: true }, include: { project: { include: { evidences: { orderBy: { createdAt: "desc" }, take: 5 } } } }, orderBy: { score: "desc" } },
      complianceGaps: { where: { isResolved: false }, orderBy: { severity: "asc" } },
      complianceMatrix: { include: { requirement: { select: { title: true, description: true } } } },
    },
  });
  if (!tender) throw new Error("Tender not found");

  const company = await prisma.company.findUnique({
    where: { userId },
    include: {
      documents: { orderBy: { updatedAt: "desc" }, take: 24 },
      legalRecords: { orderBy: { updatedAt: "desc" }, take: 12 },
      financialRecords: { orderBy: { fiscalYear: "desc" }, take: 12 },
      complianceRecords: { orderBy: { updatedAt: "desc" }, take: 12 },
    },
  });
  if (!company) throw new Error("Company not found");

  const experts = tender.expertMatches.map((m) => m.expert).filter((e) => e.trustLevel === "REVIEWED");
  const projects = tender.projectMatches.map((m) => m.project).filter((p) => p.trustLevel === "REVIEWED");
  const companyEvidenceLines = buildCompanyEvidenceLines(company);
  const projectEvidenceLines = buildProjectEvidenceLines(projects);
  const expertRequired = exactSelectionLimit(tender.requirements, "EXPERT");
  const projectRequired = exactSelectionLimit(tender.requirements, "PROJECT_EXPERIENCE");

  const intelligence = buildProposalIntelligence({ tender, company, requirements: tender.requirements, experts, projects });
  const tenderText = [tender.title, tender.reference, tender.clientName, tender.description, tender.intakeSummary, tender.analysisSummary, tender.evaluationMethodology, ...tender.files.map((f) => `${f.originalFileName}\n${f.extractedText ?? ""}`)].filter(Boolean).join("\n\n");
  const requirementLines = tender.requirements.map((r) => `${r.priority} ${r.requirementType}: ${r.title} — ${r.description}`);
  const expertLines = experts.map(expertProofLine);
  const projectLines = projects.map(projectProofLine);
  const evidenceContextLines = [...companyEvidenceLines, ...projectEvidenceLines];
  const submissionNotes = [tender.submissionMethod, tender.submissionAddress, ...intelligence.submissionRules].filter(Boolean).join("\n");
  const complianceLines = [
    ...tender.complianceMatrix.map((m) => {
      const req = m.requirement?.title ?? m.requirement?.description ?? "Requirement evidence row";
      return `${m.supportLevel}: ${req} | ${m.evidenceType} from ${m.evidenceSource}${m.evidenceReference ? ` | ref: ${m.evidenceReference}` : ""}${m.notes ? ` — ${m.notes}` : ""}`;
    }),
    ...companyEvidenceLines.slice(0, 14).map((line) => `Company evidence available: ${line}`),
    ...projectEvidenceLines.slice(0, 10).map((line) => `Project evidence available: ${line}`),
    ...tender.complianceGaps.map((g) => `${g.severity}: ${g.title} — ${g.mitigationPlan || g.description}`),
    ...(expertRequired > expertLines.length ? [`Senior review: add/confirm ${expertRequired - expertLines.length} expert(s) if the tender quantity is mandatory.`] : []),
    ...(projectRequired > projectLines.length ? [`Senior review: add/confirm ${projectRequired - projectLines.length} project reference(s) if the tender quantity is mandatory.`] : []),
  ];

  const guardInput = { tenderTitle: tender.title, clientName: intelligence.clientName, companyName: company.name, submissionNotes, expertCount: expertLines.length, projectCount: projectLines.length, complianceLines };
  const evaluatorMatrixInput = { tenderTitle: tender.title, clientName: intelligence.clientName, requirements: requirementLines, expertLines, projectLines, companyEvidenceLines, projectEvidenceLines, complianceLines, differentiators: intelligence.differentiators };

  let sourceMarkdown: string;
  let mode = "deterministic benchmark";
  let aiError: string | null = null;

  if (isAIEnabled()) {
    try {
      sourceMarkdown = await generateBenchmarkProposalWithAI({
        tenderTitle: tender.title,
        clientName: intelligence.clientName,
        tenderText: [BENCHMARK_CONTEXT_LINES.join("\n"), tenderText].join("\n\n"),
        analysisSummary: clean(tender.analysisSummary) || intelligence.tenderText.slice(0, 2000),
        evaluationMethodology: clean(tender.evaluationMethodology) || intelligence.evaluationCriteria.join("; "),
        submissionNotes: [BENCHMARK_CONTEXT_LINES.join("\n"), submissionNotes].filter(Boolean).join("\n"),
        requirements: [...BENCHMARK_CONTEXT_LINES, ...requirementLines].join("\n"),
        companyProfile: `${company.name}\n${company.legalName ?? ""}\n${company.profileSummary ?? company.description ?? ""}\nServices: ${safeParseArr(company.serviceLines).join(", ")}\nSectors: ${safeParseArr(company.sectors).join(", ")}\n\nWider company evidence library:\n${evidenceContextLines.join("\n").slice(0, 18_000)}`,
        experts: expertLines.join("\n"),
        projects: [...projectLines, ...projectEvidenceLines].join("\n"),
        compliance: [...BENCHMARK_CONTEXT_LINES, ...complianceLines].join("\n"),
        differentiators: [...BENCHMARK_CONTEXT_LINES, ...intelligence.differentiators, ...companyEvidenceLines.slice(0, 8)].join("\n"),
      });
      mode = "AI bid-writer + evaluator response matrix + full evidence library + client-ready benchmark finalizer + professional DOCX polish";
    } catch (error) {
      aiError = error instanceof Error ? error.message : String(error);
      sourceMarkdown = fallbackProposalMarkdown({ tenderTitle: tender.title, clientName: intelligence.clientName, companyName: company.name, primarySector: intelligence.primarySector, requirements: requirementLines, differentiators: intelligence.differentiators, submissionRules: intelligence.submissionRules, expertLines, projectLines, companyEvidenceLines, projectEvidenceLines, complianceLines, expertRequired, projectRequired });
      mode = "deterministic benchmark fallback + evaluator response matrix + client-ready benchmark finalizer + professional DOCX polish";
    }
  } else {
    sourceMarkdown = fallbackProposalMarkdown({ tenderTitle: tender.title, clientName: intelligence.clientName, companyName: company.name, primarySector: intelligence.primarySector, requirements: requirementLines, differentiators: intelligence.differentiators, submissionRules: intelligence.submissionRules, expertLines, projectLines, companyEvidenceLines, projectEvidenceLines, complianceLines, expertRequired, projectRequired });
  }

  const matrixMarkdown = appendEvaluatorResponseMatrix(sourceMarkdown, evaluatorMatrixInput);
  const finalized = finalizeClientReadyProposalMarkdown(matrixMarkdown, guardInput);
  const children = markdownToDocx(finalized.markdown);
  const doc = buildProfessionalDocument({ tenderTitle: tender.title, clientName: intelligence.clientName, companyName: company.name, reference: tender.reference, children });

  const fileContent = (await Packer.toBuffer(doc)).toString("base64");
  const summary = `${mode} technical proposal generated. ${finalized.internalSummary}. Inputs: ${intelligence.requiredSections.length} section group(s), ${intelligence.themes.length} tender theme(s), ${experts.length} reviewed expert(s), ${projects.length} reviewed project(s), ${companyEvidenceLines.length} company evidence item(s), ${projectEvidenceLines.length} project evidence attachment(s).${aiError ? ` AI fallback reason: ${aiError}` : ""}`;

  const target = await prisma.generatedDocument.findFirst({ where: { tenderId, documentType: { in: ["TECHNICAL_PROPOSAL", "PROPOSAL", "METHODOLOGY"] } }, orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }] });
  if (target) {
    await prisma.generatedDocument.update({ where: { id: target.id }, data: { name: "Client-Ready Benchmark Technical Proposal", documentType: "TECHNICAL_PROPOSAL", exactFileName: target.exactFileName || "Technical-Proposal.docx", fileContent, generationStatus: "GENERATED", validationStatus: "PENDING", contentSummary: summary, updatedAt: new Date() } });
  } else {
    await prisma.generatedDocument.create({ data: { tenderId, name: "Client-Ready Benchmark Technical Proposal", documentType: "TECHNICAL_PROPOSAL", format: "DOCX", exactFileName: "Technical-Proposal.docx", exactOrder: 1, fileContent, generationStatus: "GENERATED", validationStatus: "PENDING", contentSummary: summary } });
  }

  await prisma.tender.update({ where: { id: tenderId }, data: { status: "GENERATED", stage: "GENERATION", updatedAt: new Date() } });
}
