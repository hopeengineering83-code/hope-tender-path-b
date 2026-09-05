// Generated-document quality gate.
//
// Screenshots showed documents marked GENERATED / PASSED / APPROVED /
// auto-finalized while the actual content was 1-2 paragraphs of generic
// methodology language, full of "Bid-Team to confirm" placeholders, and
// missing every section the tender required. This module is the
// runtime gate that prevents that combination from being marked
// PASSED / APPROVED / READY_FOR_EXPORT going forward.
//
// Inputs:
//   - the GeneratedDocument row (name, exactFileName, documentType, format)
//   - the visible text of the generated DOCX (or fileContent / extracted)
//   - the tender requirements (so we can grade requirement coverage)
//   - the selected evidence (so we can grade evidence references)
//
// Outputs:
//   - per-document quality report with score 0..100, severity, issues[]
//   - recommendedStatus: PASSED / NEEDS_REWRITE / QUALITY_FAILED / DRAFT_ONLY
//
// Used by:
//   - lib/engine/final-submission-readiness.ts (rolls qualityFailedDocuments
//     into the canonical summary so consumers see the count)
//   - app/api/admin/generated-proposals/audit/route.ts (per-doc quality fields
//     + summary count for "qualityFailed")
//   - any future place that decides whether to flip a document to PASSED.
//
// Deliberately pure-rules, not AI-based: AI-based quality scoring is the
// next pass once we have a stable LLM provider chain. Even pure rules
// detect the screenshot regressions (Bid-Team to confirm, AI traces,
// extreme-short content, missing required sections, generic filler).

import { documentHygieneIssues } from "./export-readiness";
import { looksLikeMetadataPlaceholder, METADATA_PLACEHOLDER_PATTERNS } from "./tender-metadata-completeness";

// ── Document-type gating ─────────────────────────────────────────────────────

export type DocumentGatingCategory =
  | "NARRATIVE"          // technical proposal, methodology, cover letter, work plan, etc.
  | "CV_PACKAGE"         // expert CVs (lighter gating: word count + no AI traces)
  | "PROJECT_REFERENCE"  // project references (lighter gating)
  | "FINANCIAL_OFFICIAL" // audited financials, bank statements, financial capacity evidence
  | "LEGAL_OFFICIAL"     // business licenses, registration certs, tax clearance, TIN/VAT
  | "BID_FORM"           // bid forms, tender forms, declarations, undertakings, integrity pact, bid bond
  | "FINANCIAL_PROPOSAL" // financial envelope: BOQ, price schedule, rate card
  | "SUBMISSION_CONTROL" // submission rules, packaging rules, deadline instructions
  | "COMPLIANCE_MATRIX"  // compliance matrix (light narrative check)
  | "OTHER";             // everything else — apply light checks only

const FINANCIAL_OFFICIAL_PATTERNS: RegExp[] = [
  /audited\s+financial/i,
  /financial\s+capacity/i,
  /financial\s+evidence/i,
  /bank\s+statement/i,
  /bank\s+guarantee/i,
  /turnover\s+evidence/i,
  /financial\s+statement/i,
  /annual\s+report/i,
  /balance\s+sheet/i,
  /income\s+statement/i,
  /profit\s+.*loss/i,
];

const LEGAL_OFFICIAL_PATTERNS: RegExp[] = [
  /trade\s+licen/i,
  /business\s+licen/i,
  /registration\s+cert/i,
  /tax\s+clearance/i,
  /tin\s+cert/i,
  /vat\s+cert/i,
  /legal\s+entity/i,
  /certificate\s+of\s+incorporation/i,
  /memorandum\s+of\s+(association|understanding)/i,
];

const BID_FORM_PATTERNS_GATING: RegExp[] = [
  /\bbid\s+form\b/i,
  /\btender\s+form\b/i,
  /\bdeclaration\s+(?:of|form)\b/i,
  /\bundertaking\b/i,
  /\bintegrity\s+pact\b/i,
  /\bbid\s+bond\b/i,
  /\bbid\s+security\b/i,
];

const FINANCIAL_PROPOSAL_PATTERNS_GATING: RegExp[] = [
  /financial\s+proposal/i,
  /commercial\s+proposal/i,
  /price\s+schedule/i,
  /rate\s+card/i,
  /bill\s+of\s+quantities/i,
  /\bboq\b/i,
  /quotation/i,
  /cost\s+breakdown/i,
];

const SUBMISSION_CONTROL_PATTERNS_GATING: RegExp[] = [
  /submission\s+(method|rules?|format|deadline|packaging|delivery|instruction)/i,
  /packaging\s+rules?/i,
  /file\s+(?:naming|format|packaging)\s+rules?/i,
  /delivery\s+(?:rules?|instruction)/i,
  /portal\s+submission/i,
  /email\s+submission/i,
];

