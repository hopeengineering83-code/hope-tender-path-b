// Tender-issued form discovery — find the original in what was already uploaded.
//
// When a submission plan calls for a tender-issued form (a bid form, a rate
// card, an annex, a declaration on the client's own template), the app must
// not generate one: a generated lookalike is not the client's form. The old
// behaviour marked the row REPLACE_WITH_ORIGINAL and told the user to "upload
// the complete tender package" — even when that form was already sitting in
// the Tender Intake files they uploaded minutes earlier. The user could only
// clear a blocker by re-supplying something the app already had.
//
// This module finds that file and reuses its bytes unchanged. What it does
// NOT do is decide the document is finished: a blank form still has to be
// completed and signed by a person, and that is real work, not bureaucracy.
// So a reused form lands in the ordinary PENDING review lifecycle like any
// other document — never APPROVED, never READY_FOR_EXPORT, never REVIEWED.
//
// Matching is deliberately narrow. Attaching the wrong file to a client
// package is far worse than asking a person which file it is, so anything
// short of an unambiguous filename correspondence is reported as no match
// with the reason recorded.

/** A Tender Intake file, as much of it as matching needs. */
export type IntakeFileCandidate = {
  id: string;
  originalFileName: string | null;
  mimeType: string | null;
  deletionStatus: string | null;
  contentSha256?: string | null;
  contentByteLength?: number | null;
  totalPages?: number | null;
};

/** How a filename correspondence was established. */
export type FormMatchBasis = "EXACT_FILENAME" | "DISTINCTIVE_FILENAME_CONTAINMENT";

export type FormMatchResult =
  | {
      matched: true;
      file: IntakeFileCandidate;
      basis: FormMatchBasis;
    }
  | {
      matched: false;
      /** Why no file was reused. Surfaced to the user, so it must be specific. */
      reason: string;
    };

/**
 * The tender document body itself is never a "form" to attach. Matching a
 * plan row against the whole RFP would put a 200-page solicitation into the
 * client package in place of a one-page annex.
 */
const TENDER_BODY_PATTERNS: RegExp[] = [
  /\b(rfp|rfq|itb|ifb|eoi|tor)\b/i,
  /\brequest\s+for\s+(proposals?|quotations?|information)\b/i,
  /\binvitation\s+to\s+(bid|tender)\b/i,
  /\b(tender|bidding|solicitation)\s+(document|dossier|package)s?\b/i,
  /\bterms\s+of\s+reference\b/i,
  /\binstructions?\s+to\s+bidders?\b/i,
  /\baddend(um|a)\b/i,
];

/** Normalized comparison key: case, extension and punctuation removed. */
export function formKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Shortest key that may be matched by containment rather than equality.
 *
 * "form", "annex" and "bid" appear in nearly every tender file name, so a
 * containment match on a short key would attach an arbitrary document. Twelve
 * normalized characters is about "annex-c-bid" — specific enough that a
 * containment hit is a real correspondence rather than a common word.
 */
const MIN_DISTINCTIVE_KEY_LENGTH = 12;

