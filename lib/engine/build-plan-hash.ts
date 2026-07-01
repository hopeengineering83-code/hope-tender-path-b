import crypto from "crypto";
import { isEmailSubmissionMethod, isPhysicalSubmissionMethod, isPortalSubmissionMethod } from "./submission-method-policy";

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
  description?: string | null;
  requirementType?: string | null;
  priority?: string | null;
  exactFileName?: string | null;
  exactOrder?: number | null;
  sourceTenderFileId?: string | null;
  sourcePageNumber?: number | null;
  sourceExactQuote?: string | null;
};

export type BuildPlanHashItem = {
  canonicalId: string;
  exactFileName: string;
  exactOrder: number;
  documentType: string;
  required: boolean;
  format: string;
  envelope?: string | null;
  sourceRequirementIds: string[];
  pageLimit?: number | null;
  templateRequired?: boolean;
  templateSourceFileId?: string | null;
  brandingAllowed?: boolean;
  signatureAllowed?: boolean;
  stampAllowed?: boolean;
  grouping?: string | null;
  notes?: string | null;
};

export type BuildPlanHashMetadataEvidence = {
  fieldKey: string;
  effectiveValue: string | null;
  sourceTenderFileId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  evidenceState: string | null;
};

export type BuildPlanHashInput = {
  activeFiles: BuildPlanHashFile[];
  requirements: BuildPlanHashRequirement[];
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | null;
  submissionEmailSubject?: string | null;
  deadline?: Date | string | null;
  title?: string | null;
  items?: BuildPlanHashItem[];
  metadataEvidence?: BuildPlanHashMetadataEvidence[];
  metadataOverrides?: Array<{ field: string; fieldState: string; overrideValue: string | null }>;
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
        r.description ?? "",
        r.requirementType ?? "",
        r.priority ?? "",
        r.exactFileName ?? "",
        r.exactOrder ?? "",
        r.sourceTenderFileId ?? "",
        r.sourcePageNumber ?? "",
        r.sourceExactQuote ?? "",
      ].join(UNIT),
    )
    .join("\n");

  // Canonical BuildPlan items — any change to item fields invalidates the hash.
  const itemSig = (input.items ?? [])
    .slice()
    .sort((a, b) => a.exactOrder - b.exactOrder)
    .map((item) =>
      [
        `item:${item.canonicalId}`,
        `fn:${item.exactFileName}`,
        `ord:${item.exactOrder}`,
        `dt:${item.documentType}`,
        `req:${item.required ? 1 : 0}`,
        `fmt:${item.format}`,
        `env:${item.envelope ?? ""}`,
        `srids:${(item.sourceRequirementIds ?? []).slice().sort().join(",")}`,
        `pl:${item.pageLimit ?? ""}`,
        `tpl:${item.templateRequired ? 1 : 0}`,
        `tplf:${item.templateSourceFileId ?? ""}`,
        `br:${item.brandingAllowed ? 1 : 0}`,
        `sig:${item.signatureAllowed ? 1 : 0}`,
        `stmp:${item.stampAllowed ? 1 : 0}`,
        `grp:${item.grouping ?? ""}`,
        `nt:${item.notes ?? ""}`,
      ].join(UNIT),
    )
    .join("\n");

  // Critical metadata evidence — any change to source grounding invalidates hash.
  const metaSig = (input.metadataEvidence ?? [])
    .slice()
    .sort((a, b) => a.fieldKey < b.fieldKey ? -1 : a.fieldKey > b.fieldKey ? 1 : 0)
    .map((m) =>
      [
        `mf:${m.fieldKey}`,
        `mv:${m.effectiveValue ?? ""}`,
        `mfid:${m.sourceTenderFileId ?? ""}`,
        `mpg:${m.sourcePage ?? ""}`,
        `mq:${m.sourceQuote ?? ""}`,
        `mes:${m.evidenceState ?? ""}`,
      ].join(UNIT),
    )
    .join("\n");

  // Metadata overrides signature — changes to overrides (field/state/value)
  // MUST stale the plan. Sorted by field+state+value for determinism.
  const overrideSig = (input.metadataOverrides ?? [])
    .slice()
    .sort((a, b) => {
      const ka = `${a.field}|${a.fieldState}|${a.overrideValue ?? ""}`;
      const kb = `${b.field}|${b.fieldState}|${b.overrideValue ?? ""}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    .map((o) => `ov:${o.field}|${o.fieldState}|${o.overrideValue ?? ""}`)
    .join("\n");

  // Canonical hash — metadata is represented ONLY by the resolved effective
  // evidence (metaSig) and overrides (overrideSig). Raw metadata fields
  // (submissionMethod, submissionAddress, submissionEmails, deadline, title,
  // etc.) are NOT included separately because they are already captured in
  // metadataEvidence as effectiveValue. Including them twice would be
  // redundant and would couple the hash to raw values instead of the
  // canonical resolver output.
  const canonical = [
    `files:${fileSig}`,
    `reqs:${reqSig}`,
    `items:${itemSig}`,
    `meta:${metaSig}`,
    `overrides:${overrideSig}`,
    `exactFileNaming:${input.exactFileNaming ?? ""}`,
    `exactFileOrder:${input.exactFileOrder ?? ""}`,
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
  submissionEmailSubject?: string | null;
  deadline?: Date | string | null;
  title?: string | null;
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
    submissionEmailSubject: tender.submissionEmailSubject ?? null,
    deadline: tender.deadline ?? null,
    title: tender.title ?? null,
  };
}



/**
 * ONE canonical hash-input builder. This is the ONLY function callers should
 * use to construct a BuildPlanHashInput. No caller may manually construct a
 * reduced hash input or append items/metadata after calling this builder.
 *
 * @param tender - tender with files, requirements, and metadata source fields
 * @param items - the EXACT BuildPlan items to hash:
 *   - draft/rebuild: current derived canonical items
 *   - confirmation: exact stored DRAFT itemsJson
 *   - confirmed-plan check: exact stored CONFIRMED itemsJson
 *   - readiness/export/ZIP: exact persisted confirmed itemsJson
 */
export function buildCanonicalBuildPlanHashInput(
  tender: {
    exactFileNaming?: string | null;
    exactFileOrder?: string | null;
    submissionMethod?: string | null;
    submissionAddress?: string | null;
    submissionEmails?: string | null;
    submissionEmailSubject?: string | null;
    deadline?: Date | string | null;
    clientName?: string | null;
    clientNameSourceFileId?: string | null;
    clientNameSourcePage?: number | null;
    clientNameSourceQuote?: string | null;
    submissionMethodSourceFileId?: string | null;
    submissionMethodSourcePage?: number | null;
    submissionMethodSourceQuote?: string | null;
    submissionAddressSourceFileId?: string | null;
    submissionAddressSourcePage?: number | null;
    submissionAddressSourceQuote?: string | null;
    submissionEmailSourceFileId?: string | null;
    submissionEmailSourcePage?: number | null;
    submissionEmailSourceQuote?: string | null;
    titleSourceFileId?: string | null;
    titleSourcePage?: number | null;
    titleSourceQuote?: string | null;
    deadlineSourceFileId?: string | null;
    deadlineSourcePage?: number | null;
    deadlineSourceQuote?: string | null;
    title?: string | null;
    metadataOverrides?: Array<{ field: string; fieldState: string; overrideValue: string | null }>;
    files: BuildPlanHashFile[];
    requirements: BuildPlanHashRequirement[];
  },
  items: BuildPlanHashItem[],
): BuildPlanHashInput {
  const input = buildPlanHashInputFromTender(tender);
  input.items = items;

  // Derive metadata evidence from ALL policy-critical source fields.
  // Only include APPLICABLE endpoint fields based on submission method policy.
  // Evidence state is GROUNDED only when file ID + page + quote all exist.
  const method = tender.submissionMethod;
  const evidence: BuildPlanHashMetadataEvidence[] = [
    { fieldKey: "title", effectiveValue: tender.title ?? null, sourceTenderFileId: (tender as any).titleSourceFileId ?? null, sourcePage: (tender as any).titleSourcePage ?? null, sourceQuote: (tender as any).titleSourceQuote ?? null, evidenceState: ((tender as any).titleSourceFileId && (tender as any).titleSourcePage && (tender as any).titleSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "clientName", effectiveValue: tender.clientName ?? null, sourceTenderFileId: tender.clientNameSourceFileId ?? null, sourcePage: tender.clientNameSourcePage ?? null, sourceQuote: tender.clientNameSourceQuote ?? null, evidenceState: (tender.clientNameSourceFileId && tender.clientNameSourcePage && tender.clientNameSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "deadline", effectiveValue: tender.deadline ? new Date(tender.deadline).toISOString() : null, sourceTenderFileId: (tender as any).deadlineSourceFileId ?? null, sourcePage: (tender as any).deadlineSourcePage ?? null, sourceQuote: (tender as any).deadlineSourceQuote ?? null, evidenceState: ((tender as any).deadlineSourceFileId && (tender as any).deadlineSourcePage && (tender as any).deadlineSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionMethod", effectiveValue: tender.submissionMethod ?? null, sourceTenderFileId: tender.submissionMethodSourceFileId ?? null, sourcePage: tender.submissionMethodSourcePage ?? null, sourceQuote: tender.submissionMethodSourceQuote ?? null, evidenceState: (tender.submissionMethodSourceFileId && tender.submissionMethodSourcePage && tender.submissionMethodSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
  ];
  // Only include APPLICABLE endpoint fields — changing a non-applicable
  // endpoint must NOT stale the plan.
  if (isEmailSubmissionMethod(method)) {
    evidence.push({ fieldKey: "submissionEmails", effectiveValue: tender.submissionEmails ?? null, sourceTenderFileId: tender.submissionEmailSourceFileId ?? null, sourcePage: tender.submissionEmailSourcePage ?? null, sourceQuote: (tender as any).submissionEmailSourceQuote ?? null, evidenceState: (tender.submissionEmailSourceFileId && tender.submissionEmailSourcePage && (tender as any).submissionEmailSourceQuote) ? "GROUNDED" : "UNGROUNDED" });
  } else if (isPhysicalSubmissionMethod(method)) {
    evidence.push({ fieldKey: "submissionAddress", effectiveValue: tender.submissionAddress ?? null, sourceTenderFileId: tender.submissionAddressSourceFileId ?? null, sourcePage: tender.submissionAddressSourcePage ?? null, sourceQuote: tender.submissionAddressSourceQuote ?? null, evidenceState: (tender.submissionAddressSourceFileId && tender.submissionAddressSourcePage && tender.submissionAddressSourceQuote) ? "GROUNDED" : "UNGROUNDED" });
  } else if (isPortalSubmissionMethod(method)) {
    // Portal: include whichever endpoint exists
    if (tender.submissionEmails) {
      evidence.push({ fieldKey: "submissionEmails", effectiveValue: tender.submissionEmails ?? null, sourceTenderFileId: tender.submissionEmailSourceFileId ?? null, sourcePage: tender.submissionEmailSourcePage ?? null, sourceQuote: (tender as any).submissionEmailSourceQuote ?? null, evidenceState: (tender.submissionEmailSourceFileId && tender.submissionEmailSourcePage && (tender as any).submissionEmailSourceQuote) ? "GROUNDED" : "UNGROUNDED" });
    }
    if (tender.submissionAddress) {
      evidence.push({ fieldKey: "submissionAddress", effectiveValue: tender.submissionAddress ?? null, sourceTenderFileId: tender.submissionAddressSourceFileId ?? null, sourcePage: tender.submissionAddressSourcePage ?? null, sourceQuote: tender.submissionAddressSourceQuote ?? null, evidenceState: (tender.submissionAddressSourceFileId && tender.submissionAddressSourcePage && tender.submissionAddressSourceQuote) ? "GROUNDED" : "UNGROUNDED" });
    }
  } else {
    // Unknown/empty/malformed submission method: do NOT add endpoint evidence.
    // The validator (validateCriticalMetadataEvidenceForBuildPlan) will block
    // unknown methods anyway, so the hash only needs the 4 core fields above.
    // Adding fallback address evidence here would be inconsistent with the
    // fail-closed policy.
  }
  input.metadataEvidence = evidence;
  // Include metadata overrides in hash so override changes stale the plan
  input.metadataOverrides = (tender as any).metadataOverrides ?? [];

  return input;
}

/**
 * A recorded plan is valid only when its stored hash matches the hash recomputed
 * from the tender's CURRENT state.
 */
export function isBuildPlanValid(recordedHash: string, input: BuildPlanHashInput): boolean {
  return recordedHash === computeBuildPlanHash(input);
}
