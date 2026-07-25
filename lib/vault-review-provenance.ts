import { createHash } from "node:crypto";
import { logger } from "../observability";

export const REVIEW_PROVENANCE_PREFIX = "vault-review-provenance:v2:";
export const SOURCE_VERIFICATION_PROVENANCE_PREFIX = "vault-source-verification:v1:";
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_REVIEW_FIELDS = 40;

export type ReviewEvidenceField = {
  field: string;
  value: string | number | null | undefined;
};

export type ReviewSourceDocument = {
  id: string;
  companyId?: string | null;
  extractedText: string | null | undefined;
  contentSha256?: string | null;
  contentByteLength?: number | null;
  integrityStatus?: string | null;
  metadata?: string | null;
};

const VAULT_REVIEW_AUTHORITY_SELECT = {
  companyId: true,
  trustLevel: true,
  reviewedBy: true,
  reviewedAt: true,
  reviewNotes: true,
  sourceDocumentId: true,
  sourceDocument: {
    select: {
      id: true,
      companyId: true,
      extractedText: true,
      contentSha256: true,
      contentByteLength: true,
      integrityStatus: true,
      metadata: true,
    },
  },
} as const;

export const VAULT_REVIEW_CONSUMER_SELECT = {
  EXPERT: {
    ...VAULT_REVIEW_AUTHORITY_SELECT,
    fullName: true,
    title: true,
    yearsExperience: true,
    disciplines: true,
    sectors: true,
    certifications: true,
  },
  PROJECT: {
    ...VAULT_REVIEW_AUTHORITY_SELECT,
    name: true,
    clientName: true,
    country: true,
    sector: true,
    serviceAreas: true,
    contractValue: true,
    currency: true,
  },
} as const;

type VaultReviewAuthorityRecord = {
  companyId: string;
  trustLevel?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: Date | string | null;
  reviewNotes?: string | null;
  sourceDocumentId?: string | null;
  sourceDocument?: (ReviewSourceDocument & { companyId: string }) | null;
};

export type VaultExpertReviewConsumerRecord = VaultReviewAuthorityRecord & {
  fullName: string;
  title?: string | null;
  yearsExperience?: number | null;
  disciplines?: unknown;
  sectors?: unknown;
  certifications?: unknown;
};

export type VaultProjectReviewConsumerRecord = VaultReviewAuthorityRecord & {
  name: string;
  clientName?: string | null;
  country?: string | null;
  sector?: string | null;
  serviceAreas?: unknown;
  contractValue?: number | null;
  currency?: string | null;
};

export type VaultReviewConsumerRecord =
  | VaultExpertReviewConsumerRecord
  | VaultProjectReviewConsumerRecord;

export type ReviewRecordState = VaultReviewConsumerRecord;
export type ReviewRecordType = "EXPERT" | "PROJECT";

export type DurableReviewEvidence = {
  field: string;
  valueHash: string;
  quoteHash: string;
  quote: string;
  page: number | null;
  start: number;
  end: number;
};

export type ReviewEvidenceAssessment =
  | {
      ok: true;
      sourceContentHash: string;
      sourceByteLength: number;
      sourceTextHash: string;
      sourceExtractionRevision: string;
      evidence: DurableReviewEvidence[];
    }
  | {
      ok: false;
      code:
        | "SOURCE_DOCUMENT_REQUIRED"
        | "SOURCE_TEXT_REQUIRED"
        | "PROVENANCE_REQUIRED"
        | "FIELD_EVIDENCE_REQUIRED";
      missingFields: string[];
    };

type ReviewEvidenceFailure = Extract<ReviewEvidenceAssessment, { ok: false }>;

type StoredReviewProvenance = {
  version: 2;
  recordType: ReviewRecordType;
  sourceDocumentId: string;
  sourceContentHash: string;
  sourceByteLength: number;
  sourceTextHash: string;
  sourceExtractionRevision?: string;
  reviewerId: string;
  reviewedAt: string;
  evidence: DurableReviewEvidence[];
};

