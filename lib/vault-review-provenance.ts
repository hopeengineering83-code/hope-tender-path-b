import { createHash } from "node:crypto";
import { logger } from "./observability";

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
  fileName?: string | null;
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
      fileName: true,
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
    profile: true,
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
    startDate: true,
    endDate: true,
  },
  LEGAL: {
    ...VAULT_REVIEW_AUTHORITY_SELECT,
    recordType: true,
    title: true,
    authority: true,
    referenceNumber: true,
    issueDate: true,
    expiryDate: true,
  },
  FINANCIAL: {
    ...VAULT_REVIEW_AUTHORITY_SELECT,
    fiscalYear: true,
    recordType: true,
    currency: true,
    amount: true,
    notes: true,
  },
  COMPLIANCE: {
    ...VAULT_REVIEW_AUTHORITY_SELECT,
    complianceType: true,
    title: true,
    status: true,
    evidenceSummary: true,
    referenceNumber: true,
    expiryDate: true,
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

export type VaultLegalReviewConsumerRecord = VaultReviewAuthorityRecord & {
  recordType: string;
  title: string;
  authority?: string | null;
  referenceNumber?: string | null;
  issueDate?: Date | string | null;
  expiryDate?: Date | string | null;
};

export type VaultFinancialReviewConsumerRecord = VaultReviewAuthorityRecord & {
  fiscalYear: number;
  recordType: string;
  currency?: string | null;
  amount?: number | null;
  notes?: string | null;
};

export type VaultComplianceReviewConsumerRecord = VaultReviewAuthorityRecord & {
  complianceType: string;
  title: string;
  status?: string | null;
  evidenceSummary?: string | null;
  referenceNumber?: string | null;
  expiryDate?: Date | string | null;
};

export type VaultReviewConsumerRecord =
  | VaultExpertReviewConsumerRecord
  | VaultProjectReviewConsumerRecord
  | VaultLegalReviewConsumerRecord
  | VaultFinancialReviewConsumerRecord
  | VaultComplianceReviewConsumerRecord;

export type ReviewRecordState = VaultReviewConsumerRecord;
export type ReviewRecordType = "EXPERT" | "PROJECT" | "LEGAL" | "FINANCIAL" | "COMPLIANCE";
const REVIEW_RECORD_TYPES: readonly ReviewRecordType[] = ["EXPERT", "PROJECT", "LEGAL", "FINANCIAL", "COMPLIANCE"];
function isReviewRecordType(value: unknown): value is ReviewRecordType {
  return typeof value === "string" && (REVIEW_RECORD_TYPES as readonly string[]).includes(value);
}

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
  // True when this provenance was built by
  // buildPartialSourceVerificationProvenance — only the identity field and
  // other verified fields are in `evidence`. Descriptive only: which fields
  // may legitimately be absent from `evidence` is decided by unverifiedFields
  // below, because "partial" alone cannot say WHICH fields were unproven.
  partial?: boolean;
  /**
   * Fields the record carried at verification time whose values could NOT be
   * found in the source text. They are recorded — not just discarded — because
   * on read they are the only way to tell a field that was present-but-unproven
   * from one that appeared AFTER verification.
   *
   * Without this, partial verification silently loses the staleness guarantee:
   * anyone could add a certification to a SOURCE_VERIFIED expert and it would
   * ride along inside a record the whole system labels verified, into matching
   * scores and generated client documents.
   *
   * Absent on provenance written before partial verification existed. Those
   * are always full verifications, so absence means "every field was proven"
   * and the stricter completeness rule applies.
   */
  unverifiedFields?: string[];
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

/**
 * Honorifics and post-nominals that a source document prints but an AI
 * extractor strips. A CLOSED list, never a pattern, so this can only ever
 * ignore these exact tokens.
 */
const NAME_AFFIXES = new Set([
  "mr", "mrs", "ms", "miss", "dr", "prof", "professor", "eng", "engr", "ing",
  "ato", "wro", "wt", "weyzero", "obo",
  "msc", "bsc", "phd", "mba", "ma", "ba", "mphil", "pmp", "pe",
]);

function significantTokens(value: string): string[] {
  return value
    .toLocaleLowerCase("en-US")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0 && !NAME_AFFIXES.has(token));
}

