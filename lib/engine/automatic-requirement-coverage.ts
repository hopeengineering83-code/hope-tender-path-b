import { createHash } from "node:crypto";
// The same capability vocabulary the matching engine uses to select these
// records, so coverage scoring and selection agree on what "related" means.
import { capabilityFamilies } from "./matching";
import {
  isGroundedEvidenceInActiveFiles,
  type GroundingActiveFile,
} from "./evidence-grounding";
import {
  repairSourceGrounding,
  type RepairSourceGroundingResult,
} from "./repair-source-grounding";
import {
  canUseVaultRecord,
  VAULT_REVIEW_CONSUMER_SELECT,
  type ReviewRecordState,
} from "../vault-review-provenance";

/**
 * Persisted automatic requirement-evidence rows carry this prefix in notes.
 * The payload binds the row to both the current tender-source quote and the
 * current Company Vault/source-document bytes. A stale row therefore stops
 * counting without relying on a human cleanup action.
 */
export const AUTOMATIC_REQUIREMENT_EVIDENCE_PREFIX =
  "automatic-requirement-evidence:v1:";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_AUTOMATIC_LINKS_PER_REQUIREMENT = 8;
const MIN_AUTOMATIC_LINK_SCORE = 70;

export type AutomaticEvidenceKind =
  | "EXPERT_CV"
  | "PROJECT_REFERENCE"
  | "FINANCIAL_STATEMENT"
  | "LEGAL_REGISTRATION"
  | "TAX_CERTIFICATE"
  | "COMPLIANCE_CERTIFICATE"
  | "DECLARATION"
  | "FORM_TEMPLATE"
  | "METHODOLOGY_NARRATIVE"
  | "COMPANY_PROFILE"
  | "OUTPUT_ARTIFACT"
  | "GENERAL";

export type AutomaticEvidenceRecordType =
  | "EXPERT"
  | "PROJECT"
  | "LEGAL"
  | "FINANCIAL"
  | "COMPLIANCE"
  | "COMPANY_DOCUMENT"
  | "GENERATED_DOCUMENT"
  | "BUILD_PLAN_ITEM";

export type AutomaticEvidenceCandidate = {
  recordType: AutomaticEvidenceRecordType;
  recordId: string;
  label: string;
  searchableText: string;
  evidenceKinds: AutomaticEvidenceKind[];
  evidenceKey: string;
  sourceDocumentId: string | null;
  sourceContentHash: string;
  sourceByteLength: number;
  selected: boolean;
  generatedReady: boolean;
  exactFileName: string | null;
  sourceFileName?: string;
  sourceSection?: string | null;
  sourceQuote?: string | null;
  evidenceRevision?: string;
  facets?: Record<string, string | number | boolean | string[] | null>;
};

export type AutomaticRequirementEvidenceMetadata = {
  version: 1;
  evidenceKey: string;
  recordType: AutomaticEvidenceRecordType;
  recordId: string;
  label: string;
  requirementId: string;
  requirementSourceFileId: string;
  requirementSourceQuoteHash: string;
  sourceDocumentId: string | null;
  sourceContentHash: string;
  sourceByteLength: number;
  sourceFileName?: string;
  sourceSection?: string | null;
  sourceQuote?: string | null;
  matchedFacets?: string[];
  sourceRevision?: string;
  evidenceRevision?: string;
  linkageScore: number;
  linkageReasons: string[];
  state: "ACTIVE";
};

export type AutomaticRequirementCoverageResult = {
  ok: boolean;
  code?: string;
  sourceRepair: RepairSourceGroundingResult;
  requirementsChecked: number;
  groundedRequirements: number;
  desiredLinks: number;
  created: number;
  updated: number;
  removedStale: number;
  unchanged: number;
  remainingUngrounded: Array<{ id: string; title: string }>;
  remainingWithoutEligibleEvidence: Array<{ id: string; title: string }>;
};

type RequirementInput = {
  id: string;
  title: string;
  description: string;
  requirementType: string;
  priority: string;
  restrictions?: string | null;
  requiredQuantity?: number | null;
  exactFileName?: string | null;
  sourceTenderFileId?: string | null;
  sourcePageNumber?: number | null;
  sourceExactQuote?: string | null;
  complianceMatrixRows?: ComplianceRowInput[];
};

type ComplianceRowInput = {
  id: string;
  requirementId?: string | null;
  evidenceType?: string | null;
  evidenceSource?: string | null;
  evidenceReference?: string | null;
  supportLevel?: string | null;
  notes?: string | null;
};

type SelectedCandidate = {
  candidate: AutomaticEvidenceCandidate;
  score: number;
  reasons: string[];
  supportLevel: "FULL" | "SUBSTANTIAL" | "PARTIAL";
};

type DesiredComplianceRow = {
  key: string;
  tenderId: string;
  requirementId: string;
  evidenceType: string;
  evidenceSource: string;
  evidenceReference: string;
  supportLevel: "FULL" | "SUBSTANTIAL" | "PARTIAL";
  notes: string;
};

