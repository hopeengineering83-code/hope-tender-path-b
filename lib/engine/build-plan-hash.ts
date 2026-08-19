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
  // Plan-driving fields (not metadata) — these are part of the submission
  // scope, not the effective metadata values.
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  items?: BuildPlanHashItem[];
  // ONE canonical resolved effective-metadata result. The hash uses ONLY
  // this array (effective values + source grounding + override state) —
  // raw metadata fields (submissionMethod, submissionAddress, deadline,
  // title, etc.) are NEVER read directly from the tender.
  metadataEvidence?: BuildPlanHashMetadataEvidence[];
  metadataOverrides?: Array<{
    field: string;
    fieldState: string;
    overrideValue: string | null;
    reason?: string | null;
    confirmationBasis?: string | null;
    authorityClass?: string | null;
    confirmedAt?: Date | null;
  }>;
};

const UNIT = "\x01"; // field separator unlikely to appear in tender text

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
    .map((o) => `ov:${o.field}|${o.fieldState}|${o.overrideValue ?? ""}|${o.reason ?? ""}|${o.confirmationBasis ?? ""}|${o.authorityClass ?? ""}`)
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
  files: BuildPlanHashFile[];
  requirements: BuildPlanHashRequirement[];
}): BuildPlanHashInput {
  // ONLY plan-driving fields are set here. Raw metadata fields
  // (submissionMethod, submissionAddress, submissionEmails, deadline, title,
  // etc.) are intentionally NOT included — the hash uses ONLY the resolved
  // effective-metadata result (metadataEvidence) built by
  // buildCanonicalBuildPlanHashInput.
  return {
    activeFiles: tender.files,
    requirements: tender.requirements,
    exactFileNaming: tender.exactFileNaming ?? null,
    exactFileOrder: tender.exactFileOrder ?? null,
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

  // ─── ONE CANONICAL RESOLVED EFFECTIVE-METADATA RESULT ───────────────────
  // The hash uses ONLY the output of resolveCanonicalFieldState (the shared
  // resolver) for metadata — it does NOT read raw tender metadata fields
  // directly. This ensures the hash and the gate use the SAME resolved
  // effective values, source grounding, and override state, with zero
  // possibility of divergence.
  const { resolveCanonicalFieldState } = require("./canonical-field-state");
  const fieldState = resolveCanonicalFieldState({
    tender: {
      ...tender,
      deadline: tender.deadline ?? null,
      clientNameSourcePage: tender.clientNameSourcePage ?? null,
      clientNameSourceQuote: tender.clientNameSourceQuote ?? null,
      clientNameSourceFileId: tender.clientNameSourceFileId ?? null,
      submissionMethodSourcePage: tender.submissionMethodSourcePage ?? null,
      submissionMethodSourceQuote: tender.submissionMethodSourceQuote ?? null,
      submissionMethodSourceFileId: tender.submissionMethodSourceFileId ?? null,
      submissionAddressSourcePage: tender.submissionAddressSourcePage ?? null,
      submissionAddressSourceQuote: tender.submissionAddressSourceQuote ?? null,
      submissionAddressSourceFileId: tender.submissionAddressSourceFileId ?? null,
      submissionEmailSourcePage: tender.submissionEmailSourcePage ?? null,
      submissionEmailSourceFileId: tender.submissionEmailSourceFileId ?? null,
      submissionEmailSourceQuote: (tender as any).submissionEmailSourceQuote ?? null,
      titleSourceFileId: (tender as any).titleSourceFileId ?? null,
      titleSourcePage: (tender as any).titleSourcePage ?? null,
      titleSourceQuote: (tender as any).titleSourceQuote ?? null,
      deadlineSourceFileId: (tender as any).deadlineSourceFileId ?? null,
      deadlineSourcePage: (tender as any).deadlineSourcePage ?? null,
      deadlineSourceQuote: (tender as any).deadlineSourceQuote ?? null,
      contactDetailsSourceJson: (tender as any).contactDetailsSourceJson ?? null,
      metadataContaminated: (tender as any).metadataContaminated ?? false,
    },
    overrides: ((tender as any).metadataOverrides ?? []).map((o: any) => ({
      field: o.field,
      fieldState: o.fieldState,
      overrideValue: o.overrideValue,
      reason: o.reason ?? null,
      overriddenBy: o.overriddenBy ?? null,
      createdAt: o.createdAt ?? new Date(0),
      confirmationBasis: o.confirmationBasis ?? null,
      authorityClass: o.authorityClass ?? null,
      confirmedAt: o.confirmedAt ?? null,
    })),
    hasExtractedRequirements: (tender.requirements ?? []).length > 0,
    submissionMethodContext: tender.submissionMethod ?? undefined,
    // Filter to ACTIVE files only — defense-in-depth. The sole caller
    // (computeTenderBuildPlanHash) pre-filters files to deletionStatus=ACTIVE,
    // but this function's own type doc says callers can pass the full file
    // list. Filter here so a future caller passing unfiltered files cannot
    // accidentally let a deleted/superseded TenderFile's evidence count
    // as GROUNDED.
    activeTenderFileIds: new Set(
      (tender.files ?? [])
        .filter((f: any) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")
        .map((f: any) => f.id),
    ),
  });

  // Map the resolver output to the hash evidence format. Only include
  // policy-critical fields (title, clientName, deadline, submissionMethod,
  // and the applicable endpoint based on the EFFECTIVE submission method
  // from the resolver — NOT raw tender.submissionMethod).
  //
  // Using the resolver's effective submissionMethod ensures that a
  // USER_EDITED / USER_CONFIRMED override on submissionMethod changes
  // which endpoint evidence is included in the hash. For example, if the
  // raw tender has submissionMethod="email" but the user overrides it to
  // "physical", the hash MUST switch from submissionEmails evidence to
  // submissionAddress evidence — otherwise the override would not stale
  // the confirmed BuildPlan.
  const submissionMethodField = fieldState.fields.find((f: any) => f.fieldKey === "submissionMethod");
  const effectiveMethod = submissionMethodField?.effectiveValue ?? null;
  const criticalFieldKeys = new Set(["title", "clientName", "deadline", "submissionMethod", "reference"]);
  // Add the applicable endpoint field(s) based on the EFFECTIVE submission
  // method from the resolver.
  if (isEmailSubmissionMethod(effectiveMethod)) {
    criticalFieldKeys.add("submissionEmails");
    criticalFieldKeys.add("submissionEmailSubject");
  } else if (isPhysicalSubmissionMethod(effectiveMethod)) {
    criticalFieldKeys.add("submissionAddress");
  } else if (isPortalSubmissionMethod(effectiveMethod)) {
    criticalFieldKeys.add("submissionEmails");
    criticalFieldKeys.add("submissionAddress");
    criticalFieldKeys.add("submissionEmailSubject");
  }
  // Unknown/empty effective submission method: only the 4 core fields are
  // included. The validator (validateCriticalMetadataEvidenceForBuildPlan)
  // will block unknown methods — the hash does not need endpoint evidence.

  const evidence: BuildPlanHashMetadataEvidence[] = fieldState.fields
    .filter((f: any) => criticalFieldKeys.has(f.fieldKey))
    .map((f: any) => ({
      fieldKey: f.fieldKey,
      effectiveValue: f.effectiveValue ?? null,
      sourceTenderFileId: f.sourceFileId ?? null,
      sourcePage: f.sourcePage ?? null,
      sourceQuote: f.sourceQuote ?? null,
      evidenceState: f.isGrounded ? "GROUNDED" : "UNGROUNDED",
    }));
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