export function detectDocumentGatingCategory(label: string, documentType?: string | null): DocumentGatingCategory {
  const dt = (documentType ?? "").toUpperCase();
  // Check documentType field first (most reliable)
  if (dt === "FINANCIAL_EVIDENCE" || dt === "OFFICIAL_FINANCIAL_EVIDENCE") return "FINANCIAL_OFFICIAL";
  if (dt === "LEGAL_EVIDENCE" || dt === "OFFICIAL_LEGAL_EVIDENCE") return "LEGAL_OFFICIAL";
  if (dt === "BID_FORM" || dt === "TENDER_FORM") return "BID_FORM";
  if (dt === "SUBMISSION_RULES" || dt === "CONTROL" || dt === "INTERNAL_COMPLIANCE_CONTROL") return "SUBMISSION_CONTROL";
  if (dt === "FINANCIAL_PROPOSAL" || dt === "COMMERCIAL_PROPOSAL") return "FINANCIAL_PROPOSAL";
  if (dt === "FORM_OR_TEMPLATE" || dt === "FORM_TEMPLATE_TO_COMPLETE" || dt === "ORIGINAL_EVIDENCE_ATTACHMENT") return "BID_FORM";
  if (dt === "EXPERT_CV_PACKAGE" || dt === "CV_PACKAGE") return "CV_PACKAGE";
  if (dt === "PROJECT_REFERENCE_PACKAGE" || dt === "PROJECT_REFERENCE") return "PROJECT_REFERENCE";

  // Fall back to label matching
  if (FINANCIAL_OFFICIAL_PATTERNS.some((rx) => rx.test(label))) return "FINANCIAL_OFFICIAL";
  if (LEGAL_OFFICIAL_PATTERNS.some((rx) => rx.test(label))) return "LEGAL_OFFICIAL";
  if (BID_FORM_PATTERNS_GATING.some((rx) => rx.test(label))) return "BID_FORM";
  if (FINANCIAL_PROPOSAL_PATTERNS_GATING.some((rx) => rx.test(label))) return "FINANCIAL_PROPOSAL";
  if (SUBMISSION_CONTROL_PATTERNS_GATING.some((rx) => rx.test(label))) return "SUBMISSION_CONTROL";
  if (/\bexpert\s+cv\b|\bcv\s+package\b|\bstaff.*cv\b/i.test(label)) return "CV_PACKAGE";
  if (/project\s+(reference|experience).*package/i.test(label)) return "PROJECT_REFERENCE";
  if (/compliance\s+matrix/i.test(label)) return "COMPLIANCE_MATRIX";
  return "NARRATIVE";
}