type StoredSourceVerificationProvenance = {
  version: 1;
  recordType: ReviewRecordType;
  sourceDocumentId: string;
  sourceContentHash: string;
  sourceByteLength: number;
  sourceTextHash: string;
  sourceExtractionRevision: string;
  verificationMethod: "AI" | "DETERMINISTIC" | "HYBRID";
  verifiedAt: string;
  evidence: DurableReviewEvidence[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedValue(value: ReviewEvidenceField["value"]): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function normalizedEvidenceFields(fields: ReviewEvidenceField[]) {
  return fields
    .map((item) => ({ field: item.field.trim(), value: normalizedValue(item.value) }))
    .filter((item) => item.field.length > 0 && item.value.length > 0)
    .slice(0, MAX_REVIEW_FIELDS);
}

function evidenceValueHash(value: string): string {
  return sha256(value.toLocaleLowerCase("en-US"));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

function evidencePattern(value: string): RegExp {
  return new RegExp(value.split(/\s+/).map(escapeRegExp).join("\\s+"), "i");
}

function normalizedQuote(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sourceTextIsUsable(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length >= 100;
}

function sourceExtractionRevision(sourceDocument: Pick<ReviewSourceDocument, "metadata">): string {
  if (sourceDocument.metadata) {
    try {
      const metadata = JSON.parse(sourceDocument.metadata) as Record<string, unknown>;
      const numeric = Number(metadata.extractionRevision);
      if (Number.isInteger(numeric) && numeric > 0) return `revision:${numeric}`;
      if (typeof metadata.reExtractedAt === "string" && metadata.reExtractedAt.trim()) {
        return `legacy-reextract:${metadata.reExtractedAt.trim()}`;
      }
    } catch (e) {
      // Legacy metadata is treated as the first extraction revision.
      // Surface the failure so corrupted metadata rows are observable (a
      // series of these suggests a serialization bug, not a one-off glitch).
      // Previously bare `catch {}` — legacy metadata failures were invisible.
      logger.warn("[vault-review-provenance] failed to parse source-document metadata — treating as first extraction revision", {
        detail: e,
      });
    }
  }
  return "revision:1";
}

function sourcePageAtOffset(text: string, offset: number): number | null {
  const pagePattern = /\[Page\s+(\d+)\]/gi;
  let page: number | null = null;
  for (const match of text.matchAll(pagePattern)) {
    if ((match.index ?? 0) > offset) break;
    const parsed = Number(match[1]);
    if (Number.isInteger(parsed) && parsed > 0) page = parsed;
  }
  return page;
}

export function sourceByteIntegrityIsVerified(
  sourceDocument: Pick<ReviewSourceDocument, "contentSha256" | "contentByteLength" | "integrityStatus">,
): boolean {
  const persistedHash = sourceDocument.contentSha256?.toLowerCase() ?? "";
  return sourceDocument.integrityStatus === "VERIFIED" &&
    HASH_PATTERN.test(persistedHash) &&
    Number.isInteger(sourceDocument.contentByteLength) &&
    (sourceDocument.contentByteLength ?? 0) > 0;
}

function collectEvidence(
  sourceDocument: ReviewSourceDocument,
  fields: ReviewEvidenceField[],
): ReviewEvidenceAssessment {
  if (!sourceDocument.id) {
    return { ok: false, code: "SOURCE_DOCUMENT_REQUIRED", missingFields: [] };
  }
  if (!sourceTextIsUsable(sourceDocument.extractedText)) {
    return { ok: false, code: "SOURCE_TEXT_REQUIRED", missingFields: [] };
  }

  const text = sourceDocument.extractedText;
  const persistedHash = sourceDocument.contentSha256?.toLowerCase() ?? "";
  const persistedByteLength = sourceDocument.contentByteLength;
  if (!sourceByteIntegrityIsVerified(sourceDocument)) {
    return { ok: false, code: "PROVENANCE_REQUIRED", missingFields: [] };
  }

  const normalizedFields = normalizedEvidenceFields(fields);
  const missingFields: string[] = [];
  const evidence: DurableReviewEvidence[] = [];

  for (const item of normalizedFields) {
    const match = evidencePattern(item.value).exec(text);
    if (!match || match.index < 0) {
      missingFields.push(item.field);
      continue;
    }
    const start = Math.max(0, match.index - 80);
    const end = Math.min(text.length, match.index + match[0].length + 80);
    const quote = normalizedQuote(text.slice(start, end));
    evidence.push({
      field: item.field,
      valueHash: evidenceValueHash(item.value),
      quoteHash: sha256(quote),
      quote,
      page: sourcePageAtOffset(text, match.index),
      start,
      end,
    });
  }

  if (normalizedFields.length === 0 || missingFields.length > 0) {
    return {
      ok: false,
      code: "FIELD_EVIDENCE_REQUIRED",
      missingFields: normalizedFields.length === 0 ? ["identity"] : missingFields,
    };
  }

  return {
    ok: true,
    sourceContentHash: persistedHash,
    sourceByteLength: persistedByteLength!,
    sourceTextHash: sha256(text),
    sourceExtractionRevision: sourceExtractionRevision(sourceDocument),
    evidence,
  };
}

export function assessReviewEvidence(
  sourceDocument: ReviewSourceDocument | null | undefined,
  fields: ReviewEvidenceField[],
): ReviewEvidenceAssessment {
  if (!sourceDocument) {
    return { ok: false, code: "SOURCE_DOCUMENT_REQUIRED", missingFields: [] };
  }
  return collectEvidence(sourceDocument, fields);
}

export function buildReviewProvenance(input: {
  recordType: ReviewRecordType;
  sourceDocument: ReviewSourceDocument | null | undefined;
  fields: ReviewEvidenceField[];
  reviewerId: string;
  reviewedAt: Date;
}):
  | {
      ok: true;
      serialized: string;
      sourceContentHash: string;
      sourceByteLength: number;
      sourceTextHash: string;
      evidenceFields: string[];
    }
  | {
      ok: false;
      code: ReviewEvidenceFailure["code"];
      missingFields: string[];
    } {
  const assessment = assessReviewEvidence(input.sourceDocument, input.fields);
  if (!assessment.ok) return assessment;

  const provenance: StoredReviewProvenance = {
    version: 2,
    recordType: input.recordType,
    sourceDocumentId: input.sourceDocument!.id,
    sourceContentHash: assessment.sourceContentHash,
    sourceByteLength: assessment.sourceByteLength,
    sourceTextHash: assessment.sourceTextHash,
    sourceExtractionRevision: assessment.sourceExtractionRevision,
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt.toISOString(),
    evidence: assessment.evidence,
  };

  return {
    ok: true,
    serialized: REVIEW_PROVENANCE_PREFIX + JSON.stringify(provenance),
    sourceContentHash: assessment.sourceContentHash,
    sourceByteLength: assessment.sourceByteLength,
    sourceTextHash: assessment.sourceTextHash,
    evidenceFields: assessment.evidence.map((item) => item.field),
  };
}

export function buildSourceVerificationProvenance(input: {
  recordType: ReviewRecordType;
  sourceDocument: ReviewSourceDocument | null | undefined;
  fields: ReviewEvidenceField[];
  verificationMethod: StoredSourceVerificationProvenance["verificationMethod"];
  verifiedAt?: Date;
}):
  | {
      ok: true;
      serialized: string;
      sourceContentHash: string;
      sourceByteLength: number;
      sourceTextHash: string;
      sourceExtractionRevision: string;
      verifiedAt: string;
      evidenceFields: string[];
    }
  | {
      ok: false;
      code: ReviewEvidenceFailure["code"];
      missingFields: string[];
    } {
  const assessment = assessReviewEvidence(input.sourceDocument, input.fields);
  if (!assessment.ok) return assessment;

  const verifiedAt = (input.verifiedAt ?? new Date()).toISOString();
  const provenance: StoredSourceVerificationProvenance = {
    version: 1,
    recordType: input.recordType,
    sourceDocumentId: input.sourceDocument!.id,
    sourceContentHash: assessment.sourceContentHash,
    sourceByteLength: assessment.sourceByteLength,
    sourceTextHash: assessment.sourceTextHash,
    sourceExtractionRevision: assessment.sourceExtractionRevision,
    verificationMethod: input.verificationMethod,
    verifiedAt,
    evidence: assessment.evidence,
  };

  return {
    ok: true,
    serialized: SOURCE_VERIFICATION_PROVENANCE_PREFIX + JSON.stringify(provenance),
    sourceContentHash: assessment.sourceContentHash,
    sourceByteLength: assessment.sourceByteLength,
    sourceTextHash: assessment.sourceTextHash,
    sourceExtractionRevision: assessment.sourceExtractionRevision,
    verifiedAt,
    evidenceFields: assessment.evidence.map((item) => item.field),
  };
}

function evidenceItemIsValid(item: Partial<DurableReviewEvidence>): boolean {
  return typeof item.field === "string" && item.field.trim().length > 0 &&
    HASH_PATTERN.test(item.valueHash ?? "") &&
    HASH_PATTERN.test(item.quoteHash ?? "") &&
    (typeof item.quote === "string" || item.quote === undefined) &&
    (item.page === null || item.page === undefined || (Number.isInteger(item.page) && (item.page ?? 0) > 0)) &&
    Number.isInteger(item.start) && Number.isInteger(item.end) &&
    (item.start ?? -1) >= 0 && (item.end ?? 0) > (item.start ?? -1);
}

function parseStoredReviewProvenance(reviewNotes: string | null | undefined): StoredReviewProvenance | null {
  if (!reviewNotes?.startsWith(REVIEW_PROVENANCE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(reviewNotes.slice(REVIEW_PROVENANCE_PREFIX.length)) as Partial<StoredReviewProvenance>;
    if (
      parsed.version !== 2 ||
      (parsed.recordType !== "EXPERT" && parsed.recordType !== "PROJECT") ||
      typeof parsed.sourceDocumentId !== "string" ||
      !HASH_PATTERN.test(parsed.sourceContentHash ?? "") ||
      !Number.isInteger(parsed.sourceByteLength) ||
      (parsed.sourceByteLength ?? 0) <= 0 ||
      !HASH_PATTERN.test(parsed.sourceTextHash ?? "") ||
      typeof parsed.reviewerId !== "string" ||
      typeof parsed.reviewedAt !== "string" ||
      !Array.isArray(parsed.evidence) ||
      parsed.evidence.length === 0 ||
      parsed.evidence.length > MAX_REVIEW_FIELDS
    ) return null;

    const evidenceValid = parsed.evidence.every((item) => evidenceItemIsValid(item));
    const fields = parsed.evidence.map((item) => item.field);
    return evidenceValid && new Set(fields).size === fields.length
      ? parsed as StoredReviewProvenance
      : null;
  } catch (e) {
    // StoredReviewProvenance parse failed — return null so caller treats
    // the row as unparseable. Surface the failure so corrupted provenance
    // records are observable.
    logger.warn("[vault-review-provenance] failed to parse StoredReviewProvenance — returning null", {
      detail: e,
    });
    return null;
  }
}

function parseStoredSourceVerification(reviewNotes: string | null | undefined): StoredSourceVerificationProvenance | null {
  if (!reviewNotes?.startsWith(SOURCE_VERIFICATION_PROVENANCE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(reviewNotes.slice(SOURCE_VERIFICATION_PROVENANCE_PREFIX.length)) as Partial<StoredSourceVerificationProvenance>;
    if (
      parsed.version !== 1 ||
      (parsed.recordType !== "EXPERT" && parsed.recordType !== "PROJECT") ||
      typeof parsed.sourceDocumentId !== "string" ||
      !HASH_PATTERN.test(parsed.sourceContentHash ?? "") ||
      !Number.isInteger(parsed.sourceByteLength) ||
      (parsed.sourceByteLength ?? 0) <= 0 ||
      !HASH_PATTERN.test(parsed.sourceTextHash ?? "") ||
      typeof parsed.sourceExtractionRevision !== "string" ||
      !["AI", "DETERMINISTIC", "HYBRID"].includes(parsed.verificationMethod ?? "") ||
      typeof parsed.verifiedAt !== "string" ||
      !Array.isArray(parsed.evidence) ||
      parsed.evidence.length === 0 ||
      parsed.evidence.length > MAX_REVIEW_FIELDS
    ) return null;

    const evidenceValid = parsed.evidence.every((item) => evidenceItemIsValid(item));
    const fields = parsed.evidence.map((item) => item.field);
    return evidenceValid && new Set(fields).size === fields.length
      ? parsed as StoredSourceVerificationProvenance
      : null;
  } catch (e) {
    // StoredSourceVerificationProvenance parse failed — return null.
    // Surface the failure so corrupted provenance records are observable.
    logger.warn("[vault-review-provenance] failed to parse StoredSourceVerificationProvenance — returning null", {
      detail: e,
    });
    return null;
  }
}

function currentRecordEvidenceFields(
  record: ReviewRecordState,
  recordType: ReviewRecordType,
): ReturnType<typeof normalizedEvidenceFields> | null {
  if (recordType === "EXPERT") {
    const expert = record as Partial<VaultExpertReviewConsumerRecord>;
    if (typeof expert.fullName !== "string" || expert.fullName.trim().length === 0) return null;
    return normalizedEvidenceFields(expertReviewFields({
      fullName: expert.fullName,
      title: expert.title,
      yearsExperience: expert.yearsExperience,
      disciplines: expert.disciplines,
      sectors: expert.sectors,
      certifications: expert.certifications,
    }));
  }

  const project = record as Partial<VaultProjectReviewConsumerRecord>;
  if (typeof project.name !== "string" || project.name.trim().length === 0) return null;
  return normalizedEvidenceFields(projectReviewFields({
    name: project.name,
    clientName: project.clientName,
    country: project.country,
    sector: project.sector,
    serviceAreas: project.serviceAreas,
    contractValue: project.contractValue,
    currency: project.currency,
  }));
}

function provenanceMatchesCurrentRecord(
  record: ReviewRecordState,
  provenance: Pick<StoredReviewProvenance, "recordType" | "sourceDocumentId" | "sourceContentHash" | "sourceByteLength" | "sourceTextHash" | "sourceExtractionRevision" | "evidence">,
): boolean {
  if (
    !record.sourceDocumentId ||
    provenance.sourceDocumentId !== record.sourceDocumentId ||
    !record.sourceDocument ||
    record.sourceDocument.id !== record.sourceDocumentId ||
    record.sourceDocument.companyId !== record.companyId ||
    !sourceTextIsUsable(record.sourceDocument.extractedText) ||
    !sourceByteIntegrityIsVerified(record.sourceDocument)
  ) return false;

  if (
    record.sourceDocument.contentSha256?.toLowerCase() !== provenance.sourceContentHash ||
    record.sourceDocument.contentByteLength !== provenance.sourceByteLength ||
    sha256(record.sourceDocument.extractedText) !== provenance.sourceTextHash ||
    (provenance.sourceExtractionRevision && sourceExtractionRevision(record.sourceDocument) !== provenance.sourceExtractionRevision)
  ) return false;

  const currentFields = currentRecordEvidenceFields(record, provenance.recordType);
  if (!currentFields || currentFields.length !== provenance.evidence.length) return false;
  const currentValueHashes = new Map(
    currentFields.map((item) => [item.field, evidenceValueHash(item.value)]),
  );
  if (
    currentValueHashes.size !== currentFields.length ||
    !provenance.evidence.every((item) => currentValueHashes.get(item.field) === item.valueHash)
  ) return false;

  return provenance.evidence.every((item) => {
    if (item.end > record.sourceDocument!.extractedText!.length) return false;
    const currentQuote = normalizedQuote(record.sourceDocument!.extractedText!.slice(item.start, item.end));
    return sha256(currentQuote) === item.quoteHash &&
      (!item.quote || currentQuote === item.quote) &&
      (item.page == null || sourcePageAtOffset(record.sourceDocument!.extractedText!, item.start) === item.page);
  });
}

export function isDurablyReviewed(record: ReviewRecordState): boolean {
  if (record.trustLevel !== "REVIEWED") return false;
  const provenance = parseStoredReviewProvenance(record.reviewNotes);
  if (!provenance || !record.reviewedBy || !record.reviewedAt) return false;
  if (provenance.reviewerId !== record.reviewedBy) return false;
  if (!provenanceMatchesCurrentRecord(record, provenance)) return false;

  const persistedReviewTime = new Date(record.reviewedAt).getTime();
  const provenanceReviewTime = new Date(provenance.reviewedAt).getTime();
  return Number.isFinite(persistedReviewTime) &&
    Number.isFinite(provenanceReviewTime) &&
    persistedReviewTime === provenanceReviewTime;
}

export function isDurablySourceVerified(record: ReviewRecordState): boolean {
  if (record.trustLevel !== "SOURCE_VERIFIED") return false;
  if (record.reviewedBy || record.reviewedAt) return false;
  const provenance = parseStoredSourceVerification(record.reviewNotes);
  if (!provenance) return false;
  return provenanceMatchesCurrentRecord(record, provenance);
}

export function effectiveReviewTrustLevel(
  record: ReviewRecordState,
): "REVIEWED" | "SOURCE_VERIFIED" | "AI_DRAFT" | "REGEX_DRAFT" | "PROVENANCE_REQUIRED" | "SOURCE_VERIFICATION_REQUIRED" {
  if (record.trustLevel === "REVIEWED") {
    return isDurablyReviewed(record) ? "REVIEWED" : "PROVENANCE_REQUIRED";
  }
  if (record.trustLevel === "SOURCE_VERIFIED") {
    return isDurablySourceVerified(record) ? "SOURCE_VERIFIED" : "SOURCE_VERIFICATION_REQUIRED";
  }
  return record.trustLevel === "AI_DRAFT" ? "AI_DRAFT" : "REGEX_DRAFT";
}

export function canUseVaultRecord(
  record: ReviewRecordState,
  purpose: "MATCHING" | "GENERATION" | "EXPORT",
): boolean {
  if (purpose === "EXPORT") return isDurablyReviewed(record);
  return isDurablyReviewed(record) || isDurablySourceVerified(record);
}

export function parseStoredStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch (e) {
    // JSON.parse fallback for string array extraction — return [].
    // Surface the failure so malformed stringified arrays are observable.
    logger.warn("[vault-review-provenance] failed to parse string array — returning []", {
      detail: e,
    });
    return [];
  }
}

export function expertReviewFields(record: {
  fullName: string;
  title?: string | null;
  yearsExperience?: number | null;
  disciplines?: unknown;
  sectors?: unknown;
  certifications?: unknown;
}): ReviewEvidenceField[] {
  return [
    { field: "fullName", value: record.fullName },
    { field: "title", value: record.title },
    { field: "yearsExperience", value: record.yearsExperience },
    ...parseStoredStringList(record.disciplines).slice(0, 8).map((value, index) => ({ field: `disciplines[${index}]`, value })),
    ...parseStoredStringList(record.sectors).slice(0, 8).map((value, index) => ({ field: `sectors[${index}]`, value })),
    ...parseStoredStringList(record.certifications).slice(0, 8).map((value, index) => ({ field: `certifications[${index}]`, value })),
  ];
}

export function projectReviewFields(record: {
  name: string;
  clientName?: string | null;
  country?: string | null;
  sector?: string | null;
  serviceAreas?: unknown;
  contractValue?: number | null;
  currency?: string | null;
}): ReviewEvidenceField[] {
  return [
    { field: "name", value: record.name },
    { field: "clientName", value: record.clientName },
    { field: "country", value: record.country },
    { field: "sector", value: record.sector },
    ...parseStoredStringList(record.serviceAreas).slice(0, 8).map((value, index) => ({ field: `serviceAreas[${index}]`, value })),
    { field: "contractValue", value: record.contractValue },
    { field: "currency", value: record.currency },
  ];
}

export function publicVaultIdentifier(value: string): string {
  return sha256(value).slice(0, 16);
}

export function reviewEvidenceEquals(a: ReviewEvidenceField[], b: ReviewEvidenceField[]): boolean {
  const left = normalizedEvidenceFields(a);
  const right = normalizedEvidenceFields(b);
  if (left.length !== right.length) return false;
  const rightHashes = new Map(right.map((item) => [item.field, evidenceValueHash(item.value)]));
  if (rightHashes.size !== right.length) return false;
  return left.every((item) => rightHashes.get(item.field) === evidenceValueHash(item.value));
}

export function safeVaultFileLabel(category: string, index: number): string {
  const label = category.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
  const safeCategory = label ? label.replace(/\b\w/g, (character) => character.toUpperCase()) : "Vault";
  return `${safeCategory} document ${index + 1}`;
}

export function redactVaultText(value: string | null | undefined, maxLength = 220): string {
  if (!value) return "";
  const boundedLength = Math.max(40, Math.min(maxLength, 280));
  let redacted = value
    .replace(/\s+/g, " ")
    .replace(/\b(?:date\s+of\s+birth|dob)\s*[:#-]?\s*[^;|]{1,48}/gi, "[redacted birth detail]")
    .replace(/\bnationality\s*[:#-]?\s*[^,;|]{1,36}/gi, "[redacted nationality]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    .replace(/(?:\+?\d[\d ()-]{7,}\d)/g, "[redacted phone]")
    .replace(/\b(?:licen[cs]e|registration|tin|vat)(?:\s+(?:number|no\.?))?\s*[:#-]?\s*[A-Z0-9/-]{4,}\b/gi, "[redacted registration]")
    .replace(/(?:[A-Za-z]:\\|\/(?:var|home|tmp|workspace|storage|uploads?)\/)[^\s,;]+/g, "[redacted path]")
    .replace(/\b(?:blob|s3|gs):\/\/[^\s,;]+/gi, "[redacted path]")
    .trim();

  if (redacted.length > boundedLength) {
    redacted = redacted.slice(0, boundedLength - 1).trimEnd() + "…";
  }
  return redacted;
}
