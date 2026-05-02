import { AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageNumber, Paragraph, TextRun } from "docx";
import { prisma } from "../prisma";
import { buildProposalIntelligence, expertProofLine, projectProofLine } from "./proposal-intelligence";
import { exactSelectionLimit } from "./scope-policy";
import { finalizeClientReadyProposalMarkdown } from "./proposal-benchmark-guard";
import { benchmarkAuditSummary } from "./proposal-benchmark-audit";
import { buildClientProposalStrengtheningSections } from "./proposal-strengthening-sections";
import { appendEvaluatorResponseMatrix } from "./proposal-evaluator-matrix";
import { buildControlledProposalMarkdown } from "./controlled-proposal-assembler";

const BRAND_BLUE = "1F4E79";
const BRAND_GRAY = "595959";
const LIGHT_BLUE = "D9EAF7";

function para(text: string, bold = false): Paragraph {
  return new Paragraph({ children: [new TextRun({ text, bold, color: bold ? BRAND_BLUE : "222222", size: 22, font: "Calibri" })], spacing: { after: 120, line: 276 } });
}

function heading(text: string, level: 1 | 2 = 1): Paragraph {
  return new Paragraph({ text, heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, spacing: { before: level === 1 ? 360 : 240, after: 140 }, border: level === 1 ? { bottom: { color: LIGHT_BLUE, space: 1, style: BorderStyle.SINGLE, size: 8 } } : undefined });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 80, line: 260 } });
}