function buildNonNarrativeReport(
  category: DocumentGatingCategory,
  _label: string,
  input: DocumentQualityInput,
): DocumentQualityReport {
  const text = normalize(input.visibleText);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const issues: DocumentQualityIssue[] = [];

  // For all official-original types: if they have narrative placeholder content, flag it.
  if (category === "FINANCIAL_OFFICIAL" || category === "LEGAL_OFFICIAL" || category === "BID_FORM") {
    // Check for AI/meta traces — still a problem even for official originals
    if (text && /\b(as an ai|ai language model|chatgpt|claude|gemini|generated by ai|bid-team action)\b/i.test(text)) {
      issues.push({ code: "AI_TRACE", severity: "HIGH", message: "Generated placeholder for official original contains AI/meta traces." });
    }
    // Check for metadata placeholders (Bid-Team to confirm, TBC, [insert...]) — official originals must not contain these
    const metadataPlaceholderHits = text ? METADATA_PLACEHOLDER_PATTERNS.reduce((count, rx) => {
      const matches = text.match(new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : `${rx.flags}g`));
      return count + (matches ? matches.length : 0);
    }, 0) : 0;
    if (metadataPlaceholderHits > 0 || (text && /\[(insert|add|fill|placeholder|todo|tbd)[^\]]*\]/i.test(text))) {
      issues.push({ code: "OFFICIAL_ORIGINAL_PLACEHOLDER_RISK", severity: "HIGH", message: `${category === "BID_FORM" ? "Bid/tender form" : "Official evidence document"} requires the tender-issued original — generated placeholder must be replaced with the actual official document.` });
    }
    const hasHighIssue = issues.some((i) => i.severity === "HIGH");
    const score = issues.length > 0 ? 30 : 60;
    return {
      score,
      severity: issues.length > 0 ? (hasHighIssue ? "FAILED" : "POOR") : "WARNING",
      recommendedStatus: hasHighIssue ? "QUALITY_FAILED" : (issues.length > 0 ? "NEEDS_REWRITE" : "NEEDS_REWRITE"), // caller should override to REPLACE_WITH_ORIGINAL for official originals
      wordCount,
      sectionCount: 0,
      requiredSectionsPresent: [],
      missingRequiredSections: [],
      requirementCoverageRatio: 1,
      evidenceReferenceCount: 0,
      issues,
      notes: [`Non-narrative document (category: ${category}). Tender-issued form — narrative quality gate does not apply.`],
    };
  }

  if (category === "SUBMISSION_CONTROL") {
    return {
      score: 100,
      severity: "GOOD",
      recommendedStatus: "PASSED",
      wordCount,
      sectionCount: 0,
      requiredSectionsPresent: [],
      missingRequiredSections: [],
      requirementCoverageRatio: 1,
      evidenceReferenceCount: 0,
      issues: [],
      notes: ["Submission rule / control record — excluded from narrative quality gate."],
    };
  }

  if (category === "FINANCIAL_PROPOSAL") {
    // Financial proposals: check for AI traces but skip pricing-leakage check (it IS a pricing doc)
    if (text && /\b(as an ai|ai language model|chatgpt|claude|gemini)\b/i.test(text)) {
      issues.push({ code: "AI_TRACE", severity: "HIGH", message: "Financial proposal contains AI/meta traces." });
    }
    if (text && wordCount < 50 && wordCount > 0) {
      issues.push({ code: "TOO_SHORT", severity: "HIGH", message: `Financial proposal has only ${wordCount} words.` });
    }
    const score = Math.max(0, 100 - issues.length * 25);
    return {
      score,
      severity: severityFromScore(score),
      recommendedStatus: issues.length > 0 ? "QUALITY_FAILED" : "PASSED",
      wordCount,
      sectionCount: 0,
      requiredSectionsPresent: [],
      missingRequiredSections: [],
      requirementCoverageRatio: 1,
      evidenceReferenceCount: 0,
      issues,
      notes: ["Financial proposal — pricing-leakage check skipped; AI trace check applied."],
    };
  }

  // CV_PACKAGE and PROJECT_REFERENCE: lighter checks
  const hygieneDoc = { name: input.doc.name ?? "", exactFileName: input.doc.exactFileName ?? null, documentType: input.doc.documentType ?? null, format: input.doc.format ?? null };
  const hygiene = text ? documentHygieneIssues(text, hygieneDoc) : [];
  for (const h of hygiene) {
    if (/AI\/meta-preparation/i.test(h)) issues.push({ code: "AI_TRACE", severity: "HIGH", message: h });
    else if (/Placeholder/i.test(h)) issues.push({ code: "PLACEHOLDER", severity: "HIGH", message: h });
    // Skip pricing leakage for financial proposals
  }
  if (wordCount > 0 && wordCount < 80) {
    issues.push({ code: "TOO_SHORT", severity: "HIGH", message: `Document has only ${wordCount} words.` });
  }
  const score = Math.max(0, 100 - issues.reduce((s, i) => s + (i.severity === "HIGH" ? 25 : i.severity === "MEDIUM" ? 12 : 5), 0));
  return {
    score,
    severity: severityFromScore(score),
    recommendedStatus: score < 75 ? "QUALITY_FAILED" : "PASSED",
    wordCount,
    sectionCount: 0,
    requiredSectionsPresent: [],
    missingRequiredSections: [],
    requirementCoverageRatio: 1,
    evidenceReferenceCount: 0,
    issues,
    notes: [`Non-narrative document category: ${category} — lightweight quality check applied.`],
  };
}

export type DocumentQualitySeverity = "GOOD" | "WARNING" | "POOR" | "FAILED";

export type DocumentQualityRecommendedStatus =
  | "PASSED"
  | "NEEDS_REWRITE"
  | "QUALITY_FAILED"
  | "DRAFT_ONLY";

export type DocumentQualityIssueCode =
  | "TOO_SHORT"
  | "MISSING_REQUIRED_SECTION"
  | "GENERIC_FILLER"
  | "BID_TEAM_TO_CONFIRM"
  | "PLACEHOLDER"
  | "AI_TRACE"
  | "INTERNAL_TRACEABILITY"
  | "PRICING_LEAKAGE"
  | "UNSUPPORTED_CLAIM_RISK"
  | "DUPLICATED_SECTIONS"
  | "MISSING_REQUIREMENT_COVERAGE"
  | "MISSING_EVIDENCE_REFERENCE"
  | "MISSING_TITLE_OR_COVER"
  | "EMPTY_BODY"
  | "OFFICIAL_ORIGINAL_PLACEHOLDER_RISK";

export type DocumentQualityIssue = {
  code: DocumentQualityIssueCode;
  severity: "HIGH" | "MEDIUM" | "LOW";
  message: string;
};

export type DocumentQualityReport = {
  score: number;
  severity: DocumentQualitySeverity;
  recommendedStatus: DocumentQualityRecommendedStatus;
  wordCount: number;
  sectionCount: number;
  requiredSectionsPresent: string[];
  missingRequiredSections: string[];
  requirementCoverageRatio: number;
  evidenceReferenceCount: number;
  issues: DocumentQualityIssue[];
  notes: string[];
};

