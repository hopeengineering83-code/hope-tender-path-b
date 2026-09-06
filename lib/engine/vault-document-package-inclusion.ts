// Including official Company Vault bytes in a final client package.
//
// A verified Company Vault upload IS an official company document — a real
// registration certificate, licence or audited statement. Putting its exact
// bytes into the submission package is legitimate and useful. What was not
// legitimate is how the two link-vault-evidence routes did it:
//
//   - Any PROPOSAL_MANAGER could do it. Placing unchanged official company
//     documents into a package that goes to a client is an ADMIN decision.
//   - The document was written straight to VALIDATED and READY_FOR_EXPORT
//     when a filename-and-text hygiene heuristic found nothing to complain
//     about. No canonical validation had run and no person had approved it.
//   - A DocumentReview row was created naming the actor as the reviewer,
//     with action READY_FOR_EXPORT. Clicking "link" is not reviewing; that
//     row is a fabricated human record in the audit trail.
//   - The bytes were assigned to fileContent directly, so contentSha256,
//     contentByteLength and the legacy sha256/byteSize columns kept whatever
//     they held from the document's PREVIOUS content. The digest then
//     described bytes that were no longer there.
//   - When the Vault document had no bytes, a DOCX was manufactured from its
//     extracted text and attached as if it were the official document. A
//     generated approximation of a licence is not a licence.
//
// This module is the single path that does it correctly: verified bytes only,
// copied unchanged through the digest-computing persist path, landing in the
// ordinary review lifecycle with provenance recorded and no invented human
// state.

/**
 * Prisma `where` fragment for Vault documents that inclusion can actually accept.
 *
 * Candidate lists must be built from this so the UI never offers an option that
 * inclusion is guaranteed to refuse. Verified integrity plus real stored bytes;
 * extracted text does not qualify, because the official document is its bytes.
 * Expressed as a query fragment rather than a post-filter so listing candidates
 * never has to load the base64 blobs.
 */
export const INCLUDABLE_VAULT_DOCUMENT_WHERE: {
  integrityStatus: string;
  OR: Array<Record<string, unknown>>;
} = {
  integrityStatus: "VERIFIED",
  OR: [
    { NOT: { storagePath: "" } },
    { AND: [{ NOT: { fileContent: null } }, { NOT: { fileContent: "" } }] },
  ],
};

export type VaultInclusionOutcome =
  | {
      included: true;
      documentId: string;
      vaultDocumentId: string;
      vaultFileName: string;
      sha256: string;
      byteLength: number;
    }
  | { included: false; documentId: string; reason: string };

/**
 * Provenance for an official Vault document placed in the package.
 *
 * Says where the bytes came from and states plainly that nothing about the
 * document has been reviewed or approved, so the line can never be read as
 * evidence that someone signed off.
 */
export function describeVaultInclusionProvenance(input: {
  vaultDocumentId: string;
  vaultFileName: string;
  sha256: string;
  byteLength: number;
  mimeType: string;
}): string {
  return [
    "machine:vault-document-inclusion — official Company Vault document included unchanged",
    `source=${input.vaultFileName} (vault id ${input.vaultDocumentId})`,
    `sha256=${input.sha256}`,
    `bytes=${input.byteLength}`,
    `mime=${input.mimeType}`,
    "Not validated and not reviewed: the export gate still applies.",
  ].join(" | ");
}

/**
 * Copy one verified Vault document's bytes onto a planned package document.
 *
 * Fails closed on: a tender or row that does not belong to the caller, a Vault
 * document outside the caller's company, an unverified Vault document, absent
 * or unreadable bytes, and bytes whose digest no longer matches what was
 * recorded when the document was verified.
 *
 * Callers must already have established that the actor is an ADMIN — the
 * role gate lives at the route boundary where the session is known.
 */
