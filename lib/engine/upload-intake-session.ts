import { createHash } from "node:crypto";

export type IntakeFileIdentity = { id: string; contentHash: string | null; originalFileName: string };
export type UploadIntakeSession = { sessionKey: string; sourceRevision: string; fileIds: string[] };

/** Stable package identity used by upload, enqueue, retry, and acceptance checks. */
export function buildUploadIntakeSession(userId: string, tenderId: string, files: readonly IntakeFileIdentity[]): UploadIntakeSession {
  const ordered = [...files].sort((a, b) => a.id.localeCompare(b.id));
  const sourceRevision = createHash("sha256")
    .update(ordered.map((file) => `${file.id}:${file.contentHash ?? "missing"}`).join("\n"))
    .digest("hex");
  return {
    sessionKey: createHash("sha256").update(`${userId}:${tenderId}:${sourceRevision}`).digest("hex"),
    sourceRevision,
    fileIds: ordered.map((file) => file.id),
  };
}