export type DocumentQualityInput = {
  doc: {
    id?: string | null;
    name?: string | null;
    exactFileName?: string | null;
    documentType?: string | null;
    format?: string | null;
    reviewStatus?: string | null;
  };
  /** Visible/plaintext content of the document. May be empty/null when DOCX cannot be parsed. */
  visibleText?: string | null;
  /** Raw stored content (could be base64 DOCX). Used only for sanity checks like emptiness. */
  rawFileContent?: string | null;
  /** Whether the document has a usable storage path (storage-backed only). */
  hasStoragePath?: boolean | null;
  /** Tender requirements — used to grade requirement coverage. */
  requirements?: Array<{ title?: string | null; description?: string | null; priority?: string | null }>;
  /** Selected expert/project names — used to detect that selected evidence is referenced. */
  selectedExpertNames?: string[];
  selectedProjectNames?: string[];
};

/** Lookup table: document-type-or-name patterns -> required sections that
 * MUST appear in the visible text for the document to score well. The
 * lookup is regex on the document label (name + exactFileName + type)
 * so this works regardless of how the document was named.
 */
const REQUIRED_SECTIONS_BY_KIND: Array<{ match: RegExp; sections: string[] }> = [
  // Cover letter / transmittal letter.
  {
    match: /cover\s+letter|transmittal/i,
    sections: ["dear", "subject", "sincerely"],
  },
  // Technical proposal — broad mandatory headings.
  {
    match: /technical\s+proposal|technical\s+offer|technical\s+volume/i,
    sections: ["executive summary", "understanding", "scope", "methodology", "work plan", "team", "deliverables", "qa", "risk"],
  },
  // Methodology and work plan.
  {
    match: /methodology|work\s+plan|approach/i,
    sections: ["phases", "tasks", "deliverables", "schedule", "qa", "risk"],
  },
  // Staffing / team composition.
  {
    match: /staffing|team\s+composition|personnel|cv\s+package/i,
    sections: ["team", "roles", "responsibilities", "experience"],
  },
  // Project references / past experience.
  {
    match: /project\s+experience|project\s+references|past\s+experience|reference\s+projects/i,
    sections: ["client", "scope", "value", "role", "outcome"],
  },
  // Compliance matrix.
  {
    match: /compliance\s+matrix|compliance\s+table/i,
    sections: ["requirement", "evidence", "section"],
  },
  // Implementation / project schedule.
  {
    match: /implementation\s+schedule|project\s+schedule|gantt/i,
    sections: ["phase", "milestone", "deliverable", "duration"],
  },
  // QA/QC plan.
  {
    match: /qa\s?\/?\s?qc|quality\s+(assurance|control)\s+plan/i,
    sections: ["review", "checklist", "responsibility", "frequency"],
  },
  // Risk management plan.
  {
    match: /risk\s+management|risk\s+plan|risk\s+register/i,
    sections: ["risk", "likelihood", "impact", "mitigation", "owner"],
  },
  // Reporting plan.
  {
    match: /reporting\s+plan|reporting\s+schedule/i,
    sections: ["report", "frequency", "responsibility", "distribution"],
  },
];

/** Minimum word counts per document kind. Anything below half is treated as failed. */
const MIN_WORD_COUNTS: Array<{ match: RegExp; min: number; idealMin: number }> = [
  { match: /technical\s+proposal/i, min: 1200, idealMin: 4000 },
  { match: /methodology|work\s+plan|approach/i, min: 800, idealMin: 2500 },
  { match: /staffing|team\s+composition|personnel/i, min: 400, idealMin: 1200 },
  { match: /project\s+experience|project\s+references|past\s+experience/i, min: 600, idealMin: 1800 },
  { match: /cover\s+letter|transmittal/i, min: 120, idealMin: 350 },
  { match: /compliance\s+matrix/i, min: 200, idealMin: 800 },
  { match: /implementation\s+schedule|project\s+schedule/i, min: 200, idealMin: 600 },
  { match: /qa\s?\/?\s?qc|quality\s+(assurance|control)/i, min: 300, idealMin: 900 },
  { match: /risk\s+management|risk\s+register/i, min: 300, idealMin: 900 },
  { match: /reporting\s+plan/i, min: 250, idealMin: 700 },
];

