import { Tender } from "@prisma/client";
import {
  isValidClientName,
  isPlaceholderClientName,
  isGarbageClientName,
  isClientNameContaminated,
  clientNameContaminationReason,
  containsMetadataPlaceholder,
} from "./metadata-validators";

export type PreGenerationValidationResult = {
  valid: boolean;
  blockers: string[];
  warnings: string[];
};

/**
 * Pre-generation validation gate.
 *
 * For DRAFT_GENERATION (called from /generate):
 *   Metadata issues (placeholder, contamination, missing source) are
 *   WARNINGS only — they never make valid=false. Draft work proceeds
 *   with unavailable metadata omitted from generated output.
 *
 * For FINAL_SUBMISSION_READY (called via validateTenderBeforeExport):
 *   Stricter — blocks on placeholder, contamination, and deadline-in-past.
 *
 * The operation gate (lib/engine/tender-operation-gate.ts) is the sole
 * authority for metadata eligibility. This function is kept for backward
 * compatibility with routes that call it directly.
 */
export async function validateTenderBeforeGeneration(
  tender: Tender & {
    requirements: Array<{ id: string; sourcePageNumber?: number | null; sourceQuote?: string | null }>;
    clientNameSourcePage?: number | null;
    clientNameSourceQuote?: string | null;
  },
): Promise<PreGenerationValidationResult> {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // ── Metadata issues are WARNINGS for draft work ─────────────────────
  // Placeholder client name — warning (omitted from output, not a blocker)
  if (tender.clientName && isPlaceholderClientName(tender.clientName)) {
    warnings.push(
      `clientName is a placeholder ("${tender.clientName}") — omitted from draft output.`
    );
  }

  // Placeholder submission method — warning
  if (tender.submissionMethod && containsMetadataPlaceholder(tender.submissionMethod)) {
    warnings.push(
      `submissionMethod contains placeholder text — omitted from draft output.`
    );
  }

  // Contaminated client name — warning (omitted, neutral framing used)
  if (tender.clientName && isClientNameContaminated(tender.clientName)) {
    const reason = clientNameContaminationReason(tender.clientName);
    warnings.push(
      reason ||
        `Client name appears contaminated by portal/navigation text — omitted from draft output.`
    );
  }

  // Source traceability missing — warning (not a blocker for draft)
  if (
    tender.clientName &&
    isValidClientName(tender.clientName) &&
    !isGarbageClientName(tender.clientName) &&
    (!tender.clientNameSourcePage || !tender.clientNameSourceQuote)
  ) {
    warnings.push(
      `Client name extracted but source page/quote missing — re-run AI Analyze to capture the source.`
    );
  }

  // ── Requirements source traceability ─────────────────────────────────
  const requirementsWithoutSource = tender.requirements.filter(
    (r) => !r.sourcePageNumber || !r.sourceQuote
  );
  if (requirementsWithoutSource.length > 0) {
    warnings.push(
      `${requirementsWithoutSource.length} requirement(s) extracted but source page/quote missing.`
    );
  }

  // ── Deadline in the past (warning, not generation blocker) ────────────
  if (tender.deadline && new Date(tender.deadline) < new Date()) {
    warnings.push(
      `Submission deadline has passed — export will be blocked but draft work proceeds.`
    );
  }

  // For DRAFT_GENERATION: valid is always true — metadata never blocks draft work.
  return {
    valid: true,
    blockers: [],
    warnings,
  };
}

/**
 * Check if a tender is ready for export. Stricter than generation —
 * blocks on all generation blockers PLUS deadline-in-past.
 */
export function validateTenderBeforeExport(tender: Tender): PreGenerationValidationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (tender.clientName && isPlaceholderClientName(tender.clientName)) {
    blockers.push(`clientName is a placeholder. Cannot export with unverified metadata.`);
  }

  if (tender.clientName && isClientNameContaminated(tender.clientName)) {
    blockers.push(`clientName is contaminated. Cannot export with mixed/corrupted metadata.`);
  }

  // Deadline-in-past IS a hard block for export
  if (tender.deadline && new Date(tender.deadline) < new Date()) {
    blockers.push(
      `Submission deadline has passed (${tender.deadline.toISOString().split("T")[0]}). Late submissions are typically rejected by evaluators. Export is blocked.`
    );
  }

  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
  };
}
