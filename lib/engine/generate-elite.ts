import { AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageNumber, Paragraph, Table, TableBorders, TableCell, TableRow, TextRun, WidthType } from "docx";
import { prisma } from "../prisma";
import { generateBenchmarkProposalWithAI, isAIEnabled } from "../ai";
import { buildProposalIntelligence, expertProofLine, projectProofLine, safeParseArr } from "./proposal-intelligence";
import { exactSelectionLimit } from "./scope-policy";
import { finalizeClientReadyProposalMarkdown } from "./proposal-benchmark-guard";
import { appendEvaluatorResponseMatrix } from "./proposal-evaluator-matrix";
import { buildClientProposalStrengtheningSections } from "./proposal-strengthening-sections";
import { benchmarkAuditSummary } from "./proposal-benchmark-audit";
import { polishBenchmarkOutput } from "./benchmark-output-polisher";
import {
  buildBenchmarkTablesBlock,
  buildClientReferencesTable,
  buildCoverLetterOpener,
  buildDeclaration,
  buildExecutiveSummaryOpener,
  buildPortfolioReadingGuide,
  buildSpecialistEngagementSection,
  buildSubmittedByToBlock,
  buildValueFrameworkTable,
  makeHasHeadingChecker,
  type ExpertRecord,
  type ProjectRecord,
} from "./benchmark-tables";
import { enforceNarrativeThroughline } from "./narrative-throughline-enforcer";
import { enrichSectorVocabulary } from "./sector-vocabulary-enricher";
import { buildPortfolioMetricsBlock, computePortfolioMetrics } from "./portfolio-metrics";
import { buildPrincipalQualificationsSection } from "./principal-qualifications";
import { buildRisksMitigationsTable } from "./risks-mitigations";
import { buildWhyUsSummary } from "./why-us-summary";
import { buildWorkPlanTable } from "./work-plan-timeline";
import { buildBidComplianceMapping } from "./bid-compliance-mapping";
import { formatQualityScoreSummary, scoreProposalQuality } from "./proposal-quality-scorer";
import {
  buildCertificationsSection,
  buildConflictOfInterestSection,
  buildInHouseCapabilitiesSection,
  buildUnderstandingSection,
  buildValueAddedServices,
} from "./understanding-and-value-added";
import { reorderToCanonicalSequence } from "./section-reorderer";
import { renderDynamicTableOfContents } from "./dynamic-toc";

const BRAND_BLUE = "1F4E79";
const BRAND_GRAY = "595959";
const LIGHT_BLUE = "D9EAF7";

function parseInlineRuns(text: string, opts?: { size?: number; color?: string; font?: string }): TextRun[] {
  const size = opts?.size ?? 22;
  const color = opts?.color ?? "222222";
  const font = opts?.font ?? "Calibri";
  const runs: TextRun[] = [];
  const boldParts = text.split(/\*\*(.+?)\*\*/gs);
  boldParts.forEach((part, i) => {
    if (!part) return;
    const isBold = i % 2 === 1;
    const italicParts = part.split(/(?:\*|_)(.+?)(?:\*|_)/gs);
    italicParts.forEach((ip, ii) => {
      if (!ip) return;
      runs.push(new TextRun({ text: ip, bold: isBold, italics: ii % 2 === 1, size, color, font }));
    });
  });
  return runs.length > 0 ? runs : [new TextRun({ text, size, color, font })];
}

function para(text: string, bold = false): Paragraph {
  return new Paragraph({
    children: bold
      ? [new TextRun({ text, bold: true, color: BRAND_BLUE, size: 22, font: "Calibri" })]
      : parseInlineRuns(text),
    spacing: { after: 120, line: 276 },
  });
}

function heading(text: string, level: 1 | 2 | 3 = 1, pageBreak = false): Paragraph {
  const headingLevel = level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
  return new Paragraph({
    text,
    heading: headingLevel,
    pageBreakBefore: level === 1 ? pageBreak : false,
    spacing: { before: level === 1 ? 360 : level === 2 ? 240 : 180, after: level === 1 ? 140 : 100 },
    border: level === 1 ? { bottom: { color: LIGHT_BLUE, space: 1, style: BorderStyle.SINGLE, size: 8 } } : undefined,
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    children: parseInlineRuns(text),
    bullet: { level: 0 },
    spacing: { after: 80, line: 260 },
  });
}

function isTableLine(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|");
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line);
}