type LoadedCoverageContext = {
  tender: any;
  company: any;
  activeFiles: GroundingActiveFile[];
  requirements: RequirementInput[];
  candidates: AutomaticEvidenceCandidate[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(value: string): string[] {
  const stopWords = new Set([
    "about", "after", "against", "along", "also", "and", "are", "before",
    "company", "document", "evidence", "file", "for", "from", "have", "into",
    "must", "only", "provide", "required", "requirement", "shall", "should",
    "submit", "submission", "that", "the", "their", "this", "through", "with",
  ]);
  return Array.from(new Set(normalizeText(value).split(" ")))
    .filter((token) => token.length >= 4 && !stopWords.has(token))
    .slice(0, 40);
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return value.split(/[|,;]/).map((item) => item.trim()).filter(Boolean);
  }
}

function verifiedHashAndLength(value: {
  contentSha256?: string | null;
  contentByteLength?: number | null;
  integrityStatus?: string | null;
}): { hash: string; byteLength: number } | null {
  const hash = String(value.contentSha256 ?? "").toLowerCase();
  const byteLength = Number(value.contentByteLength ?? 0);
  if (
    value.integrityStatus !== "VERIFIED"
    || !SHA256_PATTERN.test(hash)
    || !Number.isInteger(byteLength)
    || byteLength <= 0
  ) return null;
  return { hash, byteLength };
}

function candidateKey(
  recordType: AutomaticEvidenceRecordType,
  recordId: string,
  contentHash: string,
): string {
  return `${recordType}:${recordId}:${contentHash.toLowerCase()}`;
}

export function inferAutomaticEvidenceKinds(
  requirement: Pick<RequirementInput, "title" | "description" | "requirementType" | "restrictions" | "exactFileName">,
): AutomaticEvidenceKind[] {
  const type = normalizeText(requirement.requirementType).replace(/ /g, "_").toUpperCase();
  const text = normalizeText([
    requirement.title,
    requirement.description,
    requirement.restrictions,
    requirement.exactFileName,
    requirement.requirementType,
  ].filter(Boolean).join(" "));
  const kinds = new Set<AutomaticEvidenceKind>();

  if (type === "EXPERT" || /\b(expert|personnel|staff|team leader|curriculum vitae|\bcv\b|specialist)\b/.test(text)) {
    kinds.add("EXPERT_CV");
  }
  // "PROJECT" belongs here as much as "PROJECT_EXPERIENCE".
  //
  // The requirement categories the app itself displays are Project, Eligibility,
  // Expert and Submission. ELIGIBILITY and EXPERT are matched exactly below and
  // above; PROJECT matched nothing, because only the longer PROJECT_EXPERIENCE
  // was listed. A requirement the app had already labelled "Project" therefore
  // inferred no evidence kind at all, fell through to GENERAL, and its
  // candidates started 38 points lower — below the link threshold. On the
  // reported tender that is the whole difference between the Eligibility and
  // Expert requirements reading "Fully verified" and the Project one reading
  // "Partially verified" with hospitals sitting in its selected evidence.
  //
  // The phrase list is widened for the same reason. It demanded the tender say
  // "relevant experience" or "past performance"; a requirement titled
  // "Healthcare Facility Design Experience" says none of those, and asking a
  // procuring entity to phrase its tender in this codebase's vocabulary is not
  // a workable contract. Experience of doing the work is asked for in many
  // ordinary ways, and all of them mean: show me the projects.
  if (
    type === "PROJECT_EXPERIENCE"
    || type === "PROJECT"
    || type === "SIMILAR_PROJECTS"
    || /\b(similar project|project reference|past performance|track record|portfolio|relevant experience)\b/.test(text)
    || /\b(?:design|work|project|construction|supervision|consultanc|implementation)\w*\s+experience\b/.test(text)
    || /\bexperience\s+(?:in|of|with|on)\b/.test(text)
    || /\b(?:demonstrated|proven|prior|previous|comparable|similar)\s+(?:experience|works?|projects?|assignments?|contracts?)\b/.test(text)
    || /\bcompleted\s+(?:projects?|works?|contracts?|assignments?)\b/.test(text)
  ) {
    kinds.add("PROJECT_REFERENCE");
  }
  if (/\b(audited|financial statement|turnover|revenue|balance sheet|bank reference|financial capacity)\b/.test(text)) {
    kinds.add("FINANCIAL_STATEMENT");
  }
  if (type === "ELIGIBILITY" || /\b(legal eligibility|registration|incorporation|trade licen[cs]e|business licen[cs]e|grade certificate|good standing)\b/.test(text)) {
    kinds.add("LEGAL_REGISTRATION");
  }
  if (/\b(tax clearance|tin certificate|vat certificate|tax identification)\b/.test(text)) {
    kinds.add("TAX_CERTIFICATE");
  }
  if (/\b(iso|compliance certificate|professional indemnity|insurance certificate|quality certificate|certification)\b/.test(text)) {
    kinds.add("COMPLIANCE_CERTIFICATE");
  }
  if (type === "DECLARATION" || /\b(declaration|undertaking|integrity pact|power of attorney|sworn statement)\b/.test(text)) {
    kinds.add("DECLARATION");
  }
  if (["FORM", "ANNEX", "SCHEDULE"].includes(type) || /\b(official form|bid form|annex|appendix|template|schedule of rates)\b/.test(text)) {
    kinds.add("FORM_TEMPLATE");
  }
  if (type === "METHODOLOGY" || /\b(methodology|work plan|technical approach|implementation plan|quality plan|risk management)\b/.test(text)) {
    kinds.add("METHODOLOGY_NARRATIVE");
  }
  if (type === "COMPANY_PROFILE" || /\b(company profile|capability statement|corporate profile|firm profile|organizational capability)\b/.test(text)) {
    kinds.add("COMPANY_PROFILE");
  }
  if (
    requirement.exactFileName
    || /\b(required output|output file|technical proposal|financial proposal|proposal pdf|proposal docx|deliverable file)\b/.test(text)
  ) {
    kinds.add("OUTPUT_ARTIFACT");
  }

  if (kinds.size === 0) kinds.add("GENERAL");
  return [...kinds];
}

function kindsForCompanyDocument(document: {
  category?: string | null;
  fileName?: string | null;
  extractedText?: string | null;
}): AutomaticEvidenceKind[] {
  const text = normalizeText(`${document.category ?? ""} ${document.fileName ?? ""} ${document.extractedText?.slice(0, 1200) ?? ""}`);
  const kinds = new Set<AutomaticEvidenceKind>();
  if (/company profile|profile|capability/.test(text)) kinds.add("COMPANY_PROFILE");
  if (/financial|audited|turnover|bank/.test(text)) kinds.add("FINANCIAL_STATEMENT");
  if (/legal|registration|licen[cs]e|incorporation|grade certificate/.test(text)) kinds.add("LEGAL_REGISTRATION");
  if (/tax|tin|vat/.test(text)) kinds.add("TAX_CERTIFICATE");
  if (/compliance|iso|insurance|certificate|quality/.test(text)) kinds.add("COMPLIANCE_CERTIFICATE");
  if (/declaration|undertaking|power of attorney/.test(text)) kinds.add("DECLARATION");
  if (/form|annex|appendix|template|schedule/.test(text)) kinds.add("FORM_TEMPLATE");
  if (/methodology|work plan|technical approach/.test(text)) kinds.add("METHODOLOGY_NARRATIVE");
  if (kinds.size === 0) kinds.add("GENERAL");
  return [...kinds];
}

function scoreCandidate(
  requirement: RequirementInput,
  requiredKinds: AutomaticEvidenceKind[],
  candidate: AutomaticEvidenceCandidate,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const sharedKinds = requiredKinds.filter((kind) => candidate.evidenceKinds.includes(kind));
  if (sharedKinds.length === 0 && !requiredKinds.includes("GENERAL")) {
    return { score: 0, reasons: [] };
  }

  let score = sharedKinds.length > 0 ? 68 : 30;
  if (sharedKinds.length > 0) reasons.push(`direct evidence family: ${sharedKinds.join(", ")}`);

  const requirementText = `${requirement.title} ${requirement.description} ${requirement.restrictions ?? ""} ${requirement.exactFileName ?? ""}`;
  const requirementTokens = meaningfulTokens(requirementText);
  const candidateTokenSet = new Set(meaningfulTokens(`${candidate.label} ${candidate.searchableText}`));
  const matchingTokens = requirementTokens.filter((token) => candidateTokenSet.has(token));
  if (matchingTokens.length > 0) {
    score += Math.min(18, matchingTokens.length * 3);
    reasons.push(`matching terms: ${matchingTokens.slice(0, 6).join(", ")}`);
  }

  // Shared capability family — the difference between reading and matching.
  //
  // Token overlap alone is literal to the point of uselessness on real tenders.
  // A requirement for "Healthcare Facility Design Experience" and a project
  // record reading "Dessie Specialized Hospital" have no token in common, so
  // that project scored 68 + 8 = 76: linked, but below the 84 needed for
  // SUBSTANTIAL, leaving a mandatory requirement reported as unsupported while
  // a hospital sat in the selected evidence. The owner is then asked to supply
  // evidence that is already there, phrased in the tender's words.
  //
  // The vocabulary that resolves this already exists and is already trusted:
  // `capabilityFamilies` is what the matching engine uses to select these
  // records in the first place, and its HEALTHCARE_FACILITIES patterns include
  // /\bhospital/. Reusing it here makes one system hold one notion of
  // relatedness instead of two, the stricter of which was gating release.
  //
  // This invents nothing. Both sides are derived from text already on file —
  // the tender's requirement and the record's own uploaded content — and every
  // award names the family it came from, so a reviewer can check the inference
  // rather than take it on trust. A record with no shared family gains nothing,
  // so genuinely unsupported requirements stay unsupported and fail closed.
  const requirementFamilies = capabilityFamilies(requirementText);
  if (requirementFamilies.length > 0) {
    const candidateFamilies = capabilityFamilies(`${candidate.label} ${candidate.searchableText}`);
    const sharedFamilies = requirementFamilies.filter((family) => candidateFamilies.includes(family));
    if (sharedFamilies.length > 0) {
      score += Math.min(16, sharedFamilies.length * 8);
      reasons.push(`shared capability family: ${sharedFamilies.join(", ")}`);
    }
  }

  if (candidate.selected) {
    score += 8;
    reasons.push("selected by the canonical matching engine");
  }

  const exactFileName = normalizeText(requirement.exactFileName);
  if (
    exactFileName
    && candidate.exactFileName
    && normalizeText(candidate.exactFileName) === exactFileName
  ) {
    score += 20;
    reasons.push("exact required filename match");
  }

  if (candidate.recordType === "GENERATED_DOCUMENT" && candidate.generatedReady) {
    score += 12;
    reasons.push("generated bytes and validation are current");
  }
  if (candidate.recordType === "BUILD_PLAN_ITEM") {
    score = Math.min(score, 78);
    reasons.push("planned output pending generated bytes");
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

type FacetEvaluation = { complete: boolean; matched: string[]; missing: string[] };

function explicitNumber(text: string, pattern: RegExp): number | null {
  const match = normalizeText(text).match(pattern);
  return match ? Number(match[1]) : null;
}

/**
 * Fail-closed, family-specific completeness. FULL means that every explicit
 * structured constraint we can identify is present in current verified bytes;
 * lexical similarity alone can never promote a row to FULL.
 */
export function evaluateCandidateFacets(
  requirement: RequirementInput,
  candidate: AutomaticEvidenceCandidate,
): FacetEvaluation {
  const text = normalizeText(`${requirement.title} ${requirement.description} ${requirement.restrictions ?? ""}`);
  const candidateText = normalizeText(`${candidate.label} ${candidate.searchableText}`);
  const matched: string[] = [];
  const missing: string[] = [];
  const requireText = (facet: string, expression: RegExp) => {
    if (!expression.test(text)) return;
    if (expression.test(candidateText)) matched.push(facet); else missing.push(facet);
  };

  if (candidate.recordType === "EXPERT") {
    const years = explicitNumber(text, /(?:minimum|min|at least|not less than) (\d{1,2}) years?/);
    if (years !== null) {
      if (Number(candidate.facets?.yearsExperience ?? -1) >= years) matched.push("minimumExperience");
      else missing.push("minimumExperience");
    }
    requireText("qualification", /\b(degree|bachelor|master|phd|qualification)\b/);
    requireText("certification", /\b(certifi(?:ed|cation)|licen[cs]e|registration)\b/);
    requireText("disciplineOrRole", /\b(engineer|architect|specialist|expert|team leader|manager|surveyor|consultant)\b/);
    if (!candidate.facets?.disciplines || (candidate.facets.disciplines as string[]).length === 0) missing.push("discipline");
    else matched.push("discipline");
  } else if (candidate.recordType === "PROJECT") {
    for (const [facet, value] of Object.entries({
      client: candidate.facets?.client,
      sector: candidate.facets?.sector,
      scope: candidate.facets?.serviceAreas,
      location: candidate.facets?.location,
      dates: candidate.facets?.dates,
    })) {
      if (value && (!Array.isArray(value) || value.length > 0)) matched.push(facet); else missing.push(facet);
    }
    if (/\b(value|contract amount|budget)\b/.test(text)) {
      if (Number(candidate.facets?.value ?? 0) > 0) matched.push("value"); else missing.push("value");
    }
    requireText("similarity", /\b(similar|relevant|comparable)\b/);
  } else {
    if (candidate.sourceByteLength > 0 && candidate.sourceContentHash) matched.push("verifiedBytes");
    else missing.push("verifiedBytes");
    if (requirement.exactFileName) {
      if (normalizeText(candidate.exactFileName) === normalizeText(requirement.exactFileName)) matched.push("exactFileName");
      else missing.push("exactFileName");
    }
  }

  return { complete: missing.length === 0, matched: [...new Set(matched)], missing: [...new Set(missing)] };
}

function supportForCandidate(
  requirement: RequirementInput,
  candidate: AutomaticEvidenceCandidate,
  score: number,
): "FULL" | "SUBSTANTIAL" | "PARTIAL" {
  if (candidate.recordType === "GENERATED_DOCUMENT" && candidate.generatedReady && score >= 88) {
    return "FULL";
  }
  if (candidate.recordType === "BUILD_PLAN_ITEM") return "PARTIAL";
  if (evaluateCandidateFacets(requirement, candidate).complete && score >= MIN_AUTOMATIC_LINK_SCORE) return "FULL";
  return score >= 84 ? "SUBSTANTIAL" : "PARTIAL";
}

export function selectAutomaticEvidenceForRequirement(
  requirement: RequirementInput,
  candidates: AutomaticEvidenceCandidate[],
): SelectedCandidate[] {
  const requiredKinds = inferAutomaticEvidenceKinds(requirement);
  const quantity = Math.max(
    1,
    Math.min(
      10,
      Number.isInteger(requirement.requiredQuantity) ? Number(requirement.requiredQuantity) : 1,
    ),
  );
  const desiredPerKind = requiredKinds.some((kind) => kind === "EXPERT_CV" || kind === "PROJECT_REFERENCE")
    ? quantity
    : 1;
  const selected: SelectedCandidate[] = [];
  const used = new Set<string>();

  for (const kind of requiredKinds) {
    const ranked = candidates
      .filter((candidate) => candidate.evidenceKinds.includes(kind) || kind === "GENERAL")
      .map((candidate) => ({ candidate, ...scoreCandidate(requirement, [kind], candidate) }))
      .filter((item) => item.score >= MIN_AUTOMATIC_LINK_SCORE)
      .sort((left, right) =>
        right.score - left.score
        || Number(right.candidate.selected) - Number(left.candidate.selected)
        || left.candidate.evidenceKey.localeCompare(right.candidate.evidenceKey),
      );

    let count = 0;
    for (const item of ranked) {
      if (used.has(item.candidate.evidenceKey)) continue;
      selected.push({
        candidate: item.candidate,
        score: item.score,
        reasons: item.reasons,
        supportLevel: supportForCandidate(requirement, item.candidate, item.score),
      });
      used.add(item.candidate.evidenceKey);
      count += 1;
      if (count >= desiredPerKind || selected.length >= MAX_AUTOMATIC_LINKS_PER_REQUIREMENT) break;
    }
    if (selected.length >= MAX_AUTOMATIC_LINKS_PER_REQUIREMENT) break;
  }

  // Quantity is a requirement-level constraint. Never mark one record FULL
  // when the requirement asks for several and the complete set is absent.
  if (desiredPerKind > 1 && selected.filter((item) => item.supportLevel === "FULL").length < desiredPerKind) {
    return selected.map((item) => ({ ...item, supportLevel: item.supportLevel === "FULL" ? "SUBSTANTIAL" : item.supportLevel }));
  }
  return selected;
}

export function serializeAutomaticRequirementEvidence(
  metadata: AutomaticRequirementEvidenceMetadata,
): string {
  return `${AUTOMATIC_REQUIREMENT_EVIDENCE_PREFIX}${JSON.stringify(metadata)}`;
}

export function parseAutomaticRequirementEvidence(
  notes: string | null | undefined,
): AutomaticRequirementEvidenceMetadata | null {
  if (!notes?.startsWith(AUTOMATIC_REQUIREMENT_EVIDENCE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(notes.slice(AUTOMATIC_REQUIREMENT_EVIDENCE_PREFIX.length)) as Partial<AutomaticRequirementEvidenceMetadata>;
    if (
      parsed.version !== 1
      || typeof parsed.evidenceKey !== "string"
      || typeof parsed.recordType !== "string"
      || typeof parsed.recordId !== "string"
      || typeof parsed.label !== "string"
      || typeof parsed.requirementId !== "string"
      || typeof parsed.requirementSourceFileId !== "string"
      || !SHA256_PATTERN.test(parsed.requirementSourceQuoteHash ?? "")
      || !SHA256_PATTERN.test(parsed.sourceContentHash ?? "")
      || !Number.isInteger(parsed.sourceByteLength)
      || (parsed.sourceByteLength ?? 0) <= 0
      || !Number.isFinite(parsed.linkageScore)
      || !Array.isArray(parsed.linkageReasons)
      || typeof parsed.sourceFileName !== "string"
      || parsed.sourceFileName.trim().length === 0
      || !Array.isArray(parsed.matchedFacets)
      || !SHA256_PATTERN.test(parsed.sourceRevision ?? "")
      || !SHA256_PATTERN.test(parsed.evidenceRevision ?? "")
      || parsed.state !== "ACTIVE"
    ) return null;
    return parsed as AutomaticRequirementEvidenceMetadata;
  } catch {
    return null;
  }
}

function metadataFor(
  requirement: RequirementInput,
  selected: SelectedCandidate,
): AutomaticRequirementEvidenceMetadata {
  return {
    version: 1,
    evidenceKey: selected.candidate.evidenceKey,
    recordType: selected.candidate.recordType,
    recordId: selected.candidate.recordId,
    label: selected.candidate.label,
    requirementId: requirement.id,
    requirementSourceFileId: requirement.sourceTenderFileId!,
    requirementSourceQuoteHash: sha256(requirement.sourceExactQuote!.replace(/\s+/g, " ").trim()),
    sourceDocumentId: selected.candidate.sourceDocumentId,
    sourceContentHash: selected.candidate.sourceContentHash,
    sourceByteLength: selected.candidate.sourceByteLength,
    sourceFileName: selected.candidate.sourceFileName ?? selected.candidate.label,
    sourceSection: selected.candidate.sourceSection ?? null,
    sourceQuote: selected.candidate.sourceQuote ?? null,
    matchedFacets: evaluateCandidateFacets(requirement, selected.candidate).matched,
    sourceRevision: sha256(`${requirement.sourceTenderFileId}:${requirement.sourceExactQuote!.replace(/\s+/g, " ").trim()}`),
    evidenceRevision: selected.candidate.evidenceRevision ?? selected.candidate.sourceContentHash,
    linkageScore: selected.score,
    linkageReasons: selected.reasons,
    state: "ACTIVE",
  };
}

function automaticEvidenceSource(recordType: AutomaticEvidenceRecordType): string {
  if (recordType === "GENERATED_DOCUMENT") return "AUTO_GENERATED_ARTIFACT";
  if (recordType === "BUILD_PLAN_ITEM") return "AUTO_PLANNED_ARTIFACT";
  if (recordType === "COMPANY_DOCUMENT") return "AUTO_BYTE_VERIFIED_VAULT_DOCUMENT";
  return "AUTO_SOURCE_VERIFIED_VAULT_RECORD";
}

function desiredRowsForContext(context: LoadedCoverageContext): {
  rows: DesiredComplianceRow[];
  groundedRequirements: number;
  remainingUngrounded: Array<{ id: string; title: string }>;
  remainingWithoutEligibleEvidence: Array<{ id: string; title: string }>;
} {
  const rows: DesiredComplianceRow[] = [];
  const remainingUngrounded: Array<{ id: string; title: string }> = [];
  const remainingWithoutEligibleEvidence: Array<{ id: string; title: string }> = [];
  let groundedRequirements = 0;

  for (const requirement of context.requirements) {
    const grounded = isGroundedEvidenceInActiveFiles(
      requirement.sourcePageNumber,
      requirement.sourceExactQuote,
      requirement.sourceTenderFileId,
      context.activeFiles,
    );
    if (!grounded) {
      remainingUngrounded.push({ id: requirement.id, title: requirement.title });
      continue;
    }
    groundedRequirements += 1;

    const selected = selectAutomaticEvidenceForRequirement(requirement, context.candidates);
    if (selected.length === 0) {
      remainingWithoutEligibleEvidence.push({ id: requirement.id, title: requirement.title });
      continue;
    }

    for (const item of selected) {
      const metadata = metadataFor(requirement, item);
      rows.push({
        key: `${requirement.id}:${item.candidate.evidenceKey}`,
        tenderId: context.tender.id,
        requirementId: requirement.id,
        evidenceType: item.candidate.recordType,
        evidenceSource: automaticEvidenceSource(item.candidate.recordType),
        evidenceReference: item.candidate.label,
        supportLevel: item.supportLevel,
        notes: serializeAutomaticRequirementEvidence(metadata),
      });
    }
  }

  return { rows, groundedRequirements, remainingUngrounded, remainingWithoutEligibleEvidence };
}

function vaultRecordCandidate(
  recordType: Exclude<AutomaticEvidenceRecordType, "COMPANY_DOCUMENT" | "GENERATED_DOCUMENT" | "BUILD_PLAN_ITEM">,
  record: any,
  label: string,
  searchableText: string,
  kinds: AutomaticEvidenceKind[],
  selected: boolean,
  facets: AutomaticEvidenceCandidate["facets"] = {},
): AutomaticEvidenceCandidate | null {
  if (!canUseVaultRecord(record as ReviewRecordState, "GENERATION")) return null;
  const integrity = verifiedHashAndLength(record.sourceDocument ?? {});
  if (!integrity) return null;
  return {
    recordType,
    recordId: record.id,
    label,
    searchableText,
    evidenceKinds: kinds,
    evidenceKey: candidateKey(recordType, record.id, integrity.hash),
    sourceDocumentId: record.sourceDocumentId ?? record.sourceDocument?.id ?? null,
    sourceContentHash: integrity.hash,
    sourceByteLength: integrity.byteLength,
    selected,
    generatedReady: false,
    exactFileName: null,
    sourceFileName: record.sourceDocument?.fileName ?? "",
    sourceSection: null,
    sourceQuote: record.sourceDocument?.extractedText?.slice(0, 320) ?? null,
    evidenceRevision: integrity.hash,
    facets,
  };
}

function parseBuildPlanItems(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      : [];
  } catch {
    return [];
  }
}

async function loadCoverageContext(db: any, tenderId: string, userId: string): Promise<LoadedCoverageContext | null> {
  const tender = await db.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true,
      userId: true,
      requirements: {
        where: { priority: { in: ["MANDATORY", "CRITICAL"] } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          requirementType: true,
          priority: true,
          restrictions: true,
          requiredQuantity: true,
          exactFileName: true,
          sourceTenderFileId: true,
          sourcePageNumber: true,
          sourceExactQuote: true,
          complianceMatrixRows: {
            select: {
              id: true,
              requirementId: true,
              evidenceType: true,
              evidenceSource: true,
              evidenceReference: true,
              supportLevel: true,
              notes: true,
            },
          },
        },
      },
      files: {
        where: { deletionStatus: "ACTIVE" },
        select: { id: true, extractedText: true, totalPages: true },
      },
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: {
          id: true,
          name: true,
          exactFileName: true,
          documentType: true,
          format: true,
          generationStatus: true,
          validationStatus: true,
          reviewStatus: true,
          fileContent: true,
          storagePath: true,
          contentSha256: true,
          contentByteLength: true,
          integrityStatus: true,
        },
      },
      expertMatches: { where: { isSelected: true }, select: { expertId: true } },
      projectMatches: { where: { isSelected: true }, select: { projectId: true } },
    },
  });
  if (!tender) return null;

  const company = await db.company.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!company) {
    return {
      tender,
      company: null,
      activeFiles: tender.files,
      requirements: tender.requirements,
      candidates: [],
    };
  }

  const [experts, projects, legalRecords, financialRecords, complianceRecords, companyDocuments, buildPlan] = await Promise.all([
    db.expert.findMany({
      where: { companyId: company.id, deletedAt: null },
      select: { id: true, ...VAULT_REVIEW_CONSUMER_SELECT.EXPERT },
      take: 500,
    }),
    db.project.findMany({
      where: { companyId: company.id, deletedAt: null },
      select: { id: true, ...VAULT_REVIEW_CONSUMER_SELECT.PROJECT },
      take: 500,
    }),
    db.legalRecord.findMany({
      where: { companyId: company.id },
      select: { id: true, ...VAULT_REVIEW_CONSUMER_SELECT.LEGAL },
      take: 500,
    }),
    db.financialRecord.findMany({
      where: { companyId: company.id },
      select: { id: true, ...VAULT_REVIEW_CONSUMER_SELECT.FINANCIAL },
      take: 500,
    }),
    db.companyComplianceRecord.findMany({
      where: { companyId: company.id },
      select: { id: true, ...VAULT_REVIEW_CONSUMER_SELECT.COMPLIANCE },
      take: 500,
    }),
    db.companyDocument.findMany({
      where: { companyId: company.id },
      select: {
        id: true,
        fileName: true,
        category: true,
        extractedText: true,
        contentSha256: true,
        contentByteLength: true,
        integrityStatus: true,
      },
      take: 500,
    }),
    db.buildPlan?.findFirst
      ? db.buildPlan.findFirst({
          where: { tenderId, status: "CONFIRMED" },
          orderBy: [{ revision: "desc" }, { updatedAt: "desc" }],
          select: {
            id: true,
            revision: true,
            contentHash: true,
            confirmedRevision: true,
            confirmedContentHash: true,
            itemsJson: true,
          },
        })
      : Promise.resolve(null),
  ]);

  const selectedExpertIds = new Set<string>(tender.expertMatches.map((row: any) => row.expertId));
  const selectedProjectIds = new Set<string>(tender.projectMatches.map((row: any) => row.projectId));
  const candidates: AutomaticEvidenceCandidate[] = [];

  for (const expert of experts) {
    const candidate = vaultRecordCandidate(
      "EXPERT",
      expert,
      expert.fullName ?? "Expert",
      [
        expert.title,
        expert.profile,
        ...parseStringArray(expert.disciplines),
        ...parseStringArray(expert.sectors),
        ...parseStringArray(expert.certifications),
      ].filter(Boolean).join(" "),
      ["EXPERT_CV"],
      selectedExpertIds.has(expert.id),
      {
        yearsExperience: expert.yearsExperience,
        disciplines: parseStringArray(expert.disciplines),
        sectors: parseStringArray(expert.sectors),
        certifications: parseStringArray(expert.certifications),
        qualification: expert.title,
      },
    );
    if (candidate) candidates.push(candidate);
  }

  for (const project of projects) {
    const candidate = vaultRecordCandidate(
      "PROJECT",
      project,
      project.name ?? "Project",
      [
        project.clientName,
        project.country,
        project.sector,
        project.summary,
        ...parseStringArray(project.serviceAreas),
      ].filter(Boolean).join(" "),
      ["PROJECT_REFERENCE"],
      selectedProjectIds.has(project.id),
      {
        client: project.clientName,
        sector: project.sector,
        serviceAreas: parseStringArray(project.serviceAreas),
        location: project.country,
        value: project.contractValue,
        dates: project.startDate && project.endDate ? `${project.startDate}:${project.endDate}` : null,
      },
    );
    if (candidate) candidates.push(candidate);
  }

  for (const legal of legalRecords) {
    const text = `${legal.recordType ?? ""} ${legal.title ?? ""} ${legal.authority ?? ""} ${legal.referenceNumber ?? ""}`;
    const normalized = normalizeText(text);
    const kinds: AutomaticEvidenceKind[] = ["LEGAL_REGISTRATION"];
    if (/tax|tin|vat/.test(normalized)) kinds.push("TAX_CERTIFICATE");
    if (/insurance|indemnity/.test(normalized)) kinds.push("COMPLIANCE_CERTIFICATE");
    const candidate = vaultRecordCandidate("LEGAL", legal, legal.title ?? legal.recordType ?? "Legal record", text, kinds, false);
    if (candidate) candidates.push(candidate);
  }

  for (const financial of financialRecords) {
    const text = `${financial.recordType ?? ""} ${financial.fiscalYear ?? ""} ${financial.currency ?? ""} ${financial.notes ?? ""}`;
    const candidate = vaultRecordCandidate("FINANCIAL", financial, `${financial.recordType ?? "Financial record"} ${financial.fiscalYear ?? ""}`.trim(), text, ["FINANCIAL_STATEMENT"], false);
    if (candidate) candidates.push(candidate);
  }

  for (const compliance of complianceRecords) {
    const text = `${compliance.complianceType ?? ""} ${compliance.title ?? ""} ${compliance.status ?? ""} ${compliance.evidenceSummary ?? ""}`;
    const normalized = normalizeText(text);
    const kinds: AutomaticEvidenceKind[] = ["COMPLIANCE_CERTIFICATE"];
    if (/tax|tin|vat/.test(normalized)) kinds.push("TAX_CERTIFICATE");
    if (/declaration|undertaking/.test(normalized)) kinds.push("DECLARATION");
    if (/legal|registration|licen[cs]e/.test(normalized)) kinds.push("LEGAL_REGISTRATION");
    const candidate = vaultRecordCandidate("COMPLIANCE", compliance, compliance.title ?? compliance.complianceType ?? "Compliance record", text, kinds, false);
    if (candidate) candidates.push(candidate);
  }

  for (const document of companyDocuments) {
    const integrity = verifiedHashAndLength(document);
    if (!integrity || !document.extractedText || document.extractedText.trim().length < 100) continue;
    candidates.push({
      recordType: "COMPANY_DOCUMENT",
      recordId: document.id,
      label: document.fileName,
      searchableText: `${document.category ?? ""} ${document.fileName} ${document.extractedText.slice(0, 3000)}`,
      evidenceKinds: kindsForCompanyDocument(document),
      evidenceKey: candidateKey("COMPANY_DOCUMENT", document.id, integrity.hash),
      sourceDocumentId: document.id,
      sourceContentHash: integrity.hash,
      sourceByteLength: integrity.byteLength,
      selected: false,
      generatedReady: false,
      exactFileName: document.fileName,
      sourceFileName: document.fileName,
      sourceSection: document.category ?? null,
      sourceQuote: document.extractedText.slice(0, 320),
      evidenceRevision: integrity.hash,
      facets: { category: document.category },
    });
  }

  for (const document of tender.generatedDocuments) {
    const integrity = verifiedHashAndLength(document);
    const generationStatus = String(document.generationStatus ?? "").toUpperCase();
    const validationStatus = String(document.validationStatus ?? "").toUpperCase();
    const hasBytes = Boolean((document.fileContent ?? "").trim() || (document.storagePath ?? "").trim());
    const generatedReady = Boolean(
      integrity
      && hasBytes
      && ["GENERATED", "UPLOADED", "ATTACHED", "READY_FOR_EXPORT"].includes(generationStatus)
      && ["VALIDATED", "PASSED", "APPROVED", "READY_FOR_EXPORT"].includes(validationStatus),
    );
    if (!generatedReady || !integrity) continue;
    candidates.push({
      recordType: "GENERATED_DOCUMENT",
      recordId: document.id,
      label: document.exactFileName ?? document.name,
      searchableText: `${document.name ?? ""} ${document.exactFileName ?? ""} ${document.documentType ?? ""} ${document.format ?? ""}`,
      evidenceKinds: ["OUTPUT_ARTIFACT", "METHODOLOGY_NARRATIVE", "DECLARATION", "FORM_TEMPLATE"],
      evidenceKey: candidateKey("GENERATED_DOCUMENT", document.id, integrity.hash),
      sourceDocumentId: document.id,
      sourceContentHash: integrity.hash,
      sourceByteLength: integrity.byteLength,
      selected: true,
      generatedReady: true,
      exactFileName: document.exactFileName ?? document.name,
      sourceFileName: document.exactFileName ?? document.name,
      sourceSection: document.documentType ?? null,
      sourceQuote: null,
      evidenceRevision: integrity.hash,
      facets: { validationStatus, generationStatus },
    });
  }

  if (
    buildPlan
    && buildPlan.confirmedRevision === buildPlan.revision
    && buildPlan.confirmedContentHash === buildPlan.contentHash
    && SHA256_PATTERN.test(String(buildPlan.contentHash ?? "").toLowerCase())
  ) {
    for (const [index, item] of parseBuildPlanItems(buildPlan.itemsJson).entries()) {
      const exactFileName = String(item.exactFileName ?? item.fileName ?? "").trim();
      if (!exactFileName) continue;
      const recordId = `${buildPlan.id}:${index}:${exactFileName}`;
      candidates.push({
        recordType: "BUILD_PLAN_ITEM",
        recordId,
        label: exactFileName,
        searchableText: `${exactFileName} ${String(item.documentType ?? "")} ${String(item.format ?? "")}`,
        evidenceKinds: ["OUTPUT_ARTIFACT", "METHODOLOGY_NARRATIVE", "DECLARATION", "FORM_TEMPLATE"],
        evidenceKey: candidateKey("BUILD_PLAN_ITEM", recordId, String(buildPlan.contentHash).toLowerCase()),
        sourceDocumentId: buildPlan.id,
        sourceContentHash: String(buildPlan.contentHash).toLowerCase(),
        sourceByteLength: Math.max(1, Buffer.byteLength(JSON.stringify(item), "utf8")),
        selected: true,
        generatedReady: false,
        exactFileName,
        sourceFileName: exactFileName,
        sourceSection: "Confirmed Build Plan",
        sourceQuote: null,
        evidenceRevision: String(buildPlan.contentHash).toLowerCase(),
        facets: { confirmed: true },
      });
    }
  }

  return {
    tender,
    company,
    activeFiles: tender.files,
    requirements: tender.requirements,
    candidates,
  };
}

