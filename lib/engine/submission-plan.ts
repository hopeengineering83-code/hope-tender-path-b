import { classifySubmissionPlanItem, financialProposalNameInTitle, plannedFileIsARule, requiresSubmittedFinancialProposal } from "./submission-plan-classifier";
import { statedSingleSubmissionFile } from "./single-submission-file-rule";
import { readFinancialProposalRequirement } from "./source-driven-tender-text-parser";
import { isPriceSubmissionFile } from "./pricing-submission-scope";

export type SubmissionPlanFormat = "DOCX" | "PDF" | "ZIP" | "XLSX" | "OTHER";

/** Which physical submission envelope this file belongs to.
 * - TECHNICAL  — goes into the sealed technical envelope / technical volume
 * - FINANCIAL  — goes into the sealed financial/commercial envelope (price data, BoQ, rate cards)
 * - ADMIN      — goes into the administrative/eligibility envelope (registrations, bid bond, declarations)
 *
 * Downstream checks use this to enforce technical/financial separation: no
 * FINANCIAL file may appear in a TECHNICAL envelope and vice-versa.
 */
export type SubmissionEnvelope = "TECHNICAL" | "FINANCIAL" | "ADMIN";

export type SubmissionPlanFile = {
  canonicalId: string;
  exactFileName: string;
  documentType: string;
  required: boolean;
  exactOrder: number;
  format: SubmissionPlanFormat;
  envelope: SubmissionEnvelope;
  sourceRequirementIds: string[];
  pageLimit?: number | null;
  templateRequired?: boolean;
  templateSourceFileId?: string | null;
  brandingAllowed?: boolean;
  signatureAllowed?: boolean;
  stampAllowed?: boolean;
  grouping?: string | null;
  notes?: string | null;
};

export type SubmissionPlanQuantityRule = {
  requirementType: "EXPERT" | "PROJECT_EXPERIENCE" | "FORM" | "ANNEX" | "SCHEDULE" | "DECLARATION";
  requiredQuantity: number | null;
  sourceRequirementIds: string[];
  notes?: string | null;
};

export type SubmissionPlan = {
  tenderId: string;
  files: SubmissionPlanFile[];
  quantityRules: SubmissionPlanQuantityRule[];
  forbiddenContentRules: string[];
  brandingRules: {
    letterheadAllowed: boolean;
    signatureAllowed: boolean;
    stampAllowed: boolean;
    coverPageAllowed: boolean;
    notes?: string | null;
  };
  warnings: string[];
};

export type TenderRequirementLike = {
  id: string;
  title: string;
  description?: string | null;
  requirementType: string;
  priority: string;
  exactFileName?: string | null;
  exactOrder?: number | null;
  requiredQuantity?: number | null;
  pageLimit?: number | null;
  restrictions?: string | null;
  sectionReference?: string | null;
  /** When the requirement was extracted: the tender's own sequence. */
  createdAt?: Date | string | null;
};

/**
 * Requirements in one canonical order: extraction time, then id. Every
 * database read already asks for this order; sorting here as well makes the
 * plan a function of the requirements themselves, so no caller, cache or test
 * double that hands them over in another order can change a file's identity
 * (canonicalId), its provenance list (sourceRequirementIds) or its position.
 */