function clean(text?: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function cleanClientLanguage(text: string): string {
  return text
    .replace(/^#{1,3}\s*First-Page Proof Strategy\s*$/gim, "## Opening Evidence Strategy")
    .replace(/^#{1,3}\s*Evidence Control Register\s*$/gim, "## Evidence and Appendix Verification")
    .replace(/^#{1,3}\s*Submission Compliance Controls\s*$/gim, "## Submission Compliance Approach")
    .replace(/^#{1,3}\s*Final Submission Controls\s*$/gim, "## Final Submission Checklist")
    .replace(/Source-evidence action:\s*/gi, "Supporting evidence: ")
    .replace(/Bid-team confirmation:\s*/gi, "Supporting evidence: ")
    .replace(/bid-team confirmation item(s)?/gi, "source-evidence confirmation item$1")
    .replace(/bid-team-confirmed/gi, "source-confirmed")
    .replace(/bid-team verification/gi, "final verification")
    .replace(/bid-team technical review/gi, "technical review")
    .replace(/bid team/gi, "proposal team")
    .replace(/Bid team/gi, "Proposal team")
    .replace(/The final proposal should preserve a clear claim-to-evidence discipline so the proposal team can verify every major claim before export\./gi, "The proposal preserves a clear claim-to-evidence discipline so each major claim can be checked against the appendix evidence before submission.")
    .replace(/The proposal should be reviewed against the original tender before final submission\./gi, "The proposal is aligned to the original tender and supporting evidence for final submission review.")
    .replace(/must be reviewed against the original tender documents and supporting source evidence before final submission/gi, "is prepared against the original tender documents and supporting source evidence for final submission review")
    .replace(/before export/gi, "before submission")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function shortText(text?: string | null, max = 700): string {
  const value = clean(text);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function markdownToDocx(markdown: string): Paragraph[] {
  const out: Paragraph[] = [];
  const clientMarkdown = cleanClientLanguage(markdown);
  for (const raw of clientMarkdown.replace(/\r/g, "").split("\n")) {
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
  const header = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: params.companyName, bold: true, color: BRAND_BLUE, size: 18 }), new TextRun({ text: " | Technical Proposal", color: BRAND_GRAY, size: 18 })] })] });
  const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Confidential bid document | Page ", size: 16, color: BRAND_GRAY }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: BRAND_GRAY })] })] });
  return new Document({
    creator: params.companyName,
    title: params.tenderTitle,
    description: "Client-ready technical proposal generated by Hope Tender Engine",
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 850, left: 900, right: 900 } } }, headers: { default: header }, footers: { default: footer }, children: [...buildCoverBlock(params), ...params.children] }],
    styles: { default: { document: { run: { font: "Calibri", size: 22, color: "222222" }, paragraph: { spacing: { line: 276, after: 100 } } } }, paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, color: BRAND_BLUE, font: "Calibri" }, paragraph: { spacing: { before: 360, after: 160 }, border: { bottom: { color: LIGHT_BLUE, style: BorderStyle.SINGLE, size: 8, space: 1 } } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 26, bold: true, color: BRAND_BLUE, font: "Calibri" }, paragraph: { spacing: { before: 260, after: 120 } } },
    ] },
  });
}

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

  const company = await prisma.company.findUnique({ where: { userId }, include: { documents: { orderBy: { updatedAt: "desc" }, take: 24 }, legalRecords: { orderBy: { updatedAt: "desc" }, take: 12 }, financialRecords: { orderBy: { fiscalYear: "desc" }, take: 12 }, complianceRecords: { orderBy: { updatedAt: "desc" }, take: 12 } } });
  if (!company) throw new Error("Company not found");

  const experts = tender.expertMatches.map((m) => m.expert).filter((e) => e.trustLevel === "REVIEWED");
  const projects = tender.projectMatches.map((m) => m.project).filter((p) => p.trustLevel === "REVIEWED");
  const expertRequired = exactSelectionLimit(tender.requirements, "EXPERT");
  const projectRequired = exactSelectionLimit(tender.requirements, "PROJECT_EXPERIENCE");

  const intelligence = buildProposalIntelligence({ tender, company, requirements: tender.requirements, experts, projects });
  const rankedExperts = intelligence.topExperts.length ? intelligence.topExperts : experts;
  const rankedProjects = intelligence.topProjects.length ? intelligence.topProjects : projects;
  const companyEvidenceLines = buildCompanyEvidenceLines(company);
  const projectEvidenceLines = buildProjectEvidenceLines(rankedProjects as any[]);
  const proposalTitle = intelligence.assignmentName;
  const tenderText = [proposalTitle, tender.reference, intelligence.clientName, tender.description, tender.intakeSummary, tender.analysisSummary, tender.evaluationMethodology, ...tender.files.map((f) => `${f.originalFileName}\n${f.extractedText ?? ""}`)].filter(Boolean).join("\n\n");
  const requirementLines = tender.requirements.map((r) => `${r.priority} ${r.requirementType}: ${r.title} — ${r.description}`);
  const expertLines = rankedExperts.map(expertProofLine);
  const projectLines = rankedProjects.map(projectProofLine);
  const submissionNotes = [tender.submissionMethod, tender.submissionAddress, ...intelligence.submissionRules].filter(Boolean).join("\n");
  const complianceLines = [
    ...tender.complianceMatrix.map((m) => { const req = m.requirement?.title ?? m.requirement?.description ?? "Requirement evidence row"; return `${m.supportLevel}: ${req} | ${m.evidenceType} from ${m.evidenceSource}${m.evidenceReference ? ` | ref: ${m.evidenceReference}` : ""}${m.notes ? ` — ${m.notes}` : ""}`; }),
    ...companyEvidenceLines.slice(0, 14).map((line) => `Company evidence available: ${line}`),
    ...projectEvidenceLines.slice(0, 10).map((line) => `Project evidence available: ${line}`),
    ...tender.complianceGaps.map((g) => `${g.severity}: ${g.title} — ${g.mitigationPlan || g.description}`),
    ...(expertRequired > expertLines.length ? [`Senior review: add/confirm ${expertRequired - expertLines.length} expert(s) if the tender quantity is mandatory.`] : []),
    ...(projectRequired > projectLines.length ? [`Senior review: add/confirm ${projectRequired - projectLines.length} project reference(s) if the tender quantity is mandatory.`] : []),
  ];

  const guardInput = { tenderTitle: proposalTitle, clientName: intelligence.clientName, companyName: company.name, submissionNotes, expertCount: expertLines.length, projectCount: projectLines.length, complianceLines };
  const evaluatorMatrixInput = { tenderTitle: proposalTitle, clientName: intelligence.clientName, requirements: requirementLines, expertLines, projectLines, companyEvidenceLines, projectEvidenceLines, complianceLines, differentiators: intelligence.differentiators };

  const sourceMarkdown = buildControlledProposalMarkdown({
    tenderTitle: proposalTitle,
    clientName: intelligence.clientName,
    companyName: company.name,
    primarySector: intelligence.primarySector,
    requirementLines,
    expertLines,
    projectLines,
    companyEvidenceLines,
    projectEvidenceLines,
    differentiators: intelligence.differentiators,
    submissionRules: intelligence.submissionRules,
    complianceLines,
  });
  const mode = "controlled proposal assembly + deterministic benchmark finalizer";

  const matrixMarkdown = appendEvaluatorResponseMatrix(sourceMarkdown, evaluatorMatrixInput);
  const isHealthcare = /health|hospital|medical|clinic|radiology|laboratory|pharmacy|patient|healthcare|specialty|OPD|in-patient|emergency/i.test(`${proposalTitle}\n${intelligence.primarySector}\n${submissionNotes}\n${tenderText}`);
  const strengtheningMarkdown = buildClientProposalStrengtheningSections({ clientName: intelligence.clientName, tenderTitle: proposalTitle, companyName: company.name, projectLines, expertLines, companyEvidenceLines, projectEvidenceLines, isHealthcare, existingMarkdown: matrixMarkdown });
  const finalized = finalizeClientReadyProposalMarkdown([matrixMarkdown, strengtheningMarkdown].filter(Boolean).join("\n\n"), guardInput);
  const clientMarkdown = cleanClientLanguage(finalized.markdown);
  const auditSummary = benchmarkAuditSummary(clientMarkdown);
  const children = markdownToDocx(clientMarkdown);
  const doc = buildProfessionalDocument({ tenderTitle: proposalTitle, clientName: intelligence.clientName, companyName: company.name, reference: tender.reference, children });

  const fileContent = (await Packer.toBuffer(doc)).toString("base64");
  const summary = `${mode} technical proposal generated. ${finalized.internalSummary}. ${auditSummary}. Inputs: ${intelligence.requiredSections.length} section group(s), ${intelligence.themes.length} tender theme(s), ${rankedExperts.length} ranked reviewed expert(s), ${rankedProjects.length} ranked reviewed project(s), ${companyEvidenceLines.length} company evidence item(s), ${projectEvidenceLines.length} project evidence attachment(s).`;

  const target = await prisma.generatedDocument.findFirst({ where: { tenderId, documentType: { in: ["TECHNICAL_PROPOSAL", "PROPOSAL", "METHODOLOGY"] } }, orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }] });
  if (target) await prisma.generatedDocument.update({ where: { id: target.id }, data: { name: "Client-Ready Benchmark Technical Proposal", documentType: "TECHNICAL_PROPOSAL", exactFileName: target.exactFileName || "Technical-Proposal.docx", fileContent, generationStatus: "GENERATED", validationStatus: "PENDING", contentSummary: summary, updatedAt: new Date() } });
  else await prisma.generatedDocument.create({ data: { tenderId, name: "Client-Ready Benchmark Technical Proposal", documentType: "TECHNICAL_PROPOSAL", format: "DOCX", exactFileName: "Technical-Proposal.docx", exactOrder: 1, fileContent, generationStatus: "PENDING", validationStatus: "PENDING", contentSummary: summary } });

  await prisma.tender.update({ where: { id: tenderId }, data: { status: "GENERATED", stage: "GENERATION", updatedAt: new Date() } });
}