export async function loadValidAutomaticEvidenceKeys(
  db: any,
  tenderId: string,
  userId: string,
): Promise<Set<string>> {
  const context = await loadCoverageContext(db, tenderId, userId);
  return new Set((context?.candidates ?? []).map((candidate) => candidate.evidenceKey));
}

export function filterCurrentAutomaticEvidenceRows<T extends RequirementInput>(
  requirements: T[],
  validEvidenceKeys: ReadonlySet<string>,
  activeFiles: ReadonlyArray<GroundingActiveFile>,
): T[] {
  return requirements.map((requirement) => {
    const currentSourceIsGrounded = isGroundedEvidenceInActiveFiles(
      requirement.sourcePageNumber,
      requirement.sourceExactQuote,
      requirement.sourceTenderFileId,
      activeFiles,
    );
    const currentQuoteHash = requirement.sourceExactQuote
      ? sha256(requirement.sourceExactQuote.replace(/\s+/g, " ").trim())
      : null;
    return {
      ...requirement,
      complianceMatrixRows: (requirement.complianceMatrixRows ?? []).filter((row) => {
        const metadata = parseAutomaticRequirementEvidence(row.notes);
        if (!metadata) return true;
        return currentSourceIsGrounded
          && metadata.requirementId === requirement.id
          && metadata.requirementSourceFileId === requirement.sourceTenderFileId
          && metadata.requirementSourceQuoteHash === currentQuoteHash
          && validEvidenceKeys.has(metadata.evidenceKey);
      }),
    };
  });
}

