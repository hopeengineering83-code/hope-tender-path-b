import { requireRole } from "./auth";
import { prisma, prismaReady } from "./prisma";
import { validateUploadBatch, validateUploadFile } from "./upload-security";
import { inspectActualFileBytes } from "./engine/persisted-byte-integrity";

/**
 * Prepare one retry of the canonical secure-upload handler after a legacy
 * TenderFile unique-key collision.
 *
 * Old PENDING_DELETE/DELETED rows may still carry contentHash from before the
 * durable deletion repair. contentHash is only the legacy dedup key; the
 * immutable trust digest is contentSha256 and remains untouched. Releasing the
 * legacy key lets the canonical handler persist the newly uploaded bytes while
 * preserving the historical row and all of its SHA-256 audit evidence.
 *
 * This helper never stores bytes, creates TenderFile rows, queues jobs, or
 * builds an upload response. Those responsibilities remain exclusively in
 * handleSecureUpload.
 */
export async function prepareIdempotentTenderUploadRetry(
  req: Request,
  failedResponse: Response,
): Promise<boolean> {
  if (failedResponse.status !== 422) return false;

  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch {
    return false;
  }

  const formData = await req.formData().catch(() => null);
  if (!formData || formData.get("companyDoc") === "true") return false;

  const tenderValue = formData.get("tenderId");
  const tenderId = typeof tenderValue === "string" && tenderValue ? tenderValue : null;
  const files = formData.getAll("file").filter((entry): entry is File => entry instanceof File);
  if (!tenderId || files.length === 0 || validateUploadBatch(files)) return false;

  await prismaReady;
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true },
  });
  if (!tender) return false;

  const hashes: string[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const validation = await validateUploadFile(file, buffer);
    if (!validation.ok) return false;

    const integrity = inspectActualFileBytes({
      bytes: buffer,
      filename: validation.safeFileName,
      claimedMimeType: validation.normalizedMime,
    });
    if (integrity.integrityStatus !== "VERIFIED" || !integrity.contentSha256) return false;
    hashes.push(integrity.contentSha256);
  }

  const matchingRows = await prisma.tenderFile.findMany({
    where: {
      tenderId,
      contentHash: { in: hashes },
    },
    select: { id: true, deletionStatus: true },
  });
  if (matchingRows.length === 0) return false;

  const nonActiveIds = matchingRows
    .filter((row) => row.deletionStatus === "PENDING_DELETE" || row.deletionStatus === "DELETED")
    .map((row) => row.id);

  if (nonActiveIds.length > 0) {
    await prisma.tenderFile.updateMany({
      where: {
        id: { in: nonActiveIds },
        tenderId,
        deletionStatus: { in: ["PENDING_DELETE", "DELETED"] },
      },
      data: { contentHash: null },
    });
  }

  // ACTIVE matches indicate a narrow insert race. A single canonical retry
  // will now observe and replay that ACTIVE row instead of attempting another
  // insert. Non-active matches have had the legacy key released above.
  return true;
}
