import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { prisma } from "../prisma";
import { generateBenchmarkProposalWithAI, isAIEnabled } from "../ai";
import { buildProposalIntelligence, expertProofLine, projectProofLine, safeParseArr } from "./proposal-intelligence";
import { exactSelectionLimit } from "./scope-policy";
import { appendBenchmarkQualityReview, enforceBenchmarkProposalMarkdown } from "./proposal-benchmark-guard";

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
  companyEvidenceLines: string[];
  projectEvidenceLines: string[];
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
    heading("Company Evidence Base", 2),
    ...(params.companyEvidenceLines.length ? params.companyEvidenceLines.slice(0, 12).map(bullet) : [bullet("No wider company evidence documents were available in the generation context.")]),
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
    ...(params.projectEvidenceLines.length ? [heading("Project Evidence Attachments", 2), ...params.projectEvidenceLines.slice(0, 12).map(bullet)] : []),
    heading("Technical Approach"),
    ...params.requirements.slice(0, 10).map((r) => bullet(`Response strategy: ${r}`)),
    heading("Compliance Matrix and Review Items"),
    ...params.complianceLines.slice(0, 20).map(bullet),
    heading("Appendix Register"),
    bullet("Appendices should include registration, support documents, CVs, project evidence, photos/drawings, certificates, and declarations required by the tender."),
    heading("Declaration"),
    para(`We confirm this proposal has been prepared for ${params.tenderTitle} using reviewed evidence and senior bid-review controls.`),
  ];
}

function buildCompanyEvidenceLines(company: any): string[] {
  const documentLines = (company.documents ?? [])
    .filter((doc: any) => clean(doc.extractedText).length > 20 || clean(doc.originalFileName).length > 0)
    .slice(0, 18)
    .map((doc: any) => `Company document: ${doc.originalFileName} | category: ${doc.category} | evidence: ${shortText(doc.extractedText, 850)}`);

  const legalLines = (company.legalRecords ?? [])
    .slice(0, 8)
    .map((record: any) => `Legal evidence: ${record.title} | type: ${record.recordType}${record.authority ? ` | authority: ${record.authority}` : ""}${record.referenceNumber ? ` | ref: ${record.referenceNumber}` : ""}${record.status ? ` | status: ${record.status}` : ""}`);

  const financialLines = (company.financialRecords ?? [])
    .slice(0, 8)
    .map((record: any) => `Financial evidence: ${record.recordType} ${record.fiscalYear}${record.amount ? ` | amount: ${record.currency ?? ""} ${record.amount}` : ""}${record.notes ? ` | notes: ${shortText(record.notes, 240)}` : ""}`);

  const complianceLines = (company.complianceRecords ?? [])
    .slice(0, 10)
    .map((record: any) => `Compliance evidence: ${record.title} | type: ${record.complianceType}${record.status ? ` | status: ${record.status}` : ""}${record.referenceNumber ? ` | ref: ${record.referenceNumber}` : ""}${record.evidenceSummary ? ` | ${shortText(record.evidenceSummary, 360)}` : ""}`);

  return [...documentLines, ...legalLines, ...financialLines, ...complianceLines].filter(Boolean);
}

function buildProjectEvidenceLines(projects: any[]): string[] {
  return projects.flatMap((project: any) => (project.evidences ?? [])
    .slice(0, 5)
    .map((evidence: any) => `Project evidence for ${project.name}: ${evidence.title} | type: ${evidence.evidenceType}${evidence.fileName ? ` | file: ${evidence.fileName}` : ""}${evidence.description ? ` | ${shortText(evidence.description, 280)}` : ""}${evidence.extractedText ? ` | text: ${shortText(evidence.extractedText, 520)}` : ""}`))
    .slice(0, 30);
}

