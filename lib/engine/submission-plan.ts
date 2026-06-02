import { classifySubmissionPlanItem } from "./submission-plan-classifier";

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
};

export type TenderLike = {
  id: string;
  title?: string | null;
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  pageLimit?: number | null;
  requirements?: TenderRequirementLike[];
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

function parseStringArray(value?: string | null): string[] {
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

  const financialRx = /\bfinancial\b|commercial[\s-]+offer|price[\s-]+(schedule|proposal|form)|bill[\s-]+of[\s-]+quantit|rate[\s-]+card|cost[\s-]+proposal|budget[\s-]+proposal|pricing|fee[\s-]+schedule|boq\b|b\.o\.q\b|lump[\s-]+sum[\s-]+offer|schedule[\s-]+of[\s-]+rates/i;
  if (financialRx.test(text)) return "FINANCIAL";

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

function addFile(files: Map<string, SubmissionPlanFile>, file: SubmissionPlanFile) {
  const key = fileKey(file.exactFileName);
  const existing = files.get(key);
  if (!existing) {
    files.set(key, file);
    return;
  }

  files.set(key, {
    ...existing,
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

  const baseName = requirement.exactFileName?.trim()
    || requirement.title?.trim()
    || `${type.toLowerCase()}-${index + 1}`;
  const format = inferFormat(baseName, `${requirement.description ?? ""} ${requirement.restrictions ?? ""}`);
  const restrictions = requirement.restrictions ?? "";

  return {
    canonicalId: `req-${requirement.id}`,
    exactFileName: fileNameWithExtension(baseName, format),
    documentType: documentTypeFromRequirement(requirement),
    required: requirement.priority?.toUpperCase() === "MANDATORY" || Boolean(requirement.exactFileName),
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

  return sourceNames.map((name, index): SubmissionPlanFile => {
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

export function buildSubmissionPlan(tender: TenderLike): SubmissionPlan {
  const requirements = tender.requirements ?? [];
  const files = new Map<string, SubmissionPlanFile>();
  const restrictions = restrictionText(requirements);

  requirements.forEach((requirement, index) => {
    const file = buildFileFromRequirement(requirement, index);
    if (file) addFile(files, file);
  });

  buildFilesFromExactNames(tender, files.size + 1).forEach((file) => addFile(files, file));

  const sortedFiles = Array.from(files.values())
    .sort((a, b) => a.exactOrder - b.exactOrder || a.exactFileName.localeCompare(b.exactFileName))
    .map((file, index) => ({ ...file, exactOrder: index + 1 }));

  const warnings: string[] = [];
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

export function findMissingGeneratedDocuments(plan: SubmissionPlan, generatedDocuments: GeneratedDocumentLike[]): SubmissionPlanFile[] {
  const generated = new Set(
    generatedDocuments
      .filter((document) => !document.generationStatus || document.generationStatus === "GENERATED")
      .map(generatedDocumentKey)
      .filter(Boolean),
  );

  return plan.files.filter((file) => file.required && !generated.has(fileKey(file.exactFileName)));
}