const GENERIC_FILLER_PATTERNS: RegExp[] = [
  /\b(?:in\s+conclusion|to\s+sum\s+up|in\s+summary|all\s+in\s+all)\b.{0,80}\b(?:we\s+are\s+committed|we\s+will\s+strive|we\s+look\s+forward)\b/i,
  /\b(?:state-of-the-art|world-class|cutting-edge|best-in-class|top-notch|second\s+to\s+none|unparalleled)\b/i,
  /\b(?:leverage\s+synerg|synergistic|holistic\s+approach|paradigm\s+shift)\b/i,
  /\bwe\s+have\s+extensive\s+experience\s+in\s+(?:this|the)\s+(?:field|sector)\b/i,
  /\bour\s+team\s+is\s+composed\s+of\s+highly\s+(?:qualified|experienced|skilled)\s+professionals\b/i,
];

const INTERNAL_TRACEABILITY_PATTERNS: RegExp[] = [
  /\bsource[-_\s]?id\b/i,
  /\bevidence[-_\s]?id\b/i,
  /\bmatch[-_\s]?score\b/i,
  /\bwin\s+probability\b/i,
  /\bevaluator[-_\s]?score\b/i,
  // Genuine internal-annotation markers only. This was
  // /\b(?:internal\s+(?:use|note|review)|reviewer\s+note)\b/i, whose bare
  // "internal review" alternative fired on ordinary QA-process prose — "quality
  // assurance is applied through independent internal review before any
  // deliverable is issued" is a description of how the firm works, not a
  // working note leaking into a submission. It failed a real technical proposal
  // at HIGH severity, which is a refusal the owner cannot act on because there
  // is nothing wrong with the sentence.
  /\b(?:internal\s+use(?:\s+only)?|internal\s+notes?|for\s+internal\s+review|internal\s+review\s+only|reviewer\s+notes?)\b/i,
  /\btraceability\s+map\b/i,
  /\baudit\s+metadata\b/i,
];

