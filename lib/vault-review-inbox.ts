import {
  assessReviewEvidence,
  complianceReviewFields,
  effectiveReviewTrustLevel,
  financialReviewFields,
  legalReviewFields,
  redactVaultText,
  type VaultComplianceReviewConsumerRecord,
  type VaultFinancialReviewConsumerRecord,
  type VaultLegalReviewConsumerRecord,
} from "./vault-review-provenance";

export type SupportReviewKind = "LEGAL" | "FINANCIAL" | "COMPLIANCE";
export type SupportReviewConsumerRecord =
  | VaultLegalReviewConsumerRecord
  | VaultFinancialReviewConsumerRecord
  | VaultComplianceReviewConsumerRecord;

export type SupportReviewInboxRecord = {
  id: string;
  kind: SupportReviewKind;
  title: string;
  secondary: string;
  tags: string[];
  trustLevel: ReturnType<typeof effectiveReviewTrustLevel>;
  canReview: boolean;
  missingEvidenceFields: string[];
};

function dateLabel(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function ownedSource(record: SupportReviewConsumerRecord) {
  return record.sourceDocument?.companyId === record.companyId
    ? record.sourceDocument
    : null;
}

export function buildSupportReviewInboxRecord(
  kind: "LEGAL",
  record: VaultLegalReviewConsumerRecord & { id: string },
): SupportReviewInboxRecord;
export function buildSupportReviewInboxRecord(
  kind: "FINANCIAL",
  record: VaultFinancialReviewConsumerRecord & { id: string },
): SupportReviewInboxRecord;
export function buildSupportReviewInboxRecord(
  kind: "COMPLIANCE",
  record: VaultComplianceReviewConsumerRecord & { id: string },
): SupportReviewInboxRecord;
export function buildSupportReviewInboxRecord(
  kind: SupportReviewKind,
  record: SupportReviewConsumerRecord & { id: string },
): SupportReviewInboxRecord {
  const sourceDocument = ownedSource(record);
  let title = "";
  let secondaryParts: Array<string | number | null | undefined> = [];
  let tags: Array<string | null> = [];
  let evidence;

  if (kind === "LEGAL") {
    const legal = record as VaultLegalReviewConsumerRecord;
    title = legal.title;
    secondaryParts = [legal.recordType, legal.authority, legal.referenceNumber];
    tags = [
      dateLabel(legal.issueDate) ? `Issued ${dateLabel(legal.issueDate)}` : null,
      dateLabel(legal.expiryDate) ? `Expires ${dateLabel(legal.expiryDate)}` : null,
    ];
    evidence = assessReviewEvidence(sourceDocument, legalReviewFields(legal));
  } else if (kind === "FINANCIAL") {
    const financial = record as VaultFinancialReviewConsumerRecord;
    title = `${financial.recordType} ${financial.fiscalYear}`;
    secondaryParts = [
      financial.fiscalYear,
      financial.currency && financial.amount != null
        ? `${financial.currency} ${financial.amount}`
        : financial.currency,
    ];
    tags = [];
    evidence = assessReviewEvidence(sourceDocument, financialReviewFields(financial));
  } else {
    const compliance = record as VaultComplianceReviewConsumerRecord;
    title = compliance.title;
    secondaryParts = [
      compliance.complianceType,
      compliance.status,
      compliance.referenceNumber,
    ];
    tags = [
      dateLabel(compliance.expiryDate) ? `Expires ${dateLabel(compliance.expiryDate)}` : null,
    ];
    evidence = assessReviewEvidence(sourceDocument, complianceReviewFields(compliance));
  }

  return {
    id: record.id,
    kind,
    title: redactVaultText(title, 160),
    secondary: redactVaultText(
      secondaryParts
        .filter((value) => value != null && String(value).trim().length > 0)
        .join(" · ") || "Details not recorded",
      220,
    ),
    tags: tags.filter((value): value is string => Boolean(value)).slice(0, 4),
    trustLevel: effectiveReviewTrustLevel({ ...record, sourceDocument }),
    canReview: evidence.ok,
    missingEvidenceFields: evidence.ok ? [] : evidence.missingFields.slice(0, 6),
  };
}

export function manualSupportRecordDraftFields(kind: SupportReviewKind) {
  return {
    trustLevel: "MANUAL_DRAFT" as const,
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: `Manual ${kind.toLowerCase()} record awaiting source-backed human review.`,
  };
}
