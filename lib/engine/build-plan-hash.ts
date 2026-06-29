import crypto from "crypto";

/**
 * Compute a content hash of the tender files and their metadata.
 * This hash is used to detect when the tender has been modified (files added,
 * deleted, renamed) since the plan was created. The plan becomes invalid when
 * the hash no longer matches.
 */
export function computeBuildPlanContentHash(files: Array<{ id: string; originalFileName?: string | null }>): string {
  // Hash based on file IDs and names in order
  // This detects: file additions, deletions, reordering, renames
  const fileSignature = files
    .map((f) => `${f.id}:${f.originalFileName || ""}`)
    .join("|");

  return crypto.createHash("sha256").update(fileSignature).digest("hex");
}

/**
 * Check if a build plan is still valid for the current tender.
 * A plan is valid only if its contentHash matches the current file state.
 */
export function isBuildPlanValid(
  recordedHash: string,
  files: Array<{ id: string; originalFileName?: string | null }>,
): boolean {
  const currentHash = computeBuildPlanContentHash(files);
  return recordedHash === currentHash;
}