export function looksLikeTenderBody(fileName: string | null | undefined): boolean {
  const name = fileName ?? "";
  return TENDER_BODY_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Find the uploaded intake file that IS the planned tender-issued form.
 *
 * Fails closed on every ambiguity: no candidates, several equally good
 * candidates, or only a weak partial correspondence all return matched:false
 * with a reason, leaving the existing "attach the original" blocker in place.
 */
export function matchTenderIssuedForm(
  plannedFileName: string | null | undefined,
  intakeFiles: IntakeFileCandidate[],
): FormMatchResult {
  const planKey = formKey(plannedFileName);
  if (!planKey) {
    return { matched: false, reason: "The plan row has no file name to match a tender-issued form against." };
  }

  // A deleted or pending-delete file is not something to copy bytes from.
  const active = intakeFiles.filter((file) => (file.deletionStatus ?? "ACTIVE") === "ACTIVE");
  if (active.length === 0) {
    return { matched: false, reason: "No active Tender Intake files to search for the tender-issued form." };
  }

  const eligible = active.filter((file) => !looksLikeTenderBody(file.originalFileName));
  if (eligible.length === 0) {
    return {
      matched: false,
      reason: "The uploaded Tender Intake files are the tender document itself — the separate form/annex file was not part of the upload.",
    };
  }

  const exact = eligible.filter((file) => formKey(file.originalFileName) === planKey);
  if (exact.length === 1) return { matched: true, file: exact[0], basis: "EXACT_FILENAME" };
  if (exact.length > 1) {
    return {
      matched: false,
      reason: `${exact.length} uploaded files share the name "${plannedFileName}" — attaching the wrong one would corrupt the package, so the correct file must be identified manually.`,
    };
  }

  // No exact name. Only accept containment when the planned name is
  // distinctive enough that containing it means something.
  if (planKey.length < MIN_DISTINCTIVE_KEY_LENGTH) {
    return {
      matched: false,
      reason: `No uploaded file is named "${plannedFileName}", and the name is too generic to identify one by partial match.`,
    };
  }

  const contained = eligible.filter((file) => {
    const key = formKey(file.originalFileName);
    return key.length >= MIN_DISTINCTIVE_KEY_LENGTH && (key.includes(planKey) || planKey.includes(key));
  });
  if (contained.length === 1) return { matched: true, file: contained[0], basis: "DISTINCTIVE_FILENAME_CONTAINMENT" };
  if (contained.length > 1) {
    return {
      matched: false,
      reason: `${contained.length} uploaded files could be "${plannedFileName}" — the correct one must be identified manually rather than guessed.`,
    };
  }

  return {
    matched: false,
    reason: `The tender-issued form "${plannedFileName}" is not among the uploaded Tender Intake files.`,
  };
}

export type FormReuseOutcome =
  | { reused: true; documentId: string; sourceFileId: string; sha256: string; byteLength: number }
  | { reused: false; documentId: string; reason: string };

/**
 * Copy the matched tender-issued form's bytes onto the planned document.
 *
 * Byte-preserving by construction: the source buffer is written through the
 * same verified-persist path the generators use, which recomputes the digest
 * from the actual bytes. When the source file already carries a recorded
 * SHA-256, the recomputed digest must equal it — a mismatch means the stored
 * bytes are not the bytes that were uploaded and grounded against, and that
 * fails closed rather than shipping unverified content to a client.
 *
 * Tenant ownership is enforced by loading the file through the tender, which
 * is itself scoped by userId; a file id belonging to another tenant simply
 * does not resolve.
 */
export async function reuseTenderIssuedForm(input: {
  client: any;
  storage: { getFile(record: { storagePath?: string | null; fileContent?: string | null; fileName: string }): Promise<Buffer> };
  tenderId: string;
  userId: string;
  documentId: string;
  plannedFileName: string | null | undefined;
}): Promise<FormReuseOutcome> {
  const { persistGeneratedDocumentContent } = await import("../generated-document-content");

  const tender = await input.client.tender.findFirst({
    where: { id: input.tenderId, userId: input.userId },
    select: {
      id: true,
      files: {
        select: {
          id: true, originalFileName: true, mimeType: true, deletionStatus: true,
          storagePath: true, fileContent: true,
          contentSha256: true, contentByteLength: true, totalPages: true,
        },
      },
    },
  });
  if (!tender) {
    return { reused: false, documentId: input.documentId, reason: "Tender not found for this account." };
  }

  const match = matchTenderIssuedForm(input.plannedFileName, tender.files as IntakeFileCandidate[]);
  if (!match.matched) {
    return { reused: false, documentId: input.documentId, reason: match.reason };
  }

  const source = tender.files.find((file: { id: string }) => file.id === match.file.id);
  if (!source) {
    return { reused: false, documentId: input.documentId, reason: "The matched Tender Intake file could not be re-read." };
  }
  const fileName = source.originalFileName ?? input.plannedFileName ?? "tender-issued-form";

  let bytes: Buffer;
  try {
    bytes = await input.storage.getFile({
      storagePath: source.storagePath,
      fileContent: source.fileContent,
      fileName,
    });
  } catch {
    return {
      reused: false,
      documentId: input.documentId,
      reason: `The uploaded file "${fileName}" could not be read back from storage, so its bytes cannot be reused.`,
    };
  }
  if (bytes.byteLength === 0) {
    return { reused: false, documentId: input.documentId, reason: `The uploaded file "${fileName}" is empty.` };
  }

  // The bytes must be the bytes that were uploaded and grounded against.
  const { computeByteSha256 } = await import("./persisted-byte-integrity");
  const sha256 = computeByteSha256(bytes);
  if (source.contentSha256 && source.contentSha256 !== sha256) {
    return {
      reused: false,
      documentId: input.documentId,
      reason: `CONTENT_HASH_MISMATCH: the stored bytes of "${fileName}" no longer match the digest recorded at upload, so they must not be copied into the package.`,
    };
  }

  let persisted;
  try {
    persisted = await persistGeneratedDocumentContent({
      docId: input.documentId,
      buffer: bytes,
      filename: fileName,
      mimeType: source.mimeType ?? "application/octet-stream",
      prismaClient: input.client,
      storageAdapter: (input.storage as never),
    });
  } catch (error) {
    return {
      reused: false,
      documentId: input.documentId,
      reason: `The tender-issued form "${fileName}" failed byte-integrity verification and was not attached (${error instanceof Error ? error.message : "unknown error"}).`,
    };
  }

  // Content is real and official, so generation is done — but nobody has
  // completed or signed it, so it enters the ordinary review lifecycle. Any
  // status implying approval here would be fabricated human state.
  await input.client.generatedDocument.update({
    where: { id: input.documentId },
    data: {
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
      reviewNotes: describeFormProvenance({
        sourceFileId: source.id,
        sourceFileName: fileName,
        sha256: persisted.integrity.contentSha256 ?? sha256,
        byteLength: persisted.integrity.contentByteLength ?? bytes.byteLength,
        mimeType: persisted.integrity.contentMimeType ?? source.mimeType ?? "application/octet-stream",
        basis: match.basis,
      }),
      contentSummary: `Tender-issued original "${fileName}", reused unchanged from the uploaded Tender Intake files. Complete and sign before final export.`,
      updatedAt: new Date(),
    },
  });

  return {
    reused: true,
    documentId: input.documentId,
    sourceFileId: source.id,
    sha256: persisted.integrity.contentSha256 ?? sha256,
    byteLength: persisted.integrity.contentByteLength ?? bytes.byteLength,
  };
}

/**
 * The provenance line persisted on a reused form.
 *
 * Records what item 3 requires — source file id, name, SHA-256, byte length,
 * MIME type and how the match was made — so a reviewer can tell at a glance
 * that these bytes came from the tender's own upload and were not produced by
 * the app. Kept as one line of text because it is shown in the existing review
 * notes field; no new panel, column or status carries it.
 */
export function describeFormProvenance(input: {
  sourceFileId: string;
  sourceFileName: string;
  sha256: string;
  byteLength: number;
  mimeType: string;
  basis: FormMatchBasis;
}): string {
  return [
    "machine:tender-issued-form-reuse — bytes copied unchanged from the uploaded Tender Intake file",
    `source=${input.sourceFileName} (id ${input.sourceFileId})`,
    `sha256=${input.sha256}`,
    `bytes=${input.byteLength}`,
    `mime=${input.mimeType}`,
    `match=${input.basis}`,
    "Not reviewed: complete and sign this tender-issued form before final export.",
  ].join(" | ");
}