const BENCHMARK_CONTEXT_LINES = [
  "MANDATORY BENCHMARK STRUCTURE: Cover Letter; Technical Proposal; Table of Contents; Executive Summary; Company Profile; Proposed Team; Relevant Experience; Technical Approach; Compliance and Bid Review Strategy; Additional Information; Appendix Register; Declaration.",
  "FIRST-DRAFT QUALITY RULE: Do not rely on the auto-repair guard. The first AI draft must already contain the benchmark structure, evaluator-facing narrative, evidence mapping, methodology depth, compliance strategy, appendix register, and final declaration.",
  "EVIDENCE RULE: Use only provided experts, projects, company documents, legal records, financial records, compliance records, project evidence, compliance rows, and tender text. If evidence is missing, state it as a bid-team confirmation item, not as a fake claim.",
  "METHODOLOGY RULE: Technical Approach must include phases, deliverables, QA/QC, coordination, risk management, reporting, schedule controls, and submission controls.",
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

  const guardInput = {
    tenderTitle: tender.title,
    clientName: intelligence.clientName,
    companyName: company.name,
    submissionNotes,
    expertCount: expertLines.length,
    projectCount: projectLines.length,
    complianceLines,
  };

  let children: Paragraph[] = [];
  let mode = "deterministic benchmark";
  let benchmarkScore = 0;
  let benchmarkPassed = false;
  let benchmarkGapCount = 0;

  if (isAIEnabled()) {
    try {
      const markdown = await generateBenchmarkProposalWithAI({
        tenderTitle: tender.title,
        clientName: intelligence.clientName,
        tenderText: [BENCHMARK_CONTEXT_LINES.join("\n"), tenderText].join("\n\n"),
        analysisSummary: clean(tender.analysisSummary) || intelligence.tenderText.slice(0, 2000),
        evaluationMethodology: clean(tender.evaluationMethodology) || intelligence.evaluationCriteria.join("; "),
        submissionNotes: [BENCHMARK_CONTEXT_LINES[0], submissionNotes].filter(Boolean).join("\n"),
        requirements: [...BENCHMARK_CONTEXT_LINES, ...requirementLines].join("\n"),
        companyProfile: `${company.name}\n${company.legalName ?? ""}\n${company.profileSummary ?? company.description ?? ""}\nServices: ${safeParseArr(company.serviceLines).join(", ")}\nSectors: ${safeParseArr(company.sectors).join(", ")}\n\nWider company evidence library:\n${evidenceContextLines.join("\n").slice(0, 18_000)}`,
        experts: expertLines.join("\n"),
        projects: [...projectLines, ...projectEvidenceLines].join("\n"),
        compliance: [...BENCHMARK_CONTEXT_LINES, ...complianceLines].join("\n"),
        differentiators: [...BENCHMARK_CONTEXT_LINES, ...intelligence.differentiators, ...companyEvidenceLines.slice(0, 8)].join("\n"),
      });
      const guardedMarkdown = enforceBenchmarkProposalMarkdown(markdown, guardInput);
      const reviewed = appendBenchmarkQualityReview(guardedMarkdown, guardInput);
      benchmarkScore = reviewed.score.score;
      benchmarkPassed = reviewed.score.passed;
      benchmarkGapCount = reviewed.score.gaps.length;
      children = markdownToDocx(reviewed.markdown);
      mode = "AI bid-writer + full evidence library + first-draft benchmark context + benchmark guard + quality score";
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
        companyEvidenceLines,
        projectEvidenceLines,
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
      companyEvidenceLines,
      projectEvidenceLines,
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
  const summary = `${mode} technical proposal generated. Benchmark score: ${benchmarkScore}/100 (${benchmarkPassed ? "PASS" : "NEEDS REVIEW"}); ${benchmarkGapCount} benchmark gap(s). Inputs: ${intelligence.requiredSections.length} section group(s), ${intelligence.themes.length} tender theme(s), ${experts.length} reviewed expert(s), ${projects.length} reviewed project(s), ${companyEvidenceLines.length} company evidence item(s), ${projectEvidenceLines.length} project evidence attachment(s).`;

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