function parseMdTable(tableLines: string[]): Table {
  const dataRows = tableLines.filter((l) => !isSeparatorRow(l));
  const colCount = Math.max(...dataRows.map((r) =>
    r.split("|").filter((_, i, arr) => i > 0 && i < arr.length - 1).length
  ), 1);
  const colWidth = Math.floor(8100 / colCount);

  const rows = dataRows.map((rowLine, rowIndex) => {
    const cells = rowLine
      .split("|")
      .filter((_, i, arr) => i > 0 && i < arr.length - 1)
      .map((cell) => cell.trim());
    const isHeader = rowIndex === 0;

    return new TableRow({
      children: Array.from({ length: colCount }, (_, ci) => {
        const cellText = cells[ci] ?? "";
        return new TableCell({
          width: { size: colWidth, type: WidthType.DXA },
          children: [new Paragraph({
            children: isHeader
              ? [new TextRun({ text: cellText.replace(/\*\*/g, ""), bold: true, size: 20, font: "Calibri", color: "FFFFFF" })]
              : parseInlineRuns(cellText, { size: 20 }),
            spacing: { after: 60 },
          })],
          shading: isHeader ? { fill: "1F4E79" } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
        });
      }),
    });
  });

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TableBorders.NONE,
  });
}

function clean(text?: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function shortText(text?: string | null, max = 700): string {
  const value = clean(text);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function cleanClientLanguage(text: string): string {
  return polishBenchmarkOutput(text
    .replace(/Bid-team confirmation:\s*/gi, "Evidence note: ")
    .replace(/bid-team confirmation item(s)?/gi, "source-evidence confirmation item$1")
    .replace(/bid-team-confirmed/gi, "source-confirmed")
    .replace(/bid-team verification/gi, "final verification")
    .replace(/bid team/gi, "proposal team")
    .replace(/Bid team/gi, "Proposal team")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim());
}

function markdownToDocx(markdown: string): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  let h1Count = 0;
  let tableBuffer: string[] = [];

  const flushTable = () => {
    if (tableBuffer.length >= 2) {
      out.push(parseMdTable(tableBuffer));
      out.push(new Paragraph({ children: [new TextRun("")], spacing: { after: 120 } }));
    }
    tableBuffer = [];
  };

  for (const raw of markdown.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();

    if (isTableLine(line)) {
      tableBuffer.push(line);
      continue;
    }
    if (tableBuffer.length > 0) flushTable();

    if (!line) continue;
    if (line.startsWith("### ")) out.push(heading(line.slice(4).replace(/\*\*/g, ""), 3));
    else if (line.startsWith("## ")) out.push(heading(line.slice(3).replace(/\*\*/g, ""), 2));
    else if (line.startsWith("# ")) { h1Count++; out.push(heading(line.slice(2).replace(/\*\*/g, ""), 1, h1Count > 1)); }
    else if (line.startsWith("> ")) out.push(new Paragraph({ children: parseInlineRuns(line.slice(2), { color: "795B00", size: 20 }), indent: { left: 360, right: 360 }, spacing: { after: 80, line: 260 }, border: { left: { color: "F59E0B", style: BorderStyle.SINGLE, size: 12, space: 4 } } }))
    else if (/^[-*•]\s+/.test(line)) out.push(bullet(line.replace(/^[-*•]\s+/, "")));
    else if (/^\d+[.)]\s+/.test(line)) out.push(bullet(line.replace(/^\d+[.)]\s+/, "")));
    else out.push(para(line));
  }
  if (tableBuffer.length > 0) flushTable();

  return out.length > 0 ? out : [para("No proposal content was generated.")];
}

