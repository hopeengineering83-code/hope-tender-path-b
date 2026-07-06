/**
 * Candidate Pipeline — wires the evidence-candidate model into metadata extraction.
 *
 * THE PROBLEM
 * The existing metadata extraction flow (tender-upload-first, auto-fill-tender-metadata,
 * re-extract-metadata, AI Analyze) writes field VALUES directly to scalar Tender
 * columns (clientName, reference, deadline, submissionMethod, ...) without first
 * routing them through the evidence-candidate model defined in
 * lib/engine/evidence-candidate.ts.
 *
 * That model exists but was never invoked. Candidates were never built, never
 * classified into CANDIDATE/GROUNDED/CONFIRMED/NEEDS_REVIEW/REJECTED/STALE, never
 * checked for competing values, never auto-confirmed, never stale-marked. The
 * evidence-candidate.ts module's pure functions were tested in isolation but
 * never integrated.
 *
 * THE FIX
 * This module is the integration layer. It takes the same inputs as the existing
 * enrichment (extracted metadata + per-file texts) and produces:
 *
 *   1. A list of TenderFactCandidate records — one per (field, value) pair found.
 *   2. A promotion decision per candidate: AUTO_CONFIRMED, GROUNDED, NEEDS_REVIEW,
 *      REJECTED, DEFERRED.
 *   3. A scalar patch (the values to write to the Tender table) — only contains
 *      fields whose candidate was AUTO_CONFIRMED or GROUNDED with no competing
 *      candidates.
 *   4. A rejected-candidates log (for UI surfacing — "we found a value but
 *      rejected it because ...").
 *
 * The existing enrichment flow (enrichMetadataWithSourceEvidence) is preserved
 * for backward compatibility — it still produces source-evidence columns. This
 * module sits ABOVE it: it consumes the same per-file texts, builds candidates,
 * and decides which values are safe to promote.
 *
 * CRITICAL INVARIANTS
 *   - A candidate with validationResult === "invalid" or "placeholder" is always
 *     REJECTED. The scalar patch NEVER contains an invalid value.
 *   - A candidate with competing candidates (different normalized values for the
 *     same field) is NEEDS_REVIEW. The scalar patch may contain the
 *     highest-confidence candidate (with a warning) OR be omitted entirely
 *     (safer). We choose the safer option: omit.
 *   - A candidate is GROUNDED only when isEvidenceUsable returns true.
 *   - A candidate is AUTO_CONFIRMED only when canAutoConfirm returns true.
 *   - Stale candidates are never promoted.
 */

import type { PrismaClient } from "@prisma/client";
import {
  determineCandidateStatus,
  canAutoConfirm,
  markStale,
  isEvidenceUsable,
  type TenderFactCandidate,
  type CandidateType,
  type CandidateStatus,
} from "./evidence-candidate";
import {
  isPlaceholderClientName,
  isValidClientName,
  isValidReferenceNumber,
} from "./metadata-validators";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Per-file context needed to build candidates. */
export type CandidateFileContext = {
  id: string;
  extractedText: string | null;
  totalPages: number | null;
  contentHash: string | null;
  deletionStatus?: string | null;
};

/** The input shape for buildCandidatesFromMetadata. */
export type CandidatePipelineInput = {
  /** The extracted metadata values (one per field). */
  values: Record<string, string | Date | null | undefined>;
  /** The files to search for source evidence. */
  files: CandidateFileContext[];
  /** The candidate type to assign (regex, ai, manual, override). */
  candidateType?: CandidateType;
  /** The extraction source label (e.g., "regex:inferClientName"). */
  extractionSourcePrefix?: string;
};

/** A single candidate record produced by the pipeline. */
export type CandidateRecord = TenderFactCandidate & {
  /** The promotion decision for this candidate. */
  promotionDecision: "AUTO_CONFIRMED" | "GROUNDED" | "NEEDS_REVIEW" | "REJECTED" | "DEFERRED";
  /** The reason for the decision (if not AUTO_CONFIRMED). */
  decisionReason: string | null;
  /** The number of competing candidates with different values. */
  competingCount: number;
};

