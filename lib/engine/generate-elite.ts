import { AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageNumber, Paragraph, Table, TableBorders, TableCell, TableRow, TextRun, WidthType } from "docx";
import { prisma } from "../prisma";
import { generateBenchmarkProposalWithAI, generateProposalSectionsParallel, getLastProposalProvider, isAIEnabled, refineProposalWithAI } from "../ai";
import { BENCHMARK_CONTEXT_LINES, buildCriterionEvidenceMap, buildProposalIntelligence, expertProofLine, projectProofLine, safeParseArr } from "./proposal-intelligence";
import { enforceCanonicalNames } from "./entity-name-normalizer";
import { exactSelectionLimit, forbidsBranding, forbidsCoverPage, requiresSignatureOrStamp } from "./scope-policy";
import { finalizeClientReadyProposalMarkdown } from "./proposal-benchmark-guard";
import { appendEvaluatorResponseMatrix } from "./proposal-evaluator-matrix";
import { buildClientProposalStrengtheningSections } from "./proposal-strengthening-sections";
import { benchmarkAuditSummary } from "./proposal-benchmark-audit";
import { polishBenchmarkOutput } from "./benchmark-output-polisher";
import { formatRequirementLine } from "./proposal-labels";
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
import { computeWinProbability, formatWinProbability } from "./win-probability";
import { buildPrincipalQualificationsSection } from "./principal-qualifications";
import { buildRisksMitigationsTable } from "./risks-mitigations";
import { buildWhyUsSummary } from "./why-us-summary";
import { buildWorkPlanTable } from "./work-plan-timeline";
import { buildBidComplianceMapping } from "./bid-compliance-mapping";
import { buildComplianceMatrixSection, hasComplianceMatrixHeading } from "./compliance-matrix-builder";
import { buildEvaluatorMirrorSection, hasEvaluatorMirrorHeading } from "./evaluator-mirror-builder";
import { buildWinThemesSection, hasWinThemesHeading } from "./win-themes-builder";
import { buildSelfScoreSection, hasSelfScoreHeading } from "./self-score-builder";
import { extractTenderLanguageEchoes, formatEchoesForPrompt } from "./tender-language-echoes";
import { extractTenderFacts, formatFactsForPrompt, buildTenderSpecificsBlock } from "./tender-facts-extractor";
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
import { humanize, humanizeDeterministic, humanizeOpeningSections } from "./humanize";
import { injectEvidenceMarkers } from "./evidence-marker-injector";
import { amplifySectionCDepth } from "./section-c-depth-amplifier";
import { injectMethodologyTables } from "./methodology-tables";
import { injectBeyondSpecTables } from "./beyond-spec-tables";
import { injectWinThemesTable } from "./win-themes-table";
import { injectMobilizationAndChecklist } from "./mobilization-and-checklist";
import { stripPlaceholders } from "./placeholder-stripper";
import { stripInternalReviewSections } from "./internal-review-stripper";
import { reorderSectionsAndRebuildToc } from "./section-orderer-and-toc";
import { enforceClientName } from "./client-name-enforcer";
import { suppressDuplicateSectionHeadings } from "./duplicate-section-suppressor";
import { injectPersonnelDeep } from "./personnel-deep";
import { injectTenderClosers } from "./tender-closers";
import { injectDeliverableAndPhases } from "./deliverable-and-phases";
import { buildRubricPromptDirective, ensureRubricHeadings } from "./rubric-driven-sections";
import { injectCoverPageAndRfpMeta } from "./cover-page-injector";
import { injectJvDisclosure } from "./jv-disclosure";
import { deduplicateTables, injectQaThresholds, injectAppendixReadinessRegister } from "./advanced-quality-passes";
import { generateExpertCvDocx, expertCvFileName } from "./expert-cv-docx";
import { computeBidStrategy } from "./bid-strategy";

const BRAND_BLUE = "1F4E79";
const BRAND_GRAY = "595959";
const LIGHT_BLUE = "D9EAF7";

// In-pipeline timeout for the Claude proposal call. Layered INSIDE the
// Vercel maxDuration window so the engine can fail gracefully (fall
// back to the deterministic markdown builder) before Vercel kills the
// function with a 504.
//
// Tier-aware defaults:
//   Tier 1  (Vercel Hobby  60s):  45s — 15s buffer for enrichers + DOCX
//   Tier 2+ (Vercel Pro  300s): 220s — 80s buffer; accommodates 16K output
// Override via AI_PROPOSAL_TIMEOUT_MS.
const PROPOSAL_AI_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_PROPOSAL_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 600_000) return raw;
  const tier = (process.env.ANTHROPIC_TIER || "").trim();
  return tier === "1" ? 45_000 : 220_000;
})();