const UNSUPPORTED_CLAIM_PATTERNS: RegExp[] = [
  /\bover\s+\d+\s+projects?\s+delivered\b/i,
  /\b\d+\+?\s+years?\s+of\s+(?:industry\s+)?leadership\b/i,
  /\bawarded\s+(?:more\s+than|over)\s+\d+\s+contracts?\b/i,
  /\branked\s+(?:first|top|#1)\b/i,
];

const UNPROVEN_RELATIONSHIP_CLAIM_PATTERNS: RegExp[] = [
  /\balready\s+delivered\s+this\s+assignment\b/i,
  /\bsame\s+project\s+team\b.{0,100}\b(?:available|proposed|zero\s+learning\s+curve)\b/i,
  /\bdirectly\s+comparable\s+assignment\b/i,
  /\beach\s+proposed\s+lead\b.{0,120}\bcomparable\s+role\b/i,
];
const PHANTOM_ATTACHMENT_CLAIM = /\b(?:credentials|contracts|testimony letters|certificates|supporting documents)\b.{0,160}\b(?:attached|provided)\b.{0,80}\b(?:appendix|appendices|annex|annexes)\b/i;
const TRUNCATED_SUBMISSION_METADATA = /^(?:[-*]\s*)?Submission\s+(?:Address|Portal)[^:\n]*:\s*.*\b[a-z]{1,2}\s*$/im;

const OFFICIAL_ORIGINAL_LABEL_PATTERNS: RegExp[] = [
  /\bbid\s+form\b/i,
  /\btender\s+form\b/i,
  /\bdeclaration\s+(?:of|form)\b/i,
  /\bundertaking\b/i,
  /\bintegrity\s+pact\b/i,
  /\bbid\s+bond\b/i,
  /\bbank\s+statement\b/i,
  /\btin\s+cert/i,
  /\bvat\s+cert/i,
  /\btax\s+clearance\b/i,
  /\baudited\s+financial\b/i,
  /\btrade\s+license\b/i,
  /\bbusiness\s+licen/i,
  /\bregistration\s+certificate\b/i,
];

function normalize(value?: string | null): string {
  return (value ?? "").trim();
}

function labelOf(doc: DocumentQualityInput["doc"]): string {
  return `${doc.name ?? ""} ${doc.exactFileName ?? ""} ${doc.documentType ?? ""} ${doc.format ?? ""}`.toLowerCase();
}

function countSections(text: string): number {
  // Heuristic — count lines that look like ALL CAPS, "1. Heading", or
  // "Chapter X" / "Section X". Markdown headings count too.
  const lines = text.split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    const t = line.trim();
    if (t.length === 0) continue;
    if (/^#{1,6}\s+\S/.test(t)) count += 1;
    else if (/^(?:[0-9]+\.|[A-Z][A-Z0-9 \-,'/&]{3,})$/.test(t)) count += 1;
    else if (/^(?:section|chapter|annex|appendix)\s+[0-9A-Z]/i.test(t)) count += 1;
  }
  return count;
}

function duplicatedSectionHeadings(text: string): string[] {
  // A document with the same heading repeated ≥3 times has likely been
  // regenerated without dedupe; very likely poor quality.
  const headings = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+\S/.test(line) || /^(?:[0-9]+\.|[A-Z][A-Z0-9 \-,'/&]{3,})$/.test(line));
  const counts = new Map<string, number>();
  for (const h of headings) counts.set(h, (counts.get(h) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count >= 3).map(([heading]) => heading);
}

function detectDuplicatedSections(text: string): boolean {
  return duplicatedSectionHeadings(text).length > 0;
}

function findRequirementCoverage(
  text: string,
  requirements: DocumentQualityInput["requirements"] = [],
): { ratio: number; matchedCount: number; total: number } {
  if (!requirements || requirements.length === 0) return { ratio: 1, matchedCount: 0, total: 0 };
  const lower = text.toLowerCase();
  let matched = 0;
  for (const req of requirements) {
    const title = (req.title ?? "").trim();
    if (!title) continue;
    // Match if the first 3-4 words of the requirement title appear in the doc.
    const firstWords = title.toLowerCase().split(/\s+/).slice(0, 4).join(" ");
    if (firstWords.length >= 6 && lower.includes(firstWords)) matched += 1;
  }
  return { ratio: matched / requirements.length, matchedCount: matched, total: requirements.length };
}

function countEvidenceReferences(text: string, names: string[]): number {
  if (!names || names.length === 0) return 0;
  const lower = text.toLowerCase();
  let count = 0;
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length < 4) continue;
    if (lower.includes(trimmed.toLowerCase())) count += 1;
  }
  return count;
}

function severityFromScore(score: number): DocumentQualitySeverity {
  if (score >= 80) return "GOOD";
  if (score >= 60) return "WARNING";
  if (score >= 35) return "POOR";
  return "FAILED";
}

function recommendStatus(score: number, severity: DocumentQualitySeverity, issues: DocumentQualityIssue[], wordCount: number): DocumentQualityRecommendedStatus {
  const hasHighIssue = issues.some((i) => i.severity === "HIGH");
  if (severity === "FAILED" || hasHighIssue) return "QUALITY_FAILED";
  if (severity === "POOR") return "NEEDS_REWRITE";
  if (wordCount === 0) return "DRAFT_ONLY";
  if (severity === "WARNING") return "NEEDS_REWRITE";
  return "PASSED";
}

export function assessGeneratedDocumentQuality(input: DocumentQualityInput): DocumentQualityReport {
  const doc = input.doc;
  const label = labelOf(doc);

  // ── Document-type gate: non-narrative docs skip quality assessment ─────────
  // Official originals, financial/legal evidence, CV packages, submission rules,
  // and control rows are NOT narrative proposals. Running the narrative quality
  // gate on them produces false QUALITY_FAILED results. Instead we return a
  // minimal report that signals the correct handling path.
  const gatingCategory = detectDocumentGatingCategory(label, doc.documentType);
  if (gatingCategory !== "NARRATIVE") {
    return buildNonNarrativeReport(gatingCategory, label, input);
  }

  const text = normalize(input.visibleText);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const sectionCount = countSections(text);

  const issues: DocumentQualityIssue[] = [];
  const notes: string[] = [];

  // ── Empty body / no content. ─────────────────────────────────────────────
  if (wordCount === 0 && !input.hasStoragePath && !normalize(input.rawFileContent)) {
    issues.push({ code: "EMPTY_BODY", severity: "HIGH", message: "Document has no inspectable content and no storage path." });
  }

  // ── Word-count threshold. ────────────────────────────────────────────────
  const minRule = MIN_WORD_COUNTS.find((rule) => rule.match.test(label));
  if (minRule && wordCount > 0 && wordCount < Math.floor(minRule.min / 2)) {
    issues.push({ code: "TOO_SHORT", severity: "HIGH", message: `Document is only ${wordCount} words; threshold for this document kind is ${minRule.min}.` });
  } else if (minRule && wordCount < minRule.min) {
    issues.push({ code: "TOO_SHORT", severity: "MEDIUM", message: `Document has ${wordCount} words; ideal length is ${minRule.idealMin}+.` });
  }

  // ── Required sections by document kind. ──────────────────────────────────
  let requiredSectionsPresent: string[] = [];
  let missingRequiredSections: string[] = [];
  const lower = text.toLowerCase();
  const sectionRule = REQUIRED_SECTIONS_BY_KIND.find((rule) => rule.match.test(label));
  if (sectionRule) {
    requiredSectionsPresent = sectionRule.sections.filter((section) => lower.includes(section));
    missingRequiredSections = sectionRule.sections.filter((section) => !lower.includes(section));
    if (missingRequiredSections.length > 0 && wordCount > 0) {
      issues.push({
        code: "MISSING_REQUIRED_SECTION",
        severity: missingRequiredSections.length > Math.ceil(sectionRule.sections.length / 2) ? "HIGH" : "MEDIUM",
        message: `Missing expected section signal(s): ${missingRequiredSections.slice(0, 5).join(", ")}.`,
      });
    }
  }

  // ── Hygiene reuse — AI traces, placeholders, pricing leakage, etc. ──────
  // `documentHygieneIssues` expects required (non-null) name/exactFileName/
  // documentType/format. Coerce nullables to "" for the call so the helper
  // still works on documents with partially-populated metadata.
  const hygieneDoc = {
    name: doc.name ?? "",
    exactFileName: doc.exactFileName ?? null,
    documentType: doc.documentType ?? null,
    format: doc.format ?? null,
  };
  const hygiene = text ? documentHygieneIssues(text, hygieneDoc) : [];
  for (const h of hygiene) {
    if (/AI\/meta-preparation/i.test(h)) issues.push({ code: "AI_TRACE", severity: "HIGH", message: h });
    else if (/Placeholder/i.test(h)) issues.push({ code: "PLACEHOLDER", severity: "HIGH", message: h });
    else if (/pricing language/i.test(h)) issues.push({ code: "PRICING_LEAKAGE", severity: "HIGH", message: h });
  }

  // ── Bid-Team to confirm and other metadata placeholders. ─────────────────
  if (text) {
    let placeholderHits = 0;
    for (const rx of METADATA_PLACEHOLDER_PATTERNS) {
      const matches = text.match(new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : `${rx.flags}g`));
      if (matches) placeholderHits += matches.length;
    }
    if (placeholderHits > 0) {
      issues.push({
        code: "BID_TEAM_TO_CONFIRM",
        severity: "HIGH",
        message: `Document contains ${placeholderHits} internal placeholder reference(s) (e.g. "Bid-Team to confirm"). These must never appear in submitted proposals.`,
      });
    }
  }

  // ── Generic filler / boilerplate. ────────────────────────────────────────
  if (text && GENERIC_FILLER_PATTERNS.some((rx) => rx.test(text))) {
    issues.push({ code: "GENERIC_FILLER", severity: "MEDIUM", message: "Document contains generic marketing filler (e.g. 'state-of-the-art', 'holistic approach'). Replace with tender-specific language." });
  }

  // ── Internal traceability leakage. ───────────────────────────────────────
  if (text && INTERNAL_TRACEABILITY_PATTERNS.some((rx) => rx.test(text))) {
    issues.push({ code: "INTERNAL_TRACEABILITY", severity: "HIGH", message: "Document contains internal traceability text (source-id, evidence-id, match-score, win probability). Strip before submission." });
  }

  // ── Unsupported claims. ─────────────────────────────────────────────────
  if (text && UNSUPPORTED_CLAIM_PATTERNS.some((rx) => rx.test(text))) {
    issues.push({ code: "UNSUPPORTED_CLAIM_RISK", severity: "MEDIUM", message: "Document may contain unsupported numeric claims (e.g. 'over X projects delivered'). Verify against reviewed evidence." });
  }
  if (text && UNPROVEN_RELATIONSHIP_CLAIM_PATTERNS.some((rx) => rx.test(text))) {
    issues.push({ code: "UNSUPPORTED_CLAIM_RISK", severity: "HIGH", message: "Document makes a categorical assignment-equivalence or personnel-continuity claim that requires explicit relationship evidence." });
  }
  if (text && PHANTOM_ATTACHMENT_CLAIM.test(text)) {
    issues.push({ code: "UNSUPPORTED_CLAIM_RISK", severity: "HIGH", message: "Document claims supporting material is attached in an appendix or annex without package-level proof." });
  }
  if (text && TRUNCATED_SUBMISSION_METADATA.test(text)) {
    issues.push({ code: "PLACEHOLDER", severity: "HIGH", message: "Document contains malformed or visibly truncated submission metadata." });
  }

  // ── Duplicated sections. ────────────────────────────────────────────────
  const repeatedHeadings = text ? duplicatedSectionHeadings(text) : [];
  if (repeatedHeadings.length > 0) {
    issues.push({ code: "DUPLICATED_SECTIONS", severity: "MEDIUM", message: `Same heading appears ≥3 times: ${repeatedHeadings.slice(0, 5).join("; ")}.` });
  }

  // ── Requirement coverage. ───────────────────────────────────────────────
  const reqCov = findRequirementCoverage(text, input.requirements);
  if (reqCov.total > 0 && reqCov.ratio < 0.3) {
    issues.push({
      code: "MISSING_REQUIREMENT_COVERAGE",
      severity: "MEDIUM",
      message: `Document references only ${reqCov.matchedCount}/${reqCov.total} extracted requirements. Senior-quality proposals reference at least 30% explicitly.`,
    });
  }

  // ── Evidence references. ────────────────────────────────────────────────
  const evidenceRefs = countEvidenceReferences(text, [...(input.selectedExpertNames ?? []), ...(input.selectedProjectNames ?? [])]);
  const evidenceRelevant = /staffing|technical\s+proposal|personnel|project\s+experience|cv|reference/i.test(label);
  if (evidenceRelevant && evidenceRefs === 0 && wordCount > 0) {
    issues.push({
      code: "MISSING_EVIDENCE_REFERENCE",
      severity: "MEDIUM",
      message: "Document does not reference any selected reviewed expert or project — staffing/technical/reference documents must cite the chosen evidence.",
    });
  }

  // ── Title / cover signal. ───────────────────────────────────────────────
  if (text && wordCount >= 200) {
    // The window must clear a letterhead.
    //
    // This read text.slice(0, 600), which assumed the title is the first thing
    // on the page. It is not: applyActiveUploadedLetterheadToTenderDocuments
    // is a normal automatic stage, and a real Company Vault letterhead —
    // legal name, address, PO box, phone, email, trade licence, TIN, VAT,
    // registration lines — runs past 600 characters on its own. Measured on a
    // realistic letterhead the title "Technical Proposal" began at character
    // 614, so a document with a perfectly good cover page was reported as
    // having none.
    //
    // That was the MISSING_TITLE_OR_COVER on a real owner run whose cover page
    // WAS being injected. The fix is to look far enough to see it — roughly
    // the first page of extracted text — not to inject a second cover.
    const COVER_SCAN_CHARS = 2_500;
    const head = text.slice(0, COVER_SCAN_CHARS);
    const looksTitleHeavy =
      /^(?:title|cover|subject|date|technical\s+proposal|expression\s+of\s+interest|company\s+profile)\b/im.test(head)
      // A cover page addresses someone and names what it is. Both are title
      // signals a letterhead does not produce by itself.
      || /^(?:submitted\s+(?:to|by)|attention|re:|proposal\s+for|in\s+response\s+to)\b/im.test(head);
    if (!looksTitleHeavy && /technical\s+proposal|methodology|cover\s+letter/i.test(label)) {
      issues.push({ code: "MISSING_TITLE_OR_COVER", severity: "LOW", message: "Document does not begin with a clear title / subject line." });
    }
  }

  // ── Official-original placeholder risk. ─────────────────────────────────
  if (OFFICIAL_ORIGINAL_LABEL_PATTERNS.some((rx) => rx.test(label))) {
    // For these document types, the actual original is required. A
    // "generated" body that includes "Bid-Team to confirm" or generic
    // language is high-risk — we mark it so the gate forces ATTACH_ORIGINAL.
    if (issues.some((i) => i.code === "BID_TEAM_TO_CONFIRM" || i.code === "PLACEHOLDER" || i.code === "GENERIC_FILLER")) {
      issues.push({
        code: "OFFICIAL_ORIGINAL_PLACEHOLDER_RISK",
        severity: "HIGH",
        message: "This document type requires the tender-issued original. The current generated content includes placeholder/generic language and must be REPLACED with the official original before export.",
      });
    }
  }

  // ── Score the document. ─────────────────────────────────────────────────
  // Base 100, then subtract per issue severity.
  let score = 100;
  for (const issue of issues) {
    score -= issue.severity === "HIGH" ? 25 : issue.severity === "MEDIUM" ? 12 : 5;
  }
  // Length-based floor: extremely short docs cap the score.
  if (wordCount > 0 && wordCount < 50) score = Math.min(score, 20);
  if (wordCount === 0) score = Math.min(score, 10);
  // Requirement coverage bonus (modest).
  if (reqCov.total > 0) {
    const bonus = Math.round((reqCov.ratio - 0.3) * 20);
    score += Math.max(-15, Math.min(10, bonus));
  }
  score = Math.max(0, Math.min(100, score));
  const severity = severityFromScore(score);
  const recommendedStatus = recommendStatus(score, severity, issues, wordCount);

  if (recommendedStatus !== "PASSED") {
    notes.push(`Recommended status: ${recommendedStatus} (score ${score}/100).`);
  }

  return {
    score,
    severity,
    recommendedStatus,
    wordCount,
    sectionCount,
    requiredSectionsPresent,
    missingRequiredSections,
    requirementCoverageRatio: reqCov.ratio,
    evidenceReferenceCount: evidenceRefs,
    issues,
    notes,
  };
}

export const __testing__ = {
  countSections,
  detectDuplicatedSections,
  GENERIC_FILLER_PATTERNS,
  INTERNAL_TRACEABILITY_PATTERNS,
  UNSUPPORTED_CLAIM_PATTERNS,
  UNPROVEN_RELATIONSHIP_CLAIM_PATTERNS,
  OFFICIAL_ORIGINAL_LABEL_PATTERNS,
  MIN_WORD_COUNTS,
  REQUIRED_SECTIONS_BY_KIND,
};