function fallbackProposalMarkdown(params: {
  tenderTitle: string;
  clientName: string;
  companyName: string;
  companyAddress?: string | null;
  primarySector: string;
  requirements: string[];
  differentiators: string[];
  submissionRules: string[];
  expertLines: string[];
  projectLines: string[];
  // Round-3: real records flow through so the openers can use ETB values and project names
  experts?: ExpertRecord[];
  projects?: ProjectRecord[];
  reviewedExpertCount?: number;
  companyEvidenceLines: string[];
  projectEvidenceLines: string[];
  complianceLines: string[];
  expertRequired: number;
  projectRequired: number;
  themes?: import("./proposal-intelligence").ProposalTheme[];
  evaluationCriteria?: string[];
  appendixList?: string[];
  noFinancialProposal?: boolean;
  exactEmails?: string[];
  exactSubjectLine?: string | null;
  gapsToAddressInNarrative?: string[];
  requiredSections?: string[];
  tenderDeadline?: Date | string | null;
}): string {
  const expertSelected = params.expertLines.length;
  const projectSelected = params.projectLines.length;
  const themes = params.themes ?? [];
  const evalCriteria = params.evaluationCriteria ?? [];
  const appendixList = params.appendixList ?? [];
  const gaps = params.gapsToAddressInNarrative ?? [];
  const sections = params.requiredSections ?? [];
  const exactSubject = params.exactSubjectLine ?? `Technical Proposal for ${params.tenderTitle}`;
  const emailLine = params.exactEmails?.length ? `To: ${params.exactEmails.join("; ")}` : `To: ${params.clientName}`;
  const reviewedProjects = params.projects ?? [];
  const reviewedExperts = params.experts ?? [];
  const lines: string[] = [];

  // ── Cover Letter ─────────────────────────────────────────────────────────────
  lines.push("# Cover Letter");
  lines.push(emailLine);
  lines.push(`Subject: ${exactSubject}`);
  if (params.noFinancialProposal) lines.push("Note: This is a TECHNICAL PROPOSAL ONLY. No financial offer or pricing is included, as required by the tender instructions.");
  // Project-anchored opener (replaces the prior generic "we are pleased to submit"
  // boilerplate). When reviewed projects exist, the opener names the top 1–2 with
  // ETB values and same-team continuity language, matching the benchmark pattern.
  lines.push(buildCoverLetterOpener({
    companyName: params.companyName,
    clientName: params.clientName,
    tenderTitle: params.tenderTitle,
    projects: reviewedProjects,
  }));
  if (params.differentiators.length > 0) {
    lines.push("Key differentiators that make us well-placed to serve this assignment:");
    lines.push(...params.differentiators.slice(0, 3).map((d) => `- ${d}`));
  }
  lines.push(`We trust this proposal demonstrates our capacity, commitment, and technical depth.\n\nSincerely,\n${params.companyName}`);

  // ── Cover Page ────────────────────────────────────────────────────────────────
  lines.push("# Technical Proposal");
  lines.push(`**${params.tenderTitle}**`);
  // Submitted-by / Submitted-to 2-column metadata block (mirrors benchmark's
  // cover page table). Pulls from company profile when available; falls back
  // to a minimal block when company metadata is sparse.
  lines.push(buildSubmittedByToBlock({
    companyName: params.companyName,
    companyAddress: params.companyAddress ?? null,
    clientName: params.clientName,
    exactEmails: params.exactEmails ?? [],
    exactSubject,
    deadline: params.tenderDeadline ?? null,
  }));
  lines.push(`Sector: ${params.primarySector}`);

  // ── Table of Contents ─────────────────────────────────────────────────────────
  const tocItems = ["Cover Letter", "Executive Summary"];
  if (sections.length >= 2) {
    tocItems.push(...sections);
  } else {
    tocItems.push("Section A: Company Profile", "Section B: Relevant Experience", "Section C: Technical Approach", "Section D: Additional Information");
  }
  tocItems.push("Compliance and Bid Review Notes", "Appendix Register", "Declaration");
  lines.push("# Table of Contents");
  lines.push(...tocItems.map((item, i) => `${i + 1}. ${item}`));

  // ── Executive Summary ─────────────────────────────────────────────────────────
  // Lead sentence enforces the benchmark "[Company] has already delivered this
  // assignment [N times]" pattern when reviewed projects exist; otherwise emits
  // a Source-Evidence Action note rather than vague boilerplate.
  lines.push("# Executive Summary");
  lines.push(buildExecutiveSummaryOpener({
    companyName: params.companyName,
    clientName: params.clientName,
    projects: reviewedProjects,
    reviewedExpertCount: params.reviewedExpertCount ?? reviewedExperts.length,
  }));
  if (reviewedProjects.length === 0) {
    // Fall back to a compact metadata sentence so the section is not empty.
    lines.push(
      `${params.companyName} presents this technical proposal as a ${params.primarySector} assignment requiring an evidence-led, evaluator-facing response. ` +
      `${expertSelected > 0 ? `${expertSelected} reviewed specialist(s)` : "A qualified professional team"} ${expertSelected > 0 ? "are" : "is"} aligned to the scope.`,
    );
  }
  if (evalCriteria.length > 0) {
    lines.push("## Our response maps directly to the evaluation criteria:");
    lines.push(...evalCriteria.slice(0, 5).map((c) => `- ${c}`));
  }
  if (params.differentiators.length > 0) {
    lines.push("## Why we are best placed for this assignment:");
    lines.push(...params.differentiators.map((d) => `- ${d}`));
  }

  // ── Section A: Company Profile ─────────────────────────────────────────────────
  const sectionALabel = sections.find((s) => /company profile|section a/i.test(s)) ?? "Section A: Company Profile";
  lines.push(`# ${sectionALabel}`);
  lines.push(`**${params.companyName}** is a professional consultancy operating in the ${params.primarySector} sector.`);
  if (params.companyEvidenceLines.length > 0) {
    lines.push("## Company Evidence Documents");
    lines.push(...params.companyEvidenceLines.slice(0, 8).map((x) => `- ${x}`));
  } else {
    lines.push("Company registration, licence, service line, and sector information should be confirmed and attached to this section before final submission.");
  }
  if (params.submissionRules.length > 0) {
    lines.push("## Submission Instructions Acknowledged");
    lines.push(...params.submissionRules.map((r) => `- ${r}`));
  }

  // ── Section B: Relevant Experience ────────────────────────────────────────────
  const sectionBLabel = sections.find((s) => /relevant experience|section b/i.test(s)) ?? "Section B: Relevant Experience";
  lines.push(`# ${sectionBLabel}`);
  if (projectSelected > 0) {
    lines.push(`${params.companyName} presents ${projectSelected} reviewed project reference(s) directly relevant to this assignment:`);
    lines.push(...params.projectLines.map((x) => `- ${x}`));
    if (params.projectEvidenceLines.length > 0) {
      lines.push("## Project Evidence Attachments");
      lines.push(...params.projectEvidenceLines.slice(0, 10).map((x) => `- ${x}`));
    }
  } else {
    lines.push("No reviewed project reference has been selected yet. Select and review project references in the application before final submission. Ensure each reference includes: project name, client, contract value, country, scope summary, and a client reference letter or contract.");
  }

  // ── Section C: Technical Approach ─────────────────────────────────────────────
  const sectionCLabel = sections.find((s) => /technical approach|methodology|section c/i.test(s)) ?? "Section C: Technical Approach";
  lines.push(`# ${sectionCLabel}`);
  lines.push(`${params.companyName} will execute this ${params.primarySector} assignment through the following structured methodology:`);

  if (themes.length > 0) {
    for (const theme of themes.slice(0, 4)) {
      lines.push(`## ${theme.label}`);
      lines.push(...theme.methodologyBullets.map((b) => `- ${b}`));
    }
  } else if (params.requirements.length > 0) {
    lines.push("## Scope Response");
    lines.push(...params.requirements.slice(0, 12).map((r) => `- ${r}`));
  }

  lines.push("## Proposed Team and Expert Contributions");
  if (expertSelected > 0) {
    lines.push(...params.expertLines.map((x) => `- ${x}`));
  } else {
    lines.push("- Expert CVs and role assignments must be finalised and reviewed before submission. The tender requires a multidisciplinary team; confirm each expert's primary role and comparable previous project.");
  }

  // ── Section D: Additional Information ─────────────────────────────────────────
  const sectionDLabel = sections.find((s) => /additional information|value.?added|section d/i.test(s)) ?? "Section D: Additional Information";
  lines.push(`# ${sectionDLabel}`);
  lines.push(`${params.companyName} offers the following value-added capabilities and institutional advantages relevant to this assignment:`);
  if (params.differentiators.length > 3) {
    lines.push(...params.differentiators.slice(3).map((d) => `- ${d}`));
  }
  lines.push("Additional certifications, awards, company manuals, and institutional affiliations are provided in the appendices.");

  // ── Compliance and Bid Review Notes ───────────────────────────────────────────
  lines.push("# Compliance and Bid Review Notes");
  lines.push("This proposal is submitted in strict compliance with the tender instructions. The following compliance items have been reviewed:");
  if (params.complianceLines.length > 0) lines.push(...params.complianceLines.slice(0, 16).map((x) => `- ${x}`));
  if (params.expertRequired > expertSelected) lines.push(`- Tender requests ${params.expertRequired} expert(s); ${expertSelected} reviewed expert(s) are included. Confirm or add ${params.expertRequired - expertSelected} expert(s) before final submission.`);
  if (params.projectRequired > projectSelected) lines.push(`- Tender requests ${params.projectRequired} project reference(s); ${projectSelected} reviewed reference(s) are included. Confirm or add ${params.projectRequired - projectSelected} reference(s) before final submission.`);
  if (gaps.length > 0) {
    lines.push("## Senior Bid-Review Items (gaps to address before submission)");
    lines.push(...gaps.map((g) => `- ${g}`));
  }

  // ── Appendix Register ──────────────────────────────────────────────────────────
  lines.push("# Appendix Register");
  if (appendixList.length > 0) {
    lines.push(...appendixList.map((a) => `- ${a}`));
  } else {
    lines.push("- Appendix A: Company Profile and Registration Documents (Certificate of Incorporation, TIN, VAT, Business Licence)");
    lines.push("- Appendix B: Client Reference Letters and Contracts for Selected Projects");
    lines.push("- Appendix C: Curricula Vitae and Professional Credentials for Proposed Experts");
    lines.push("- Appendix D: Project Photos, Floor Plans and Drawings");
    lines.push("- Appendix E: Audited Financial Statements and Company Manuals");
    lines.push("- Appendix F: Certifications, ISO and Compliance Certificates");
  }

  // ── Declaration ────────────────────────────────────────────────────────────────
  lines.push("# Declaration");
  lines.push(
    `We, ${params.companyName}, hereby confirm that this technical proposal has been prepared specifically in response to ${params.tenderTitle} for ${params.clientName}. ` +
    "All information provided is accurate and supported by documentary evidence available on request. " +
    "This proposal has been prepared using reviewed evidence and senior bid-review controls, and we commit to delivering the assigned scope with the proposed team, methodology, and schedule."
  );

  // ── Submission Control Sheet ──────────────────────────────────────────────────
  lines.push("# Submission Control Sheet");
  lines.push("> Use this checklist immediately before sending. Do not submit until every item below is confirmed.");
  lines.push("## Submission Recipients");
  if (params.exactEmails && params.exactEmails.length > 0) {
    lines.push(...params.exactEmails.map((e) => `- **${e}**`));
  } else {
    lines.push(`- **${params.clientName}** — verify the exact submission email from the tender document before sending.`);
  }
  lines.push("## Email Subject Line");
  lines.push(`> **${exactSubject}**`);
  lines.push("Copy and paste this subject line exactly. Do not abbreviate or reword.");
  lines.push("## Document Format Requirements");
  if (params.noFinancialProposal) {
    lines.push("- **Technical Proposal ONLY** — Do NOT include any pricing, rates, or financial figures in this submission.");
  }
  if (params.submissionRules.length > 0) {
    lines.push(...params.submissionRules.slice(0, 12).map((r) => `- ${r}`));
  } else {
    lines.push("- Submit all documents as PDF unless the tender explicitly permits Word format.");
    lines.push("- Ensure the email attachment total does not exceed the size limit stated in the tender.");
    lines.push("- Confirm the deadline time zone before submission (e.g., EAT, GMT, WAT).");
  }
  lines.push("## Pre-Submission Checklist");
  lines.push("- [ ] Cover Letter signed and on company letterhead");
  lines.push("- [ ] All required sections included and complete");
  lines.push("- [ ] Expert CVs attached and signed");
  lines.push("- [ ] Project references include client contact details");
  lines.push("- [ ] All legal documents (registration, TIN, VAT) attached");
  lines.push("- [ ] Submission sent before the stated deadline");

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

function buildContactFooterText(company: { name: string; address?: string | null; phone?: string | null; email?: string | null; website?: string | null }): string {
  const parts: string[] = [];
  if (company.address) parts.push(company.address);
  if (company.phone) parts.push(`Tel: ${company.phone}`);
  if (company.email) parts.push(company.email);
  if (company.website) parts.push(company.website);
  return parts.length > 0 ? parts.join(" | ") : "";
}

function buildProfessionalDocument(params: {
  tenderTitle: string;
  clientName: string;
  companyName: string;
  reference?: string | null;
  contactFooter?: string;
  children: (Paragraph | Table)[];
}): Document {
  const header = new Header({
    children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: params.companyName, bold: true, color: BRAND_BLUE, size: 18 }), new TextRun({ text: " | Technical Proposal", color: BRAND_GRAY, size: 18 })] })],
  });
  // Footer carries the company contact strip on every page when company profile
  // includes address / phone / email / website. Mirrors the benchmark's per-page
  // contact band. Falls back to the prior page-number-only footer when contact
  // info is not yet on file.
  const footerChildren: Paragraph[] = [];
  if (params.contactFooter) {
    footerChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: params.contactFooter, size: 14, color: BRAND_GRAY })],
        spacing: { after: 40 },
      }),
    );
  }
  footerChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "Confidential bid document | Page ", size: 16, color: BRAND_GRAY }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: BRAND_GRAY }),
      ],
    }),
  );
  const footer = new Footer({ children: footerChildren });
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
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 22, bold: true, color: BRAND_GRAY, font: "Calibri" }, paragraph: { spacing: { before: 180, after: 80 } } },
      ],
    },
  });
}