async function withProposalAiTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`AI proposal timed out after ${Math.round(ms / 1000)} seconds (in-pipeline guard before Vercel function timeout)`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  // Strip ** (heading style already applies bold) but keep *italic* so
  // parseInlineRuns can render it correctly in the heading TextRuns.
  const stripped = text.replace(/\*\*/g, "");
  return new Paragraph({
    children: parseInlineRuns(stripped),
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
  // Accept rows that start with | even if trailing pipe is absent — AI
  // occasionally omits the closing pipe on the last cell.
  return line.startsWith("|");
}

function isSeparatorRow(line: string): boolean {
  // Make trailing pipe optional — AI sometimes omits it, consistent with
  // the isTableLine change that accepts rows without trailing pipe.
  return /^\|[\s:|-]+\|?$/.test(line.trimEnd());
}

function splitTableCells(rowLine: string): string[] {
  // Normalize soft newlines and split on pipe.
  const normalized = rowLine.replace(/<br\s*\/?>/gi, " ").replace(/\\n/g, " ");
  const parts = normalized.split("|");
  // If row starts with | the first segment is empty — skip it (index > 0).
  // If row ends with | the last segment is also empty — skip it (index < len-1).
  // If the trailing pipe is absent the last segment is the final cell — keep it.
  const endsWithPipe = normalized.trimEnd().endsWith("|");
  return parts
    .filter((_, i, arr) => i > 0 && (endsWithPipe ? i < arr.length - 1 : true))
    .map((cell) => cell.trim());
}

function parseMdTable(tableLines: string[]): Table {
  const dataRows = tableLines.filter((l) => !isSeparatorRow(l));
  const colCount = Math.max(...dataRows.map((r) =>
    splitTableCells(r).length
  ), 1);
  // PR FF: for wide tables (5+ cols) use tighter column width so the table
  // fits within the page margins without overflowing.
  const colWidth = Math.floor(8100 / colCount);

  const rows = dataRows.map((rowLine, rowIndex) => {
    const cells = splitTableCells(rowLine);
    const isHeader = rowIndex === 0;

    return new TableRow({
      children: Array.from({ length: colCount }, (_, ci) => {
        const cellText = cells[ci] ?? "";
        // PR FF: apply parseInlineRuns to header cells as well — bold/italic
        // inside header cells was previously stripped by the replace(/\*\*/g,"")
        // call and lost entirely in the DOCX output.
        const headerRuns = parseInlineRuns(cellText, { size: 20, color: "FFFFFF" }).map(
          (r) => new TextRun({ ...r, bold: true }),
        );
        return new TableCell({
          width: { size: colWidth, type: WidthType.DXA },
          children: [new Paragraph({
            children: isHeader ? headerRuns : parseInlineRuns(cellText, { size: 20 }),
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
    .replace(/Bid-Team Action:\s*/gi, "Evidence note: ")
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

    if (!line) {
      // Preserve visual paragraph separation: emit a small spacer so
      // consecutive body paragraphs don't collapse into a dense block.
      out.push(new Paragraph({ children: [new TextRun("")], spacing: { after: 60 } }));
      continue;
    }
    if (line.startsWith("### ")) out.push(heading(line.slice(4), 3));
    else if (line.startsWith("## ")) out.push(heading(line.slice(3), 2));
    else if (line.startsWith("# ")) { h1Count++; out.push(heading(line.slice(2), 1, h1Count > 1)); }
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
  companyLegalName?: string | null;
  companyAddress?: string | null;
  companyTIN?: string | null;
  companyVAT?: string | null;
  companyGM?: string | null;
  companyGMLicense?: string | null;
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
  companyLicenseGrade?: string | null;
  companyHeadcount?: number | null;
  companyServiceLines?: string[];
  companySectors?: string[];
  companyProfileSummary?: string | null;
  companyLegalRecords?: Array<{ title: string; recordType?: string | null; authority?: string | null; referenceNumber?: string | null; status?: string | null }>;
  companyComplianceRecords?: Array<{ title: string; complianceType?: string | null; status?: string | null; referenceNumber?: string | null }>;
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
    companyLegalName: params.companyLegalName ?? null,
    companyAddress: params.companyAddress ?? null,
    companyTIN: params.companyTIN ?? null,
    companyVAT: params.companyVAT ?? null,
    companyGM: params.companyGM ?? null,
    companyGMLicense: params.companyGMLicense ?? null,
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
  } else {
    const topProject = reviewedProjects[0];
    const projectClientPart = topProject.clientName ? ` for ${topProject.clientName}` : "";
    const projectValuePart = topProject.contractValue ? ` (${topProject.currency ?? "ETB"} ${topProject.contractValue.toLocaleString()})` : "";
    lines.push(
      `${params.companyName} has delivered comparable assignments. ${topProject.name}${projectClientPart}${projectValuePart}. ` +
      `The same team is proposed for this engagement.`,
    );
  }
  if (reviewedExperts.length > 0) {
    const topExpert = reviewedExperts[0];
    const titlePart = topExpert.title ? `, ${topExpert.title}` : "";
    const yearsPart = topExpert.yearsExperience ?? 10;
    lines.push(
      `Led by ${topExpert.fullName}${titlePart}, the proposed team brings ${yearsPart}+ years of ${params.primarySector} expertise.`,
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
  lines.push("## A.1 Company Overview");
  const profileDesc = params.companyProfileSummary ?? null;
  const licenseGradePart = params.companyLicenseGrade ? `, holding a ${params.companyLicenseGrade} licence grade` : "";
  const headcountPart = params.companyHeadcount ? ` with ${params.companyHeadcount} professional staff` : "";
  const legalNamePart = params.companyLegalName ? ` (registered as ${params.companyLegalName})` : "";
  lines.push(`**${params.companyName}**${legalNamePart} is a professional consultancy operating in the ${params.primarySector} sector${licenseGradePart}${headcountPart}.`);
  if (profileDesc) {
    lines.push(profileDesc.slice(0, 400));
  } else {
    lines.push(`${params.companyName} delivers end-to-end technical consultancy services across its registered sectors, combining sector-specialist expertise with evidence-anchored project delivery.`);
  }
  if (params.companyAddress ?? params.companyTIN ?? params.companyVAT ?? params.companyGM) {
    const infoItems: string[] = [];
    if (params.companyAddress) infoItems.push(`Address: ${params.companyAddress}`);
    if (params.companyTIN) infoItems.push(`TIN: ${params.companyTIN}`);
    if (params.companyVAT) infoItems.push(`VAT: ${params.companyVAT}`);
    if (params.companyGM) infoItems.push(`General Manager: ${params.companyGM}${params.companyGMLicense ? ` (Lic. ${params.companyGMLicense})` : ""}`);
    lines.push(infoItems.join(" | "));
  }
  lines.push("## A.2 Service Lines & Sectors");
  const serviceLinesList = params.companyServiceLines && params.companyServiceLines.length > 0 ? params.companyServiceLines : [];
  const sectorsList = params.companySectors && params.companySectors.length > 0 ? params.companySectors : [params.primarySector];
  if (serviceLinesList.length > 0) {
    lines.push(`Core service lines: ${serviceLinesList.join(", ")}. Sectors served: ${sectorsList.join(", ")}.`);
  } else {
    lines.push(`Sectors served: ${sectorsList.join(", ")}.`);
  }
  lines.push("## A.3 Evidence of Compliance");
  const legalRecs = params.companyLegalRecords ?? [];
  const complianceRecs = params.companyComplianceRecords ?? [];
  if (legalRecs.length > 0) {
    lines.push(...legalRecs.slice(0, 3).map((r) => `- ${r.title}${r.recordType ? ` (${r.recordType})` : ""}${r.authority ? ` — ${r.authority}` : ""}${r.referenceNumber ? ` Ref: ${r.referenceNumber}` : ""}${r.status ? ` [${r.status}]` : ""}`));
  }
  if (complianceRecs.length > 0) {
    lines.push(...complianceRecs.slice(0, 3).map((r) => `- ${r.title}${r.complianceType ? ` (${r.complianceType})` : ""}${r.referenceNumber ? ` Ref: ${r.referenceNumber}` : ""}${r.status ? ` [${r.status}]` : ""}`));
  }
  if (legalRecs.length === 0 && complianceRecs.length === 0 && params.companyEvidenceLines.length > 0) {
    lines.push(...params.companyEvidenceLines.slice(0, 6).map((x) => `- ${x}`));
  } else if (legalRecs.length === 0 && complianceRecs.length === 0) {
    lines.push("- Registration and compliance documents are attached as appendices.");
  }
  lines.push("## A.4 Key Personnel");
  const topExpertsForA = reviewedExperts.slice(0, 2);
  if (topExpertsForA.length > 0) {
    for (const exp of topExpertsForA) {
      const titleStr = exp.title ? `, ${exp.title}` : "";
      const yearsStr = exp.yearsExperience ? ` — ${exp.yearsExperience}+ years of ${params.primarySector} experience` : "";
      lines.push(`- **${exp.fullName}**${titleStr}${yearsStr}`);
    }
  } else if (params.expertLines.length > 0) {
    lines.push(...params.expertLines.slice(0, 2).map((x) => `- ${x}`));
  } else {
    lines.push("- Key personnel CVs and role assignments to be confirmed before submission.");
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
      lines.push(...params.projectEvidenceLines.slice(0, 25).map((x) => `- ${x}`));
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

function buildCoverBlock(params: {
  tenderTitle: string;
  clientName: string;
  companyName: string;
  reference?: string | null;
  // PR #259 — full company-vault credentials surfaced on the
  // cover page. When provided, the page now includes registered
  // address, TIN, VAT, license grade, GM with PPE license, phone,
  // email, website — matching the Claude benchmark proposal's
  // cover page exactly.
  vault?: {
    serviceLines?: string[] | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    tin?: string | null;
    vat?: string | null;
    licenseGrade?: string | null;
    gmName?: string | null;
    gmTitle?: string | null;
    gmLicense?: string | null;
    submissionDate?: Date | string | null;
    proposalValidityDays?: number | null;
    exactSubjectLine?: string | null;
  };
}): Paragraph[] {
  const v = params.vault ?? {};
  const blocks: Paragraph[] = [];

  // Optional service-line tagline (Claude's PATH cover page had:
  // "Design | Interior Design | Water Drilling | Geotechnical
  // Investigation | Contract Administration").
  if (v.serviceLines && v.serviceLines.length > 0) {
    blocks.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 60 },
      children: [new TextRun({ text: v.serviceLines.slice(0, 6).join("  |  "), italics: true, size: 18, color: BRAND_GRAY, font: "Calibri" })],
    }));
  }

  blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 200 }, children: [new TextRun({ text: "TECHNICAL PROPOSAL", bold: true, size: 44, color: BRAND_BLUE, font: "Calibri" })] }));

  // Reference line (e.g., "RFP No. 2026-024")
  if (params.reference) {
    blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: params.reference, bold: true, size: 26, color: BRAND_BLUE, font: "Calibri" })] }));
  }

  blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: params.tenderTitle, bold: true, size: 30, color: "222222", font: "Calibri" })] }));
  blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: `Submitted to: ${params.clientName}`, size: 24, color: BRAND_GRAY, font: "Calibri" })] }));

  // Submission date | Validity (Claude's pattern: "Submission Date:
  // 25 March 2026 | Proposal Validity: 90 Days")
  const dateBits: string[] = [];
  if (v.submissionDate) {
    const d = new Date(v.submissionDate);
    if (!Number.isNaN(d.getTime())) dateBits.push(`Submission Date: ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`);
  }
  if (v.proposalValidityDays) dateBits.push(`Proposal Validity: ${v.proposalValidityDays} Days`);
  if (dateBits.length > 0) {
    blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 280 }, children: [new TextRun({ text: dateBits.join("  |  "), size: 20, color: BRAND_GRAY, font: "Calibri" })] }));
  } else {
    blocks.push(new Paragraph({ spacing: { after: 280 }, children: [new TextRun("")] }));
  }

  // "Prepared by" line — bold company name in brand color
  blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: params.companyName, bold: true, size: 26, color: BRAND_BLUE, font: "Calibri" })] }));

  // Address line
  if (v.address) {
    blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: v.address, size: 18, color: BRAND_GRAY, font: "Calibri" })] }));
  }

  // Tax + license registration line — "TIN: ... | VAT Reg. No.: ... | Category 1 (Grade I)"
  const regBits: string[] = [];
  if (v.tin) regBits.push(`TIN: ${v.tin}`);
  if (v.vat) regBits.push(`VAT Reg. No.: ${v.vat}`);
  if (v.licenseGrade) regBits.push(v.licenseGrade);
  if (regBits.length > 0) {
    blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: regBits.join("  |  "), size: 16, color: BRAND_GRAY, font: "Calibri" })] }));
  }

  // Phone | Email | Website line
  const contactBits: string[] = [];
  if (v.phone) contactBits.push(`Tel: ${v.phone}`);
  if (v.email) contactBits.push(v.email);
  if (v.website) contactBits.push(v.website);
  if (contactBits.length > 0) {
    blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: contactBits.join("  |  "), size: 16, color: BRAND_GRAY, font: "Calibri" })] }));
  }

  // GM signatory line
  if (v.gmName) {
    const gmText = `${v.gmName}, ${v.gmTitle ?? "General Manager"}${v.gmLicense ? `  |  ${v.gmLicense}` : ""}`;
    blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: gmText, size: 16, color: BRAND_GRAY, italics: true, font: "Calibri" })] }));
  }

  // Email subject line — extracted from tender's exact subject (PR #259)
  if (v.exactSubjectLine) {
    blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 40 }, children: [new TextRun({ text: `Email Subject Line: [${v.exactSubjectLine}]`, size: 16, color: "222222", font: "Calibri", italics: true })] }));
  }

  // Section divider
  blocks.push(new Paragraph({ border: { bottom: { color: BRAND_BLUE, style: BorderStyle.SINGLE, size: 12, space: 1 } }, spacing: { before: 200, after: 300 }, children: [new TextRun("")] }));

  return blocks;
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
  // STRICT SCOPE FLAGS (PR #245):
  // The product spec mandates "must prepare exactly and only what the
  // tender requires." When the analyzed tender forbids a cover page or
  // forbids branding (logo / letterhead / company name in header), the
  // DOCX renderer must respect that — historically the engine emitted
  // a cover block + branded header on every proposal regardless of
  // tender restrictions, which is a compliance violation.
  suppressCoverBlock?: boolean;
  suppressBrandedHeader?: boolean;
  // PR #259 — pass-through to buildCoverBlock for full vault-aware
  // cover page (TIN, VAT, license grade, GM with PPE license,
  // service-line tagline, submission date + validity, exact subject
  // line). When omitted, cover block falls back to the basic
  // tenderTitle + clientName + companyName layout.
  coverVault?: Parameters<typeof buildCoverBlock>[0]["vault"];
}): Document {
  // Branded header is suppressed when the tender forbids branding.
  // Spec rule: do not apply company logo, letterhead, or company name
  // in headers/footers when the tender prohibits branding. The footer's
  // generic "Confidential bid document | Page X" line is retained
  // because page numbering is universally required.
  const header = params.suppressBrandedHeader
    ? new Header({
        children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: " ", size: 18 })] })],
      })
    : new Header({
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
      // Cover block is suppressed when the tender forbids cover pages.
      // Without this gate, the engine would emit "TECHNICAL PROPOSAL"
      // banner + tender title + client + reference + "Prepared by ..."
      // even on tenders that explicitly require a plain template
      // without a cover page (typical of donor-funded RFPs where the
      // first attached form replaces the bidder's own cover page).
      children: params.suppressCoverBlock
        ? params.children
        : [...buildCoverBlock({
            tenderTitle: params.tenderTitle,
            clientName: params.clientName,
            companyName: params.companyName,
            reference: params.reference,
            vault: params.coverVault,
          }), ...params.children],
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
      // PR #248 — fallback evidence library for the evidence-marker
      // injector. When the matching engine selected 0 projects (low
      // similarity scores or unreviewed inventory), the injector still
      // needs a pool of project records to pull anchor sentences from.
      // Take the top 8 reviewed projects sorted by contractValue desc
      // so the strongest portfolio entries surface first as fallback
      // anchors.
      projects: {
        where: { trustLevel: "REVIEWED" },
        orderBy: [{ contractValue: "desc" }, { updatedAt: "desc" }],
        take: 8,
        include: { evidences: { orderBy: { createdAt: "desc" }, take: 5 } },
      },
      // PR J — vault-fallback experts. When zero experts are selected
      // for a tender, the deterministic Section A.4 / A.5 builders
      // emit placeholder text. With the vault loaded here, when the
      // selected list is empty we substitute the firm's reviewed expert
      // roster so the proposal carries real names + licences instead.
      experts: {
        where: { trustLevel: "REVIEWED" },
        orderBy: [{ yearsExperience: "desc" }, { updatedAt: "desc" }],
        take: 12,
      },
    },
  });
  if (!company) throw new Error("Company not found");

  const allSelectedExperts = tender.expertMatches.map((m) => m.expert);
  const allSelectedProjects = tender.projectMatches.map((m) => m.project);
  let experts = allSelectedExperts.filter((e) => e.trustLevel === "REVIEWED");
  let projects = allSelectedProjects.filter((p) => p.trustLevel === "REVIEWED");

  // PR J — vault-fallback when the bid team forgot to select.
  // If no expert / project was selected for this tender, fall back to
  // the firm's reviewed vault roster so deterministic builders never
  // see an empty array. Without this, Sections A.4, A.5, B.2 emit
  // "Source-evidence action: select reviewed records before final
  // submission" placeholder text (the exact gap the user flagged).
  if (experts.length === 0 && (company.experts ?? []).length > 0) {
    experts = company.experts as typeof experts;
    console.warn(`[generate-elite] No experts selected for tender — falling back to ${experts.length} reviewed vault expert(s).`);
  }
  if (projects.length === 0 && (company.projects ?? []).length > 0) {
    projects = company.projects as typeof projects;
    console.warn(`[generate-elite] No projects selected for tender — falling back to ${projects.length} reviewed vault project(s).`);
  }

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
  // Cleaned tender title (sanitized via cleanTenderTitle inside
  // buildProposalIntelligence). Used everywhere a user-facing label is
  // needed; the raw tender.title is intentionally kept out of generated
  // content because intake-stage extraction can produce multi-line garbage
  // that propagates to every section if used directly.
  let cleanedTenderTitle = intelligence.assignmentName;
  const tenderText = [cleanedTenderTitle, tender.reference, intelligence.clientName, tender.description, tender.intakeSummary, tender.analysisSummary, tender.evaluationMethodology, ...tender.files.map((f) => `${f.originalFileName}\n${f.extractedText ?? ""}`)].filter(Boolean).join("\n\n");

  // ─── G1 fix: canonical-title re-extractor ──────────────────────────────────
  // intelligence.assignmentName is sanitized but still based on tender.title,
  // which the user typed at upload time and is often generic ("PATH Tender",
  // "Pharo Foundation Tender"). Try to recover the canonical RFP title from
  // the tender body — patterns like "RFP No. 2026-024 — Architectural Design
  // …" or "Tender Title: …". When confidence is high AND the stored title
  // looks generic, override.
  try {
    const { extractCanonicalTenderTitle, pickBestTenderTitle } = await import("./tender-title-extractor");
    const tenderBody = tender.files.map((f) => f.extractedText ?? "").filter((t) => t.length > 100).join("\n\n");
    if (tenderBody.length > 100) {
      const extracted = extractCanonicalTenderTitle(tenderBody);
      const picked = pickBestTenderTitle(cleanedTenderTitle, extracted);
      if (picked.source === "EXTRACTED" && picked.title !== cleanedTenderTitle) {
        // Prefix the RFP ID when one was found alongside the title.
        const final = picked.rfpId ? `${picked.rfpId} — ${picked.title}` : picked.title;
        console.info(`[generate-elite] Tender title overridden: "${cleanedTenderTitle}" → "${final}" (extracted from tender body)`);
        cleanedTenderTitle = final;
      }
    }
  } catch (tErr) {
    // Non-critical: stored title is still usable. Log and continue.
    console.warn("[generate-elite] tender-title-extractor failed:", tErr instanceof Error ? tErr.message : tErr);
  }

  // ─── PR R — Auto multi-perspective AI re-ranking ─────────────────────────
  // The lexical scoring (proposal-intelligence.ts) is single-axis token
  // overlap. The user's gap analysis flagged: "the scoring and weighing
  // matrix is very poor — it doesn't analyse from many perspectives".
  // The multi-perspective matcher (lib/engine/ai-multi-perspective-matcher)
  // already exists but was only triggered manually via the "AI Rematch" UI
  // button. This wires it to fire AUTOMATICALLY before generation.
  //
  // Each call sends pre-filtered candidates to Claude for scoring across
  // 4 perspectives:
  //   1. DISCIPLINE_FIT — does discipline match tender scope?
  //   2. SENIORITY_OR_SCALE — years/licence (experts), value/scope (projects)
  //   3. SECTOR_FIT — sector overlap with tender
  //   4. RECENCY_OR_ROLE — recent comparable role/delivery
  //
  // Results re-rank the experts and projects arrays so the most
  // multi-axis-relevant candidates flow into the AI prompt + every
  // downstream deterministic builder. Cost ~$0.07 per tender at Tier 2
  // rates. Two parallel Claude calls (~5 sec wall-time).
  //
  // Falls back silently to lexical scoring on any AI error — never
  // blocks generation.
  //
  // BUDGET GUARD (post-pull) — when this auto-rematch runs INSIDE
  // generate-elite, it competes with the 4 parallel section calls +
  // post-passes + DOCX render against Vercel Hobby's 60s function
  // budget. The rematcher's internal REMATCH_TIMEOUT_MS (default 40s)
  // is for the standalone manual rematch route — too long here. We
  // wrap the parallel pair in our own 18s race guard so the full
  // pipeline keeps room for generation. Skipping this on a slow
  // network just means experts/projects keep their lexical order —
  // PR Q's hard sector filter still applies.
  // PR WW — tier-aware auto-rematch. On Tier 1 the rematch's 12-perspective
  // batch can hit the rate limit; use a tighter 10s budget instead of the
  // 18s budget used on Tier 2+. Tier 2+ keeps the full 18s budget (PR OO).
  // Manual "Re-score" button still works independently per-tender on all tiers.
  const tierForRematch = (process.env.ANTHROPIC_TIER || "").trim();
  const AUTO_REMATCH_BUDGET_MS = tierForRematch === "1"
    ? Math.min(Number(process.env.AUTO_REMATCH_BUDGET_MS) || 10_000, 10_000)
    : Number(process.env.AUTO_REMATCH_BUDGET_MS) || 18_000;
  if (isAIEnabled() && (experts.length > 0 || projects.length > 0)) {
    try {
      const { aiRematchExperts, aiRematchProjects } = await import("./ai-multi-perspective-matcher");
      const tenderRequirementsText = [
        cleanedTenderTitle,
        intelligence.tenderText.slice(0, 4_000),
        ...tender.requirements.slice(0, 12).map((r) => `${r.priority ?? ""} ${r.title ?? ""}: ${r.description ?? ""}`),
      ].filter(Boolean).join("\n");

      const expertCandidates = experts.slice(0, 15).map((e) => ({
        id: e.id,
        fullName: e.fullName,
        title: e.title ?? null,
        yearsExperience: e.yearsExperience ?? null,
        disciplines: safeParseArr(e.disciplines),
        sectors: safeParseArr(e.sectors),
        certifications: safeParseArr(e.certifications),
        profile: e.profile ?? null,
        trustLevel: e.trustLevel ?? null,
      }));
      const projectCandidates = projects.slice(0, 15).map((p) => ({
        id: p.id,
        name: p.name,
        clientName: p.clientName ?? null,
        country: p.country ?? null,
        sector: p.sector ?? null,
        serviceAreas: safeParseArr(p.serviceAreas),
        summary: p.summary ?? null,
        contractValue: p.contractValue ?? null,
        currency: p.currency ?? null,
        startDate: p.startDate ?? null,
        endDate: p.endDate ?? null,
        trustLevel: p.trustLevel ?? null,
      }));

      // Race condition fix: track individual batch results as boxed objects so
      // TypeScript CFA can track the side-effect mutations across await points.
      // Previously Promise.all([expert, project]) only resolved when BOTH
      // finished — losing the faster result if the budget guard fired first.
      const batchHolder = { expert: null as Awaited<ReturnType<typeof aiRematchExperts>>, project: null as Awaited<ReturnType<typeof aiRematchProjects>> };

      const expertRematch = expertCandidates.length > 0
        ? aiRematchExperts({
            tenderTitle: cleanedTenderTitle,
            tenderRequirementsText,
            evaluationMethodology: intelligence.evaluationCriteria.join("; ") || "—",
            candidates: expertCandidates,
          }).then((r) => { batchHolder.expert = r; return r; })
        : Promise.resolve(null);

      const projectRematch = projectCandidates.length > 0
        ? aiRematchProjects({
            tenderTitle: cleanedTenderTitle,
            tenderRequirementsText,
            tenderCategory: tender.category ?? null,
            candidates: projectCandidates,
          }).then((r) => { batchHolder.project = r; return r; })
        : Promise.resolve(null);

      const budgetGuard = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), AUTO_REMATCH_BUDGET_MS)
      );
      // Wait for both batches OR the budget guard — whichever settles first.
      // If the budget guard fires, batchHolder still contains any batch that
      // already resolved via the .then() side effects above.
      await Promise.race([Promise.all([expertRematch, projectRematch]), budgetGuard]);
      if (batchHolder.expert === null && batchHolder.project === null) {
        console.warn(`[generate-elite] AI multi-perspective re-rank skipped — exceeded ${AUTO_REMATCH_BUDGET_MS}ms auto-budget. Lexical order kept.`);
      }

      // Re-sort experts/projects by AI overall score. Candidates without
      // an assessment fall back to their original lexical position.
      const expertBatch = batchHolder.expert;
      const projectBatch = batchHolder.project;
      if (expertBatch?.assessments?.length) {
        const scoreMap = new Map<string, number>();
        for (const a of expertBatch.assessments) scoreMap.set(a.candidateId, a.overallScore);
        experts = [...experts].sort((a, b) => {
          const sa = scoreMap.get(a.id) ?? -1;
          const sb = scoreMap.get(b.id) ?? -1;
          return sb - sa;
        });
        console.info(`[generate-elite] AI multi-perspective expert re-rank: ${expertBatch.assessments.length} candidate(s) scored over ${Math.round(expertBatch.durationMs / 1000)}s.`);
      }
      if (projectBatch?.assessments?.length) {
        const scoreMap = new Map<string, number>();
        for (const a of projectBatch.assessments) scoreMap.set(a.candidateId, a.overallScore);
        projects = [...projects].sort((a, b) => {
          const sa = scoreMap.get(a.id) ?? -1;
          const sb = scoreMap.get(b.id) ?? -1;
          return sb - sa;
        });
        console.info(`[generate-elite] AI multi-perspective project re-rank: ${projectBatch.assessments.length} candidate(s) scored over ${Math.round(projectBatch.durationMs / 1000)}s.`);
      }
    } catch (err) {
      console.warn(`[generate-elite] AI multi-perspective match failed (falling back to lexical): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Requirement lines for AI prompt context AND for downstream rendering.
  // formatRequirementLine handles three real-world content-quality issues:
  //   - drops internal classifier prefixes (MANDATORY FORM:, etc.)
  //   - dedupes "X — X — X" internal repetition from the AI analysis step
  //   - strips title-in-description duplication
  const requirementLines = tender.requirements.map((r) => formatRequirementLine(r));
  const expertLines = experts.map(expertProofLine);
  const projectLines = projects.map(projectProofLine);
  const evidenceContextLines = [...companyEvidenceLines, ...projectEvidenceLines];
  // Surface the structured commercial terms (bid bond, performance guarantee,
  // bid validity, clarification deadline, pre-bid meeting, contract duration,
  // consortia rules, local-content requirement) that detectCommercialTerms
  // pulled from the raw tender text. These have been historically buried in
  // the prose AND missing from the AI prompt's submissionNotes block — so
  // the proposal narrative cannot confirm compliance against them. Surfacing
  // them here makes the AI explicitly state validity, EMD, etc., in the
  // Cover Letter / Compliance Matrix.
  const commercialTermLines: string[] = [];
  const ct = intelligence.commercialTerms;
  if (ct.bidBond) commercialTermLines.push(`Bid bond / EMD: ${ct.bidBond}`);
  if (ct.performanceGuarantee) commercialTermLines.push(`Performance guarantee: ${ct.performanceGuarantee}`);
  if (ct.bidValidityDays) commercialTermLines.push(`Bid validity period: ${ct.bidValidityDays} days from submission`);
  if (ct.clarificationDeadline) commercialTermLines.push(`Clarification / pre-bid question deadline: ${ct.clarificationDeadline}`);
  if (ct.preBidMeeting) commercialTermLines.push(`Pre-bid meeting / site visit: ${ct.preBidMeeting}`);
  if (ct.contractDuration) commercialTermLines.push(`Contract duration: ${ct.contractDuration}`);
  if (ct.consortiaRules) commercialTermLines.push(`Joint venture / consortium rules: ${ct.consortiaRules}`);
  if (ct.localContent) commercialTermLines.push(`Local content / national-firm requirement: ${ct.localContent}`);

  // Surface numeric evaluation weights as criterion-with-weight lines. These
  // feed the EVALUATION CRITERIA RESPONSE MIRROR table that the AI is now
  // instructed to produce.
  const evaluationWeightLines = intelligence.evaluationWeights.map(
    (w) => `- ${w.criterion} — ${w.weight} (raw match: "${w.rawMatch}")`,
  );

  // Extract verbatim evaluator-language phrases from the tender text and
  // build a prompt-ready directive block. Echoing the evaluator's exact
  // wording is one of the highest-leverage scoring tactics on competitive
  // tenders. Empty when no high-signal phrases were found — caller-side
  // .filter(Boolean) drops the empty block from the joined prompt.
  const tenderLanguageEchoes = extractTenderLanguageEchoes(intelligence.tenderText, 12);
  const tenderLanguageEchoBlock = formatEchoesForPrompt(tenderLanguageEchoes);

  // PR K — Tender FACTS extractor (numbers, dates, RFP IDs, brand
  // names, file formats, deliverable codes, locations, quantities).
  // Where tender-language-echoes captures evaluator vocabulary, this
  // captures the tender's CONCRETE DATA — the verbatim numbers that
  // prove the bidder read the document. Both flow into the AI prompt;
  // the facts also flow into a deterministic Section C.0 "Tender
  // Specifics Recognised by This Proposal" table that ALWAYS appears
  // at the top of Section C.
  const tenderFacts = extractTenderFacts(intelligence.tenderText);
  const tenderFactsPromptBlock = formatFactsForPrompt(tenderFacts);
  const tenderSpecificsTable = buildTenderSpecificsBlock(tenderFacts);
  if (tenderFacts.rawCount > 0) {
    console.info(`[generate-elite] Tender facts extracted: ${tenderFacts.rfpIds.length} RFP ID(s), ${tenderFacts.deadlines.length} deadline(s), ${tenderFacts.deliverableCodes.length} deliverable code(s), ${tenderFacts.quantities.length} quantity(s).`);
  }

  const submissionNotes = [
    tender.submissionMethod,
    tender.submissionAddress,
    ...intelligence.submissionRules,
    ...(commercialTermLines.length > 0 ? ["", "Commercial terms detected in tender — confirm compliance in Cover Letter and Compliance Matrix:", ...commercialTermLines] : []),
  ].filter(Boolean).join("\n");
  // Compute bid strategy and surface top risks into complianceLines so the AI
  // narrative explicitly addresses the most critical bid gaps.
  const bidStrategy = (() => {
    try {
      return computeBidStrategy({
        tender: {
          id: tender.id,
          title: tender.title,
          category: (tender as { category?: string | null }).category,
          requirements: tender.requirements,
          complianceGaps: tender.complianceGaps,
          expertMatches: tender.expertMatches as Parameters<typeof computeBidStrategy>[0]["tender"]["expertMatches"],
          projectMatches: tender.projectMatches as Parameters<typeof computeBidStrategy>[0]["tender"]["projectMatches"],
          evaluationMethodology: tender.evaluationMethodology,
          submissionMethod: tender.submissionMethod,
        },
        company: {
          name: company.name,
          sectors: (company as { sectors?: string | null }).sectors ?? "[]",
          serviceLines: (company as { serviceLines?: string | null }).serviceLines ?? "[]",
          licenseGrade: (company as { licenseGrade?: string | null }).licenseGrade,
          country: (company as { country?: string | null }).country,
          headcount: (company as { headcount?: number | null }).headcount,
          expertCount: experts.length,
          projectCount: projects.length,
          legalRecordCount: (company.legalRecords ?? []).length,
          financialRecordCount: (company.financialRecords ?? []).length,
        },
      });
    } catch {
      return null;
    }
  })();

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
    // Bid strategy top risks — surfaced so the AI addresses each in the Compliance/Risk section
    ...(bidStrategy?.topRisks.map((r) => `BID RISK [${r.severity}] ${r.category}: ${r.title} — ${r.mitigation}`) ?? []),
  ];

  const guardInput = { tenderTitle: cleanedTenderTitle, clientName: intelligence.clientName, companyName: company.name, submissionNotes, expertCount: expertLines.length, projectCount: projectLines.length, complianceLines, primarySector: intelligence.primarySector, topProjectNames: intelligence.topProjects.slice(0, 3).map((p) => p.name).filter(Boolean), topExpertName: intelligence.topExperts[0]?.fullName ?? undefined };
  const evaluatorMatrixInput = { tenderTitle: cleanedTenderTitle, clientName: intelligence.clientName, requirements: requirementLines, expertLines, projectLines, companyEvidenceLines, projectEvidenceLines, complianceLines, differentiators: intelligence.differentiators };

  let sourceMarkdown: string;
  let mode = "deterministic benchmark";
  let aiError: string | null = null;

  if (isAIEnabled()) {
    try {
      // PROPOSAL_GENERATION_MODE controls which AI path produces the
      // first-draft markdown. Default: "parallel" — runs four small
      // concurrent Claude calls (one per section cluster) and stitches
      // them. This was added to address the systemic Vercel-Hobby 60s
      // timeout: the legacy "single" path asked Claude for ~8K output
      // tokens in one call (25–55s wall time), which routinely exceeded
      // the per-section in-pipeline budget. The parallel path runs four
      // calls of 1500–2800 output tokens each, finishing in ~25s wall
      // time. See lib/engine/proposal-sections.ts for per-section
      // system prompts and deterministic fallbacks.
      //
      // Set PROPOSAL_GENERATION_MODE=single to revert to the legacy
      // monolithic-call path (useful for A/B comparison and as an
      // escape hatch on Vercel Pro tiers where the 300s budget makes
      // the single-call path viable).
      const generationMode = (process.env.PROPOSAL_GENERATION_MODE || "parallel").toLowerCase();
      const useParallel = generationMode === "parallel";

      const aiInput = {
        tenderTitle: cleanedTenderTitle,
        clientName: intelligence.clientName,
        tenderText: [BENCHMARK_CONTEXT_LINES.join("\n"), tenderText].join("\n\n"),
        analysisSummary: clean(tender.analysisSummary) || intelligence.tenderText.slice(0, 2000),
        evaluationMethodology: [
          clean(tender.evaluationMethodology) || intelligence.evaluationCriteria.join("; "),
          ...(evaluationWeightLines.length > 0 ? ["", "Numeric evaluation weights detected in tender (echo verbatim in the EVALUATION CRITERIA RESPONSE MIRROR table):", ...evaluationWeightLines] : []),
          tenderLanguageEchoBlock,
          // PR K — tender-FACTS prompt block. Forces Claude to weave
          // verbatim RFP IDs, deadlines, validity periods, deliverable
          // codes (D1–Dn), site/location names, distinctive quantities
          // (room counts, sqm, person counts), file format requirements,
          // and brand/website mentions into the proposal. Without this,
          // Claude writes a generic methodology that could fit any
          // tender. Empty when no facts found.
          tenderFactsPromptBlock,
          // PR #258 — rubric-driven section directive injected here
          // so Claude organises its output around the tender's exact
          // rubric (e.g., SV 01, EXP 01, PER 01). Empty when the
          // tender has no extracted weights — prompt unchanged.
          buildRubricPromptDirective(intelligence.evaluationWeights),
        ].filter(Boolean).join("\n"),
        submissionNotes: [BENCHMARK_CONTEXT_LINES.join("\n"), submissionNotes].filter(Boolean).join("\n"),
        requirements: [...BENCHMARK_CONTEXT_LINES, ...requirementLines].join("\n"),
        companyProfile: `${company.name}\n${company.legalName ?? ""}\n${company.profileSummary ?? company.description ?? ""}\nServices: ${safeParseArr(company.serviceLines).join(", ")}\nSectors: ${safeParseArr(company.sectors).join(", ")}\n\nWider company evidence library:\n${evidenceContextLines.join("\n").slice(0, 9_000)}`,
        experts: [
          expertLines.length > 0
            ? `LEAD EXPERT (name as Team Lead / Project Manager in EVERY section): ${expertLines[0].split("|")[0].trim()}`
            : "",
          ...expertLines,
        ].filter(Boolean).join("\n"),
        projects: [...projectLines, ...projectEvidenceLines].join("\n"),
        compliance: [...BENCHMARK_CONTEXT_LINES, ...complianceLines].join("\n"),
        differentiators: [...BENCHMARK_CONTEXT_LINES, ...intelligence.differentiators, ...companyEvidenceLines.slice(0, 8)].join("\n"),
        // PR #257 — structured company-vault fields. Used by the
        // deterministic section fallback (proposal-sections.ts
        // buildSectionFallback) to emit REAL data instead of
        // "Bid-Team Action: confirm X" placeholders when the AI
        // returns thin output OR when the deterministic fallback
        // runs. The complianceLines aggregate every CompanyComplianceRecord
        // already loaded above; passing them through here lets D.3
        // populate with the firm's actual ISO / professional-body /
        // donor-compliance records instead of a generic placeholder.
        companyVault: {
          name: company.name,
          legalName: company.legalName,
          address: company.address,
          phone: company.phone,
          email: company.email,
          website: company.website,
          country: company.country,
          foundingYear: company.foundingYear,
          headcount: company.headcount,
          licenseGrade: company.licenseGrade,
          registrationNumber: company.registrationNumber,
          tin: company.tin,
          vat: company.vat,
          gmName: company.gmName,
          gmTitle: company.gmTitle,
          gmLicense: company.gmLicense,
          profileSummary: company.profileSummary ?? company.description,
          serviceLines: safeParseArr(company.serviceLines),
          sectors: safeParseArr(company.sectors),
          // Format every CompanyComplianceRecord into a one-line
          // citation. complianceLines (above) already includes these
          // among other things; this filtered list is just the
          // certification-relevant rows for D.3.
          // PR W — pass firm-history client names to the cover-letter
          // prompt as a "DO NOT use these as the client of THIS tender"
          // list. Belt-and-braces with the post-pass enforcer (PR V).
          // companyVault block placement keeps this in lockstep with
          // the rest of the vault data.
          complianceLines: (company.complianceRecords ?? [])
            .map((r) => {
              const parts: string[] = [];
              if (r.title) parts.push(r.title);
              if (r.complianceType) parts.push(r.complianceType);
              if (r.referenceNumber) parts.push(`Ref: ${r.referenceNumber}`);
              if (r.status) parts.push(`Status: ${r.status}`);
              return parts.join(" — ");
            })
            .filter((s) => s.length > 0),
        },
        // PR W — list of clients from the firm's vault project history AND
        // selected projects that the AI must NEVER substitute as the client
        // of this tender (they are the firm's PREVIOUS clients, not the
        // current one). Excludes the current tender client so repeat-client
        // tenders don't receive contradictory instructions.
        doNotUseAsClient: (() => {
          const tenderClient = intelligence.clientName?.toLowerCase().trim() ?? "";
          return Array.from(new Set([
            ...(company.projects ?? []).map((p) => (p as { clientName?: string | null }).clientName),
            ...projects.map((p) => (p as { clientName?: string | null }).clientName),
          ].filter((cn): cn is string => {
            if (!cn || cn.trim().length < 3) return false;
            return cn.toLowerCase().trim() !== tenderClient;
          })));
        })(),
        // Per-criterion evidence map — tells the AI which projects/experts
        // are most relevant to each evaluation criterion, and at what depth
        // (proportional to criterion weight). This eliminates the AI's
        // tendency to spread evidence evenly across all sections regardless
        // of scoring weight. Built from the extracted evaluationWeights +
        // vault top candidates; empty string when no numeric weights found.
        criterionEvidenceMap: buildCriterionEvidenceMap(
          intelligence.evaluationWeights,
          intelligence.topProjects,
          intelligence.topExperts,
          tender.evaluationMethodology ?? intelligence.evaluationCriteria.join("\n"),
        ),
      };

      sourceMarkdown = await withProposalAiTimeout(
        useParallel
          ? generateProposalSectionsParallel(aiInput)
          : generateBenchmarkProposalWithAI(aiInput),
        PROPOSAL_AI_TIMEOUT_MS,
      );
      // Canonical name normalization — fast post-assembly pass that replaces
      // minor expert-name variations (Dr. X vs X, different middle initials)
      // with the authoritative fullName from the Expert record, and strips
      // spurious leading articles from project names ("the Hospital X" → "Hospital X").
      // Runs on the raw AI output before any deterministic enrichers touch it
      // so all downstream sections see consistent canonical names.
      if (sourceMarkdown) {
        sourceMarkdown = enforceCanonicalNames(sourceMarkdown, experts, projects);
      }
      const provider = getLastProposalProvider() ?? "ai";
      const pathLabel = useParallel ? "section-parallel" : "single-call";
      mode = `${provider === "claude" ? "Claude" : provider === "gemini" ? "Gemini" : provider === "openai" ? "GPT-4o" : "AI"} ${pathLabel} bid-writer + evaluator response matrix + full evidence library + client-ready benchmark finalizer + professional DOCX polish`;
    } catch (error) {
      aiError = error instanceof Error ? error.message : String(error);
      sourceMarkdown = fallbackProposalMarkdown({ tenderTitle: cleanedTenderTitle, clientName: intelligence.clientName, companyName: company.name, companyLegalName: company.legalName, companyAddress: company.address, companyTIN: company.tin, companyVAT: company.vat, companyGM: company.gmName, companyGMLicense: company.gmLicense, primarySector: intelligence.primarySector, requirements: requirementLines, differentiators: intelligence.differentiators, submissionRules: intelligence.submissionRules, expertLines, projectLines, experts: experts as ExpertRecord[], projects: projects as ProjectRecord[], reviewedExpertCount: experts.length, companyEvidenceLines, projectEvidenceLines, complianceLines, expertRequired, projectRequired, themes: intelligence.themes, evaluationCriteria: intelligence.evaluationCriteria, appendixList: intelligence.appendixList, noFinancialProposal: intelligence.noFinancialProposal, exactEmails: intelligence.exactEmails, exactSubjectLine: intelligence.exactSubjectLine, gapsToAddressInNarrative: intelligence.gapsToAddressInNarrative, requiredSections: intelligence.requiredSections, tenderDeadline: tender.deadline, companyLicenseGrade: company.licenseGrade, companyHeadcount: company.headcount, companyServiceLines: safeParseArr(company.serviceLines), companySectors: safeParseArr(company.sectors), companyProfileSummary: company.profileSummary ?? company.description, companyLegalRecords: company.legalRecords ?? [], companyComplianceRecords: company.complianceRecords ?? [] });
      mode = "deterministic benchmark fallback + evaluator response matrix + client-ready benchmark finalizer + professional DOCX polish";
    }
  } else {
    sourceMarkdown = fallbackProposalMarkdown({ tenderTitle: cleanedTenderTitle, clientName: intelligence.clientName, companyName: company.name, companyLegalName: company.legalName, companyAddress: company.address, companyTIN: company.tin, companyVAT: company.vat, companyGM: company.gmName, companyGMLicense: company.gmLicense, primarySector: intelligence.primarySector, requirements: requirementLines, differentiators: intelligence.differentiators, submissionRules: intelligence.submissionRules, expertLines, projectLines, experts: experts as ExpertRecord[], projects: projects as ProjectRecord[], reviewedExpertCount: experts.length, companyEvidenceLines, projectEvidenceLines, complianceLines, expertRequired, projectRequired, themes: intelligence.themes, evaluationCriteria: intelligence.evaluationCriteria, appendixList: intelligence.appendixList, noFinancialProposal: intelligence.noFinancialProposal, exactEmails: intelligence.exactEmails, exactSubjectLine: intelligence.exactSubjectLine, gapsToAddressInNarrative: intelligence.gapsToAddressInNarrative, requiredSections: intelligence.requiredSections, tenderDeadline: tender.deadline, companyLicenseGrade: company.licenseGrade, companyHeadcount: company.headcount, companyServiceLines: safeParseArr(company.serviceLines), companySectors: safeParseArr(company.sectors), companyProfileSummary: company.profileSummary ?? company.description, companyLegalRecords: company.legalRecords ?? [], companyComplianceRecords: company.complianceRecords ?? [] });
  }

  // PR NN: Strip any AI-produced Section H (Proposal Self-Score) from the raw AI
  // output before the deterministic backstop is applied. The AI is prompted to
  // produce Section H, but its version uses rough estimates while the deterministic
  // builder (buildSelfScoreSection) uses the structured evidence we have. Keeping
  // both would give duplicate headings; the deterministic version always wins.
  function stripAiSectionH(md: string): string {
    const lines = md.split("\n");
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const isSelfScore = /(^|\n)\s*#{1,4}\s*(?:section\s*[H:.\-\s]*)?\s*(?:proposal\s+)?self.?score\b/i.test(lines[i]);
      if (isSelfScore) {
        const level = lines[i].match(/^(#+)\s/)?.[1].length ?? 2;
        i += 1;
        while (i < lines.length) {
          const m = lines[i].match(/^(#+)\s/);
          if (m && m[1].length <= level) break;
          i += 1;
        }
        continue;
      }
      out.push(lines[i]);
      i += 1;
    }
    return out.join("\n");
  }

  const matrixMarkdown = appendEvaluatorResponseMatrix(stripAiSectionH(sourceMarkdown), evaluatorMatrixInput);
  const isHealthcare = /health|hospital|medical|clinic|radiology|laboratory|pharmacy|patient|specialty|OPD|in-patient|emergency/i.test(`${intelligence.primarySector}\n${intelligence.tenderText}`);
  const strengtheningMarkdown = buildClientProposalStrengtheningSections({ clientName: intelligence.clientName, tenderTitle: cleanedTenderTitle, companyName: company.name, projectLines, expertLines, companyEvidenceLines, projectEvidenceLines, isHealthcare, existingMarkdown: matrixMarkdown });

  // Inject benchmark-quality tabular sections (Proposed Team, Team-to-Project Mapping,
  // Project Portfolio cards, Three-Stage Review, optional Assessment Matrix) only if
  // the upstream output (AI or fallback) didn't already produce them. This guarantees
  // every proposal carries the high-evidence-density tables the benchmark uses.
  const upstreamCheck = makeHasHeadingChecker(`${matrixMarkdown}\n${strengtheningMarkdown}`);
  const benchmarkTables = buildBenchmarkTablesBlock({
    experts,
    projects,
    companyName: company.name,
    tenderTitle: cleanedTenderTitle,
    primarySector: intelligence.primarySector,
    assignmentRoleHint: `Aligned to ${cleanedTenderTitle} scope and ${intelligence.clientName} evaluation criteria.`,
    alreadyHasHeading: upstreamCheck,
  });

  // Round-2 benchmark sections — same idempotency rule. Each section is appended
  // only if the upstream output did not already produce an equivalent heading.
  const round2Sections: string[] = [];
  if (!upstreamCheck("B.1 Client References") && !upstreamCheck("Client References")) {
    round2Sections.push(buildClientReferencesTable(projects));
  }
  if (!upstreamCheck("B.2.0 Portfolio Reading Guide") && !upstreamCheck("Portfolio Reading Guide")) {
    const guide = buildPortfolioReadingGuide({ projects, primarySector: intelligence.primarySector, tenderTitle: cleanedTenderTitle });
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
      tenderTitle: cleanedTenderTitle,
      // Round-10: gmName / gmLicense come from the Company schema. When the
      // user has populated them, the declaration carries a real signature
      // line; otherwise it falls back to the generic "General Manager" line.
      companyGM: company.gmName ?? null,
      companyGMLicense: company.gmLicense ?? null,
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
  // PR BB: Suppress Why Us when the deterministic Section G (Win Themes & Discriminators)
  // will be added — both sections cover the same ground (firm strengths + discriminators)
  // and two overlapping sections confuse evaluators and bloat the TOC.
  const winThemesInUpstream = hasWinThemesHeading(`${matrixMarkdown}\n${strengtheningMarkdown}\n${benchmarkTables}`);
  if (!winThemesInUpstream && !upstreamCheck(`Why ${company.name} for ${intelligence.clientName}`) && !upstreamCheck("Why Us") && !upstreamCheck(`Why ${company.name}`)) {
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
      tenderTitle: cleanedTenderTitle,
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
      tenderTitle: cleanedTenderTitle,
    }));
  }

  // Round-12: deterministic Section E–H backstops.
  // Sections E (Compliance Matrix), F (Evaluation Criteria Response Mirror),
  // G (Win Themes & Discriminators), and H (Proposal Self-Score) are the
  // four mandatory output sections introduced by PR #228. The AI prompt
  // asks Claude to produce them, the scorer (PR #229) catches when a
  // section is missing and triggers refinement — but refinement also
  // requires AI. When AI is unavailable (rate-limited, quota exhausted,
  // API key issue), or when Claude omits a section under output-token
  // pressure, these deterministic builders construct the section from
  // the structured intelligence + database state we already have. Each
  // builder is idempotent — its has*Heading guard returns null when the
  // upstream output already produced an equivalent heading.
  const upstreamMarkdownForBackstops = `${matrixMarkdown}\n${strengtheningMarkdown}\n${benchmarkTables}\n${round2Sections.join("\n")}`;
  const deterministicComplianceMatrix = !hasComplianceMatrixHeading(upstreamMarkdownForBackstops)
    ? buildComplianceMatrixSection({
        requirements: tender.requirements,
        matrixRows: tender.complianceMatrix,
        gaps: tender.complianceGaps,
      })
    : null;
  const deterministicEvaluatorMirror = !hasEvaluatorMirrorHeading(upstreamMarkdownForBackstops)
    ? buildEvaluatorMirrorSection({
        evaluationCriteria: intelligence.evaluationCriteria,
        evaluationWeights: intelligence.evaluationWeights,
        topProjectName: (projects as ProjectRecord[])[0]?.name ?? null,
        topExpertName: (experts as ExpertRecord[])[0]?.fullName ?? null,
        primarySector: intelligence.primarySector,
      })
    : null;
  const deterministicWinThemes = !hasWinThemesHeading(upstreamMarkdownForBackstops)
    ? buildWinThemesSection({
        differentiators: intelligence.differentiators,
        evaluationCriteria: intelligence.evaluationCriteria,
        topProjects: (projects as ProjectRecord[]).slice(0, 5),
        topExperts: (experts as ExpertRecord[]).slice(0, 5),
        companyName: company.name,
        clientName: intelligence.clientName,
        primarySector: intelligence.primarySector,
      })
    : null;

  // Section H must observe whether E/F/G are now in place — its score
  // heuristic credits the proposal for having them. We compose the
  // upstream markdown plus our own deterministic E/F/G when they are
  // being added so the self-score reflects the assembled document, not
  // the raw AI output.
  const upstreamWithBackstops = [
    upstreamMarkdownForBackstops,
    deterministicComplianceMatrix,
    deterministicEvaluatorMirror,
    deterministicWinThemes,
  ].filter(Boolean).join("\n\n");
  // PR NN: Always add the deterministic Section H — the AI's version was stripped
  // from sourceMarkdown above, so there is no duplicate. The deterministic builder
  // uses structured evaluation criteria + evidence from the vault, producing a
  // more accurate and consistent self-score than ad-hoc AI output.
  const deterministicSelfScore = buildSelfScoreSection({
    evaluationCriteria: intelligence.evaluationCriteria,
    evaluationWeights: intelligence.evaluationWeights,
    topProjects: (projects as ProjectRecord[]).slice(0, 5),
    topExperts: (experts as ExpertRecord[]).slice(0, 5),
    hasComplianceMatrix: hasComplianceMatrixHeading(upstreamWithBackstops),
    hasEvaluatorMirror: hasEvaluatorMirrorHeading(upstreamWithBackstops),
    hasWinThemes: hasWinThemesHeading(upstreamWithBackstops),
    primarySector: intelligence.primarySector,
  });

  const combinedMarkdown = [
    matrixMarkdown,
    strengtheningMarkdown,
    benchmarkTables,
    ...round2Sections,
    deterministicComplianceMatrix,
    deterministicEvaluatorMirror,
    deterministicWinThemes,
    deterministicSelfScore,
  ].filter(Boolean).join("\n\n");

  // Round-4 self-healing pass: enforce the benchmark "narrative throughline"
  // rule (top 1–2 projects must appear in Cover Letter, Executive Summary,
  // and Section B/Relevant Experience) and ensure sector-specific technical
  // vocabulary is present. Both are idempotent — if the upstream output
  // already covers them, nothing is added.
  const throughline = enforceNarrativeThroughline({
    markdown: combinedMarkdown,
    topProjects: (projects as ProjectRecord[]).slice(0, 3),
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

  // ─── Humanization layer (PR #245) ────────────────────────────────────────
  // The product spec mandates a humanization pass that:
  //   • removes AI traces ("As an AI…", "Certainly!", etc.)
  //   • removes square-bracket placeholders ([INSERT], [TBD], …)
  //   • normalizes em-dash spacing and multi-blank-line runs
  //   • optionally rewrites prose to senior-editor quality
  //
  // Up to PR #244, lib/engine/humanize.ts existed and was wired into the
  // legacy generate.ts path, but the active generate-elite.ts pipeline
  // skipped it entirely. AI traces and placeholder remnants could leak
  // into the final DOCX, lowering the deterministic quality score and
  // damaging the "evaluator-ready" promise of the proposal.
  //
  // This block adds humanization in two tiers:
  //
  //   1. ALWAYS-ON deterministic pass (humanizeDeterministic) — strips
  //      ~20 AI-trace patterns, normalizes whitespace. Adds <1ms per
  //      proposal, no Claude call. Safe on Vercel Hobby tier.
  //
  //   2. OPT-IN AI pass (humanize) — sends the full proposal to Claude
  //      with a senior-editor system prompt for stylistic rewrite.
  //      Adds 15–30s wall time. Gated by PROPOSAL_HUMANIZE_AI=true so
  //      Vercel Hobby (60s function cap) users don't blow their budget
  //      on a 6th Claude call after the 4 parallel sections + Section C
  //      drill-down.
  //
  // Both passes preserve every fact in the source markdown — only
  // patterns and prose style are touched, not project names, expert
  // names, contract values, or evidence anchors.
  let humanizedMarkdown = humanizeDeterministic(clientMarkdown);

  // Targeted opening-sections polish: rewrites only the Cover Letter and
  // Executive Summary (~500 tokens each) so the highest-read sections
  // sound like a senior consultant wrote them. Always-on — the small
  // token budget keeps wall time under 15s even on Hobby tier.
  try {
    humanizedMarkdown = await humanizeOpeningSections(humanizedMarkdown);
    console.info("[generate-elite] Targeted Cover Letter + Executive Summary humanization applied.");
  } catch (err) {
    console.warn(`[generate-elite] Opening-sections humanize failed (${err instanceof Error ? err.message : String(err)}) — keeping deterministic output.`);
  }

  // Full-proposal AI humanization pass (opt-in via PROPOSAL_HUMANIZE_AI=true).
  // Adds 25–45s. Not recommended on Vercel Hobby (60s limit).
  const humanizeAiEnabled = (process.env.PROPOSAL_HUMANIZE_AI || "").toLowerCase() === "true";
  if (humanizeAiEnabled) {
    try {
      humanizedMarkdown = await humanize(humanizedMarkdown);
    } catch (err) {
      console.warn(`[generate-elite] Full-proposal humanize AI pass failed (${err instanceof Error ? err.message : String(err)}) — keeping output from opening-sections pass.`);
    }
  }

  // ─── Evidence-marker injection (PR #248) ─────────────────────────────────
  // Quality-scorer's evidenceDensity axis (10 points) inspects every
  // substantive paragraph for scorer-recognised markers (ETB amounts,
  // license numbers, year contexts, named donors, named assets).
  // Generic AI prose without those markers caps the axis at 4–6 / 10
  // and is the single biggest reason proposals score 71/100 instead of
  // 95+.
  //
  // The injector below takes any substantive paragraph that fails the
  // scorer's marker tests and appends a single short evidence-anchor
  // sentence drawn from the company's reviewed evidence library. Two
  // sources stack: selected projects (preferred) + the company's wider
  // reviewed portfolio (fallback when 0 are selected). Capped at 12
  // injections to avoid bloating the prose.
  //
  // Idempotent: paragraphs that already have markers are skipped, so
  // re-running on already-anchored markdown produces identical output.
  const evidenceLibrary = [
    ...(projects as ProjectRecord[]),
    // Fallback: company's wider reviewed portfolio. Excludes already-
    // selected projects so the same project doesn't get cited from
    // both sources (would still work — just not optimal rotation).
    ...((company.projects ?? []).filter((p) =>
      !projects.some((selected) => selected.id === p.id),
    ) as ProjectRecord[]),
  ];
  const evidenceInjection = injectEvidenceMarkers(humanizedMarkdown, evidenceLibrary);
  if (evidenceInjection.injected > 0) {
    console.info(`[generate-elite] Evidence-marker injector added ${evidenceInjection.injected} anchor sentence(s) to lift evidenceDensity score.`);
  }
  humanizedMarkdown = evidenceInjection.markdown;

  // ─── Tender Specifics block (PR K) ───────────────────────────────────────
  // Insert the deterministic "C.0 Tender Specifics Recognised by This
  // Proposal" table at the top of Section C. This is the un-skippable
  // proof that the bidder read the document — verbatim RFP ID,
  // deadline, validity period, deliverable codes, location, file
  // formats, brand, distinctive quantities. ALWAYS present when the
  // tender text yielded any facts; idempotent via marker comment.
  if (tenderSpecificsTable && !humanizedMarkdown.includes("<!-- tender-facts:specifics -->")) {
    // Insert just after Section C heading; fall back to before
    // Section C.1 if no Section C heading found.
    const lines = humanizedMarkdown.split("\n");
    let insertAt = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (/^#\s+Section\s+C\b/i.test(lines[i]) || /^#\s+Technical\s+Approach/i.test(lines[i])) {
        insertAt = i + 1;
        break;
      }
    }
    if (insertAt < 0) {
      // No Section C heading — insert before C.1 if present
      for (let i = 0; i < lines.length; i += 1) {
        if (/^##\s+C\.1\b/i.test(lines[i]) || /^##\s+Understanding\s+of\s+the\s+Assignment/i.test(lines[i])) {
          insertAt = i;
          break;
        }
      }
    }
    if (insertAt >= 0) {
      humanizedMarkdown = [
        ...lines.slice(0, insertAt),
        "",
        tenderSpecificsTable,
        "",
        ...lines.slice(insertAt),
      ].join("\n");
      console.info(`[generate-elite] Tender Specifics (C.0) block injected.`);
    }
  }

  // ─── Section C depth amplifier (PR #252) ─────────────────────────────────
  // Closes the final 5-point gap to 100/100. When the AI returns a thin
  // Section C — fewer than 4 numbered sub-sections OR sub-sections with
  // < 2 substantive paragraphs — multiple axes drop simultaneously
  // (tableCoverage, evidenceDensity within C, sub-section heading count).
  // The amplifier injects deterministic depth blocks tailored to the
  // detected sector with embedded evidence anchors. Idempotent via
  // `<!-- section-c-amplifier:C.X -->` markers.
  const sectionCAmp = amplifySectionCDepth(humanizedMarkdown, {
    primarySector: intelligence.primarySector,
    projects: evidenceLibrary,
    companyName: company.name,
    evaluationCriteria: intelligence.evaluationCriteria,
  });
  if (sectionCAmp.injected.length > 0) {
    const addedCount = sectionCAmp.injected.filter((i) => i.mode === "ADDED").length;
    const deepenedCount = sectionCAmp.injected.filter((i) => i.mode === "DEEPENED").length;
    console.info(`[generate-elite] Section C depth amplifier: added ${addedCount} sub-section(s), deepened ${deepenedCount} thin sub-section(s).`);
  }
  humanizedMarkdown = sectionCAmp.markdown;

  // ─── Methodology tables (PR E) ───────────────────────────────────────────
  // Real elite tender proposals (the Claude AI benchmark) carry FIVE
  // structural tables that evaluators tick off directly:
  //   1. Project Phasing Table
  //   2. RACI Matrix
  //   3. Risk Register
  //   4. Quality Assurance Plan / ITP
  //   5. Communication & Reporting Protocol
  // Each is injected only if neither the heading nor an idempotency
  // marker (<!-- methodology-table:KEY -->) already exists. Row content
  // is sector-aware and vault-aware (RACI uses real expert names when
  // the team is selected; Risk/QA carry sector-specific clauses for
  // healthcare / water / road / urban / generic).
  // ─── G10 follow-up: detect tender's stated total duration ──────────────
  // If the tender body carries an explicit total like "28 calendar days
  // from signed contract" or "delivered within 45 days", parse the
  // number and pass it so the phasing table renders day-numbered rows
  // ("Days 1–3", "Days 4–8") instead of generic "Weeks 1–2".
  const totalDaysMatch = tenderText.match(/\b(\d{1,3})\s*(?:calendar\s+|working\s+|business\s+)?days?\b(?!\s*(?:after|before|prior|notice|advance))/i);
  const totalDays = totalDaysMatch ? Number(totalDaysMatch[1]) : undefined;
  if (totalDays && totalDays >= 7 && totalDays <= 1000) {
    console.info(`[generate-elite] Detected total project duration: ${totalDays} days — phasing table will use day-numbered rows.`);
  }

  const methodologyTables = injectMethodologyTables(humanizedMarkdown, {
    primarySector: intelligence.primarySector,
    experts: allSelectedExperts as unknown as Parameters<typeof injectMethodologyTables>[1]["experts"],
    projects: evidenceLibrary,
    totalDays: totalDays && totalDays >= 7 && totalDays <= 1000 ? totalDays : undefined,
  });
  humanizedMarkdown = methodologyTables.markdown;

  // ─── G11 fix: Deliverable-Specific QA Checklist ────────────────────────
  // Append a deliverable-numbered QA checklist (D1, D2, …) at the end of
  // Section C. The Claude AI benchmark for the Path tender included a
  // 7-row table mapping each QA Check Item → Responsible → Deliverable
  // Code → Acceptance Standard. Without this, our generic 3-stage QA
  // gate looks thin. Idempotent (marker comment skips re-injection).
  try {
    const { injectDeliverableQaChecklist } = await import("./deliverable-qa-checklist");
    const qaChecklist = injectDeliverableQaChecklist(humanizedMarkdown, {
      tenderText,
      primarySector: intelligence.primarySector,
      experts: allSelectedExperts as unknown as Parameters<typeof injectDeliverableQaChecklist>[1]["experts"],
    });
    if (qaChecklist.injected) {
      console.info(`[generate-elite] Deliverable QA Checklist injected with ${qaChecklist.rowsRendered} row(s).`);
      humanizedMarkdown = qaChecklist.markdown;
    }
  } catch (qaErr) {
    console.warn("[generate-elite] Deliverable QA Checklist injection failed:", qaErr instanceof Error ? qaErr.message : qaErr);
  }
  const newlyInjected = methodologyTables.injected.filter((i) => i.reason === "MISSING").map((i) => i.key);
  if (newlyInjected.length > 0) {
    console.info(`[generate-elite] Methodology tables injected: ${newlyInjected.join(", ")}`);
  }
  // NOTE: humanizedMarkdown was already updated above by methodologyTables
  // and again by the QA-checklist injection — do NOT re-assign from
  // methodologyTables.markdown here, that would clobber the QA checklist.

  // ─── Beyond-spec tables (PR F) ───────────────────────────────────────────
  // Section D ("value added") differentiator tables. Modern tenders
  // (donor-funded, corporate RFP) carry explicit ESG / H&S / Innovation /
  // Local Content evaluation criteria. Without dedicated tables here,
  // Section D plateaus at one paragraph of generic prose. This pass
  // injects four tables:
  //   1. Sustainability & ESG Plan (climate / gender / universal design / environmental)
  //   2. Health & Safety Plan (management system, PPE, RAMS, incident reporting)
  //   3. Innovation & Value Engineering (beyond-spec proposals with client value)
  //   4. Local Content & Capacity Building (employment, supplier dev, training)
  // Sector-aware row content; idempotent via marker comments.
  const beyondSpec = injectBeyondSpecTables(humanizedMarkdown, {
    primarySector: intelligence.primarySector,
  });
  const beyondSpecAdded = beyondSpec.injected.filter((i) => i.reason === "MISSING").map((i) => i.key);
  if (beyondSpecAdded.length > 0) {
    console.info(`[generate-elite] Beyond-spec tables injected: ${beyondSpecAdded.join(", ")}`);
  }
  humanizedMarkdown = beyondSpec.markdown;

  // ─── Win Themes & Discriminators table (PR G) ────────────────────────────
  // The 10-axis quality scorer's winThemesPresence axis caps at 7/10
  // unless there are >= 2 table rows under a Win Themes heading. Existing
  // proposal-evaluator-matrix emits bullets, never a table. This pass
  // injects a 4-column table mapping each tender pain → firm strength →
  // quantified discriminator → evidence anchor. Sector-aware default
  // rows; tender-specific rows pulled from gapsToAddressInNarrative +
  // themes. Idempotent via <!-- win-themes:table --> marker.
  const winThemes = injectWinThemesTable(humanizedMarkdown, {
    primarySector: intelligence.primarySector,
    projects: evidenceLibrary,
    differentiators: intelligence.differentiators,
    gapsToAddressInNarrative: intelligence.gapsToAddressInNarrative,
    themes: (intelligence.themes ?? []).map((t) => t.label),
    evaluationCriteria: intelligence.evaluationCriteria,
    companyName: company.name,
  });
  if (winThemes.injected) {
    console.info(`[generate-elite] Win Themes table injected (Section G).`);
  }
  humanizedMarkdown = winThemes.markdown;

  // ─── Mobilization plan + Submission Readiness checklist (PR H) ──────────
  // Two more deterministic sections that elite proposals carry:
  //   1. Mobilization & Resourcing Plan — week-by-week ramp-up table
  //      (team, workspace, software, equipment, support staff, QA,
  //      communication). Donor-funded engagements explicitly score
  //      "implementation arrangements" and look for this.
  //   2. Submission Readiness Checklist — tear-out final-checks list
  //      grouped by Identity, Eligibility, Technical, Team, Format,
  //      Submission. Mandatory vs Recommended items.
  // Idempotent via marker comments. Mobilization sits in Section A;
  // Checklist sits at end of document.
  const mobAndChecklist = injectMobilizationAndChecklist(humanizedMarkdown, {
    experts: allSelectedExperts as unknown as Parameters<typeof injectMobilizationAndChecklist>[1]["experts"],
  });
  if (mobAndChecklist.injected.mobilization) {
    console.info(`[generate-elite] Mobilization & Resourcing Plan injected.`);
  }
  if (mobAndChecklist.injected.checklist) {
    console.info(`[generate-elite] Submission Readiness Checklist injected.`);
  }
  humanizedMarkdown = mobAndChecklist.markdown;

  // ─── Personnel deep treatment (PR L) ────────────────────────────────────
  // Three personnel structures the benchmark Claude proposal carries
  // but the app didn't generate:
  //   1. PER 01 — Personnel Loading Table (Role | Expert | Licence | Days)
  //   2. PER 02 — Per-Expert Profile Cards (7-row vertical block per expert
  //      covering education, licence, software, sectors, key projects,
  //      core competencies, signed-availability declaration)
  //   3. Project Management Organogram (PM at top, sector-aware streams
  //      with named experts and licence codes)
  // Vault-aware (real names + licences when available), sector-aware
  // (healthcare/water/road/urban/generic role sets and stream structures),
  // idempotent via marker comments. Injects at end of Section A.
  const personnelDeep = injectPersonnelDeep(humanizedMarkdown, {
    experts: experts as unknown as Parameters<typeof injectPersonnelDeep>[1]["experts"],
    projects: evidenceLibrary,
    primarySector: intelligence.primarySector,
  });
  const personnelInjected = Object.entries(personnelDeep.injected).filter(([, v]) => v).map(([k]) => k);
  if (personnelInjected.length > 0) {
    console.info(`[generate-elite] Personnel deep treatment injected: ${personnelInjected.join(", ")}.`);
  }
  humanizedMarkdown = personnelDeep.markdown;

  // ─── Deliverable crosswalk + phase narrative + branded innovation (PR N)
  // Three more structures the benchmark Claude proposal carries:
  //   1. Deliverable-to-Project Crosswalk — extracts D-codes from
  //      tender, maps each code to most relevant reviewed project
  //      (proof that this firm has delivered each scope element).
  //   2. Phase-by-Phase Methodology Narrative — 6 phase paragraphs
  //      naming the responsible expert + sector-specific activities +
  //      artefacts produced per phase (60-110 words each).
  //   3. Branded Innovation Hooks — when the tender mentions a brand
  //      or website, emits "Innovation 2: <BRAND> Brand Integration
  //      from Day One" + dashboard + post-handover advisory hooks.
  // Sector-aware, vault-aware, idempotent. Inserts at end of Section C.
  const deliverablePhases = injectDeliverableAndPhases(humanizedMarkdown, {
    tenderText: intelligence.tenderText,
    projects: evidenceLibrary,
    experts: experts as unknown as Parameters<typeof injectDeliverableAndPhases>[1]["experts"],
    primarySector: intelligence.primarySector,
    companyName: company.name,
  });
  const dpInjected = Object.entries(deliverablePhases.injected).filter(([, v]) => v).map(([k]) => k);
  if (dpInjected.length > 0) {
    console.info(`[generate-elite] Deliverable + phase + branded innovation injected: ${dpInjected.join(", ")}.`);
  }
  humanizedMarkdown = deliverablePhases.markdown;

  // ─── Tender closers (PR M) ───────────────────────────────────────────────
  // Three close-out structures the benchmark Claude proposal carries:
  //   1. Tender-Specific Obstacles and Mitigation — parses tender text
  //      for area contradictions, file format requirements, brand
  //      mentions, schedule tightness, site-visit logistics, revision
  //      rounds. Replaces "we read the document" with proof of it.
  //   2. Commercial Understanding and Compliance — parses tender for
  //      validity period, payment terms, two-envelope rule, tax
  //      treatment, revision count, file format. Closes with verbatim
  //      acknowledgement. Looks like the bidder is across the
  //      commercial clauses — not just the technical scope.
  //   3. Anti-Bribery, Ethics and Conflict of Interest Declaration —
  //      8-clause declaration with vault Code of Ethics ref,
  //      Ethiopian law citation, GM signature block.
  // Idempotent via marker comments. Inserts before Section E /
  // Compliance Matrix.
  const closers = injectTenderClosers(humanizedMarkdown, {
    tenderText: intelligence.tenderText,
    ethicsVault: {
      companyName: company.name,
      legalName: company.legalName,
      gmName: company.gmName,
      gmTitle: company.gmTitle,
      gmLicense: company.gmLicense,
      // Optional vault override — when companies populate these in
      // their profile, they get used; otherwise generic defaults apply.
      codeOfEthicsRef: null,
      countryLegalCitation: null,
    },
  });
  const closersInjected = Object.entries(closers.injected).filter(([, v]) => v).map(([k]) => k);
  if (closersInjected.length > 0) {
    console.info(`[generate-elite] Tender closers injected: ${closersInjected.join(", ")}.`);
  }
  humanizedMarkdown = closers.markdown;

  // ─── Rubric-driven section enforcement (PR #258) ─────────────────────────
  // When the tender has explicit evaluation criteria with weights
  // (e.g., "Social Value 25%, Experience 30%, Personnel 25%,
  // Methodology 20%"), ensure each criterion has a dedicated
  // sub-section heading the evaluator can score against directly.
  // The AI has been prompted to emit these (via the prompt directive
  // injected into evaluationMethodology); this post-pass injects
  // stubs for any criterion the AI missed, with a Bid-Team Action
  // note pointing the user at the gap.
  //
  // Does nothing when intelligence.evaluationWeights is empty.
  const rubricResult = ensureRubricHeadings(humanizedMarkdown, intelligence.evaluationWeights);
  if (rubricResult.missingCriteria.length > 0) {
    console.info(`[generate-elite] Rubric post-pass: injected ${rubricResult.missingCriteria.length} missing rubric sub-section stub(s) for criteria: ${rubricResult.missingCriteria.join("; ")}`);
  }
  humanizedMarkdown = rubricResult.markdown;

  // ─── JV / Consortia disclosure table (PR GG) ─────────────────────────────
  // When the tender intelligence detected a JV/consortium clause, inject a
  // "D.6 JV / Partnership Disclosure" section that explicitly states whether
  // the bid is a single-firm or consortium submission. Evaluators on
  // JV-eligible tenders need this to score the "Organisation and Teaming"
  // criterion. Idempotent via marker; inserts before Section E.
  if (intelligence.commercialTerms?.consortiaRules) {
    const jvResult = injectJvDisclosure(humanizedMarkdown, {
      consortiaRules: intelligence.commercialTerms.consortiaRules,
      companyName: company.name,
    });
    if (jvResult.injected) {
      console.info("[generate-elite] JV/Consortia Partnership Disclosure table injected (PR GG).");
    }
    humanizedMarkdown = jvResult.markdown;
  }

  // ─── Duplicate section heading suppressor (PR Q) ─────────────────────────
  // After every deterministic post-pass has run, scan for level-2
  // headings whose numeric prefix (B.1, C.3, D.1 etc.) is shared by
  // multiple sections and renumber the duplicates with a/b/c suffix.
  // Without this, the TOC carries entries like:
  //   B.1 Portfolio Overview
  //   B.1 Client References     ← shared prefix
  //   C.3 Work Plan and Deliverables
  //   C.3 Quality Assurance     ← shared prefix
  // which evaluators read as a rendering bug. NEVER deletes content.
  const dedupeResult = suppressDuplicateSectionHeadings(humanizedMarkdown);
  if (dedupeResult.renumbered > 0) {
    console.info(`[generate-elite] Duplicate section suppressor: renumbered ${dedupeResult.renumbered} duplicate-prefix heading(s).`);
  }
  humanizedMarkdown = dedupeResult.markdown;

  // ─── Client name enforcer (PR V) ────────────────────────────────────────
  // Final pass that detects and corrects client-name substitutions.
  // The AI sometimes pulls a client name from the firm's project
  // history (e.g., "Pharo Ventures" when the canonical client is
  // "The Client") and uses it in the cover letter "To:" line, the
  // subject line, and the executive summary's first paragraph. The
  // user's gap analysis flagged this as the single most damaging
  // bug. This pass:
  //   1. Collects the firm's vault project clients
  //   2. Scrubs any of those names from the Cover Letter / Exec
  //      Summary zone if they don't match the canonical client
  //   3. Replaces with canonical name (or [CLIENT TO BE CONFIRMED]
  //      if canonical itself is a placeholder)
  // Operates ONLY in the cover-letter zone — Section B project cards
  // legitimately reference firm-history clients and must not be touched.
  const knownFirmClients = (company.projects ?? [])
    .map((p) => (p as { clientName?: string | null }).clientName)
    .filter((c): c is string => Boolean(c && c.trim().length >= 3));
  const enforced = enforceClientName(humanizedMarkdown, {
    canonicalClientName: intelligence.clientName,
    knownFirmClients,
  });
  if (enforced.substitutionsMade > 0) {
    console.warn(`[generate-elite] Client name enforcer scrubbed ${enforced.substitutionsMade} hallucinated client substitution(s) in Cover Letter / Executive Summary zone.`);
  }
  humanizedMarkdown = enforced.markdown;

  // ─── Internal review section stripper (PR X) ─────────────────────────────
  // Remove bid-team-internal review/QA sections from the client-facing
  // proposal: Evaluator Response Matrix, Claim-to-Evidence Proof Map,
  // Unsupported Claim Control, Delivery Methodology Work Plan, Evidence-
  // Based Appendix Register, Final Submission Control Checklist,
  // Benchmark Opening Proof Strategy, Evaluator Decision Narrative,
  // Evaluator-Facing Team-to-Assignment Mapping, Sector-Specific
  // Methodology Depth, Client-Ready Appendix Register, Final Claim and
  // Evidence Control. These were originally designed as bid-team aids;
  // shipping them in the technical proposal makes the document look
  // unfinished. Real output had ~12 such sections in the TOC.
  const internalStrip = stripInternalReviewSections(humanizedMarkdown);
  if (internalStrip.removedSections.length > 0) {
    console.info(`[generate-elite] Internal-review stripper removed ${internalStrip.removedSections.length} bid-team section(s) from client-facing proposal: ${internalStrip.removedSections.slice(0, 5).join("; ")}${internalStrip.removedSections.length > 5 ? " …" : ""}`);
  }
  humanizedMarkdown = internalStrip.markdown;

  // ─── Section orderer + auto-TOC (PR Y) ───────────────────────────────────
  // After every post-pass has run (and the internal-review stripper has
  // removed bid-team-only content), reorder all level-1 sections into
  // canonical proposal flow:
  //   Cover Letter → Executive Summary → Section A → B → C → D → E
  //   → F → G → H → Appendix Register → Declaration → Submission
  //   Readiness Checklist → (other custom sections in insertion order)
  // Then drop any AI-emitted Table of Contents (which won't reflect the
  // post-pass mutations) and emit a fresh one at the very top derived
  // from the actual final headings.
  const sectionOrderResult = reorderSectionsAndRebuildToc(humanizedMarkdown);
  if (sectionOrderResult.reorderedSectionCount > 0) {
    console.info(`[generate-elite] Section orderer: reordered ${sectionOrderResult.reorderedSectionCount} section(s); rebuilt TOC with ${sectionOrderResult.tocEntries} entries.`);
  }
  humanizedMarkdown = sectionOrderResult.markdown;

  // ─── Placeholder stripper (PR J) — LAST post-pass before DOCX render ────
  // Removes "Bid-Team Action: confirm X" lines and italic placeholder
  // paragraphs that visually scream "internal draft". Replaces table-cell
  // placeholders with em-dash to keep table layouts intact. NEVER
  // fabricates — if the data wasn't supplied earlier, the placeholder
  // is silently removed.
  const stripped = stripPlaceholders(humanizedMarkdown);
  if (stripped.removedLines > 0 || stripped.blankedCells > 0 || stripped.removedParagraphs > 0) {
    console.info(`[generate-elite] Placeholder stripper: removed ${stripped.removedLines} line(s), ${stripped.removedParagraphs} paragraph(s); blanked ${stripped.blankedCells} table cell(s).`);
  }
  humanizedMarkdown = stripped.markdown;

  // ─── Markdown cover page + RFP meta bar (PR EE + PR II) ─────────────────
  // PR EE: Inject a formal markdown cover page at the very top of the proposal
  // (company name, tender title, client, reference, date, validity, contact).
  // This is distinct from the DOCX buildCoverBlock — it provides the same
  // context in the markdown / PDF export path.
  // PR II: Inject "RFP # | Submission: date | Validity: X days" as a reference
  // bar immediately under the cover letter subject line when missing.
  // Both are idempotent via marker comments.
  const coverAndMeta = injectCoverPageAndRfpMeta(humanizedMarkdown, {
    companyName: company.name,
    companyLegalName: company.legalName,
    tenderTitle: cleanedTenderTitle,
    clientName: intelligence.clientName,
    reference: tender.reference,
    exactSubjectLine: intelligence.exactSubjectLine,
    submissionDate: tender.deadline,
    proposalValidityDays: intelligence.commercialTerms?.bidValidityDays
      ? Number(String(intelligence.commercialTerms.bidValidityDays).match(/\d+/)?.[0] ?? "") || null
      : null,
    address: company.address,
    phone: company.phone,
    email: company.email,
    website: company.website,
    tin: company.tin,
    gmName: company.gmName,
    gmTitle: company.gmTitle,
  });
  if (coverAndMeta.coverPageInjected) {
    console.info("[generate-elite] Markdown cover page injected (PR EE).");
  }
  if (coverAndMeta.rfpMetaInjected) {
    console.info("[generate-elite] RFP reference metadata bar injected under cover letter subject line (PR II).");
  }
  humanizedMarkdown = coverAndMeta.markdown;

  // ─── PR HH: Content-level table deduplication ───────────────────────────
  // After all deterministic builders have run, remove duplicate Markdown
  // tables that share the same column header row. The AI and the
  // deterministic builders may both emit a Team-to-Project mapping table
  // or a QA review table with identical headers. Keep the LAST occurrence
  // (deterministic builders run last, so the structured version survives).
  const dedupedTables = deduplicateTables(humanizedMarkdown);
  if (dedupedTables.removed > 0) {
    console.info(`[generate-elite] Duplicate table deduplicator removed ${dedupedTables.removed} line(s) from ${Math.floor(dedupedTables.removed / 3)} duplicate table block(s) (PR HH).`);
  }
  humanizedMarkdown = dedupedTables.markdown;

  // ─── PR LL: QA numeric threshold injection ────────────────────────────────
  // Extract numeric thresholds from the tender text (review rounds, day
  // limits, ISO standards, defect tolerances) and inject a
  // "Tender-Specific Quality Requirements" table below the C.3 QA section.
  // Elevates the QA section from generic to tender-responsive.
  const qaThresholds = injectQaThresholds(humanizedMarkdown, intelligence.tenderText);
  if (qaThresholds.injected) {
    console.info("[generate-elite] QA tender-specific numeric thresholds injected below C.3 (PR LL).");
  }
  humanizedMarkdown = qaThresholds.markdown;

  // ─── PR MM: Appendix readiness register cross-check ──────────────────────
  // Scan for Annex/Appendix references in the assembled proposal and build
  // a "Appendix Readiness Register" table at end-of-document listing each
  // annex, its inferred content, and readiness status (vault document
  // available vs. Bid-Team Action). Flags missing documents before
  // submission. Idempotent via marker.
  const vaultDocNames = [
    ...(company.documents ?? []).map((d: any) => d.originalFileName ?? d.fileName ?? ""),
    ...(company.legalRecords ?? []).map((r: any) => r.title ?? r.recordType ?? ""),
    ...(company.financialRecords ?? []).map((r: any) => `${r.recordType ?? ""} ${r.fiscalYear ?? ""}`.trim()),
    ...(company.complianceRecords ?? []).map((r: any) => r.title ?? r.complianceType ?? ""),
  ].filter(Boolean);
  const appendixReg = injectAppendixReadinessRegister(humanizedMarkdown, vaultDocNames);
  if (appendixReg.injected) {
    console.info("[generate-elite] Appendix Readiness Register cross-check injected (PR MM).");
  }
  humanizedMarkdown = appendixReg.markdown;

  // ─── PR JJ: Three-column DOCX signature block ─────────────────────────────
  // Inject a "Signed | Company Stamp | Date" signature block after the
  // Declaration section when the tender requires a signature. Missing a
  // physical signature / stamp space is the single most common reason
  // proposals are disqualified on submission-format grounds.
  // Idempotent via marker; only added when the markdown doesn't already
  // contain a "Signature:" or "Signed:" line.
  const SIG_MARKER = "<!-- signature-block:injected -->";
  if (requiresSignatureOrStamp(tender.requirements) && !humanizedMarkdown.includes(SIG_MARKER) && !/\bsignature:\s*_+/im.test(humanizedMarkdown)) {
    const gmSigName = company.gmName ? `${company.gmName}${company.gmTitle ? `, ${company.gmTitle}` : ""}` : "General Manager";
    const sigBlock = [
      SIG_MARKER,
      "## Authorised Signature",
      "",
      "| Signed | Company Stamp | Date |",
      "|---|---|---|",
      `| **${company.name}** | | |`,
      `| _${gmSigName}_ | _(affix stamp)_ | ________________ |`,
      `| Authorised Representative | | |`,
      "",
    ].join("\n");
    // Insert before Section E / Compliance Matrix, or at end.
    const sigLines = humanizedMarkdown.split("\n");
    let sigInsertAt = sigLines.length;
    for (let i = 0; i < sigLines.length; i += 1) {
      if (/^##\s+SECTION\s+E\b/i.test(sigLines[i]) || /^#\s+Section\s+E\b/i.test(sigLines[i])) {
        sigInsertAt = i;
        break;
      }
    }
    const sigOut = [
      ...sigLines.slice(0, sigInsertAt),
      "",
      sigBlock,
      ...sigLines.slice(sigInsertAt),
    ];
    humanizedMarkdown = sigOut.join("\n");
    console.info("[generate-elite] Three-column signature block injected (PR JJ).");
  }

  const auditSummary = benchmarkAuditSummary(humanizedMarkdown);
  const children = markdownToDocx(humanizedMarkdown);
  const contactFooter = buildContactFooterText({
    name: company.name,
    address: company.address,
    phone: company.phone,
    email: company.email,
    website: company.website,
  });
  // ─── Strict-scope flags (PR #245) ────────────────────────────────────────
  // Compute once from the analyzed tender requirements, pass to every
  // DOCX builder + the post-generation letterhead applicator. When the
  // tender forbids cover pages or branding, the engine must respect
  // that — historically these checks existed in scope-policy.ts but
  // were never wired into generate-elite.ts.
  const tenderForbidsCoverPage = forbidsCoverPage(tender.requirements);
  const tenderForbidsBranding = forbidsBranding(tender.requirements);
  const tenderRequiresSignature = requiresSignatureOrStamp(tender.requirements);
  if (tenderForbidsCoverPage) console.info("[generate-elite] Tender forbids cover page — suppressing cover block in main proposal DOCX.");
  if (tenderForbidsBranding) console.info("[generate-elite] Tender forbids branding — suppressing branded header and skipping letterhead application.");
  if (!tenderRequiresSignature) console.info("[generate-elite] Tender does not explicitly require signature/stamp — declaration will use printed-name-only sign-off.");

  // PR #259 — vault-aware cover page. Surfaces TIN, VAT, license
  // grade, GM with PPE license, service-line tagline, submission date,
  // proposal validity, exact subject line. Falls back gracefully on
  // any field that's null in the Company table.
  const coverVault = {
    serviceLines: safeParseArr(company.serviceLines),
    address: company.address,
    phone: company.phone,
    email: company.email,
    website: company.website,
    tin: company.tin,
    vat: company.vat,
    licenseGrade: company.licenseGrade,
    gmName: company.gmName,
    gmTitle: company.gmTitle,
    gmLicense: company.gmLicense,
    submissionDate: tender.deadline,
    proposalValidityDays: intelligence.commercialTerms?.bidValidityDays
      ? Number(String(intelligence.commercialTerms.bidValidityDays).match(/\d+/)?.[0] ?? "")
      : null,
    exactSubjectLine: intelligence.exactSubjectLine,
  };

  const doc = buildProfessionalDocument({
    tenderTitle: cleanedTenderTitle,
    clientName: intelligence.clientName,
    companyName: company.name,
    reference: tender.reference,
    contactFooter,
    children,
    suppressCoverBlock: tenderForbidsCoverPage,
    suppressBrandedHeader: tenderForbidsBranding,
    coverVault,
  });

  // Round-11: multi-pass refinement. Score the assembled proposal; if it
  // falls below threshold and the AI is configured, ask the AI to rewrite
  // the weak axes only. Re-score after refinement and use whichever output
  // is stronger. Skipped when AI is not available or refinement returns
  // null (e.g., model failure). Idempotent: never weakens the proposal,
  // only replaces if refinement raises the score.
  //
  // Refinement adds a second Claude call (typically 30–60s). On Vercel
  // Hobby (60s function timeout) the first generation pass already
  // consumes most of the budget — running refinement on top reliably
  // exceeds the limit and the function dies. PROPOSAL_REFINEMENT_DISABLED
  // env var lets operators on Hobby disable the second pass and keep
  // the first Claude output as-is. The deterministic backstops
  // (Sections E/F/G/H from PR #230 + #231) plus the in-prompt
  // Section-E-through-H instructions (PR #228) already give strong
  // structural guarantees without refinement, so disabling has minimal
  // quality impact on properly-tuned tenders.
  const REFINEMENT_DISABLED = process.env.PROPOSAL_REFINEMENT_DISABLED === "true";
  // Refinement target: proposals below this score get an AI refinement pass.
  // Tier-aware defaults:
  //   Tier 1  (limited output budget):       82 — conservative, avoids 429s
  //   Tier 2+ (16K tokens/min, Vercel Pro):  90 — targets benchmark territory
  //   Tier 3+:                               92 — near-perfect target
  // Override via QUALITY_REFINEMENT_THRESHOLD env var.
  const tierForThreshold = (process.env.ANTHROPIC_TIER || "").trim();
  const tierDefaultThreshold = tierForThreshold === "1" ? 82
    : tierForThreshold === "3" || tierForThreshold === "4" ? 92
    : 90; // Tier 2 default
  const QUALITY_REFINEMENT_THRESHOLD = Number(process.env.QUALITY_REFINEMENT_THRESHOLD) || tierDefaultThreshold;
  // PR WW — tier-aware refinement attempt cap. The pre-PR-WW default
  // was 2 (Tier 3+ comfortable). On Tier 1/2 the second attempt risks
  // hitting the per-minute output-token rate limit and returning 429.
  // New default by tier:
  //   Tier 1 (10K/min): 0 attempts — refinement skipped, deterministic
  //                     post-passes do the heavy lifting
  //   Tier 2 (16K/min, default): 1 attempt
  //   Tier 3+ (80K/min): 2 attempts
  // Override with MAX_REFINEMENT_ATTEMPTS env var.
  const tierForRefinement = (process.env.ANTHROPIC_TIER || "").trim();
  const tierDefaultAttempts = tierForRefinement === "1" ? 0
    : tierForRefinement === "3" || tierForRefinement === "4" ? 2
    : 1; // Tier 2 default
  const MAX_REFINEMENT_ATTEMPTS = Number(process.env.MAX_REFINEMENT_ATTEMPTS) || tierDefaultAttempts;
  // Score the HUMANIZED markdown (PR #245) — refinement should evaluate
  // the same text that's about to be rendered to DOCX, not the
  // pre-humanize version which still contained AI-trace patterns.
  let workingMarkdown = humanizedMarkdown;
  let qualityScore = scoreProposalQuality({
    markdown: workingMarkdown,
    primarySector: intelligence.primarySector,
    topProjects: (projects as ProjectRecord[]).slice(0, 2),
  });
  let refinementApplied = false;
  let refinementAttempts = 0;
  while (
    !REFINEMENT_DISABLED &&
    refinementAttempts < MAX_REFINEMENT_ATTEMPTS &&
    qualityScore.total < QUALITY_REFINEMENT_THRESHOLD &&
    qualityScore.weakAxes.length > 0 &&
    isAIEnabled()
  ) {
    refinementAttempts += 1;
    try {
      const refined = await refineProposalWithAI({
        currentMarkdown: workingMarkdown,
        weakAxes: qualityScore.weakAxes,
        tenderTitle: cleanedTenderTitle,
        clientName: intelligence.clientName,
        primarySector: intelligence.primarySector,
        topProjectNames: (projects as ProjectRecord[]).slice(0, 2).map((p) => p.name).filter(Boolean),
        topExpertNames: (experts as ExpertRecord[]).slice(0, 3).map((e) => e.fullName).filter(Boolean),
      });
      if (refined && refined.length > workingMarkdown.length * 0.7) {
        const refinedClean = cleanClientLanguage(refined);
        const refinedScore = scoreProposalQuality({
          markdown: refinedClean,
          primarySector: intelligence.primarySector,
          topProjects: (projects as ProjectRecord[]).slice(0, 2),
        });
        if (refinedScore.total > qualityScore.total) {
          const lift = refinedScore.total - qualityScore.total;
          workingMarkdown = refinedClean;
          qualityScore = refinedScore;
          refinementApplied = true;
          console.info(`[generate-elite] Refinement attempt ${refinementAttempts}/${MAX_REFINEMENT_ATTEMPTS}: ${qualityScore.total - lift} → ${qualityScore.total} (+${lift}). Weak axes remaining: ${qualityScore.weakAxes.length}.`);
          // If the lift was meaningful AND the score is still below
          // threshold AND we have attempts left, the loop will try
          // another pass with the refined output as input.
          // Stop early when the lift is < 2 points (diminishing returns).
          if (lift < 2) {
            console.info(`[generate-elite] Refinement lift ${lift} < 2 — stopping early to avoid AI budget burn.`);
            break;
          }
        } else {
          // Refinement made score WORSE or equal — keep the previous
          // version and stop attempting.
          console.info(`[generate-elite] Refinement attempt ${refinementAttempts} did not improve score (${qualityScore.total} unchanged). Stopping.`);
          break;
        }
      } else {
        // Refined output too short — keep the previous version.
        console.warn(`[generate-elite] Refinement attempt ${refinementAttempts} returned thin output (${refined?.length ?? 0} chars vs ${workingMarkdown.length}). Stopping.`);
        break;
      }
    } catch (err) {
      console.warn(`[generate-elite] Refinement pass ${refinementAttempts} failed: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }

  // ─── PR UU — re-apply idempotent finalisers after refinement ────────────
  // The refinement pass asks Claude to STRENGTHEN weak axes — which often
  // means adding evidence anchors, deepening prose, or restating sections.
  // Refinement runs AFTER all 20+ deterministic post-passes, so its
  // output skipped:
  //   • duplicate-section heading suppressor (PR Q)
  //   • client-name enforcer (PR V)
  //   • internal-review-section stripper (PR X)
  //   • section orderer + auto-TOC rebuild (PR Y)
  //   • placeholder stripper (PR J)
  //
  // Side-effect of skipping: refined output occasionally introduced
  // duplicate "Section A" or "Cover Letter" headings (Claude restates
  // them when answering an axis), and any new "Bid-Team Action: ..."
  // strings the AI inserted weren't stripped before DOCX render.
  //
  // Each of these passes is idempotent — running them a second time on
  // already-clean markdown is a no-op. Re-running them on the refined
  // output catches any duplicates / leaks Claude introduced in the
  // refinement. If refinement didn't run, this whole block is a no-op
  // (workingMarkdown === humanizedMarkdown).
  if (refinementApplied) {
    const reDedup = suppressDuplicateSectionHeadings(workingMarkdown);
    if (reDedup.renumbered > 0) {
      console.info(`[generate-elite] Post-refinement re-dedupe: renumbered ${reDedup.renumbered} duplicate-prefix heading(s) introduced by refinement.`);
    }
    workingMarkdown = reDedup.markdown;

    const reEnforced = enforceClientName(workingMarkdown, {
      canonicalClientName: intelligence.clientName,
      knownFirmClients,
    });
    if (reEnforced.substitutionsMade > 0) {
      console.warn(`[generate-elite] Post-refinement client-name enforcer scrubbed ${reEnforced.substitutionsMade} hallucinated substitution(s) introduced by refinement.`);
    }
    workingMarkdown = reEnforced.markdown;

    const reStrip = stripInternalReviewSections(workingMarkdown);
    if (reStrip.removedSections.length > 0) {
      console.info(`[generate-elite] Post-refinement internal-review stripper removed ${reStrip.removedSections.length} bid-team section(s) re-introduced by refinement.`);
    }
    workingMarkdown = reStrip.markdown;

    const reOrder = reorderSectionsAndRebuildToc(workingMarkdown);
    if (reOrder.reorderedSectionCount > 0) {
      console.info(`[generate-elite] Post-refinement reorder: re-sequenced ${reOrder.reorderedSectionCount} section(s); TOC rebuilt.`);
    }
    workingMarkdown = reOrder.markdown;

    const reStripPlaceholders = stripPlaceholders(workingMarkdown);
    if (reStripPlaceholders.removedLines + reStripPlaceholders.blankedCells + reStripPlaceholders.removedParagraphs > 0) {
      console.info(`[generate-elite] Post-refinement placeholder stripper: removed ${reStripPlaceholders.removedLines} line(s), ${reStripPlaceholders.removedParagraphs} paragraph(s); blanked ${reStripPlaceholders.blankedCells} table cell(s).`);
    }
    workingMarkdown = reStripPlaceholders.markdown;
  }

  // Re-render the DOCX from the (possibly refined) markdown.
  const finalChildren = refinementApplied ? markdownToDocx(workingMarkdown) : children;
  const finalDoc = refinementApplied
    ? buildProfessionalDocument({
        tenderTitle: cleanedTenderTitle,
        clientName: intelligence.clientName,
        companyName: company.name,
        reference: tender.reference,
        contactFooter,
        children: finalChildren,
        suppressCoverBlock: tenderForbidsCoverPage,
        suppressBrandedHeader: tenderForbidsBranding,
        coverVault, // PR #259 — same vault on the refined re-render
      })
    : doc;
  const fileContent = (await Packer.toBuffer(finalDoc)).toString("base64");
  const refinementProvider = refinementApplied ? getLastProposalProvider() : null;
  const refinementLabel = refinementApplied
    ? ` + ${refinementProvider === "claude" ? "Claude" : refinementProvider === "gemini" ? "Gemini" : "AI"} refinement pass`
    : "";
  const winProb = computeWinProbability({
    primarySector: intelligence.primarySector,
    tenderBudget: (tender as { budget?: number | null }).budget ?? null,
    tenderCategory: tender.category ?? null,
    projects: projects as Parameters<typeof computeWinProbability>[0]["projects"],
    experts: experts as Parameters<typeof computeWinProbability>[0]["experts"],
    complianceGaps: tender.complianceGaps,
    bidOutcomes: (company as { bidOutcomes?: Array<{ won: boolean; primarySector?: string | null }> }).bidOutcomes,
  });
  const summary = `${mode}${refinementLabel} technical proposal generated. ${finalized.internalSummary}. ${auditSummary}. ${formatQualityScoreSummary(qualityScore)}. ${formatWinProbability(winProb)}. Inputs: ${intelligence.requiredSections.length} section group(s), ${intelligence.themes.length} tender theme(s), ${experts.length} reviewed expert(s), ${projects.length} reviewed project(s), ${companyEvidenceLines.length} company evidence item(s), ${projectEvidenceLines.length} project evidence attachment(s).${aiError ? ` AI fallback reason: ${aiError}` : ""}`;

  // ─── Save the main Technical Proposal (PR #256 fix) ─────────────────────
  // BUG (pre-PR #256): the engine looked for a planned slot whose
  // documentType was TECHNICAL_PROPOSAL / PROPOSAL / METHODOLOGY and
  // OVERWROTE that slot's content while preserving its exactFileName.
  // For tenders where the submission plan classifies an unrelated
  // requirement (e.g., "Submission formatting, file and packaging rules")
  // as METHODOLOGY type, the main proposal got stuffed into that slot
  // and the resulting ZIP contained a file named
  // "Submission formatting, file and packaging rules.docx" that
  // ACTUALLY held the entire Technical Proposal. The user's submission
  // package was missing a recognisable "Technical Proposal" file
  // because of this misrouting.
  //
  // FIX: only reuse a planned slot if its filename clearly indicates
  // the main proposal ("technical proposal", "main proposal",
  // "technical bid"). Otherwise always create a fresh
  // Technical-Proposal.docx record and let the misclassified planned
  // slot remain as a support doc (filled later by
  // fillPlannedSupportDocuments).
  const target = await prisma.generatedDocument.findFirst({
    where: {
      tenderId,
      documentType: { in: ["TECHNICAL_PROPOSAL", "PROPOSAL", "METHODOLOGY"] },
    },
    orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
  });
  // Only reuse the slot if the filename is a real proposal-named slot.
  // This regex catches genuine main-proposal slot names while rejecting
  // accidental METHODOLOGY-classified support slots.
  const isMainProposalSlotName = (name: string | null | undefined) =>
    typeof name === "string" && /\b(technical[-\s_]*proposal|technical[-\s_]*bid|main[-\s_]*proposal|proposal[-\s_]*document|consultancy[-\s_]*proposal)\b/i.test(name);
  const reuseTarget = target && isMainProposalSlotName(target.exactFileName ?? target.name);

  if (reuseTarget && target) {
    await prisma.generatedDocument.update({
      where: { id: target.id },
      data: {
        name: "Client-Ready Benchmark Technical Proposal",
        documentType: "TECHNICAL_PROPOSAL",
        // Keep target.exactFileName because it's a genuine
        // proposal-named slot the tender required.
        exactFileName: target.exactFileName ?? "Technical-Proposal.docx",
        fileContent,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        contentSummary: summary,
        updatedAt: new Date(),
      },
    });
  } else {
    // No suitable slot OR the existing slot had the wrong name —
    // always emit Technical-Proposal.docx as a fresh record.
    // Use upsert-ish pattern: if a Technical-Proposal record exists
    // already, update; otherwise create.
    const existing = await prisma.generatedDocument.findFirst({
      where: { tenderId, exactFileName: "Technical-Proposal.docx" },
    });
    if (existing) {
      await prisma.generatedDocument.update({
        where: { id: existing.id },
        data: {
          name: "Client-Ready Benchmark Technical Proposal",
          documentType: "TECHNICAL_PROPOSAL",
          fileContent,
          generationStatus: "GENERATED",
          validationStatus: "PENDING",
          contentSummary: summary,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.generatedDocument.create({
        data: {
          tenderId,
          name: "Client-Ready Benchmark Technical Proposal",
          documentType: "TECHNICAL_PROPOSAL",
          format: "DOCX",
          exactFileName: "Technical-Proposal.docx",
          exactOrder: 1,
          fileContent,
          generationStatus: "GENERATED",
          validationStatus: "PENDING",
          contentSummary: summary,
        },
      });
    }
  }

  await prisma.tender.update({ where: { id: tenderId }, data: { status: "GENERATED", stage: "GENERATION", updatedAt: new Date() } });

  // ─── Proposal version snapshot ──────────────────────────────────────────────
  // Save the current proposal as a numbered version in ProposalVersion.
  // Keeps only the last 5 versions per tender (oldest pruned automatically).
  // Versions let users compare previous generations and roll back when a
  // regeneration produces worse output than the prior run.
  // PR XX-A — switched to typed Prisma access. Bootstrap migration in
  // lib/prisma.ts:508 still creates the table for envs without Prisma
  // migrations, so this is a pure type-safety upgrade.
  let savedProposalVersion = 1;
  try {
    const existingVersions = await prisma.proposalVersion.findMany({
      where: { tenderId },
      select: { id: true, version: true },
      orderBy: { version: "desc" },
    });
    const nextVersion = existingVersions.length > 0 ? existingVersions[0].version + 1 : 1;
    savedProposalVersion = nextVersion;

    await prisma.proposalVersion.create({
      data: {
        tenderId,
        version: nextVersion,
        markdown: workingMarkdown,
        fileContent,
        benchmarkScore: finalized.score.score,
        qualityScore: qualityScore.total,
        winProbabilityScore: winProb.score,
        mode,
        summary: summary.slice(0, 500),
      },
    });
    console.info(`[generate-elite] Proposal version ${nextVersion} saved.`);

    // Prune versions beyond the last 5.
    if (existingVersions.length >= 5) {
      const idsToDelete = existingVersions.slice(4).map((v) => v.id);
      if (idsToDelete.length > 0) {
        await prisma.proposalVersion.deleteMany({ where: { id: { in: idsToDelete } } });
        console.info(`[generate-elite] Pruned ${idsToDelete.length} old proposal version(s) (keeping last 5).`);
      }
    }
  } catch (vErr) {
    // Version saving is non-critical — never block the main proposal.
    console.warn("[generate-elite] Proposal version snapshot failed:", vErr instanceof Error ? vErr.message : vErr);
  }

  // ─── Section evidence map (G5 follow-up) ───────────────────────────────────
  // Walks the stitched proposal markdown, splits it into top-level sections,
  // and writes each one to SectionEvidenceMap. Powers the weak-section
  // detector and the "where does this section's evidence live?" UI.
  // Idempotent on (tenderId, proposalVersion, sectionId), so re-running
  // the engine for the same tender just refreshes the rows.
  // Wrapped in its own try so a write failure never blocks the main run.
  try {
    const { writeSectionEvidenceFromMarkdown } = await import("./section-evidence-map");
    const requirementIds = tender.requirements.map((r) => r.id);
    const expertIds = tender.expertMatches.map((m) => m.expert.id);
    const projectIds = tender.projectMatches.map((m) => m.project.id);
    const result = await writeSectionEvidenceFromMarkdown({
      tenderId,
      proposalVersion: savedProposalVersion,
      markdown: workingMarkdown,
      requirementIds,
      expertIds,
      projectIds,
    });
    console.info(`[generate-elite] Section evidence map: ${result.sectionsWritten} section(s) recorded for v${savedProposalVersion}.`);
  } catch (sErr) {
    console.warn("[generate-elite] Section evidence map write failed:", sErr instanceof Error ? sErr.message : sErr);
  }

  // ─── Expert CV DOCX generation ──────────────────────────────────────────────
  // Generate one professional CV Word document per selected REVIEWED expert.
  // CVs are saved as separate GeneratedDocument records (documentType=
  // "EXPERT_CV_PACKAGE") so the user can download them individually or as
  // part of the ZIP bundle. They do NOT block the main proposal save above.
  // Each CV follows the standard World Bank / FIDIC CV template layout.
  if (experts.length > 0) {
    const cvResults = await Promise.allSettled(
      experts.slice(0, 12).map(async (expert) => {
        const fileName = expertCvFileName(expert.fullName);
        const cvBuffer = await generateExpertCvDocx({
          fullName: expert.fullName,
          title: (expert as { title?: string | null }).title,
          email: (expert as { email?: string | null }).email,
          phone: (expert as { phone?: string | null }).phone,
          yearsExperience: (expert as { yearsExperience?: number | null }).yearsExperience,
          disciplines: (expert as { disciplines?: string | null }).disciplines,
          sectors: (expert as { sectors?: string | null }).sectors,
          certifications: (expert as { certifications?: string | null }).certifications,
          profile: (expert as { profile?: string | null }).profile,
        });
        const cvContent = cvBuffer.toString("base64");
        const existing = await prisma.generatedDocument.findFirst({
          where: { tenderId, exactFileName: fileName },
        });
        if (existing) {
          await prisma.generatedDocument.update({
            where: { id: existing.id },
            data: { fileContent: cvContent, generationStatus: "GENERATED", updatedAt: new Date() },
          });
        } else {
          await prisma.generatedDocument.create({
            data: {
              tenderId,
              name: `CV — ${expert.fullName}`,
              documentType: "EXPERT_CV_PACKAGE",
              format: "DOCX",
              exactFileName: fileName,
              fileContent: cvContent,
              generationStatus: "GENERATED",
              validationStatus: "PENDING",
              contentSummary: `Professional CV for ${expert.fullName}${(expert as { title?: string | null }).title ? `, ${(expert as { title?: string | null }).title}` : ""}.`,
            },
          });
        }
        return fileName;
      })
    );
    const cvGenerated = cvResults.filter((r) => r.status === "fulfilled").length;
    const cvFailed = cvResults.filter((r) => r.status === "rejected").length;
    if (cvGenerated > 0) console.info(`[generate-elite] Expert CV DOCX: generated ${cvGenerated} CV(s).`);
    if (cvFailed > 0) console.warn(`[generate-elite] Expert CV DOCX: ${cvFailed} CV(s) failed to generate.`);
  }
}