/** The pipeline output. */
export type CandidatePipelineOutput = {
  /** All candidates produced (one per field that had a value). */
  candidates: CandidateRecord[];
  /** The scalar patch to write to the Tender table — only AUTO_CONFIRMED + GROUNDED. */
  scalarPatch: Record<string, string | Date | null>;
  /** The source-evidence patch to write — only for AUTO_CONFIRMED + GROUNDED. */
  evidencePatch: Record<string, string | number | null>;
  /** Rejected candidates (for UI surfacing). */
  rejected: Array<{ field: string; value: string; reason: string }>;
  /** Needs-review candidates (for UI surfacing). */
  needsReview: Array<{ field: string; value: string; reason: string }>;
  /** A summary count for logging. */
  summary: {
    total: number;
    autoConfirmed: number;
    grounded: number;
    needsReview: number;
    rejected: number;
    deferred: number;
  };
};

// ─── Validation helpers ─────────────────────────────────────────────────────

/**
 * Validate a field value. Returns "valid", "invalid", "placeholder", or "unverified".
 *
 * "valid" — the value passes field-specific validation.
 * "invalid" — the value fails field-specific validation (e.g., malformed deadline).
 * "placeholder" — the value is a known placeholder ("TBD", "N/A", "Bid-Team to confirm").
 * "unverified" — the value cannot be validated (no validator for this field).
 */
