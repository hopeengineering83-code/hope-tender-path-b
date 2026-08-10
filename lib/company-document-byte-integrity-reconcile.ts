import { prisma } from "./prisma";
import { logger } from "./observability";
import { verifiedIntegrityDataFromBase64 } from "./engine/persisted-byte-integrity";

/**
 * Establishes byte integrity for owned Company Vault documents that never had
 * it computed, so they can act as evidence sources.
 *
 * Why this exists
 * ---------------
 * `CompanyDocument.integrityStatus` defaults to "UNKNOWN", and the source
 * remapper only considers documents whose integrity is "VERIFIED". Extraction
 * and byte integrity are independent: a document uploaded before the integrity
 * columns were populated shows as extracted, with readable text, and is still
 * invisible to evidence binding. Nothing then binds, nothing verifies, and the
 * Vault reports 0 verified experts, 0 verified projects and 0 verified support
 * records while cheerfully displaying "4 extracted".
 *
 * That is not a hypothetical. Reconciling a vault of 28 experts and 112
 * projects against 4 byte-verified documents source-verifies 112/112 projects;
 * flip those same documents to UNKNOWN integrity and the identical run
 * produces 0/28 and 0/112, returning in ~220ms instead of ~3s because no
 * document qualifies as a source at all.
 *
 * What this is NOT
 * ----------------
 * This does not bypass the byte-integrity gate and does not mark unknown bytes
 * as verified. It performs, once, the verification that was never performed:
 * the persisted bytes are inspected and their real hash, length, MIME type and
 * detected format are recorded. `verifiedIntegrityDataFromBase64` throws unless
 * the bytes actually inspect clean, so a truncated or corrupt document stays
 * blocked. A document whose bytes are no longer recoverable is left untouched
 * and stays blocked — being unable to prove a document is a reason to refuse
 * it, not a reason to trust it.
 *
 * Once a document is VERIFIED, later drift is still caught by the ordinary
 * comparison path; this only establishes the baseline that was missing.
 */
export type CompanyDocumentIntegrityReconciliation = {
  examined: number;
  verified: number;
  unrecoverable: number;
};

export async function reconcileCompanyDocumentByteIntegrity(
  companyId: string,
): Promise<CompanyDocumentIntegrityReconciliation> {
  const candidates = await prisma.companyDocument.findMany({
    where: { companyId, NOT: { integrityStatus: "VERIFIED" } },
    select: {
      id: true,
      fileName: true,
      originalFileName: true,
      mimeType: true,
      fileContent: true,
    },
  });

  let verified = 0;
  let unrecoverable = 0;

  for (const document of candidates) {
    if (!document.fileContent) {
      // No recoverable bytes — cannot be proven, so it stays blocked.
      unrecoverable += 1;
      continue;
    }
    try {
      const integrity = verifiedIntegrityDataFromBase64({
        fileContent: document.fileContent,
        filename: document.originalFileName || document.fileName,
        claimedMimeType: document.mimeType,
      });
      await prisma.companyDocument.update({
        where: { id: document.id },
        data: {
          contentSha256: integrity.contentSha256,
          contentByteLength: integrity.contentByteLength,
          contentMimeType: integrity.contentMimeType,
          detectedFormat: integrity.detectedFormat,
          integrityStatus: integrity.integrityStatus,
          integrityVerifiedAt: integrity.integrityVerifiedAt,
          integrityFailureCode: integrity.integrityFailureCode,
        },
      });
      verified += 1;
    } catch (error) {
      // Bytes exist but do not inspect clean. Record why and leave it blocked.
      unrecoverable += 1;
      const failureCode = error instanceof Error ? error.message : "FILE_INTEGRITY_NOT_VERIFIED";
      await prisma.companyDocument
        .update({
          where: { id: document.id },
          data: { integrityFailureCode: failureCode },
        })
        .catch((updateError: unknown) => {
          logger.warn("[vault-integrity] could not record integrity failure code", {
            documentId: document.id,
            detail: updateError,
          });
        });
    }
  }

  return { examined: candidates.length, verified, unrecoverable };
}
