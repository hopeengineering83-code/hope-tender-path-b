import { createHash } from "node:crypto";

export const REVIEW_PROVENANCE_PREFIX = "vault-review-provenance:v1:";
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_REVIEW_FIELDS = 32;

export type ReviewEvidenceField = {
  field: string;
  value: string | number | null | undefined;
};

export type ReviewSourceDocument = {
  id: string;
  extractedText: string | null | undefined;
  contentSha256?: string | null;
};

export type ReviewRecordState = {
  trustLevel?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: Date | string | null;
  reviewNotes?: string | null;
  sourceDocumentId?: string | null;
};

export type DurableReviewEvidence = {
  field: string;
  valueHash: string;
  quoteHash: string;
  start: number;
  end: number;
};

export type ReviewEvidenceAssessment =
  | {
      ok: true;
      sourceContentHash: string;
      evidence: DurableReviewEvidence[];
    }
  | {
      ok: false;
      code: "SOURCE_DOCUMENT_REQUIRED" | "SOURCE_TEXT_REQUIRED" | "FIELD_EVIDENCE_REQUIRED";
      missingFields: string[];
    };

type ReviewEvidenceFailure = Extract<ReviewEvidenceAssessment, { ok: false }>;

type StoredReviewProvenance = {
  version: 1;
  sourceDocumentId: string;
  sourceContentHash: string;
  reviewerId: string;
  reviewedAt: string;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

function evidencePattern(value: string): RegExp {
  return new RegExp(value.split(/\s+/).map(escapeRegExp).join("\\s+"), "i");
}

function sourceTextIsUsable(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length >= 100;
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
  const normalizedFields = fields
    .map((item) => ({ field: item.field.trim(), value: normalizedValue(item.value) }))
    .filter((item) => item.field.length > 0 && item.value.length > 0)
    .slice(0, MAX_REVIEW_FIELDS);

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
    const quote = text.slice(start, end).replace(/\s+/g, " ").trim();
    evidence.push({
      field: item.field,
      valueHash: sha256(item.value.toLocaleLowerCase("en-US")),
      quoteHash: sha256(quote),
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

  const persistedHash = sourceDocument.contentSha256?.toLowerCase() ?? "";
  return {
    ok: true,
    sourceContentHash: HASH_PATTERN.test(persistedHash) ? persistedHash : sha256(text),
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
  sourceDocument: ReviewSourceDocument | null | undefined;
  fields: ReviewEvidenceField[];
  reviewerId: string;
  reviewedAt: Date;
}):
  | {
      ok: true;
      serialized: string;
      sourceContentHash: string;
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
    version: 1,
    sourceDocumentId: input.sourceDocument!.id,
    sourceContentHash: assessment.sourceContentHash,
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt.toISOString(),
    evidence: assessment.evidence,
  };

  return {
    ok: true,
    serialized: REVIEW_PROVENANCE_PREFIX + JSON.stringify(provenance),
    sourceContentHash: assessment.sourceContentHash,
    evidenceFields: assessment.evidence.map((item) => item.field),
  };
}

function parseStoredProvenance(reviewNotes: string | null | undefined): StoredReviewProvenance | null {
  if (!reviewNotes?.startsWith(REVIEW_PROVENANCE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(reviewNotes.slice(REVIEW_PROVENANCE_PREFIX.length)) as Partial<StoredReviewProvenance>;
    if (
      parsed.version !== 1 ||
      typeof parsed.sourceDocumentId !== "string" ||
      !HASH_PATTERN.test(parsed.sourceContentHash ?? "") ||
      typeof parsed.reviewerId !== "string" ||
      typeof parsed.reviewedAt !== "string" ||
      !Array.isArray(parsed.evidence) ||
      parsed.evidence.length === 0
    ) {
      return null;
    }
    const evidenceValid = parsed.evidence.every((item) =>
      item &&
      typeof item.field === "string" &&
      HASH_PATTERN.test(item.valueHash) &&
      HASH_PATTERN.test(item.quoteHash) &&
      Number.isInteger(item.start) &&
      Number.isInteger(item.end) &&
      item.start >= 0 &&
      item.end > item.start,
    );
    return evidenceValid ? parsed as StoredReviewProvenance : null;
  } catch {
    return null;
  }
}

export function isDurablyReviewed(record: ReviewRecordState): boolean {
  if (record.trustLevel !== "REVIEWED") return false;
  const provenance = parseStoredProvenance(record.reviewNotes);
  if (!provenance) return false;
  if (
    !record.sourceDocumentId ||
    provenance.sourceDocumentId !== record.sourceDocumentId ||
    !record.reviewedBy ||
    provenance.reviewerId !== record.reviewedBy ||
    !record.reviewedAt
  ) {
    return false;
  }

  const persistedReviewTime = new Date(record.reviewedAt).getTime();
  const provenanceReviewTime = new Date(provenance.reviewedAt).getTime();
  return Number.isFinite(persistedReviewTime) &&
    Number.isFinite(provenanceReviewTime) &&
    persistedReviewTime === provenanceReviewTime;
}

export function effectiveReviewTrustLevel(
  record: ReviewRecordState,
): "REVIEWED" | "AI_DRAFT" | "REGEX_DRAFT" | "PROVENANCE_REQUIRED" {
  if (record.trustLevel === "REVIEWED") {
    return isDurablyReviewed(record) ? "REVIEWED" : "PROVENANCE_REQUIRED";
  }
  return record.trustLevel === "AI_DRAFT" ? "AI_DRAFT" : "REGEX_DRAFT";
}

export function canUseVaultRecord(
  record: ReviewRecordState,
  _purpose: "MATCHING" | "GENERATION" | "EXPORT",
): boolean {
  return isDurablyReviewed(record);
}

export function parseStoredStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
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
    .replace(/\b(?:date\s+of\s+birth|dob)\s*[:#-]?\s*[^,;|]{1,48}/gi, "[redacted birth detail]")
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