/**
 * Order-independent identity match, used ONLY after the ordered pattern has
 * already failed, and ONLY for a record's identity field.
 *
 * An AI extractor normalises "BEKELE, Dawit (MSc)" to "Dawit Bekele".
 * evidencePattern then builds /Dawit\s+Bekele/i, finds nothing, and the record
 * stays draft — invisible to matching. That is why a vault of 112 candidates
 * promoted zero records and the workflow sat on "Match Evidence" forever with
 * analysis and engine both succeeding.
 *
 * The relaxation is deliberately narrow:
 *   - identity fields only, never inferred fields like yearsExperience, where
 *     order-independent tokens would falsely match scattered text;
 *   - EVERY significant token must appear in the source as a whole word;
 *   - no fuzzy, phonetic or edit-distance matching of any kind;
 *   - affixes come from the closed NAME_AFFIXES list.
 * A value with any token absent still fails, so a fabricated name cannot pass.
 */
function identityTokensPresent(text: string, value: string): RegExpExecArray | null {
  const tokens = significantTokens(value);
  if (tokens.length === 0) return null;
  let earliest: RegExpExecArray | null = null;
  for (const token of tokens) {
    const hit = new RegExp(`(?<![\p{L}\p{N}])${escapeRegExp(token)}(?![\p{L}\p{N}])`, "iu").exec(text);
    if (!hit) return null;
    if (!earliest || hit.index < earliest.index) earliest = hit;
  }
  return earliest;
}