function validateFieldValue(field: string, value: string): "valid" | "invalid" | "placeholder" | "unverified" {
  if (!value || !value.trim()) return "invalid";
  const trimmed = value.trim();

  // Placeholders — apply to ALL fields
  const placeholderPatterns = [
    /^(?:tbd|tba|n\/a|na|unknown|none|not\s+specified|not\s+set|bid[-\s]?team\s+to\s+confirm|to\s+be\s+confirmed|to\s+be\s+determined|pending|awaiting)$/i,
  ];
  if (placeholderPatterns.some((re) => re.test(trimmed))) return "placeholder";

  // Field-specific validators
  switch (field) {
    case "clientName":
      if (!isValidClientName(trimmed)) return "invalid";
      if (isPlaceholderClientName(trimmed)) return "placeholder";
      return "valid";
    case "reference":
      if (!isValidReferenceNumber(trimmed)) return "invalid";
      return "valid";
    case "deadline":
      // Deadline should be a parseable date
      const parsed = new Date(trimmed);
      if (isNaN(parsed.getTime())) return "invalid";
      return "valid";
    case "submissionMethod":
      // Must be one of the known methods
      if (/email|physical|portal|hand|courier|sealed|e-procurement|e-tendering/i.test(trimmed)) return "valid";
      return "unverified";
    default:
      return "unverified";
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute the source-content hash for a candidate. Currently uses the file's
 * contentHash if available; otherwise returns null.
 */
function computeSourceContentHash(file: CandidateFileContext | null): string | null {
  return file?.contentHash ?? null;
}

/**
 * Find the source evidence for a value across all active files. Returns the
 * first file (in stable id order) that contains the value, with the page +
 * quote evidence.
 *
 * Mirrors the locateValueInFiles logic in metadata-source-enrichment.ts but
 * returns the file context too (so the candidate can store its contentHash).
 */
function locateValueEvidence(
  value: string,
  files: CandidateFileContext[],
): { file: CandidateFileContext; page: number | null; quote: string } | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 3) return null;

  // Reuse the same page-computation logic as metadata-source-enrichment.
  // We import it lazily to avoid a circular dependency at module load time.
  // The enrichment module's locateValueInFile is internal — we replicate the
  // minimal logic here. This keeps candidate-pipeline self-contained.

  const normalizedValue = trimmed.toLowerCase().replace(/\s+/g, " ").trim();

  const active = files
    .filter((f) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE" && f.extractedText)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const f of active) {
    if (!f.extractedText) continue;
    const normalizedText = f.extractedText.toLowerCase().replace(/\s+/g, " ").trim();
    const idx = normalizedText.indexOf(normalizedValue);
    if (idx < 0) continue;

    // Compute page number from the original text position
    const origText = f.extractedText;
    // Find the original-text offset that corresponds to the normalized match.
    // We re-scan the original text and build a normalized form, tracking offsets.
    let normalized = "";
    const map: number[] = [];
    let pendingSpace = false;
    for (let i = 0; i < origText.length; i++) {
      const ch = origText[i].toLowerCase();
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || /\s/.test(ch)) {
        if (normalized.length > 0) pendingSpace = true;
        continue;
      }
      if (pendingSpace) {
        normalized += " ";
        map.push(i);
        pendingSpace = false;
      }
      normalized += ch;
      map.push(i);
    }
    const origIdx = map[idx];
    if (typeof origIdx !== "number") continue;

    // Page computation
    const before = origText.slice(0, origIdx);
    let page: number | null = null;
    const bracketMarkers = before.match(/\[Page\s+(\d+)\]/gi);
    if (bracketMarkers && bracketMarkers.length > 0) {
      const m = bracketMarkers[bracketMarkers.length - 1].match(/(\d+)/);
      if (m) page = parseInt(m[1], 10);
    }
    if (page === null) {
      const formFeeds = (before.match(/\f/g) || []).length;
      if (formFeeds > 0) page = formFeeds + 1;
    }
    if (page === null) {
      const pageMarkers = before.match(/(?:^|\n)[-\s]*Page\s+(\d+)/gi);
      if (pageMarkers && pageMarkers.length > 0) {
        const m = pageMarkers[pageMarkers.length - 1].match(/(\d+)/);
        if (m) page = parseInt(m[1], 10);
      }
    }
    if (page === null && f.totalPages === 1) page = 1;
    // Clamp page to totalPages if known
    if (page !== null && f.totalPages !== null && f.totalPages > 0 && page > f.totalPages) {
      page = null; // Impossible page → fail-closed
    }

    // Quote — capture surrounding context
    const quoteStart = Math.max(0, origIdx - 100);
    const quoteEnd = Math.min(origText.length, quoteStart + 200);
    const quote = origText.slice(quoteStart, quoteEnd).trim();

    return { file: f, page, quote };
  }
  return null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build candidates from extracted metadata values + per-file texts.
 *
 * For each non-null value, this function:
 *   1. Validates the value (valid / invalid / placeholder / unverified).
 *   2. Locates source evidence (file, page, quote) by searching the file texts.
 *   3. Determines the candidate status (GROUNDED / CANDIDATE / REJECTED /
 *      NEEDS_REVIEW) using determineCandidateStatus.
 *   4. Decides whether to promote the value to the scalar patch.
 *
 * The scalar patch is safe to apply directly to the Tender table — it only
 * contains AUTO_CONFIRMED or GROUNDED candidates with no competing values.
 */