export async function includeVaultDocumentInPackage(input: {
  client: any;
  storage: { getFile(record: { storagePath?: string | null; fileContent?: string | null; fileName: string }): Promise<Buffer> };
  tenderId: string;
  userId: string;
  documentId: string;
  vaultDocumentId: string;
}): Promise<VaultInclusionOutcome> {
  const { persistGeneratedDocumentContent } = await import("../generated-document-content");
  const { computeByteSha256 } = await import("./persisted-byte-integrity");

  const fail = (reason: string): VaultInclusionOutcome => ({ included: false, documentId: input.documentId, reason });

  const tender = await input.client.tender.findFirst({
    where: { id: input.tenderId, userId: input.userId },
    select: { id: true },
  });
  if (!tender) return fail("Tender not found for this account.");

  const row = await input.client.generatedDocument.findFirst({
    where: { id: input.documentId, tenderId: input.tenderId },
    select: { id: true, name: true, exactFileName: true },
  });
  if (!row) return fail("Package document row not found on this tender.");

  const company = await input.client.company.findUnique({
    where: { userId: input.userId },
    select: { id: true },
  });
  if (!company) return fail("No company profile for this account.");

  const vault = await input.client.companyDocument.findFirst({
    where: { id: input.vaultDocumentId, companyId: company.id },
    select: {
      id: true, fileName: true, originalFileName: true, mimeType: true,
      storagePath: true, fileContent: true,
      contentSha256: true, contentByteLength: true, integrityStatus: true,
    },
  });
  if (!vault) return fail("Vault document not found for this company.");

  // "Verified Company Vault uploads are official company documents" — the
  // converse matters just as much. An upload whose bytes were never verified
  // is not established as anything, and must not be presented to a client as
  // the company's official document.
  if (vault.integrityStatus !== "VERIFIED") {
    return fail(
      `The Vault document "${vault.fileName}" has not passed byte verification (integrity ${vault.integrityStatus}), so it cannot be included as an official company document.`,
    );
  }

  const fileName = vault.originalFileName ?? vault.fileName;

  // Only real, stored bytes. Manufacturing a document from extracted text and
  // presenting it as the official original is exactly what must never happen.
  if (!(vault.storagePath ?? "").trim() && !(vault.fileContent ?? "").trim()) {
    return fail(`The Vault document "${fileName}" has no stored file bytes to include.`);
  }

  let bytes: Buffer;
  try {
    bytes = await input.storage.getFile({
      storagePath: vault.storagePath,
      fileContent: vault.fileContent,
      fileName,
    });
  } catch {
    return fail(`The Vault document "${fileName}" could not be read back from storage.`);
  }
  if (bytes.byteLength === 0) return fail(`The Vault document "${fileName}" is empty.`);

  const sha256 = computeByteSha256(bytes);
  if (vault.contentSha256 && vault.contentSha256 !== sha256) {
    return fail(
      `CONTENT_HASH_MISMATCH: the stored bytes of "${fileName}" no longer match the digest recorded when it was verified.`,
    );
  }

  let persisted;
  try {
    persisted = await persistGeneratedDocumentContent({
      docId: row.id,
      buffer: bytes,
      filename: row.exactFileName ?? fileName,
      mimeType: vault.mimeType ?? "application/octet-stream",
      prismaClient: input.client,
      storageAdapter: (input.storage as never),
    });
  } catch (error) {
    return fail(
      `"${fileName}" failed byte-integrity verification and was not included (${error instanceof Error ? error.message : "unknown error"}).`,
    );
  }

  // The bytes are real and official, so generation is done. Everything that
  // follows is someone else's decision: canonical validation has not run, and
  // no person has approved this document for a client.
  await input.client.generatedDocument.update({
    where: { id: row.id },
    data: {
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
      reviewNotes: describeVaultInclusionProvenance({
        vaultDocumentId: vault.id,
        vaultFileName: fileName,
        sha256: persisted.integrity.contentSha256 ?? sha256,
        byteLength: persisted.integrity.contentByteLength ?? bytes.byteLength,
        mimeType: persisted.integrity.contentMimeType ?? vault.mimeType ?? "application/octet-stream",
      }),
      contentSummary: `Official Company Vault document "${fileName}", included unchanged. Awaiting validation and approval before final export.`,
      updatedAt: new Date(),
    },
  });

  return {
    included: true,
    documentId: row.id,
    vaultDocumentId: vault.id,
    vaultFileName: fileName,
    sha256: persisted.integrity.contentSha256 ?? sha256,
    byteLength: persisted.integrity.contentByteLength ?? bytes.byteLength,
  };
}