function collectEvidence(
  sourceDocument: ReviewSourceDocument,
  fields: ReviewEvidenceField[],
  recordType?: ReviewRecordType,
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

  const identitySpec = recordType ? IDENTITY_FIELD_BY_RECORD_TYPE[recordType] : null;
  const identityFieldNames = new Set(
    identitySpec == null ? [] : Array.isArray(identitySpec) ? identitySpec : [identitySpec],
  );

  for (const item of normalizedFields) {
    let match = evidencePattern(item.value).exec(text);
    if ((!match || match.index < 0) && identityFieldNames.has(item.field)) {
      match = identityTokensPresent(text, item.value);
    }
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
  recordType?: ReviewRecordType,
): ReviewEvidenceAssessment {
  if (!sourceDocument) {
    return { ok: false, code: "SOURCE_DOCUMENT_REQUIRED", missingFields: [] };
  }
  return collectEvidence(sourceDocument, fields, recordType);
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
  const assessment = assessReviewEvidence(input.sourceDocument, input.fields, input.recordType);
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
  const assessment = assessReviewEvidence(input.sourceDocument, input.fields, input.recordType);
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
    // Full verification: every field the record carried was proven.
    unverifiedFields: [],
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

/**
 * Defect 4: Identity field for each record type. The identity field is the
 * minimum required to consider a record "source-verified" — other fields
 * may remain inferred/non-authoritative without rejecting the entire record.
 *
 *   EXPERT  → fullName
 *   PROJECT → name
 *   LEGAL   → title
 *   FINANCIAL → (fiscalYear + recordType) — verified as a pair
 *   COMPLIANCE → title
 *
 * The FINANCIAL case uses a composite identity because neither fiscalYear
 * alone nor recordType alone uniquely identifies the record.
 */
const IDENTITY_FIELD_BY_RECORD_TYPE: Record<ReviewRecordType, string | string[]> = {
  EXPERT: "fullName",
  PROJECT: "name",
  LEGAL: "title",
  FINANCIAL: ["fiscalYear", "recordType"],
  COMPLIANCE: "title",
};

/**
 * Defect 4: Partial source-verification result. Directly proven fields
 * become source-verified; unsupported inferred fields remain
 * non-authoritative. The record is NOT rejected just because some
 * inferred fields are missing from source text — only when the identity
 * field itself is missing.
 */
export type PartialSourceVerificationResult = {
  /** True iff the identity field (or composite identity) was verified. */
  ok: boolean;
  /** The list of fields whose values were found in source text. */
  verifiedFields: string[];
  /** The list of fields whose values were NOT found in source text. */
  unverifiedFields: string[];
  /** When ok=true, the serialized provenance payload (prefix + JSON). */
  serialized: string | null;
  /** When ok=false, the failure code (always FIELD_EVIDENCE_REQUIRED when
   * the identity field is missing, or the upstream code otherwise). */
  code: ReviewEvidenceFailure["code"] | null;
  /** The persisted sourceContentHash (when ok=true). */
  sourceContentHash: string | null;
  /** The persisted sourceByteLength (when ok=true). */
  sourceByteLength: number | null;
  /** The persisted sourceTextHash (when ok=true). */
  sourceTextHash: string | null;
  /** The persisted sourceExtractionRevision (when ok=true). */
  sourceExtractionRevision: string | null;
};

/**
 * Defect 4: build a PARTIAL source-verification provenance. Unlike
 * buildSourceVerificationProvenance (which fails closed when ANY field is
 * missing from source text), this function succeeds when at least the
 * identity field is verified. The provenance payload records only the
 * verified fields; unverified fields are listed in unverifiedFields but
 * do not block verification.
 *
 * Use this when importing records that may have inferred fields (e.g., a
 * CV with the expert's name and title but no explicit yearsExperience
 * number). The record becomes SOURCE_VERIFIED on its identity; consumers
 * can check field-level trust via canUseVaultRecordField().
 *
 * When the identity field itself is missing, returns ok=false with
 * code=FIELD_EVIDENCE_REQUIRED and the identity field in unverifiedFields.
 */
export function buildPartialSourceVerificationProvenance(input: {
  recordType: ReviewRecordType;
  sourceDocument: ReviewSourceDocument | null | undefined;
  fields: ReviewEvidenceField[];
  verificationMethod: StoredSourceVerificationProvenance["verificationMethod"];
  verifiedAt?: Date;
}): PartialSourceVerificationResult {
  const empty: PartialSourceVerificationResult = {
    ok: false,
    verifiedFields: [],
    unverifiedFields: [],
    serialized: null,
    code: "SOURCE_DOCUMENT_REQUIRED",
    sourceContentHash: null,
    sourceByteLength: null,
    sourceTextHash: null,
    sourceExtractionRevision: null,
  };
  if (!input.sourceDocument) {
    return { ...empty, code: "SOURCE_DOCUMENT_REQUIRED" };
  }
  if (!input.sourceDocument.id) {
    return { ...empty, code: "SOURCE_DOCUMENT_REQUIRED" };
  }
  if (!sourceTextIsUsable(input.sourceDocument.extractedText)) {
    return { ...empty, code: "SOURCE_TEXT_REQUIRED" };
  }
  if (!sourceByteIntegrityIsVerified(input.sourceDocument)) {
    return { ...empty, code: "PROVENANCE_REQUIRED" };
  }

  const text = input.sourceDocument.extractedText;
  const persistedHash = input.sourceDocument.contentSha256!.toLowerCase();
  const persistedByteLength = input.sourceDocument.contentByteLength!;
  const normalizedFields = normalizedEvidenceFields(input.fields);
  const verified: DurableReviewEvidence[] = [];
  const unverifiedFields: string[] = [];

  for (const item of normalizedFields) {
    const match = evidencePattern(item.value).exec(text);
    if (!match || match.index < 0) {
      unverifiedFields.push(item.field);
      continue;
    }
    const start = Math.max(0, match.index - 80);
    const end = Math.min(text.length, match.index + match[0].length + 80);
    const quote = normalizedQuote(text.slice(start, end));
    verified.push({
      field: item.field,
      valueHash: evidenceValueHash(item.value),
      quoteHash: sha256(quote),
      quote,
      page: sourcePageAtOffset(text, match.index),
      start,
      end,
    });
  }

  // Check identity verification.
  const identityField = IDENTITY_FIELD_BY_RECORD_TYPE[input.recordType];
  const identityFields = Array.isArray(identityField) ? identityField : [identityField];
  const allIdentityFieldsVerified = identityFields.every((f) => verified.some((v) => v.field === f));

  if (!allIdentityFieldsVerified) {
    // Identity field(s) not verified — fail closed like the original gate.
    const missing = identityFields.filter((f) => !verified.some((v) => v.field === f));
    return {
      ...empty,
      verifiedFields: verified.map((v) => v.field),
      unverifiedFields: [...missing, ...unverifiedFields.filter((f) => !identityFields.includes(f))],
      code: "FIELD_EVIDENCE_REQUIRED",
    };
  }

  // Identity verified — succeed with partial verification.
  const verifiedAt = (input.verifiedAt ?? new Date()).toISOString();
  const provenance: StoredSourceVerificationProvenance = {
    version: 1,
    recordType: input.recordType,
    sourceDocumentId: input.sourceDocument.id,
    sourceContentHash: persistedHash,
    sourceByteLength: persistedByteLength,
    sourceTextHash: sha256(text),
    sourceExtractionRevision: sourceExtractionRevision(input.sourceDocument),
    verificationMethod: input.verificationMethod,
    verifiedAt,
    evidence: verified,
    // Descriptive marker: this record was only partially verified.
    partial: true,
    // Persisted so a later reader can tell these apart from fields that did
    // not exist at verification time.
    unverifiedFields,
  };

  return {
    ok: true,
    verifiedFields: verified.map((v) => v.field),
    unverifiedFields,
    serialized: SOURCE_VERIFICATION_PROVENANCE_PREFIX + JSON.stringify(provenance),
    code: null,
    sourceContentHash: persistedHash,
    sourceByteLength: persistedByteLength,
    sourceTextHash: sha256(text),
    sourceExtractionRevision: sourceExtractionRevision(input.sourceDocument),
  };
}

/**
 * Defect 4: per-field trust check. Returns true iff the record's provenance
 * payload contains evidence for the requested field AND the provenance still
 * matches the current record state (same source bytes, same source text).
 *
 * Consumers that need to gate on a specific field (e.g., "can I cite this
 * expert's yearsExperience in the proposal?") should call this instead of
 * canUseVaultRecord(), which gates on the whole-record trust level only.
 *
 * For a record verified via buildPartialSourceVerificationProvenance, this
 * returns true for verifiedFields and false for unverifiedFields — exactly
 * the per-field authority the defect requires.
 */
export function canUseVaultRecordField(
  record: ReviewRecordState,
  fieldName: string,
  _purpose?: "MATCHING" | "GENERATION" | "EXPORT",
): boolean {
  if (!isDurablySourceVerified(record) && !isDurablyReviewed(record)) return false;
  // Both provenance formats store evidence as an array of {field, ...}.
  // parseStoredSourceVerification returns the v1 payload; parseStoredReviewProvenance
  // returns the v2 payload. Try both.
  const sv = parseStoredSourceVerification(record.reviewNotes);
  if (sv) {
    return sv.evidence.some((item) => item.field === fieldName);
  }
  const rv = parseStoredReviewProvenance(record.reviewNotes);
  if (rv) {
    return rv.evidence.some((item) => item.field === fieldName);
  }
  return false;
}

/**
 * Defect 4: return a summary of which fields are verified vs unverified for
 * a given record. Consumers (UI, generation pipeline, export gate) can call
 * this to render per-field trust badges or to decide which fields are safe
 * to cite.
 *
 * For a fully-verified record (every field in source text), returns
 * { verifiedFields: [...all], unverifiedFields: [], partial: false }.
 * For a partially-verified record (identity verified, some inferred fields
 * missing), returns { verifiedFields: [...verified], unverifiedFields:
 * [...missing], partial: true }.
 * For a non-verified record (AI_DRAFT, no provenance), returns
 * { verifiedFields: [], unverifiedFields: [], partial: false }.
 */
export type PartialVerificationSummary = {
  /** True iff the record has provenance AND some fields are unverified. */
  partial: boolean;
  /** Fields whose values were found in source text. */
  verifiedFields: string[];
  /** Fields whose values were NOT found in source text (inferred). */
  unverifiedFields: string[];
};

export function partialVerificationSummary(
  record: ReviewRecordState,
  recordType: ReviewRecordType,
): PartialVerificationSummary {
  const empty: PartialVerificationSummary = { partial: false, verifiedFields: [], unverifiedFields: [] };
  // Try source-verification provenance (v1) first — that's what Plan B and
  // partial verification write.
  const sv = parseStoredSourceVerification(record.reviewNotes);
  if (sv) {
    const verified = sv.evidence.map((item) => item.field);
    // Compute unverified as the set of record fields that are NOT in the
    // verified list. Use currentRecordEvidenceFields to get the full set.
    const allFields = currentRecordEvidenceFields(record, recordType) ?? [];
    const allFieldNames = allFields.map((item) => item.field);
    const unverified = allFieldNames.filter((name) => !verified.includes(name));
    return {
      partial: unverified.length > 0,
      verifiedFields: verified,
      unverifiedFields: unverified,
    };
  }
  // Try review provenance (v2) — human-approval path.
  const rv = parseStoredReviewProvenance(record.reviewNotes);
  if (rv) {
    const verified = rv.evidence.map((item) => item.field);
    const allFields = currentRecordEvidenceFields(record, recordType) ?? [];
    const allFieldNames = allFields.map((item) => item.field);
    const unverified = allFieldNames.filter((name) => !verified.includes(name));
    return {
      partial: unverified.length > 0,
      verifiedFields: verified,
      unverifiedFields: unverified,
    };
  }
  return empty;
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
      !isReviewRecordType(parsed.recordType) ||
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
      !isReviewRecordType(parsed.recordType) ||
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
      parsed.evidence.length > MAX_REVIEW_FIELDS ||
      // Optional, for provenance written before partial verification existed.
      // Malformed when present means the payload cannot be trusted at all.
      (parsed.unverifiedFields !== undefined &&
        (!Array.isArray(parsed.unverifiedFields) ||
          parsed.unverifiedFields.length > MAX_REVIEW_FIELDS ||
          !parsed.unverifiedFields.every((field) => typeof field === "string" && field.length > 0)))
    ) return null;

    const evidenceValid = parsed.evidence.every((item) => evidenceItemIsValid(item));
    const fields = parsed.evidence.map((item) => item.field);
    return evidenceValid && new Set(fields).size === fields.length
      ? parsed as StoredSourceVerificationProvenance
      : null;
  } catch (e) {
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

  if (recordType === "PROJECT") {
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

  if (recordType === "LEGAL") {
    const legal = record as Partial<VaultLegalReviewConsumerRecord>;
    if (typeof legal.title !== "string" || legal.title.trim().length === 0) return null;
    return normalizedEvidenceFields(legalReviewFields({
      recordType: legal.recordType ?? "",
      title: legal.title,
      authority: legal.authority,
      referenceNumber: legal.referenceNumber,
      issueDate: legal.issueDate,
      expiryDate: legal.expiryDate,
    }));
  }

  if (recordType === "FINANCIAL") {
    const financial = record as Partial<VaultFinancialReviewConsumerRecord>;
    if (!Number.isFinite(financial.fiscalYear)) return null;
    return normalizedEvidenceFields(financialReviewFields({
      fiscalYear: financial.fiscalYear!,
      recordType: financial.recordType ?? "",
      currency: financial.currency,
      amount: financial.amount,
      notes: financial.notes,
    }));
  }

  const compliance = record as Partial<VaultComplianceReviewConsumerRecord>;
  if (typeof compliance.title !== "string" || compliance.title.trim().length === 0) return null;
  return normalizedEvidenceFields(complianceReviewFields({
    complianceType: compliance.complianceType ?? "",
    title: compliance.title,
    status: compliance.status,
    evidenceSummary: compliance.evidenceSummary,
    referenceNumber: compliance.referenceNumber,
    expiryDate: compliance.expiryDate,
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
  if (!currentFields) return false;
  const currentValueHashes = new Map(
    currentFields.map((item) => [item.field, evidenceValueHash(item.value)]),
  );
  if (currentValueHashes.size !== currentFields.length) return false;

  // Every verified field must still hold the value that was verified.
  if (!provenance.evidence.every((item) => currentValueHashes.get(item.field) === item.valueHash)) {
    return false;
  }

  // And the record must not have GROWN since. A field the provenance never
  // assessed is a claim nothing verified — and because these gates return one
  // verdict for the whole record, that claim would ride along inside a record
  // the app labels verified, into matching scores and generated client
  // documents. Adding a certification to a SOURCE_VERIFIED expert is exactly
  // the case.
  //
  // Partial verification (buildPartialSourceVerificationProvenance) legitimately
  // leaves fields unproven, so those are allowed — but only the ones actually
  // recorded as unproven at verification time. That list is what distinguishes
  // "present but unprovable" from "appeared afterwards"; when it is absent the
  // provenance predates partial verification and every field had to be proven,
  // so the stricter rule is the correct fail-closed default.
  const unverifiedAtVerification = new Set(
    (provenance as { unverifiedFields?: string[] }).unverifiedFields ?? [],
  );
  const verifiedFieldNames = new Set(provenance.evidence.map((item) => item.field));
  const assessedEveryField = currentFields.every(
    (item) => verifiedFieldNames.has(item.field) || unverifiedAtVerification.has(item.field),
  );
  if (!assessedEveryField) return false;

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
): "REVIEWED" | "SOURCE_VERIFIED" | "MANUAL_DRAFT" | "AI_DRAFT" | "REGEX_DRAFT" | "PROVENANCE_REQUIRED" | "SOURCE_VERIFICATION_REQUIRED" {
  if (record.trustLevel === "REVIEWED") {
    return isDurablyReviewed(record) ? "REVIEWED" : "PROVENANCE_REQUIRED";
  }
  if (record.trustLevel === "SOURCE_VERIFIED") {
    return isDurablySourceVerified(record) ? "SOURCE_VERIFIED" : "SOURCE_VERIFICATION_REQUIRED";
  }
  if (record.trustLevel === "MANUAL_DRAFT") return "MANUAL_DRAFT";
  return record.trustLevel === "AI_DRAFT" ? "AI_DRAFT" : "REGEX_DRAFT";
}

/**
 * The single authority on whether a Company Vault record may be used at
 * runtime. Every consumer — matching, readiness, generation, export — routes
 * here, either directly or through canUseVaultRecordSafely().
 *
 * `purpose` is deliberately accepted and deliberately not branched on. All
 * three purposes currently share one rule: an unexpired record that is either
 * durably human-REVIEWED or durably machine-SOURCE_VERIFIED. EXPORT used to be
 * stricter (human review only); it was widened to match, because machine
 * verification against byte-checked source is the stronger claim of the two.
 * The parameter stays in the signature so call sites keep declaring what they
 * are gating, and so any future divergence has exactly one place to land
 * instead of being reimplemented per consumer.
 */
export function canUseVaultRecord(
  record: ReviewRecordState,
  purpose: "MATCHING" | "GENERATION" | "EXPORT",
): boolean {
  const expiryDate = (record as { expiryDate?: Date | string | null }).expiryDate;
  if (recordIsExpired(expiryDate)) return false;
  return isDurablyReviewed(record) || isDurablySourceVerified(record);
}

export function parseStoredStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch (e) {
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

function dateOnlyValue(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function recordIsExpired(expiryDate: Date | string | null | undefined, asOf: Date = new Date()): boolean {
  if (!expiryDate) return false;
  const parsed = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() < asOf.getTime();
}

export function legalReviewFields(record: {
  recordType: string;
  title: string;
  authority?: string | null;
  referenceNumber?: string | null;
  issueDate?: Date | string | null;
  expiryDate?: Date | string | null;
}): ReviewEvidenceField[] {
  return [
    { field: "recordType", value: record.recordType },
    { field: "title", value: record.title },
    { field: "authority", value: record.authority },
    { field: "referenceNumber", value: record.referenceNumber },
    { field: "issueDate", value: dateOnlyValue(record.issueDate) },
    { field: "expiryDate", value: dateOnlyValue(record.expiryDate) },
  ];
}

export function financialReviewFields(record: {
  fiscalYear: number;
  recordType: string;
  currency?: string | null;
  amount?: number | null;
  notes?: string | null;
}): ReviewEvidenceField[] {
  return [
    { field: "fiscalYear", value: record.fiscalYear },
    { field: "recordType", value: record.recordType },
    { field: "currency", value: record.currency },
    { field: "amount", value: record.amount },
  ];
}

export function complianceReviewFields(record: {
  complianceType: string;
  title: string;
  status?: string | null;
  evidenceSummary?: string | null;
  referenceNumber?: string | null;
  expiryDate?: Date | string | null;
}): ReviewEvidenceField[] {
  return [
    { field: "complianceType", value: record.complianceType },
    { field: "title", value: record.title },
    { field: "referenceNumber", value: record.referenceNumber },
    { field: "expiryDate", value: dateOnlyValue(record.expiryDate) },
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
  if (redacted.length > boundedLength) redacted = `${redacted.slice(0, boundedLength - 1).trimEnd()}…`;
  return redacted;
}