export function buildCandidatesFromMetadata(
  input: CandidatePipelineInput,
): CandidatePipelineOutput {
  const candidateType: CandidateType = input.candidateType ?? "regex";
  const extractionSourcePrefix = input.extractionSourcePrefix ?? "regex";
  const now = new Date();

  const candidates: CandidateRecord[] = [];
  const rejected: Array<{ field: string; value: string; reason: string }> = [];
  const needsReview: Array<{ field: string; value: string; reason: string }> = [];
  const scalarPatch: Record<string, string | Date | null> = {};
  const evidencePatch: Record<string, string | number | null> = {};

  // Track values per field so we can detect competing candidates
  const valuesByField = new Map<string, Array<{ value: string; normalized: string }>>();

  // First pass: collect all (field, value) pairs
  for (const [field, rawValue] of Object.entries(input.values)) {
    if (rawValue === null || rawValue === undefined) continue;
    const value = rawValue instanceof Date ? rawValue.toISOString().slice(0, 10) : String(rawValue);
    if (!value.trim()) continue;
    const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
    if (!valuesByField.has(field)) valuesByField.set(field, []);
    valuesByField.get(field)!.push({ value, normalized });
  }

  // Second pass: build candidates with competing-count awareness
  for (const [field, valueEntries] of valuesByField.entries()) {
    // Detect competing values (different normalized values for the same field)
    const uniqueNormalized = new Set(valueEntries.map((v) => v.normalized));
    const competingCount = uniqueNormalized.size - 1; // -1 for the candidate's own value

    for (const { value } of valueEntries) {
      const validationResult = validateFieldValue(field, value);

      // Locate source evidence
      const evidence = locateValueEvidence(value, input.files);
      const tenderFileId = evidence?.file.id ?? null;
      const pageNumber = evidence?.page ?? null;
      const exactQuote = evidence?.quote ?? null;
      const sourceContentHash = computeSourceContentHash(evidence?.file ?? null);

      // Build the candidate (without status/hasCompetingCandidates/isStale — those are computed)
      const candidateBase = {
        field,
        candidateType,
        normalizedValue: value.toLowerCase().replace(/\s+/g, " ").trim(),
        originalValue: value,
        confidence: evidence ? 0.9 : 0.5, // Higher confidence when source evidence is found
        tenderFileId,
        pageNumber,
        exactQuote,
        sourceContentHash,
        extractionSource: `${extractionSourcePrefix}:${field}`,
        validationResult,
        createdAt: now,
        isStale: false,
      };

      // Determine the candidate status
      const status: CandidateStatus = determineCandidateStatus(candidateBase, competingCount);

      // Determine whether the evidence is usable (grounded)
      let evidenceUsable = false;
      if (evidence && tenderFileId && pageNumber !== null && exactQuote) {
        const activeFileIds = new Set(input.files.map((f) => f.id));
        evidenceUsable = isEvidenceUsable(
          { tenderFileId, pageNumber, exactQuote, sourceContentHash },
          activeFileIds,
          evidence.file.totalPages,
          evidence.file.extractedText,
          evidence.file.contentHash,
        );
      }

      // Build the full candidate record
      const candidate: TenderFactCandidate = {
        ...candidateBase,
        status,
        hasCompetingCandidates: competingCount > 0,
      };

      // Decide promotion
      let promotionDecision: CandidateRecord["promotionDecision"] = "DEFERRED";
      let decisionReason: string | null = null;

      if (status === "REJECTED") {
        promotionDecision = "REJECTED";
        decisionReason = `Value failed validation: ${validationResult}`;
        rejected.push({ field, value, reason: decisionReason });
      } else if (status === "NEEDS_REVIEW") {
        promotionDecision = "NEEDS_REVIEW";
        decisionReason = `Competing candidates exist (${competingCount} other value(s))`;
        needsReview.push({ field, value, reason: decisionReason });
      } else if (canAutoConfirm(candidate, competingCount) && evidenceUsable) {
        promotionDecision = "AUTO_CONFIRMED";
        decisionReason = null;
        // Promote to scalar patch
        scalarPatch[field] = value;
        // Promote to evidence patch
        if (tenderFileId) evidencePatch[`${field}SourceFileId`] = tenderFileId;
        if (pageNumber !== null) evidencePatch[`${field}SourcePage`] = pageNumber;
        if (exactQuote) evidencePatch[`${field}SourceQuote`] = exactQuote;
      } else if (status === "GROUNDED" && evidenceUsable && competingCount === 0) {
        promotionDecision = "GROUNDED";
        decisionReason = null;
        // Promote to scalar patch
        scalarPatch[field] = value;
        // Promote to evidence patch
        if (tenderFileId) evidencePatch[`${field}SourceFileId`] = tenderFileId;
        if (pageNumber !== null) evidencePatch[`${field}SourcePage`] = pageNumber;
        if (exactQuote) evidencePatch[`${field}SourceQuote`] = exactQuote;
      } else if (status === "CANDIDATE") {
        promotionDecision = "DEFERRED";
        decisionReason = "Value found but no source evidence — deferred pending manual review";
      } else if (status === "GROUNDED" && !evidenceUsable) {
        promotionDecision = "DEFERRED";
        decisionReason = "Evidence located but not usable (deleted file, out-of-range page, or quote not in text)";
      } else {
        promotionDecision = "DEFERRED";
        decisionReason = `Status ${status} with competing=${competingCount}, evidenceUsable=${evidenceUsable}`;
      }

      candidates.push({ ...candidate, promotionDecision, decisionReason, competingCount });
    }
  }

  // Build summary
  const summary = {
    total: candidates.length,
    autoConfirmed: candidates.filter((c) => c.promotionDecision === "AUTO_CONFIRMED").length,
    grounded: candidates.filter((c) => c.promotionDecision === "GROUNDED").length,
    needsReview: candidates.filter((c) => c.promotionDecision === "NEEDS_REVIEW").length,
    rejected: candidates.filter((c) => c.promotionDecision === "REJECTED").length,
    deferred: candidates.filter((c) => c.promotionDecision === "DEFERRED").length,
  };

  return { candidates, scalarPatch, evidencePatch, rejected, needsReview, summary };
}