export function canonicalRequirementOrder<R extends { id: string; createdAt?: Date | string | null }>(requirements: readonly R[]): R[] {
  const time = (r: R) => {
    const t = r.createdAt == null ? Number.NaN : new Date(r.createdAt).getTime();
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  return [...requirements].sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export type TenderLike = {
  id: string;
  title?: string | null;
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  pageLimit?: number | null;
  requirements?: TenderRequirementLike[];
  submissionMethod?: string | null;
  tenderCategory?: string | null;
  analysisExtractionStatus?: string | null;
};

export type GeneratedDocumentLike = {
  id?: string;
  name?: string | null;
  documentType?: string | null;
  exactFileName?: string | null;
  exactOrder?: number | null;
  format?: string | null;
  generationStatus?: string | null;
  fileContent?: string | null;
};

const DOCUMENT_REQUIREMENT_TYPES = new Set([
  "TECHNICAL",
  "FINANCIAL",
  "ELIGIBILITY",
  "FORMAT",
  "SUBMISSION_RULE",
  "DECLARATION",
  "ANNEX",
  "SCHEDULE",
  "FORM",
  "METHODOLOGY",
  "COMPANY_PROFILE",
  "PROJECT_EXPERIENCE",
]);

const QUANTITY_REQUIREMENT_TYPES = new Set<SubmissionPlanQuantityRule["requirementType"]>([
  "EXPERT",
  "PROJECT_EXPERIENCE",
  "FORM",
  "ANNEX",
  "SCHEDULE",
  "DECLARATION",
]);

export function parseStringArray(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function normalize(value?: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slug(value: string): string {
  return normalize(value).replace(/\s+/g, "-") || "document";
}

function inferFormat(fileName: string, fallback?: string | null): SubmissionPlanFormat {
  const text = `${fileName} ${fallback ?? ""}`.toLowerCase();
  if (/\.pdf\b|\bpdf\b/.test(text)) return "PDF";
  if (/\.zip\b|\bzip\b/.test(text)) return "ZIP";
  if (/\.xlsx\b|\.xls\b|\bexcel\b|\bspreadsheet\b/.test(text)) return "XLSX";
  if (/\.docx\b|\.doc\b|\bword\b|\bdocx\b/.test(text)) return "DOCX";
  return "DOCX";
}

/**
 * Canonical format inference shared by the submission-plan producer and the
 * final-package manifest. Keeping one classifier prevents the plan and the
 * exported ZIP from recording contradictory formats for the same filename.
 */
export function inferSubmissionPlanFormat(
  fileName: string,
  fallback?: string | null,
): SubmissionPlanFormat {
  return inferFormat(fileName, fallback);
}

function fileNameWithExtension(fileName: string, format: SubmissionPlanFormat): string {
  const trimmed = fileName.trim();
  if (/\.[a-z0-9]{2,5}$/i.test(trimmed)) return trimmed;
  if (format === "PDF") return `${trimmed}.pdf`;
  if (format === "ZIP") return `${trimmed}.zip`;
  if (format === "XLSX") return `${trimmed}.xlsx`;
  if (format === "DOCX") return `${trimmed}.docx`;
  return trimmed;
}

function restrictionText(requirements: TenderRequirementLike[]): string {
  return requirements.map((requirement) => requirement.restrictions ?? "").join("\n");
}

function restrictionAllows(text: string, subject: "letterhead" | "signature" | "stamp" | "cover"): boolean {
  const normalized = text.toLowerCase();
  const subjectPattern = subject === "cover" ? "cover page|cover" : subject;
  const forbidden = new RegExp(`(no|not allowed|forbid|forbidden|must not|do not|without|prohibited).{0,80}(${subjectPattern})|(${subjectPattern}).{0,80}(not allowed|forbidden|prohibited|must not)`, "i");
  return !forbidden.test(normalized);
}

/** Infer which submission envelope a file belongs to based on document-type
 * and file name keywords.
 *
 * Rules (in order of specificity):
 * 1. Explicit FINANCIAL requirementType or pricing/commercial/BoQ keywords → FINANCIAL
 * 2. Admin/eligibility keywords (registration, declaration, eligibility, bid bond,
 *    bank guarantee, tax clearance, VAT, TIN, incorporation, undertaking, integrity,
 *    compliance, form, annex, schedule) → ADMIN
 * 3. Everything else → TECHNICAL
 */
export function inferEnvelope(
  requirementType: string,
  fileName: string,
  description?: string | null,
): SubmissionEnvelope {
  const text = `${requirementType} ${fileName} ${description ?? ""}`.toLowerCase();

  // Financial QUALIFICATION evidence (audited statements, turnover, a
  // financial-capacity form, bank references) belongs with the eligibility
  // documents, not in the sealed financial envelope with the price.
  const qualificationEvidence = /\baudited\b|\bfinancial[\s-]+(?:statements?|capacity|standing|situation|position|resources|records?|reports?|soundness|strength)\b|\bturnover\b|\bbalance[\s-]+sheets?\b|\bbank[\s-]+(?:statements?|references?)\b|\bannual[\s-]+reports?\b|\bline[\s-]+of[\s-]+credit\b/i;
  const priceSubmission = /\b(?:financial|commercial|price)[\s-]+(?:proposal|offer|bid)\b|price[\s-]+schedule|\bpriced\b|bill[\s-]+of[\s-]+quantit|\bboq\b|rate[\s-]+card|schedule[\s-]+of[\s-]+rates|fee[\s-]+schedule|\bquotation\b/i;
  if (qualificationEvidence.test(text) && !priceSubmission.test(text)) return "ADMIN";

  const financialRx = /\bfinancial\b|commercial[\s-]+offer|price[\s-]+(schedule|proposal|form)|bill[\s-]+of[\s-]+quantit|rate[\s-]+card|cost[\s-]+proposal|budget[\s-]+proposal|pricing|fee[\s-]+schedule|boq\b|b\.o\.q\b|lump[\s-]+sum[\s-]+offer|schedule[\s-]+of[\s-]+rates/i;
  if (financialRx.test(text)) return "FINANCIAL";

  // Explicit technical deliverables outrank a generic FORM requirement type.
  // Otherwise "Technical Proposal.pdf" extracted as requirementType=FORM is
  // incorrectly classified into the ADMIN envelope.
  const technicalRx = /\btechnical[\s-]+proposal\b|\btechnical[\s-]+offer\b|\bmethodology\b|\btechnical[\s-]+approach\b|\bwork[\s-]+plan\b|\bimplementation[\s-]+plan\b|\bteam[\s-]+(?:cv|curriculum)|\bkey[\s-]+experts?\b/i;
  if (technicalRx.test(`${fileName} ${description ?? ""}`.toLowerCase())) return "TECHNICAL";

  const adminRx = /\bregistration\b|\bdeclaration\b|\beligibility\b|\bbid\s+bond\b|\bbid\s+security\b|\bbank\s+guarantee\b|\btax\s+clearance\b|\bvat\s+cert|\btin\s+cert|\bincorporation\b|\bundertaking\b|\bintegrity\s+pact\b|\bannex\b|\bschedule\b|\bform\b|\bcompliance\s+(matrix|certif)|\bpower\s+of\s+attorney\b|\baudited\s+financial\b|\bbank\s+statement\b|\bbusiness\s+licen\b/i;
  if (adminRx.test(text)) return "ADMIN";

  return "TECHNICAL";
}

function documentTypeFromRequirement(requirement: TenderRequirementLike): string {
  const type = requirement.requirementType.toUpperCase();
  if (type === "EXPERT") return "EXPERT";
  if (type === "PROJECT_EXPERIENCE") return "PROJECT_REFERENCE";
  return type;
}

function fileKey(fileName: string): string {
  return normalize(fileName);
}

/**
 * The type of a file several requirements contribute to, independent of the
 * order they are read in.
 *
 * Keeping whichever contributor arrived first made the type depend on row
 * order, and requirements are read without one: the Pharo plan (2026-10-08)
 * was confirmed as "Technical Proposal.pdf / ANNEX", the same 14 rows came
 * back in another order after finalization updated them, the recomputed scope
 * said "COMPANY_PROFILE", and the export gate refused a correct plan as "not
 * in current tender-controlled scope". A file named as the main proposal is
 * that proposal; any other merged file takes the lowest type name, which is
 * the same whichever order the rows arrive in.
 */
function mergedDocumentType(fileName: string, a: string, b: string): string {
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  if (/expression[\s._-]*of[\s._-]*interest|\beoi\b/i.test(base)) return "EXPRESSION_OF_INTEREST";
  if (/\btechnical[\s._-]*proposal\b/i.test(base)) return "TECHNICAL_PROPOSAL";
  return a <= b ? a : b;
}

function addFile(files: Map<string, SubmissionPlanFile>, file: SubmissionPlanFile) {
  const key = fileKey(file.exactFileName);
  const existing = files.get(key);
  if (!existing) {
    files.set(key, file);
    return;
  }

  files.set(key, {
    ...existing,
    documentType: mergedDocumentType(existing.exactFileName, existing.documentType, file.documentType),
    required: existing.required || file.required,
    exactOrder: Math.min(existing.exactOrder, file.exactOrder),
    sourceRequirementIds: Array.from(new Set([...existing.sourceRequirementIds, ...file.sourceRequirementIds])),
    pageLimit: existing.pageLimit ?? file.pageLimit ?? null,
    templateRequired: Boolean(existing.templateRequired || file.templateRequired),
    brandingAllowed: existing.brandingAllowed && file.brandingAllowed,
    signatureAllowed: existing.signatureAllowed && file.signatureAllowed,
    stampAllowed: existing.stampAllowed && file.stampAllowed,
    notes: [existing.notes, file.notes].filter(Boolean).join(" | ") || null,
  });
}

/**
 * Positions the proposal first when no tender order places it: the tender
 * declared no order here (the caller only folds when it names no files), so
 * the remaining files keep their relative order one step later.
 */
function shiftForLeadingProposal(files: Map<string, SubmissionPlanFile>): number {
  for (const [key, file] of Array.from(files.entries())) files.set(key, { ...file, exactOrder: file.exactOrder + 1 });
  return 1;
}

/** Bidder-written narrative that is a section of the technical proposal. */
const PROPOSAL_SECTION = /technical proposal|cover letter|executive summary|company profile|firm profile|qualification|capabilit|methodology|approach|work\s*plan|implementation plan|quality assurance|risk management|project team|team composition|key personnel|personnel|staffing|\bcvs?\b|curriculum vitae|expert|experience|portfolio|track record|project reference|similar projects|understanding|scope of (?:work|services)/;

function buildFileFromRequirement(requirement: TenderRequirementLike, index: number): SubmissionPlanFile | null {
  const type = requirement.requirementType.toUpperCase();
  if (!requirement.exactFileName && !DOCUMENT_REQUIREMENT_TYPES.has(type)) return null;

  // ─── Gap 8 fix — reject "rule" rows posing as files ─────────────────
  // The classifier inspects title+description+type and returns whether
  // this row should become a planned file. Rules (commercial separation,
  // submission process, internal controls) return false here so they
  // never produce a fake .docx/.pdf in the submission plan.
  const classifier = classifySubmissionPlanItem({
    title: requirement.title,
    description: requirement.description,
    requirementType: requirement.requirementType,
    exactFileName: requirement.exactFileName,
  });
  if (!classifier.shouldBePlannedFile) return null;

  // A row the tender words as "submit a financial proposal …" is required
  // whatever priority label the model gave it: "SCORED" says the proposal is
  // weighted, not that it is optional. A feasibility-study ToR asking for a
  // technical and a financial proposal got a plan with no financial file
  // because the row was SCORED (2026-10-06). The file is the deliverable the
  // title names ("Financial Proposal"), not the row's heading.
  const financialProposal = !requirement.exactFileName?.trim()
    && requiresSubmittedFinancialProposal(requirement.title, `${requirement.title ?? ""} ${requirement.description ?? ""}`.toLowerCase());
  const baseName = requirement.exactFileName?.trim()
    || (financialProposal ? financialProposalNameInTitle(requirement.title) : null)
    || requirement.title?.trim()
    || `${type.toLowerCase()}-${index + 1}`;
  const format = inferFormat(baseName, `${requirement.description ?? ""} ${requirement.restrictions ?? ""}`);
  const restrictions = requirement.restrictions ?? "";

  return {
    canonicalId: `req-${requirement.id}`,
    exactFileName: fileNameWithExtension(baseName, format),
    documentType: documentTypeFromRequirement(requirement),
    required: requirement.priority?.toUpperCase() === "MANDATORY" || Boolean(requirement.exactFileName) || financialProposal,
    exactOrder: requirement.exactOrder ?? index + 1,
    format,
    envelope: inferEnvelope(requirement.requirementType, baseName, requirement.description),
    sourceRequirementIds: [requirement.id],
    pageLimit: requirement.pageLimit ?? null,
    templateRequired: /template|form|annex|schedule|declaration/i.test(`${requirement.title} ${requirement.description ?? ""} ${restrictions}`),
    templateSourceFileId: null,
    brandingAllowed: restrictionAllows(restrictions, "letterhead"),
    signatureAllowed: restrictionAllows(restrictions, "signature"),
    stampAllowed: restrictionAllows(restrictions, "stamp"),
    grouping: requirement.sectionReference ?? null,
    notes: restrictions || null,
  };
}

function buildFilesFromExactNames(tender: TenderLike, startOrder: number): SubmissionPlanFile[] {
  const exactNames = parseStringArray(tender.exactFileNaming);
  const exactOrder = parseStringArray(tender.exactFileOrder);
  const orderedNames = exactOrder.length > 0 ? exactOrder : exactNames;
  const sourceNames = orderedNames.length > 0 ? orderedNames : exactNames;

  // A tender-stated name is still subject to the one rule-vs-file authority:
  // a name that positively reads as a submission rule ("Email Submission")
  // describes how to send the package and can never be produced, so it must
  // not become a required file. Only the positive rule categories are dropped —
  // the classifier's catch-all is not a reason to discard a name the tender gave.
  const deliverableNames = sourceNames.filter((name) => {
    const category = classifySubmissionPlanItem({ title: name, exactFileName: name }).category;
    return category !== "SUBMISSION_RULE" && category !== "COMMERCIAL_SEPARATION_RULE";
  });

  return deliverableNames.map((name, index): SubmissionPlanFile => {
    const format = inferFormat(name);
    return {
      canonicalId: `exact-${slug(name)}`,
      exactFileName: fileNameWithExtension(name, format),
      documentType: "TENDER_REQUIRED_FILE",
      required: true,
      exactOrder: startOrder + index,
      format,
      envelope: inferEnvelope("TENDER_REQUIRED_FILE", name),
      sourceRequirementIds: [],
      pageLimit: tender.pageLimit ?? null,
      templateRequired: /template|form|annex|schedule|declaration/i.test(name),
      templateSourceFileId: null,
      brandingAllowed: true,
      signatureAllowed: true,
      stampAllowed: true,
      grouping: null,
      notes: "Compiled from tender exact file naming/order instructions.",
    };
  });
}

function buildQuantityRules(requirements: TenderRequirementLike[]): SubmissionPlanQuantityRule[] {
  const grouped = new Map<SubmissionPlanQuantityRule["requirementType"], SubmissionPlanQuantityRule>();

  for (const requirement of requirements) {
    const type = requirement.requirementType.toUpperCase() as SubmissionPlanQuantityRule["requirementType"];
    if (!QUANTITY_REQUIREMENT_TYPES.has(type)) continue;
    if (requirement.requiredQuantity == null && !["FORM", "ANNEX", "SCHEDULE", "DECLARATION"].includes(type)) continue;

    const current = grouped.get(type);
    const nextQuantity = requirement.requiredQuantity ?? current?.requiredQuantity ?? null;
    grouped.set(type, {
      requirementType: type,
      requiredQuantity: current?.requiredQuantity == null ? nextQuantity : Math.max(current.requiredQuantity ?? 0, nextQuantity ?? 0) || null,
      sourceRequirementIds: Array.from(new Set([...(current?.sourceRequirementIds ?? []), requirement.id])),
      notes: [current?.notes, requirement.title].filter(Boolean).join(" | ") || null,
    });
  }

  return Array.from(grouped.values());
}

export function buildSubmissionPlanWithDerivedFallback(tender: TenderLike): SubmissionPlan {
  const plan = buildSubmissionPlan(tender);
  if (plan.files.length > 0 || (tender.requirements ?? []).length === 0) return plan;

  const derivedEntries = buildDerivedDraftPlan({
    requirements: canonicalRequirementOrder(tender.requirements ?? []).map((r) => ({
      title: r.title,
      description: r.description,
      requirementType: r.requirementType,
      priority: r.priority,
    })),
    submissionMethod: tender.submissionMethod,
    title: tender.title,
    tenderCategory: tender.tenderCategory,
    analysisExtractionStatus: tender.analysisExtractionStatus,
  });

  if (derivedEntries.length === 0) return plan;

  const derivedFiles = derivedEntries.map((entry, index): SubmissionPlanFile => ({
    canonicalId: `derived-${index + 1}`,
    exactFileName: fileNameWithExtension(entry.name, "DOCX"),
    documentType: entry.documentType,
    required: entry.required,
    exactOrder: index + 1,
    format: "DOCX",
    envelope: (/^FINANCIAL/.test(entry.documentType) ? "FINANCIAL" : "TECHNICAL"),
    sourceRequirementIds: [],
    pageLimit: null,
    templateRequired: false,
    templateSourceFileId: null,
    brandingAllowed: true,
    signatureAllowed: true,
    stampAllowed: true,
    grouping: null,
    notes: entry.derivedFrom,
  }));

  return { ...plan, files: derivedFiles, warnings: [...plan.warnings, "Submission plan is a derived draft; confirm exact file names/order before export."] };
}

/**
 * May this tender's plan carry a price submission? `state` is the canonical
 * three-state reader's answer over the requirement rows and the tender's own
 * file list. Every planned file comes from a tender requirement row (source
 * page and quote, verified at confirmation) or the tender's own file list, so
 * a planned price file is grounded by that source — unless the tender rules
 * pricing out (`state === false`), which always wins. The plan builder and the
 * Build Plan validators share this one answer.
 *
 * It used to demand that the rows also use the reader's financial vocabulary,
 * so a required "Price Bid Form" or "Cost Schedule" row, whose words the reader
 * does not list, was dropped from the plan (release review, 2026-10-11).
 */
export function priceSubmissionGrounding(tender: Pick<TenderLike, "requirements" | "exactFileNaming" | "exactFileOrder">): { grounded: boolean; state: boolean | null } {
  const requirements = tender.requirements ?? [];
  const declared = [...parseStringArray(tender.exactFileNaming), ...parseStringArray(tender.exactFileOrder)];
  const state = readFinancialProposalRequirement([
    ...declared.map((name) => name.replace(/\.[a-z0-9]+$/i, "")),
    ...requirements.map((requirement) => [requirement.title, requirement.description, requirement.restrictions].filter(Boolean).join(". ")),
  ].join("\n"));
  return { grounded: state !== false, state };
}

/** A planned file carries the tender source it came from: requirement rows, or the tender's own file list. */
function hasTenderSource(file: { canonicalId?: string | null; sourceRequirementIds?: string[] | null }): boolean {
  return (file.sourceRequirementIds ?? []).length > 0 || String(file.canonicalId ?? "").startsWith("exact-");
}

export function buildSubmissionPlan(tender: TenderLike): SubmissionPlan {
  const requirements = canonicalRequirementOrder(tender.requirements ?? []);
  const files = new Map<string, SubmissionPlanFile>();
  const restrictions = restrictionText(requirements);

  // The tender's own list of file names is the authority on WHAT the
  // deliverables are; a requirement title is a description of one.
  //
  // A requirement row that elaborates a deliverable the tender has already
  // named must not become a SECOND file. The Pharo tender names exactly one —
  // exactFileNaming ["Technical Proposal.pdf"] — and also carries a MANDATORY
  // FORMAT requirement titled "Technical Proposal Structure", which says how
  // that proposal must be structured. The planner turned the second into its
  // own deliverable, "Technical Proposal Structure.docx"; generation then
  // wrote the entire 11,590-word technical proposal into THAT file and
  // superseded the correctly named one, so the package simultaneously reported
  // EXTRA_FILES and "MISSING_REQUIRED_FILES: technical proposal.pdf" — the
  // required deliverable existed, under a name the tender never asked for.
  //
  // Folding is by name containment against the declared list and applies only
  // to rows with no exactFileName of their own, so a row that names its own
  // file still gets one, and a genuinely different deliverable (an annex, a
  // financial offer) is untouched: its base name neither contains nor is
  // contained by a declared name. The row's requirement ids move to the file it
  // describes, so nothing loses its provenance.
  const declaredBaseNames = parseStringArray(tender.exactFileNaming)
    .concat(parseStringArray(tender.exactFileOrder))
    .map((name) => normalize(name.trim().replace(/\.[a-z0-9]+$/i, "")))
    .filter(Boolean);
  const elaboratesDeclaredFile = (requirement: TenderRequirementLike, file: SubmissionPlanFile): string | null => {
    if ((requirement.exactFileName ?? "").trim()) return null;
    const base = normalize(file.exactFileName.replace(/\.[a-z0-9]+$/i, ""));
    if (!base) return null;
    const byName = declaredBaseNames.find((declared) => declared !== base && (base.includes(declared) || declared.includes(base)));
    if (byName) return byName;
    // A row that states which declared file it belongs to is a part of that
    // file, not a file beside it. AI Analyze returned "Cover Letter" and
    // "Company Profile" as MANDATORY rows with sectionReference "Technical
    // Proposal - Required Sections" on a tender that asks for one PDF; the
    // planner made each its own .docx and the ZIP carried three files. A
    // financial-envelope row is never folded into another file.
    if (file.envelope === "FINANCIAL") return null;
    const container = normalize(requirement.sectionReference ?? "");
    if (!container) return null;
    return declaredBaseNames.find((declared) => declared !== base && container.includes(declared)) ?? null;
  };
  const foldedRequirementIds = new Map<string, string[]>();

  requirements.forEach((requirement, index) => {
    const file = buildFileFromRequirement(requirement, index);
    if (!file) return;
    const declaredBase = elaboratesDeclaredFile(requirement, file);
    if (declaredBase) {
      foldedRequirementIds.set(declaredBase, [...(foldedRequirementIds.get(declaredBase) ?? []), ...file.sourceRequirementIds]);
      return;
    }
    addFile(files, file);
  });

  // ── Unnamed proposal sections are sections of ONE proposal ──────────────
  //
  // 2026-09-29, Preview, a new tender that names no files: AI Analyze returned
  // "Company Profile and Qualifications", "Technical Approach and
  // Methodology", "Project Team Qualifications" and "Portfolio and
  // Experience" as MANDATORY rows. The planner made the first two separate
  // required .docx files. Proposal Generation then wrote the complete
  // Technical Proposal (cover letter, Sections A–H, compliance matrix mapping
  // each of those rows to a section), and auto-finalize retired it as "outside
  // the confirmed plan", leaving the package as two short planned-file drafts.
  //
  // When the tender states no file names and no single-file rule, a
  // bidder-written narrative item the row does not name as a file is a
  // section of the one technical proposal, not a file beside it. Tender
  // forms, original evidence, financial items and legal instruments (bid
  // bond, power of attorney, JV/consortium agreement) are untouched, and a
  // tender that names its files keeps them exactly as named.
  if (declaredBaseNames.length === 0 && !statedSingleSubmissionFile(requirements)) {
    const requirementById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
    const sections = Array.from(files.entries()).filter(([, file]) => {
      if (file.envelope === "FINANCIAL" || file.templateRequired) return false;
      if (file.sourceRequirementIds.length === 0) return false;
      const rows = file.sourceRequirementIds.map((id) => requirementById.get(id));
      if (rows.some((row) => !row || (row.exactFileName ?? "").trim())) return false;
      const label = `${file.exactFileName} ${rows.map((row) => `${row!.title} ${row!.description ?? ""}`).join(" ")}`.toLowerCase();
      if (/financial|commercial|price|pricing|bid bond|bid security|power of attorney|joint venture agreement|consortium agreement/.test(label)) return false;
      return classifySubmissionPlanItem({ title: file.exactFileName, requirementType: file.documentType }).category === "REQUIRED_OUTPUT_FILE"
        && PROPOSAL_SECTION.test(file.exactFileName.toLowerCase());
    });
    // A narrative row the planner did not make a file at all still needs the
    // proposal that answers it. 2026-09-30, Preview, a 4-page EOI: "Company
    // Profile and Tax Registration Documents" (a 25-page profile plus
    // certificates) was classified as original evidence and "Previous
    // Telecommunications Tower Experience" is SCORED, so the plan held three
    // declarations and no EOI response; the profile and experience the tender
    // scores had nowhere to go. The certificates in such a row remain vault
    // evidence; the narrative is answered in the one proposal file.
    const plannedIds = new Set(Array.from(files.values()).flatMap((file) => file.sourceRequirementIds));
    const hasMainProposal = Array.from(files.values()).some((file) =>
      /^(?:TECHNICAL_PROPOSAL|EXPRESSION_OF_INTEREST)$/.test(file.documentType)
      || /\b(?:technical proposal|expression of interest)\b/i.test(file.exactFileName));
    const narrativeRows = requirements.filter((requirement) => {
      if (plannedIds.has(requirement.id) || (requirement.exactFileName ?? "").trim()) return false;
      if (!/^(?:MANDATORY|CRITICAL|SCORED)$/i.test(requirement.priority ?? "")) return false;
      const title = (requirement.title ?? "").toLowerCase();
      if (/financial|commercial|price|pricing|bid bond|bid security|power of attorney|joint venture agreement|consortium agreement/.test(title)) return false;
      return PROPOSAL_SECTION.test(title);
    });
    if (sections.length > 0 || (!hasMainProposal && narrativeRows.length > 0)) {
      const sectionRows = [
        ...sections.flatMap(([, file]) => file.sourceRequirementIds.map((id) => requirementById.get(id)!)),
        ...narrativeRows,
      ];
      // An expression of interest is a shortlisting submission. A tender that
      // asks for a technical or a financial proposal wants the proposal, even
      // when one of its forms is an "expression of interest letter": that row
      // used to rename an RFP's technical proposal "Expression of Interest".
      const EOI = /expressions?\s+of\s+interest|\beoi\b/i;
      const asksForProposal = requirements.some((row) => {
        const text = `${row.title ?? ""} ${row.description ?? ""}`;
        return /\btechnical\s+proposal\b/i.test(text) || requiresSubmittedFinancialProposal(row.title, text.toLowerCase());
      });
      const isEoi = EOI.test(`${tender.title ?? ""} ${tender.tenderCategory ?? ""}`)
        || (!asksForProposal && requirements.some((row) => EOI.test(`${row.title} ${row.description ?? ""}`)));
      const baseName = isEoi ? "Expression of Interest" : "Technical Proposal";
      const format = inferFormat(baseName, sectionRows.map((row) => `${row.description ?? ""} ${row.restrictions ?? ""}`).join(" "));
      for (const [key] of sections) files.delete(key);
      const orders = [
        ...sections.map(([, file]) => file.exactOrder),
        ...narrativeRows.map((row) => row.exactOrder ?? Number.POSITIVE_INFINITY),
      ].filter((order) => Number.isFinite(order));
      addFile(files, {
        canonicalId: `proposal-${slug(baseName)}`,
        exactFileName: fileNameWithExtension(baseName, format),
        documentType: isEoi ? "EXPRESSION_OF_INTEREST" : "TECHNICAL_PROPOSAL",
        required: true,
        exactOrder: orders.length > 0 ? Math.min(...orders) : shiftForLeadingProposal(files),
        format,
        envelope: "TECHNICAL",
        sourceRequirementIds: Array.from(new Set(sectionRows.map((row) => row.id))),
        pageLimit: tender.pageLimit ?? null,
        templateRequired: false,
        templateSourceFileId: null,
        brandingAllowed: restrictionAllows(restrictions, "letterhead"),
        signatureAllowed: restrictionAllows(restrictions, "signature"),
        stampAllowed: restrictionAllows(restrictions, "stamp"),
        grouping: null,
        notes: "The tender names no separate files; these sections are parts of the one technical proposal.",
      });
    }
  }

  buildFilesFromExactNames(tender, files.size + 1).forEach((file) => {
    const base = normalize(file.exactFileName.replace(/\.[a-z0-9]+$/i, ""));
    const folded = foldedRequirementIds.get(base) ?? [];
    addFile(files, folded.length > 0
      ? { ...file, sourceRequirementIds: Array.from(new Set([...file.sourceRequirementIds, ...folded])) }
      : file);
  });

  // ── "All documents … as a single PDF file named X" ────────────────────────
  // See lib/engine/single-submission-file-rule.ts. Bidder-produced files in
  // the non-financial scope are contents of X, not files beside it.
  const singleFile = statedSingleSubmissionFile(requirements);
  if (singleFile) {
    const targetFormat = inferFormat(singleFile.fileName);
    const targetKey = fileKey(fileNameWithExtension(singleFile.fileName, targetFormat));
    const foldedIds: string[] = [...singleFile.requirementIds];
    for (const [key, file] of Array.from(files.entries())) {
      if (key === targetKey) continue;
      // The row that STATES the rule is an instruction about the package, not
      // a second file ("PDF Submission.pdf" beside the file it names).
      const onlyStatesTheRule = file.sourceRequirementIds.length > 0
        && file.sourceRequirementIds.every((id) => singleFile.requirementIds.includes(id));
      if (onlyStatesTheRule) {
        files.delete(key);
        continue;
      }
      if (file.envelope === "FINANCIAL") continue;
      const category = classifySubmissionPlanItem({
        title: file.exactFileName,
        requirementType: file.documentType,
        exactFileName: file.exactFileName,
      }).category;
      if (category !== "REQUIRED_OUTPUT_FILE") continue;
      foldedIds.push(...file.sourceRequirementIds);
      files.delete(key);
    }
    const existing = files.get(targetKey);
    addFile(files, existing
      ? { ...existing, sourceRequirementIds: Array.from(new Set([...existing.sourceRequirementIds, ...foldedIds])) }
      : {
          canonicalId: `single-${slug(singleFile.fileName)}`,
          exactFileName: fileNameWithExtension(singleFile.fileName, targetFormat),
          documentType: "TECHNICAL_PROPOSAL",
          required: true,
          exactOrder: 1,
          format: targetFormat,
          envelope: "TECHNICAL",
          sourceRequirementIds: Array.from(new Set(foldedIds)),
          pageLimit: tender.pageLimit ?? null,
          templateRequired: false,
          templateSourceFileId: null,
          brandingAllowed: restrictionAllows(restrictions, "letterhead"),
          signatureAllowed: restrictionAllows(restrictions, "signature"),
          stampAllowed: restrictionAllows(restrictions, "stamp"),
          grouping: null,
          notes: "The tender requires the whole submission as this one file; bidder-produced deliverables are its contents.",
        });
  }

  // ── No price submission the tender does not ask for ──────────────────────
  //
  // A financial proposal, price schedule or priced BOQ is planned only when the
  // tender requires the bidder to submit pricing, and never against a
  // prohibition ("no financial proposal at this stage", "do not submit
  // prices", "EOI only"), whatever a single row's wording suggests. Audited
  // statements, turnover, a budget or a scoring weight never become a price
  // file (the classifier keeps them as owner originals); a price file the
  // tender's own rows or file list name is grounded by them — unless the
  // tender also rules pricing out, which always wins.
  const { grounded: pricingGrounded, state: pricingState } = priceSubmissionGrounding(tender);
  const ungroundedPriceFiles: string[] = [];
  for (const [key, file] of Array.from(files.entries())) {
    if (!isPriceSubmissionFile(file.exactFileName, file.documentType)) continue;
    if (pricingGrounded && hasTenderSource(file)) continue;
    ungroundedPriceFiles.push(file.exactFileName);
    files.delete(key);
  }

  // ── The tender's stated attachment order is authoritative ────────────────
  //
  // Files are contributed in two passes: one per requirement (ordered by the
  // requirement's own position) and one for any remaining names in
  // exactFileNaming/exactFileOrder. Sorting purely on the resulting exactOrder
  // let requirement iteration order decide the package order, so a tender that
  // says "Attachments must be named and ordered exactly as follows: 1.
  // 01-Expression-Of-Interest.docx 2. 02-Company-Profile.docx 3.
  // 03-Capability-Statement.docx" produced a confirmed Build Plan ordered
  // 03, 01, 02 — whichever requirement happened to mention a file first.
  //
  // Generated documents copy the plan's exactOrder, so the package was
  // assembled in the wrong order and the export gate refused it with
  // FILE_ORDER ("Generated file order does not match tender order"). The
  // ordering the client asked for is not a preference the planner may
  // reinterpret, so when the tender declares one it decides the sequence;
  // files it does not name keep their existing relative order behind it.
  const declaredOrder = parseStringArray(tender.exactFileOrder).length > 0
    ? parseStringArray(tender.exactFileOrder)
    : parseStringArray(tender.exactFileNaming);
  const declaredRank = new Map<string, number>();
  declaredOrder.forEach((name, index) => {
    const withExtension = fileNameWithExtension(name, inferFormat(name));
    declaredRank.set(normalize(withExtension), index);
    declaredRank.set(normalize(name), index);
  });
  const rankOf = (file: SubmissionPlanFile): number =>
    declaredRank.get(normalize(file.exactFileName)) ?? Number.MAX_SAFE_INTEGER;

  // The plan must never contain a file the stale-plan detector would reject,
  // or every confirmed plan is stale the moment it is read. Same test, same
  // fields — see plannedFileIsARule.
  const sortedFiles = Array.from(files.values())
    .filter((file) => !plannedFileIsARule(file).rule)
    .sort((a, b) =>
      rankOf(a) - rankOf(b)
      || a.exactOrder - b.exactOrder
      || a.exactFileName.localeCompare(b.exactFileName))
    .map((file, index) => ({ ...file, exactOrder: index + 1 }));

  const warnings: string[] = [];
  if (ungroundedPriceFiles.length > 0) warnings.push(`Not planned: ${ungroundedPriceFiles.join(", ")} — the tender ${pricingState === false ? "rules out a price submission" : "does not ask the bidder for prices"}.`);
  if (sortedFiles.length === 0) warnings.push("No exact submission files were extracted; generation should remain draft-only until tender output scope is confirmed.");
  if (parseStringArray(tender.exactFileNaming).length > 0 && parseStringArray(tender.exactFileOrder).length === 0) warnings.push("Exact file names exist but exact order was not extracted.");
  if (requirements.some((requirement) => requirement.requiredQuantity != null && requirement.requiredQuantity < 0)) warnings.push("At least one requirement has an invalid negative quantity.");

  return {
    tenderId: tender.id,
    files: sortedFiles,
    quantityRules: buildQuantityRules(requirements),
    forbiddenContentRules: [
      "No unsupported company facts",
      "No AI or debug traces",
      "No extra documents outside the submission plan",
      "No signature, stamp, cover page or letterhead where prohibited by tender restrictions",
    ],
    brandingRules: {
      letterheadAllowed: restrictionAllows(restrictions, "letterhead"),
      signatureAllowed: restrictionAllows(restrictions, "signature"),
      stampAllowed: restrictionAllows(restrictions, "stamp"),
      coverPageAllowed: restrictionAllows(restrictions, "cover"),
      notes: restrictions || null,
    },
    warnings,
  };
}

export function submissionPlanFileCount(plan: SubmissionPlan): number {
  return plan.files.filter((file) => file.required).length;
}

export function hasExplicitSubmissionScope(tender: TenderLike): boolean {
  return parseStringArray(tender.exactFileNaming).length > 0
    || parseStringArray(tender.exactFileOrder).length > 0
    || (tender.requirements ?? []).some((requirement) => Boolean(requirement.exactFileName));
}

export function plannedSubmissionTargetFiles(plan: SubmissionPlan): SubmissionPlanFile[] {
  return plan.files.filter((file) => file.required);
}

export function submissionPlanFileKey(fileName?: string | null): string {
  return fileKey(fileName ?? "");
}

// ── Derived draft plan ───────────────────────────────────────────────────────
//
// A display-only preview when the primary plan produces 0 files (before Run
// Engine builds and source-verifies the real plan). It never authorizes
// generation or export, and it obeys the same rule as the real plan: the
// tender decides what documents exist.
//
// It used to add files because they are common in tenders — a "Financial
// Proposal" from the words budget, cost, fee or rate; a "Financial Capacity
// Package" from audited statements (owner originals, never generated); a
// "Design Statement", "Healthcare Infrastructure Technical Proposal", "Donor
// Compliance Package", "Compliance Matrix" and "CV Package" from sector or
// donor keywords. None of those is a requirement of the tender, so the preview
// showed the owner documents the tender never asked for. It now offers only
// the one response the requirements describe (a technical proposal, or an
// expression of interest), and a financial proposal only when the tender asks
// the bidder for prices.

export type DerivedDraftEntry = {
  name: string;
  documentType: string;
  required: boolean;
  derivedFrom: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

export function buildDerivedDraftPlan(tender: {
  requirements?: Array<{ text?: string; title?: string; description?: string | null; mandatory?: boolean; priority?: string; category?: string; requirementType?: string }>;
  submissionMethod?: string | null;
  title?: string | null;
  analysisExtractionStatus?: string | null;
  tenderCategory?: string | null;
}): DerivedDraftEntry[] {
  const requirements = tender.requirements ?? [];
  if (requirements.length === 0) return [];

  const requirementsText = requirements
    .map((r) => [r.text ?? "", r.title ?? "", r.description ?? ""].join(" "))
    .join("\n");
  const combinedText = [tender.title ?? "", tender.tenderCategory ?? "", requirementsText].join(" ").toLowerCase();
  const reqText = requirementsText.toLowerCase();

  const entries: DerivedDraftEntry[] = [];

  // The response the requirements describe: an expression of interest is a
  // shortlisting submission; anything asking for an approach, team or
  // experience is answered by one technical proposal.
  const isEOI = /\beoi\b|expression[\s-]+of[\s-]+interest/.test(combinedText) && !/\btechnical[\s-]+proposal\b/.test(reqText);
  if (isEOI) {
    entries.push({
      name: "Expression of Interest",
      documentType: "EXPRESSION_OF_INTEREST",
      required: true,
      derivedFrom: "DERIVED_DRAFT_UNCONFIRMED — the tender asks for an expression of interest",
      confidence: "HIGH",
    });
  } else if (/technical|methodology|approach|scope[\s-]+of[\s-]+(?:work|services)|\bsow\b|work[\s-]+plan|personnel|expert|\bcvs?\b|experience|qualification|capabilit/.test(reqText)) {
    entries.push({
      name: "Technical Proposal",
      documentType: "TECHNICAL_PROPOSAL",
      required: true,
      derivedFrom: "DERIVED_DRAFT_UNCONFIRMED — the requirements ask for a technical response",
      confidence: "HIGH",
    });
  }

  // A financial proposal only when the tender asks the bidder for prices — never
  // from a budget, turnover, audited statements, payment terms or a weight, and
  // never against a prohibition.
  if (readFinancialProposalRequirement(requirementsText) === true) {
    entries.push({
      name: "Financial Proposal",
      documentType: "FINANCIAL_PROPOSAL",
      required: true,
      derivedFrom: "DERIVED_DRAFT_UNCONFIRMED — the tender asks the bidder to submit pricing",
      confidence: "HIGH",
    });
  }

  return entries;
}

export function plannedSubmissionTargetKeys(plan: SubmissionPlan): Set<string> {
  return new Set(plannedSubmissionTargetFiles(plan).map((file) => submissionPlanFileKey(file.exactFileName)));
}

function generatedDocumentKey(document: GeneratedDocumentLike): string {
  return fileKey(document.exactFileName || document.name || document.documentType || document.id || "");
}

export function generatedDocumentSubmissionKey(document: GeneratedDocumentLike): string {
  return generatedDocumentKey(document);
}

export function findExtraGeneratedDocuments(plan: SubmissionPlan, generatedDocuments: GeneratedDocumentLike[]): GeneratedDocumentLike[] {
  const allowed = new Set(plan.files.map((file) => fileKey(file.exactFileName)));
  return generatedDocuments.filter((document) => {
    if (document.generationStatus && document.generationStatus !== "GENERATED") return false;
    const key = generatedDocumentKey(document);
    return key.length > 0 && !allowed.has(key);
  });
}

export function findMissingGeneratedDocuments(plan: Pick<SubmissionPlan, "files">, generatedDocuments: GeneratedDocumentLike[]): SubmissionPlanFile[] {
  const generated = new Set(
    generatedDocuments
      .filter((document) => !document.generationStatus || document.generationStatus === "GENERATED")
      .map(generatedDocumentKey)
      .filter(Boolean),
  );

  return plan.files.filter((file) => file.required && !generated.has(fileKey(file.exactFileName)));
}

export type SubmissionPlanStatus =
  | "NO_PLAN"
  | "DERIVED_DRAFT"
  | "USER_REVIEW_REQUIRED"
  | "CANONICAL_APPROVED"
  | "STALE"
  | "INVALID";

export function deriveSubmissionPlanStatus(tender: any, plan: SubmissionPlan): SubmissionPlanStatus {
  if (!plan.files || plan.files.length === 0) return "NO_PLAN";

  const isDerived = plan.files.some(f => f.notes?.includes("DERIVED_DRAFT_UNCONFIRMED"));
  if (isDerived) return "DERIVED_DRAFT";

  if (tender.status === "PLAN_APPROVED") return "CANONICAL_APPROVED";

  return "USER_REVIEW_REQUIRED";
}
