import crypto from "crypto";

/**
 * Single shared, deterministic hash for the canonical Build Plan.
 *
 * Used by BOTH the Build Plan persistence (submission-plan/build route) and the
 * generation/export readiness gate, so the recorded plan and the gate's
 * freshness check can never compute different hashes for the same tender state.
 *
 * The hash covers every input that drives the submission plan:
 *   - ACTIVE tender files (id + name + a digest of their extracted content)
 *   - requirements (the plan-driving fields)
 *   - exact file naming / order
 *   - submission instructions (method / address / emails)
 *
 * Determinism rules:
 *   - inputs are sorted by a stable key (file id, requirement id) BEFORE
 *     hashing, so database query order never affects the hash;
 *   - file content is folded into a per-file SHA-256 so a large corpus does not
 *     blow up the canonical string while still detecting any content change.
 *
 * Changing files (add / remove / rename / re-extract content), requirements, or
 * exact naming/order therefore changes the hash and invalidates the plan.
 */

export type BuildPlanHashFile = {
  id: string;
  // The tender file's display name. Renames change the plan/hash.
  fileName: string | null;
  // Extracted text — "extracted content" that drives requirement/plan derivation.
  extractedText?: string | null;
  // Present so callers can pass the full file list; only ACTIVE files are hashed.
  deletionStatus?: string | null;
};

export type BuildPlanHashRequirement = {
  id: string;
  title?: string | null;
  requirementType?: string | null;
  priority?: string | null;
  exactFileName?: string | null;
  exactOrder?: number | null;
};

export type BuildPlanHashInput = {
  activeFiles: BuildPlanHashFile[];
  requirements: BuildPlanHashRequirement[];
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | null;
};

const UNIT = ""; // field separator unlikely to appear in tender text

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Compute the canonical Build Plan hash. Only ACTIVE files participate (a file
 * with deletionStatus other than "ACTIVE" is excluded, mirroring the gate's
 * active-file rule). Deterministic regardless of input ordering.
 */
export function computeBuildPlanHash(input: BuildPlanHashInput): string {
  const fileSig = input.activeFiles
    .filter((f) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")
    .slice()
    .sort(byId)
    .map((f) => `${f.id}${UNIT}${f.fileName ?? ""}${UNIT}${sha256(f.extractedText ?? "")}`)
    .join("\n");

  const reqSig = input.requirements
    .slice()
    .sort(byId)
    .map((r) =>
      [
        r.id,
        r.title ?? "",
        r.requirementType ?? "",
        r.priority ?? "",
        r.exactFileName ?? "",
        r.exactOrder ?? "",
      ].join(UNIT),
    )
    .join("\n");

  const canonical = [
    `files:${fileSig}`,
    `reqs:${reqSig}`,
    `exactFileNaming:${input.exactFileNaming ?? ""}`,
    `exactFileOrder:${input.exactFileOrder ?? ""}`,
    `submissionMethod:${input.submissionMethod ?? ""}`,
    `submissionAddress:${input.submissionAddress ?? ""}`,
    `submissionEmails:${input.submissionEmails ?? ""}`,
  ].join("\n\n");

  return sha256(canonical);
}

/**
 * Build the hash input from a tender-shaped object. Both the Build Plan route
 * and the readiness gate call this so they always feed identical inputs into
 * computeBuildPlanHash. `files` may be the full file list — only ACTIVE files
 * are hashed.
 */
export function buildPlanHashInputFromTender(tender: {
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | null;
  files: BuildPlanHashFile[];
  requirements: BuildPlanHashRequirement[];
}): BuildPlanHashInput {
  return {
    activeFiles: tender.files,
    requirements: tender.requirements,
    exactFileNaming: tender.exactFileNaming ?? null,
    exactFileOrder: tender.exactFileOrder ?? null,
    submissionMethod: tender.submissionMethod ?? null,
    submissionAddress: tender.submissionAddress ?? null,
    submissionEmails: tender.submissionEmails ?? null,
  };
}

/**
 * A recorded plan is valid only when its stored hash matches the hash recomputed
 * from the tender's CURRENT state.
 */
export function isBuildPlanValid(recordedHash: string, input: BuildPlanHashInput): boolean {
  return recordedHash === computeBuildPlanHash(input);
}