export async function reconcileAutomaticRequirementCoverage(
  db: any,
  tenderId: string,
  userId: string,
): Promise<AutomaticRequirementCoverageResult> {
  const sourceRepair = await repairSourceGrounding(tenderId, { db, userId });
  const context = await loadCoverageContext(db, tenderId, userId);
  if (!context) {
    return {
      ok: false,
      code: "TENDER_NOT_FOUND",
      sourceRepair,
      requirementsChecked: 0,
      groundedRequirements: 0,
      desiredLinks: 0,
      created: 0,
      updated: 0,
      removedStale: 0,
      unchanged: 0,
      remainingUngrounded: [],
      remainingWithoutEligibleEvidence: [],
    };
  }

  const desired = desiredRowsForContext(context);
  const desiredByKey = new Map(desired.rows.map((row) => [row.key, row]));
  const currentAutomaticRows = context.requirements.flatMap((requirement) =>
    (requirement.complianceMatrixRows ?? [])
      .map((row) => ({ row, metadata: parseAutomaticRequirementEvidence(row.notes) }))
      .filter((item): item is { row: ComplianceRowInput; metadata: AutomaticRequirementEvidenceMetadata } => Boolean(item.metadata)),
  );

  let created = 0;
  let updated = 0;
  let removedStale = 0;
  let unchanged = 0;

  await db.$transaction(async (tx: any) => {
    const existingByKey = new Map<string, ComplianceRowInput>();
    const duplicateIds: string[] = [];
    for (const item of currentAutomaticRows) {
      const key = `${item.metadata.requirementId}:${item.metadata.evidenceKey}`;
      if (existingByKey.has(key)) duplicateIds.push(item.row.id);
      else existingByKey.set(key, item.row);
    }

    const staleIds = [
      ...duplicateIds,
      ...[...existingByKey.entries()]
        .filter(([key]) => !desiredByKey.has(key))
        .map(([, row]) => row.id),
    ];
    if (staleIds.length > 0) {
      const deleted = await tx.complianceMatrix.deleteMany({ where: { id: { in: staleIds } } });
      removedStale += Number(deleted.count ?? staleIds.length);
    }

    for (const desiredRow of desired.rows) {
      const existing = existingByKey.get(desiredRow.key);
      if (!existing || staleIds.includes(existing.id)) {
        await tx.complianceMatrix.create({
          data: {
            tenderId: desiredRow.tenderId,
            requirementId: desiredRow.requirementId,
            evidenceType: desiredRow.evidenceType,
            evidenceSource: desiredRow.evidenceSource,
            evidenceReference: desiredRow.evidenceReference,
            supportLevel: desiredRow.supportLevel,
            notes: desiredRow.notes,
          },
        });
        created += 1;
        continue;
      }

      const changed = existing.evidenceType !== desiredRow.evidenceType
        || existing.evidenceSource !== desiredRow.evidenceSource
        || existing.evidenceReference !== desiredRow.evidenceReference
        || existing.supportLevel !== desiredRow.supportLevel
        || existing.notes !== desiredRow.notes;
      if (!changed) {
        unchanged += 1;
        continue;
      }
      await tx.complianceMatrix.update({
        where: { id: existing.id },
        data: {
          evidenceType: desiredRow.evidenceType,
          evidenceSource: desiredRow.evidenceSource,
          evidenceReference: desiredRow.evidenceReference,
          supportLevel: desiredRow.supportLevel,
          notes: desiredRow.notes,
          updatedAt: new Date(),
        },
      });
      updated += 1;
    }
  });

  return {
    ok: true,
    sourceRepair,
    requirementsChecked: context.requirements.length,
    groundedRequirements: desired.groundedRequirements,
    desiredLinks: desired.rows.length,
    created,
    updated,
    removedStale,
    unchanged,
    remainingUngrounded: desired.remainingUngrounded,
    remainingWithoutEligibleEvidence: desired.remainingWithoutEligibleEvidence,
  };
}