const BENCHMARK_CONTEXT_LINES = [
  "MANDATORY BENCHMARK STRUCTURE: Cover Letter; Technical Proposal; Table of Contents; Executive Summary; Company Profile; Proposed Team; Relevant Experience; Technical Approach; Compliance and Bid Review Strategy; Additional Information; Appendix Register; Declaration.",
  "FIRST-DRAFT QUALITY RULE: The first AI draft must contain the benchmark structure, evaluator-facing narrative, evidence mapping, methodology depth, compliance strategy, appendix register, and final declaration.",
  "EVIDENCE RULE: Use only provided experts, projects, company documents, legal records, financial records, compliance records, project evidence, compliance rows, and tender text. If evidence is missing, state it as a bid-team confirmation item, not as a fake claim.",
  "CLIENT-READY RULE: Do not write internal benchmark review, auto-repair, debug, AI fallback, or quality-score sections inside the client proposal document.",
  "FORBIDDEN PHRASES: Never write 'extensive experience' without a project name; 'committed to excellence/quality'; 'leading firm in the region'; 'team of qualified professionals'; 'we look forward to the opportunity'; 'as an AI'; 'certainly'; or any [square bracket] placeholder.",
  "EVIDENCE DENSITY RULE: Every strong claim must cite a specific project name, ETB/contract value, expert name + licence, or client reference. No paragraph may be purely generic without one verifiable fact.",
  "NARRATIVE THROUGHLINE RULE: The same two strongest project names MUST appear in the Cover Letter opening, Executive Summary first paragraph, AND Section B. This is not optional.",
  "EXECUTIVE SUMMARY LEAD RULE: Executive Summary must open with: 'We have already delivered this assignment. [Company] designed/supervised/assessed [Project Name] (ETB X, Client Y) — a [parallel description].' This is the single most important sentence in the proposal.",
  "TEAM-TO-PROJECT RULE: Each proposed expert must be linked in a table showing: Expert Name | Proposed Role | Previous Comparable Project | Role on That Project | Key Technical Contribution.",
  "SECTION LENGTH RULE: Cover Letter ≥ 4 paragraphs; Executive Summary ≥ 3 paragraphs; each Section A/B/C ≥ 5 paragraphs with sub-sections. Do not truncate or summarise — write the full content.",
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

  const allSelectedExperts = tender.expertMatches.map((m) => m.expert);
  const allSelectedProjects = tender.projectMatches.map((m) => m.project);
  const experts = allSelectedExperts.filter((e) => e.trustLevel === "REVIEWED");
  const projects = allSelectedProjects.filter((p) => p.trustLevel === "REVIEWED");

  // Warn about draft records silently excluded from generation (they are not blocked here —
  // the route gate handles blocking. This provides auditability in the return value.)
  const excludedDraftExperts = allSelectedExperts.filter((e) => e.trustLevel !== "REVIEWED");
  const excludedDraftProjects = allSelectedProjects.filter((p) => p.trustLevel !== "REVIEWED");
  if (excludedDraftExperts.length > 0) {
    console.warn(`[generate-elite] Excluded ${excludedDraftExperts.length} unreviewed expert(s) from generation: ${excludedDraftExperts.map((e) => e.fullName).join(", ")}`);
  }
  if (excludedDraftProjects.length > 0) {
    console.warn(`[generate-elite] Excluded ${excludedDraftProjects.length} unreviewed project(s) from generation: ${excludedDraftProjects.map((p) => p.name).join(", ")}`);
  }
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
      sourceMarkdown = fallbackProposalMarkdown({ tenderTitle: tender.title, clientName: intelligence.clientName, companyName: company.name, companyAddress: company.address, primarySector: intelligence.primarySector, requirements: requirementLines, differentiators: intelligence.differentiators, submissionRules: intelligence.submissionRules, expertLines, projectLines, experts: experts as ExpertRecord[], projects: projects as ProjectRecord[], reviewedExpertCount: experts.length, companyEvidenceLines, projectEvidenceLines, complianceLines, expertRequired, projectRequired, themes: intelligence.themes, evaluationCriteria: intelligence.evaluationCriteria, appendixList: intelligence.appendixList, noFinancialProposal: intelligence.noFinancialProposal, exactEmails: intelligence.exactEmails, exactSubjectLine: intelligence.exactSubjectLine, gapsToAddressInNarrative: intelligence.gapsToAddressInNarrative, requiredSections: intelligence.requiredSections, tenderDeadline: tender.deadline });
      mode = "deterministic benchmark fallback + evaluator response matrix + client-ready benchmark finalizer + professional DOCX polish";
    }
  } else {
    sourceMarkdown = fallbackProposalMarkdown({ tenderTitle: tender.title, clientName: intelligence.clientName, companyName: company.name, companyAddress: company.address, primarySector: intelligence.primarySector, requirements: requirementLines, differentiators: intelligence.differentiators, submissionRules: intelligence.submissionRules, expertLines, projectLines, experts: experts as ExpertRecord[], projects: projects as ProjectRecord[], reviewedExpertCount: experts.length, companyEvidenceLines, projectEvidenceLines, complianceLines, expertRequired, projectRequired, themes: intelligence.themes, evaluationCriteria: intelligence.evaluationCriteria, appendixList: intelligence.appendixList, noFinancialProposal: intelligence.noFinancialProposal, exactEmails: intelligence.exactEmails, exactSubjectLine: intelligence.exactSubjectLine, gapsToAddressInNarrative: intelligence.gapsToAddressInNarrative, requiredSections: intelligence.requiredSections, tenderDeadline: tender.deadline });
  }

  const matrixMarkdown = appendEvaluatorResponseMatrix(sourceMarkdown, evaluatorMatrixInput);
  const isHealthcare = /health|hospital|medical|clinic|radiology|laboratory|pharmacy|patient|specialty|OPD|in-patient|emergency/i.test(`${intelligence.primarySector}\n${intelligence.tenderText}`);
  const strengtheningMarkdown = buildClientProposalStrengtheningSections({ clientName: intelligence.clientName, tenderTitle: tender.title, companyName: company.name, projectLines, expertLines, companyEvidenceLines, projectEvidenceLines, isHealthcare, existingMarkdown: matrixMarkdown });

  // Inject benchmark-quality tabular sections (Proposed Team, Team-to-Project Mapping,
  // Project Portfolio cards, Three-Stage Review, optional Assessment Matrix) only if
  // the upstream output (AI or fallback) didn't already produce them. This guarantees
  // every proposal carries the high-evidence-density tables the benchmark uses.
  const upstreamCheck = makeHasHeadingChecker(`${matrixMarkdown}\n${strengtheningMarkdown}`);
  const benchmarkTables = buildBenchmarkTablesBlock({
    experts,
    projects,
    companyName: company.name,
    tenderTitle: tender.title,
    primarySector: intelligence.primarySector,
    assignmentRoleHint: `Aligned to ${tender.title} scope and ${intelligence.clientName} evaluation criteria.`,
    alreadyHasHeading: upstreamCheck,
  });

  // Round-2 benchmark sections — same idempotency rule. Each section is appended
  // only if the upstream output did not already produce an equivalent heading.
  const round2Sections: string[] = [];
  if (!upstreamCheck("B.1 Client References") && !upstreamCheck("Client References")) {
    round2Sections.push(buildClientReferencesTable(projects));
  }
  if (!upstreamCheck("B.2.0 Portfolio Reading Guide") && !upstreamCheck("Portfolio Reading Guide")) {
    const guide = buildPortfolioReadingGuide({ projects, primarySector: intelligence.primarySector, tenderTitle: tender.title });
    if (guide) round2Sections.push(guide);
  }
  const specialistSection = buildSpecialistEngagementSection({ tenderText: intelligence.tenderText, companyName: company.name });
  if (specialistSection) {
    const triggeredHeading = specialistSection.split("\n", 1)[0]?.replace(/^##\s+/, "") ?? "";
    if (triggeredHeading && !upstreamCheck(triggeredHeading)) {
      round2Sections.push(specialistSection);
    }
  }
  if (!upstreamCheck("D.1 Value Framework") && !upstreamCheck(`D.1 Value Framework — What ${intelligence.clientName} Gains`) && !upstreamCheck("Value Framework")) {
    round2Sections.push(buildValueFrameworkTable({ primarySector: intelligence.primarySector, clientName: intelligence.clientName }));
  }
  if (!upstreamCheck("D.4 Declaration of Eligibility") && !upstreamCheck("Declaration of Eligibility") && !upstreamCheck("Declaration")) {
    round2Sections.push(buildDeclaration({
      companyName: company.name,
      clientName: intelligence.clientName,
      tenderTitle: tender.title,
      // Company schema does not have explicit GM/license columns — left null until
      // the user adds these to the company profile. Falls back to generic signature.
      companyGM: null,
      companyGMLicense: null,
    }));
  }

  // Round-4: Portfolio at a Glance + Principal Qualifications. Both gated by
  // the heading-idempotency check so they don't duplicate AI-produced content.
  if (!upstreamCheck("A.0 Portfolio at a Glance") && !upstreamCheck("Portfolio at a Glance")) {
    const metrics = computePortfolioMetrics({
      experts: experts as ExpertRecord[],
      projects: projects as ProjectRecord[],
    });
    round2Sections.push(buildPortfolioMetricsBlock(metrics, company.name));
  }
  if (!upstreamCheck("A.4.1 Principal Qualifications — Detailed Bios") && !upstreamCheck("Principal Qualifications") && !upstreamCheck("Detailed Bios")) {
    const cv = buildPrincipalQualificationsSection({ experts: experts as ExpertRecord[], topN: 5 });
    if (cv) round2Sections.push(cv);
  }

  // Round-5: high-impact evaluator-friendly sections.
  if (!upstreamCheck(`Why ${company.name} for ${intelligence.clientName}`) && !upstreamCheck("Why Us") && !upstreamCheck(`Why ${company.name}`)) {
    const whyUs = buildWhyUsSummary({
      companyName: company.name,
      clientName: intelligence.clientName,
      experts: experts as ExpertRecord[],
      projects: projects as ProjectRecord[],
      differentiators: intelligence.differentiators,
      primarySector: intelligence.primarySector,
    });
    if (whyUs) round2Sections.push(whyUs);
  }
  if (!upstreamCheck("C.5 Risk Register and Mitigation Strategy") && !upstreamCheck("Risk Register") && !upstreamCheck("Risks and Mitigations")) {
    round2Sections.push(buildRisksMitigationsTable({ primarySector: intelligence.primarySector, clientName: intelligence.clientName }));
  }
  if (!upstreamCheck("C.6 Work Plan and Schedule") && !upstreamCheck("Work Plan") && !upstreamCheck("Schedule")) {
    round2Sections.push(buildWorkPlanTable({ primarySector: intelligence.primarySector }));
  }
  if (!upstreamCheck("E.1 Bid Compliance Mapping — Tender Requirements to Proposal Sections") && !upstreamCheck("Bid Compliance Mapping") && !upstreamCheck("Tender Requirements Mapping")) {
    const mapping = buildBidComplianceMapping({ requirements: tender.requirements });
    if (mapping) round2Sections.push(mapping);
  }

  // Round-6: more evaluator-facing sections (Understanding, Value-Added,
  // Certifications, In-House Capabilities, Conflict of Interest).
  if (!upstreamCheck("C.1 Understanding of the Assignment") && !upstreamCheck("Understanding of the Assignment") && !upstreamCheck("Understanding of Assignment")) {
    round2Sections.push(buildUnderstandingSection({
      tenderTitle: tender.title,
      clientName: intelligence.clientName,
      primarySector: intelligence.primarySector,
      evaluationCriteria: intelligence.evaluationCriteria,
    }));
  }
  if (!upstreamCheck("D.2 Value-Added Services") && !upstreamCheck("Value-Added Services") && !upstreamCheck("Value Added Services")) {
    round2Sections.push(buildValueAddedServices({ primarySector: intelligence.primarySector, companyName: company.name }));
  }
  if (!upstreamCheck("D.3 Professional Certifications and Affiliations") && !upstreamCheck("Professional Certifications") && !upstreamCheck("Certifications and Affiliations")) {
    round2Sections.push(buildCertificationsSection({ experts: experts as ExpertRecord[], companyName: company.name }));
  }
  if (!upstreamCheck("A.7 In-House Capabilities") && !upstreamCheck("In-House Capabilities")) {
    round2Sections.push(buildInHouseCapabilitiesSection({
      companyName: company.name,
      serviceLines: safeParseArr(company.serviceLines),
      sectors: safeParseArr(company.sectors),
      evidenceLines: companyEvidenceLines,
    }));
  }
  if (!upstreamCheck("D.5 Declaration of No Conflict of Interest") && !upstreamCheck("Conflict of Interest") && !upstreamCheck("No Conflict of Interest")) {
    round2Sections.push(buildConflictOfInterestSection({
      companyName: company.name,
      clientName: intelligence.clientName,
      tenderTitle: tender.title,
    }));
  }

  const combinedMarkdown = [matrixMarkdown, strengtheningMarkdown, benchmarkTables, ...round2Sections].filter(Boolean).join("\n\n");

  // Round-4 self-healing pass: enforce the benchmark "narrative throughline"
  // rule (top 1–2 projects must appear in Cover Letter, Executive Summary,
  // and Section B/Relevant Experience) and ensure sector-specific technical
  // vocabulary is present. Both are idempotent — if the upstream output
  // already covers them, nothing is added.
  const throughline = enforceNarrativeThroughline({
    markdown: combinedMarkdown,
    topProjects: (projects as ProjectRecord[]).slice(0, 2),
  });
  const enriched = enrichSectorVocabulary({
    markdown: throughline.markdown,
    primarySector: intelligence.primarySector,
  });
  // Round-7: reorder all sections into canonical proposal sequence (Cover Letter → Cover Page →
  // TOC → Executive Summary → Why Us → A.x → B.x → C.x → D.x → E.x → Submission Control Sheet)
  // so the appended deterministic sections don't show up out of order at the end of the document.
  const reordered = reorderToCanonicalSequence(enriched.markdown);
  // Round-8: replace the static TOC with one built from the actual section
  // headings present in the (now reordered) document. The fallback writes a
  // generic TOC that doesn't reflect the 30+ sections this pipeline produces.
  const withDynamicToc = renderDynamicTableOfContents(reordered);
  const finalized = finalizeClientReadyProposalMarkdown(withDynamicToc, guardInput);
  const clientMarkdown = cleanClientLanguage(finalized.markdown);
  const auditSummary = benchmarkAuditSummary(clientMarkdown);
  const children = markdownToDocx(clientMarkdown);
  const contactFooter = buildContactFooterText({
    name: company.name,
    address: company.address,
    phone: company.phone,
    email: company.email,
    website: company.website,
  });
  const doc = buildProfessionalDocument({ tenderTitle: tender.title, clientName: intelligence.clientName, companyName: company.name, reference: tender.reference, contactFooter, children });

  const fileContent = (await Packer.toBuffer(doc)).toString("base64");
  const qualityScore = scoreProposalQuality({
    markdown: clientMarkdown,
    primarySector: intelligence.primarySector,
    topProjects: (projects as ProjectRecord[]).slice(0, 2),
  });
  const summary = `${mode} technical proposal generated. ${finalized.internalSummary}. ${auditSummary}. ${formatQualityScoreSummary(qualityScore)}. Inputs: ${intelligence.requiredSections.length} section group(s), ${intelligence.themes.length} tender theme(s), ${experts.length} reviewed expert(s), ${projects.length} reviewed project(s), ${companyEvidenceLines.length} company evidence item(s), ${projectEvidenceLines.length} project evidence attachment(s).${aiError ? ` AI fallback reason: ${aiError}` : ""}`;

  const target = await prisma.generatedDocument.findFirst({ where: { tenderId, documentType: { in: ["TECHNICAL_PROPOSAL", "PROPOSAL", "METHODOLOGY"] } }, orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }] });
  if (target) {
    await prisma.generatedDocument.update({ where: { id: target.id }, data: { name: "Client-Ready Benchmark Technical Proposal", documentType: "TECHNICAL_PROPOSAL", exactFileName: target.exactFileName || "Technical-Proposal.docx", fileContent, generationStatus: "GENERATED", validationStatus: "PENDING", contentSummary: summary, updatedAt: new Date() } });
  } else {
    await prisma.generatedDocument.create({ data: { tenderId, name: "Client-Ready Benchmark Technical Proposal", documentType: "TECHNICAL_PROPOSAL", format: "DOCX", exactFileName: "Technical-Proposal.docx", exactOrder: 1, fileContent, generationStatus: "GENERATED", validationStatus: "PENDING", contentSummary: summary } });
  }

  await prisma.tender.update({ where: { id: tenderId }, data: { status: "GENERATED", stage: "GENERATION", updatedAt: new Date() } });
}
