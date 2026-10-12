import { prisma } from "./prisma";
import { logger } from "./observability";
import { inspectActualFileBytes } from "./engine/persisted-byte-integrity";

/**
 * Turns Legacy Data Import staging rows into real Company Vault documents.
 *
 * Why this exists
 * ---------------
 * A Legacy Data Import stages the source text it parsed (`PlanBStaging.rawText`)
 * and creates the Expert and Project rows from it. What it does not create is a
 * `CompanyDocument`. Everything downstream — the source remapper, automatic
 * verification, and the import's own source resolution — looks only at
 * `CompanyDocument`. So an import that genuinely carried the company's CV
 * bundle and project references produced 28 experts and 114 projects, zero
 * documents, and a blocker telling the owner to upload files the app had
 * already read.
 *
 * That demand is wrong on the product's own terms. The mandate is to generate
 * proposals from the company evidence the owner already supplied; asking them
 * to re-supply it is exactly the bureaucracy the contract forbids.
 *
 * What this is NOT
 * ----------------
 * This does not invent evidence. It persists the text the import actually read,
 * hashes the bytes it actually holds, and lets the ordinary verifier decide
 * whether a record's values appear in that text. A staging row with no usable
 * text is skipped — there is nothing to materialise, and a document with no
 * content would be a fabricated source. Verification stays exactly as strict:
 * records still only reach SOURCE_VERIFIED when their current exact values are
 * found in this owned text.
 *
 * The stored bytes are the imported text itself, so `contentSha256` is the hash
 * of what is really persisted rather than the original binary's hash. The
 * declared original filename and supplied hash are kept in `metadata` for
 * provenance, and the filename is preserved on the document so the import's
 * declared-source resolution still matches it by name.
 */
export type LegacySourceMaterialization = {
  created: number;
  alreadyPresent: number;
  withoutText: number;
};

const LEGACY_SOURCE_MIME = "text/plain";

/**
 * The stored artifact holds extracted text, so it is named as text. Exported so
 * the Legacy Import can alias a declared original name onto what was stored.
 */
export function legacySourceFileName(originalFileName: string): string {
  const trimmed = originalFileName.trim();
  return trimmed.toLowerCase().endsWith(".txt") ? trimmed : `${trimmed}.txt`;
}

export async function materializeLegacyImportSources(
  companyId: string,
): Promise<LegacySourceMaterialization> {
  const staged = await prisma.planBStaging.findMany({
    where: { companyId },
    select: {
      id: true,
      originalFileName: true,
      rawText: true,
      suppliedSha256: true,
      sourceCategory: true,
      normalizedCategory: true,
      sourceType: true,
    },
  });
  if (staged.length === 0) return { created: 0, alreadyPresent: 0, withoutText: 0 };

  let created = 0;
  let alreadyPresent = 0;
  let withoutText = 0;

  for (const row of staged) {
    const text = (row.rawText ?? "").trim();
    if (!text) {
      // Nothing was parsed from this source, so there is no evidence to hold.
      withoutText += 1;
      continue;
    }

    const bytes = Buffer.from(text, "utf8");
    // What is stored is the extracted text, not the original binary, so the
    // artifact is named for what it actually holds. Calling text "Expert
    // CVS.pdf" would be a label the bytes contradict — the integrity inspector
    // correctly rejects that as a MISMATCH, and any later re-inspection would
    // reject it again and demote the document. The declared original name is
    // preserved in metadata, and the import aliases it when resolving sources.
    const storedFileName = legacySourceFileName(row.originalFileName);
    const integrity = inspectActualFileBytes({
      bytes,
      filename: storedFileName,
      claimedMimeType: LEGACY_SOURCE_MIME,
    });
    if (integrity.integrityStatus !== "VERIFIED" || !integrity.contentSha256) {
      withoutText += 1;
      continue;
    }

    const existing = await prisma.companyDocument.findFirst({
      where: {
        companyId,
        OR: [
          { contentSha256: integrity.contentSha256 },
          { originalFileName: storedFileName },
          // If the owner ever uploads the real binary under its own name, that
          // upload is the better evidence and this staged text must not be
          // added alongside it as a second copy of the same source.
          { originalFileName: row.originalFileName },
        ],
      },
      select: { id: true },
    });
    if (existing) {
      alreadyPresent += 1;
      continue;
    }

    try {
      await prisma.companyDocument.create({
        data: {
          companyId,
          fileName: storedFileName,
          originalFileName: storedFileName,
          mimeType: LEGACY_SOURCE_MIME,
          size: integrity.contentByteLength ?? bytes.byteLength,
          fileContent: bytes.toString("base64"),
          extractedText: text,
          aiExtractionStatus: "EXTRACTED",
          aiExtractedAt: new Date(),
          category: row.normalizedCategory || row.sourceCategory || "OTHER",
          contentSha256: integrity.contentSha256,
          contentByteLength: integrity.contentByteLength,
          contentMimeType: integrity.contentMimeType,
          detectedFormat: integrity.detectedFormat,
          integrityStatus: integrity.integrityStatus,
          integrityVerifiedAt: integrity.integrityVerifiedAt,
          integrityFailureCode: integrity.integrityFailureCode,
          metadata: JSON.stringify({
            provenance: "LEGACY_DATA_IMPORT",
            planBStagingId: row.id,
            declaredOriginalFileName: row.originalFileName,
            declaredSourceSha256: row.suppliedSha256 ?? null,
            declaredSourceType: row.sourceType ?? null,
            note: "Persisted from the text this import already read. Bytes are that text; contentSha256 hashes what is stored, not the original binary.",
          }),
        },
      });
      created += 1;
    } catch (error) {
      logger.warn("[legacy-source] could not materialize staged source as a vault document", {
        companyId,
        planBStagingId: row.id,
        detail: error,
      });
    }
  }

  return { created, alreadyPresent, withoutText };
}