/**
 * Mark existing candidates as STALE when a field value changes.
 *
 * This is called when a user manually edits a Tender field. The previous
 * candidates for that field (with the old value) are marked STALE so they
 * no longer count toward the canonical resolver's grounding checks.
 *
 * In the current architecture, candidates are not yet persisted to a DB table
 * (the schema doesn't have a TenderFactCandidate model). This function is a
 * pure helper: it takes the existing candidates + the new value, and returns
 * the updated list with stale candidates marked.
 *
 * When the TenderFactCandidate DB table is added in a future migration, this
 * function will be replaced by a DB update.
 */
export function markStaleOnValueChange(
  existingCandidates: TenderFactCandidate[],
  field: string,
  newValue: string,
): TenderFactCandidate[] {
  const newNormalized = newValue.toLowerCase().replace(/\s+/g, " ").trim();
  return existingCandidates.map((c) => {
    if (c.field !== field) return c;
    if (c.normalizedValue === newNormalized) return c;
    return markStale(c, newNormalized);
  });
}

/**
 * Apply a candidate pipeline output to the Tender table.
 *
 * This is the bridge between the candidate pipeline and the existing Tender
 * scalar columns. It writes:
 *   - The scalar patch (only AUTO_CONFIRMED + GROUNDED values)
 *   - The evidence patch (sourceFileId / sourcePage / sourceQuote columns)
 *
 * Rejected and needs-review candidates are NOT written — they're returned in
 * the pipeline output for the caller to surface in the UI.
 *
 * Returns the count of fields updated.
 */
export async function applyCandidatePipelineToTender(
  tenderId: string,
  pipeline: CandidatePipelineOutput,
  prisma: PrismaClient,
): Promise<{ updatedFields: string[]; rejectedCount: number; needsReviewCount: number }> {
  if (Object.keys(pipeline.scalarPatch).length === 0 && Object.keys(pipeline.evidencePatch).length === 0) {
    return { updatedFields: [], rejectedCount: pipeline.rejected.length, needsReviewCount: pipeline.needsReview.length };
  }

  const patch: Record<string, unknown> = {
    ...pipeline.scalarPatch,
    ...pipeline.evidencePatch,
  };

  await prisma.tender.update({
    where: { id: tenderId },
    data: patch,
  });

  return {
    updatedFields: Object.keys(pipeline.scalarPatch),
    rejectedCount: pipeline.rejected.length,
    needsReviewCount: pipeline.needsReview.length,
  };
}
