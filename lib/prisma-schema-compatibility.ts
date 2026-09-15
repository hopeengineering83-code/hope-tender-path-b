import type { PrismaClient } from "@prisma/client";
import { logger } from "./observability";
import { redactSecrets } from "./sanitize-error";
import { canUseVaultRecord } from "./vault-review-provenance";

const REVIEW_PROVENANCE_COLUMNS = [
  "LegalRecord.trustLevel",
  "LegalRecord.reviewedBy",
  "LegalRecord.reviewedAt",
  "LegalRecord.reviewNotes",
  "LegalRecord.sourceDocumentId",
  "FinancialRecord.trustLevel",
  "FinancialRecord.reviewedBy",
  "FinancialRecord.reviewedAt",
  "FinancialRecord.reviewNotes",
  "FinancialRecord.sourceDocumentId",
  "CompanyComplianceRecord.trustLevel",
  "CompanyComplianceRecord.reviewedBy",
  "CompanyComplianceRecord.reviewedAt",
  "CompanyComplianceRecord.reviewNotes",
  "CompanyComplianceRecord.sourceDocumentId",
] as const;

type PrismaLikeError = {
  code?: unknown;
  message?: unknown;
  meta?: { column?: unknown } | null;
};

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const candidate = error as PrismaLikeError;
  const column = typeof candidate.meta?.column === "string" ? candidate.meta.column : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return `${column} ${message}`;
}

/**
 * Narrow compatibility guard for the review-provenance migration only.
 *
 * Preview deployments intentionally skip migrations unless they use an
 * isolated preview database. During that safe rollout window, the application
 * may be newer than the preview schema. We never fall back to unreviewed rows:
 * callers receive empty legal/financial/compliance evidence instead.
 */
export function isReviewProvenanceSchemaUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as PrismaLikeError;
  if (candidate.code !== "P2022") return false;
  const text = errorText(error);
  return REVIEW_PROVENANCE_COLUMNS.some((column) => text.includes(column));
}

export function publicJobFailureMessage(error: unknown, correlationId: string): string {
  const ref = `Reference: ${correlationId}`;
  if (isReviewProvenanceSchemaUnavailable(error)) {
    return `This preview requires a database update. ${ref}`;
  }

  const message = error instanceof Error ? error.message : String(error);
  // A superseded run needs no user action: the enqueue authority already
  // queued a fresh job for the new source revision. Without this case the
  // all-caps fallback below told the user to "retry once the underlying issue
  // is resolved" and to contact an administrator, for a condition that
  // resolves itself and that they caused simply by changing their documents.
  if (/ENGINE_SOURCE_REVISION_STALE/i.test(message)) {
    return `Your source documents changed while this run was in progress, so the run was superseded. A new run has already been queued automatically — no action is needed. ${ref}`;
  }
  if (/TENDER_FACTS_INVALID[\s\S]{0,400}(?:metadata field title|title.*source page)|(?:metadata field title|title.*source page)[\s\S]{0,400}TENDER_FACTS_INVALID/i.test(message)) {
    return `TITLE_SOURCE_PROVENANCE_INVALID: The tender title could not be proven at a valid page in the active source. Reconcile the title source file, page, and quote, then retry Run Engine. ${ref}`;
  }
  // AUTO_FINALIZE names the documents it could not converge, and that list is
  // the only actionable thing about the failure. Collapsed into the generic
  // fallback below it became "The background job could not complete. Retry
  // once..." -- advice that is actively wrong, because the blocker is
  // classified NON_RETRYABLE precisely so retrying cannot help. Two hosted
  // runs were diagnosed by guessing as a result.
  //
  // The blockers are document names and readiness codes the same user already
  // sees on the export-readiness surface, so passing them through discloses
  // nothing new; they are redacted and bounded all the same.
  const notConverged = /AUTO_FINALIZE_NOT_CONVERGED\s*[-\u2014:]*\s*([\s\S]*)$/i.exec(message);
  if (notConverged) {
    const blockers = redactSecrets((notConverged[1] || "").trim()).slice(0, 400);
    return blockers
      ? `AUTO_FINALIZE_NOT_CONVERGED: Auto-finalize could not resolve every document. Retrying will not help -- resolve these first: ${blockers} ${ref}`
      : `AUTO_FINALIZE_NOT_CONVERGED: Auto-finalize could not resolve every document, and recorded no blocker list. ${ref}`;
  }

  if (/\b(?:TenderFile|Tender|Company|AiJob)\b.+\bnot found\b/i.test(message)) {
    return `A required source record no longer exists. Refresh the page, confirm the source file is still attached, and retry. ${ref}`;
  }
  if (/payload|request entity too large|too many|oversiz|max(?:imum)?\s+(?:size|length|characters?)/i.test(message)) {
    return `The submitted input exceeds the supported size. Remove duplicate source files or split the package, then retry. ${ref}`;
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(message.trim())) {
    return `The background job's input or current state did not satisfy a required precondition. Retry once the underlying issue is resolved; contact an administrator if it persists. ${ref}`;
  }
  return `The background job could not complete. Retry once; if it fails again, share the reference with an administrator. ${ref}`;
}

export async function loadDurableCompanySupportRecords(
  client: PrismaClient,
  companyId: string,
  take = 24,
) {
  try {
    const [legalRecords, financialRecords, complianceRecords] = await Promise.all([
      client.legalRecord.findMany({
        where: { companyId },
        orderBy: { updatedAt: "desc" },
        take,
        include: {
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
        },
      }),
      client.financialRecord.findMany({
        where: { companyId },
        orderBy: { fiscalYear: "desc" },
        take,
        include: {
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
        },
      }),
      client.companyComplianceRecord.findMany({
        where: { companyId },
        orderBy: { updatedAt: "desc" },
        take,
        include: {
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
        },
      }),
    ]);

    return {
      legalRecords: legalRecords.filter((record) => canUseVaultRecord(record, "GENERATION")),
      financialRecords: financialRecords.filter((record) => canUseVaultRecord(record, "GENERATION")),
      complianceRecords: complianceRecords.filter((record) => canUseVaultRecord(record, "GENERATION")),
      schemaCompatible: true,
    };
  } catch (error) {
    if (!isReviewProvenanceSchemaUnavailable(error)) throw error;
    logger.warn("[schema-compatibility] review-provenance migration is not available; support records are excluded fail-closed", {
      companyId,
      code: "REVIEW_PROVENANCE_SCHEMA_UNAVAILABLE",
    });
    return {
      legalRecords: [],
      financialRecords: [],
      complianceRecords: [],
      schemaCompatible: false,
    };
  }
}
